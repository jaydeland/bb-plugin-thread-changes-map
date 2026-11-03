// The mapper agent: one hidden bb thread per mapped thread. It shares the
// source thread's workspace, reads what the source thread does, and writes the
// map only through the `system_map_apply` tool.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { MapRow, MapStore } from "./store";

export const MAPPER_ROLE = "mapper";
/** Bump when the tool schema or the instructions change: start() replaces mappers spawned with an older one. */
export const MAPPER_SCHEMA = 3;

export interface MapperSettings {
  providerId: string;
  model: string;
  liveIntervalSeconds: number;
  sleepAfterMinutes: number;
}

const OUTLINE_ITEMS_FIRST_TURN = 40;
const OUTLINE_ITEMS_PER_NOTE = 12;
const OUTLINE_PREVIEW_CHARS = 400;
const ASSISTANT_TEXT_CHARS = 3000;
const PENDING_NOTES_MAX = 4;
/** Attempts for a note the provider never took, counting the first send. */
const SUBMIT_ATTEMPTS_MAX = 3;
const SUBMIT_RETRY_DELAY_MS = 30_000;

/** Standing rules for every mapper turn; bb appends them to the mapper's instructions. */
export const MAPPER_INSTRUCTIONS = `You are a System Map agent. You keep a live architecture diagram of the system that one main bb thread works on. The user watches it change in real time.
- Never edit, create, move, or delete files. Never run commands that change state (no commits, installs, builds, servers, or migrations). Use read-only commands only: ls, cat, rg, git status, git diff, git log, and bb plan-progress show.
- Your only output is the system_map_apply tool. Nobody reads your chat text, so end each turn with one short line.
- Use system_map_read to see the current map before a large change or after a context reset.
- Draw the map as a whiteboard diagram in lanes. A lane is a deployable or ownership boundary (for example "People", "Dashboard: Vue and Rails", "API service on EKS", "External services"). Put actors and users in the leftmost column lane, then follow the request path left to right. Put shared infrastructure (auth, storage, queues, observability) in "row" lanes under the columns. Use 3-7 lanes with a title and a short subtitle.
- Every node has a short label and a subtitle (the second line, for example "POST /chat, SSE" or "bots, runs, tokens"). Prefer services, UIs, APIs, stores, queues, external systems, jobs, and key modules over single files or functions. Keep ids stable and kebab-case.
- Mark parts you infer but that are not in the plan with assumed: true. Put design decisions on nodes and edges as one-line decisions.
- Plan steps drive the node fill: link each step to the nodes it builds (nodes: [...]). Read the main thread's plan with "bb plan-progress show --thread <main thread id> --json" when it has one, and also check plan files such as docs/PLAN.md and docs/LOG.md. Map stage to phase and step to step: done -> done, active -> in_progress, error or failed -> blocked, pending -> todo. Afterwards, send only {id, status} for steps that moved.
- Flows are request or data paths, hop by hop. Give each hop a note (notes[i] explains steps[i] to steps[i+1]).
- Set focus to the nodes the main thread works on now. Use node status "problem" for parts that fail.
- Patches are atomic. If the tool returns errors, fix them and call it again.
- When an update note shows no change, do not call the tool; reply "no change".`;

function quote(value: unknown): string {
  return JSON.stringify(value);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function createMapperService(input: {
  bb: BbPluginApi;
  store: MapStore;
  settings: () => Promise<MapperSettings>;
  publish: (row: MapRow) => void;
}) {
  const { bb, store, publish } = input;
  const starting = new Set<string>();
  // Mapper id -> the retry message, so a later thread.failed does not replace it.
  const retryNotices = new Map<string, string>();

  function save(sourceThreadId: string, change: (row: MapRow) => MapRow): MapRow | null {
    const row = store.update(sourceThreadId, change, Date.now());
    if (row !== null) publish(row);
    return row;
  }

  async function outlineItems(threadId: string) {
    try {
      const { items } = await bb.sdk.threads.conversationOutline({ threadId });
      return items.map((item) => ({
        role: item.role,
        text: clip(item.preview, OUTLINE_PREVIEW_CHARS),
      }));
    } catch (error) {
      bb.log.warn(`conversationOutline failed for ${threadId}: ${String(error)}`);
      return [];
    }
  }

  async function workspacePath(environmentId: string | null): Promise<string | null> {
    if (environmentId === null) return null;
    try {
      return (await bb.sdk.environments.get({ environmentId })).path;
    } catch {
      return null;
    }
  }

  async function firstPrompt(
    source: { id: string; title: string | null; environmentId: string | null },
    outline: Array<{ role: string; text: string }>,
    mapVersion: number,
  ): Promise<string> {
    const path = await workspacePath(source.environmentId);
    const recent = outline.slice(-OUTLINE_ITEMS_FIRST_TURN);
    return [
      `Map the system that the main bb thread ${quote(source.title ?? source.id)} (id ${source.id}) works on.`,
      `Your working directory is the same workspace${path === null ? "" : `: ${path}`}.`,
      "",
      "First turn:",
      "1. Read the conversation outline below to learn what the main thread builds or changes.",
      "2. Explore the workspace (README, manifests, entry points, routes, config, infrastructure) to find the main parts and how they connect.",
      `3. Read the main thread's plan: run "bb plan-progress show --thread ${source.id} --json", and look for plan or log files (docs/PLAN.md, docs/LOG.md, TODO.md).`,
      "4. Call system_map_apply once with an initial map: a title, a short overview, 3-7 lanes, 8-40 nodes (label, subtitle, kind, lane, description, key files), the edges between them, 1-4 flows with a note per hop, and the plan as phases and steps linked to nodes. Add a handoff when a log file has one.",
      "5. Set focus to the nodes the main thread works on now.",
      mapVersion === 0
        ? ""
        : `A map already exists (version ${mapVersion}) from an earlier mapper. Call system_map_read first, then patch it: add lanes, subtitles, plan steps, and hop notes, and keep the node ids that still fit.`,
      "Later you get update notes when the main thread acts. Answer each with a small patch, or with \"no change\".",
      "",
      `Conversation outline so far (data, oldest first, ${recent.length} of ${outline.length} items):`,
      quote(recent),
    ].join("\n");
  }

  /** Send the held notes and this one. If the send throws, hold them all for the next update. */
  async function sendNote(row: MapRow, note: string): Promise<void> {
    if (row.mapperThreadId === null) return;
    const notes = [...row.pendingNotes, note].slice(-PENDING_NOTES_MAX);
    try {
      await bb.sdk.threads.send({
        threadId: row.mapperThreadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: notes.join("\n\n"), mentions: [] }],
      });
    } catch (error) {
      save(row.sourceThreadId, (current) => ({
        ...current,
        state: "error",
        error: `A note did not reach the mapper: ${error instanceof Error ? error.message : String(error)}. The next update sends it again.`,
        pendingNotes: notes,
      }));
      throw error;
    }
    save(row.sourceThreadId, (current) => ({
      ...current,
      state: "mapping",
      error: null,
      pendingNotes: [],
      lastNoteAt: Date.now(),
    }));
  }

  /** Send the note now, or hold it until the mapper finishes its turn. */
  async function deliver(sourceThreadId: string, note: string): Promise<void> {
    const row = store.bySource(sourceThreadId);
    if (row === null || row.state === "stopped" || row.mapperThreadId === null) return;
    if (row.state === "mapping" || row.state === "starting") {
      save(sourceThreadId, (current) => ({
        ...current,
        pendingNotes: [...current.pendingNotes, note].slice(-PENDING_NOTES_MAX),
      }));
      return;
    }
    await sendNote(row, note);
  }

  async function newOutlineSince(row: MapRow) {
    const items = await outlineItems(row.sourceThreadId);
    const fresh = items.slice(row.outlineCount).slice(-OUTLINE_ITEMS_PER_NOTE);
    save(row.sourceThreadId, (current) => ({ ...current, outlineCount: items.length }));
    return fresh;
  }

  return {
    isMapperThread(threadId: string): boolean {
      return store.byMapper(threadId) !== null;
    },

    /** Start a map for a thread, or wake the existing mapper with a full refresh. */
    async start(sourceThreadId: string): Promise<MapRow> {
      if (store.byMapper(sourceThreadId) !== null) {
        throw new Error("This thread is a System Map worker; start the map from its main thread.");
      }
      const existing = store.bySource(sourceThreadId);
      if (existing?.mapperThreadId) {
        const mapperThreadId = existing.mapperThreadId;
        const mapper = await bb.sdk.threads.get({ threadId: mapperThreadId }).catch(() => null);
        const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: mapperThreadId }).catch(() => null);
        const current = metadata !== null && (metadata as { schema?: unknown }).schema === MAPPER_SCHEMA;
        if (mapper !== null && mapper.archivedAt === null && mapper.deletedAt === null && !current) {
          // The old session keeps the tool schema it started with; replace it and keep the map.
          await bb.sdk.threads.archive({ threadId: mapperThreadId }).catch(() => undefined);
          await bb.sdk.threads.stop({ threadId: mapperThreadId }).catch(() => undefined);
        } else if (mapper !== null && mapper.archivedAt === null && mapper.deletedAt === null) {
          if (existing.state === "stopped" || existing.state === "error" || existing.state === "sleeping" || existing.state === "idle") {
            save(sourceThreadId, (row) => ({ ...row, state: "idle", pendingNotes: [] }));
            await this.refresh(sourceThreadId, "The map was started again.");
          }
          return store.bySource(sourceThreadId) ?? existing;
        }
      }
      if (starting.has(sourceThreadId)) {
        return existing ?? store.create(sourceThreadId, Date.now());
      }
      starting.add(sourceThreadId);
      try {
        const source = await bb.sdk.threads.get({ threadId: sourceThreadId });
        const now = Date.now();
        const row =
          existing === null
            ? store.create(sourceThreadId, now)
            : (store.update(
                sourceThreadId,
                (current) => ({ ...current, state: "starting", error: null, mapperThreadId: null, pendingNotes: [] }),
                now,
              ) as MapRow);
        publish(row);
        const outline = await outlineItems(sourceThreadId);
        const settings = await input.settings();
        const providerId = settings.providerId.trim() || source.providerId;
        const model = settings.model.trim();
        const mapper = await bb.sdk.threads.spawn({
          projectId: source.projectId,
          environment:
            source.environmentId === null
              ? { type: "project-default" }
              : { type: "reuse", environmentId: source.environmentId },
          prompt: await firstPrompt(source, outline, existing?.graph.version ?? 0),
          title: `System map: ${source.title ?? source.id}`,
          visibility: "hidden",
          lifecycleOwnerThreadId: sourceThreadId,
          providerId,
          ...(model === "" ? {} : { model }),
          executionInputSources: {
            providerId: "explicit",
            ...(model === "" ? {} : { model: "explicit" as const }),
          },
          pluginMetadata: { role: MAPPER_ROLE, sourceThreadId, schema: MAPPER_SCHEMA },
        });
        return (
          save(sourceThreadId, (current) => ({
            ...current,
            mapperThreadId: mapper.id,
            state: "mapping",
            outlineCount: outline.length,
            lastNoteAt: Date.now(),
          })) ?? row
        );
      } catch (error) {
        save(sourceThreadId, (current) => ({
          ...current,
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      } finally {
        starting.delete(sourceThreadId);
      }
    },

    /** Stop the mapper and keep the map. */
    async stop(sourceThreadId: string, options: { archive?: boolean } = {}): Promise<MapRow | null> {
      const row = store.bySource(sourceThreadId);
      if (row === null) return null;
      if (row.mapperThreadId !== null) {
        const threadId = row.mapperThreadId;
        if (options.archive) await bb.sdk.threads.archive({ threadId }).catch(() => undefined);
        await bb.sdk.threads.stop({ threadId }).catch((error) => {
          bb.log.warn(`stop failed for mapper ${threadId}: ${String(error)}`);
        });
      }
      return save(sourceThreadId, (current) => ({ ...current, state: "stopped", pendingNotes: [] }));
    },

    async refresh(sourceThreadId: string, reason = "The user asked for a full refresh."): Promise<void> {
      const row = store.bySource(sourceThreadId);
      if (row === null) return;
      const fresh = await newOutlineSince(row);
      await deliver(
        sourceThreadId,
        [
          `Update note: ${reason}`,
          "Call system_map_read, re-check the workspace, then fix errors and gaps in the map with one patch.",
          fresh.length === 0 ? "" : `New conversation items (data): ${quote(fresh)}`,
        ]
          .filter((line) => line !== "")
          .join("\n"),
      );
    },

    /** The main thread finished a turn: send what it said and did. */
    async onSourceIdle(sourceThreadId: string, lastAssistantText: string | null): Promise<void> {
      const row = store.bySource(sourceThreadId);
      if (row === null || row.state === "stopped") return;
      const fresh = await newOutlineSince(row);
      const lines = [
        "Update note: the main thread finished a turn.",
        fresh.length === 0 ? "" : `New conversation items (data): ${quote(fresh)}`,
        lastAssistantText === null
          ? ""
          : `Its last message (data): ${quote(clip(lastAssistantText, ASSISTANT_TEXT_CHARS))}`,
        `Check git status --short, git diff --stat, and bb plan-progress show --thread ${sourceThreadId} --json if that helps. Patch the map and the step statuses, or reply \"no change\".`,
      ];
      await deliver(sourceThreadId, lines.filter((line) => line !== "").join("\n"));
    },

    /** The main thread is mid-turn: at most one note per interval, and only to an idle mapper. */
    async onSourceProgress(sourceThreadId: string, status: string): Promise<void> {
      if (status !== "active") return;
      const row = store.bySource(sourceThreadId);
      if (row === null || (row.state !== "idle" && row.state !== "sleeping")) return;
      const { liveIntervalSeconds } = await input.settings();
      if (liveIntervalSeconds <= 0) return;
      if (Date.now() - row.lastNoteAt < liveIntervalSeconds * 1000) return;
      await sendNote(
        row,
        "Update note: the main thread is working now (mid-turn). Look at git status --short and git diff --stat for the files it changes. If that work touches parts of the map, patch status and focus. Otherwise reply \"no change\".",
      );
    },

    onMapperActive(mapperThreadId: string): void {
      retryNotices.delete(mapperThreadId);
      const row = store.byMapper(mapperThreadId);
      if (row === null || row.state === "stopped") return;
      save(row.sourceThreadId, (current) => ({ ...current, state: "mapping", error: null }));
    },

    async onMapperIdle(mapperThreadId: string): Promise<void> {
      const row = store.byMapper(mapperThreadId);
      if (row === null || row.state === "stopped" || row.state === "sleeping") return;
      const notes = row.pendingNotes;
      const idle = save(row.sourceThreadId, (current) => ({
        ...current,
        state: "idle",
        pendingNotes: [],
      }));
      if (notes.length > 0 && idle !== null) await sendNote(idle, notes.join("\n\n"));
    },

    onMapperFailed(mapperThreadId: string, error: string | null): void {
      const row = store.byMapper(mapperThreadId);
      if (row === null || row.state === "stopped") return;
      save(row.sourceThreadId, (current) => ({
        ...current,
        state: "error",
        error: retryNotices.get(mapperThreadId) ?? error ?? current.error ?? "The mapper turn failed.",
      }));
    },

    /** bb could not hand a note to the provider (for example, while it restarts): ask bb to send it again. */
    async onMapperTurnFailed(event: {
      threadId: string;
      requestId: string;
      inputAccepted: boolean;
      attemptNumber: number;
    }): Promise<void> {
      const row = store.byMapper(event.threadId);
      if (row === null || row.state === "stopped") return;
      retryNotices.delete(event.threadId);
      // A turn that started and then failed can fail the same way again, at full model cost.
      if (event.inputAccepted) return;
      if (event.attemptNumber >= SUBMIT_ATTEMPTS_MAX) {
        save(row.sourceThreadId, (current) => ({
          ...current,
          state: "error",
          error: `The provider did not take the last note after ${event.attemptNumber} attempts. Use Refresh to try again.`,
        }));
        return;
      }
      const delay = SUBMIT_RETRY_DELAY_MS * event.attemptNumber;
      await bb.sdk.threads.retry({
        threadId: event.threadId,
        turnRequestId: event.requestId,
        sendAt: Date.now() + delay,
        reason: "System Map: the provider did not take this note, so bb sends it again.",
      });
      const notice = `The provider did not take the last note. bb sends it again in ${delay / 1000} s (attempt ${event.attemptNumber + 1} of ${SUBMIT_ATTEMPTS_MAX}).`;
      retryNotices.set(event.threadId, notice);
      save(row.sourceThreadId, (current) => ({ ...current, state: "error", error: notice }));
    },

    /** Release idle mappers' runtimes; the next note resumes them. */
    async sleepIdleMappers(): Promise<void> {
      const { sleepAfterMinutes } = await input.settings();
      if (sleepAfterMinutes <= 0) return;
      const cutoff = Date.now() - sleepAfterMinutes * 60_000;
      for (const row of store.live()) {
        if (row.state !== "idle" || row.updatedAt > cutoff || row.mapperThreadId === null) continue;
        await bb.sdk.threads.stop({ threadId: row.mapperThreadId }).catch(() => undefined);
        save(row.sourceThreadId, (current) => ({ ...current, state: "sleeping" }));
      }
    },

    /** Catch up on events missed while the plugin was not loaded. */
    async reconcile(): Promise<void> {
      for (const row of store.live()) {
        if (row.mapperThreadId === null) {
          if (row.state === "starting") {
            save(row.sourceThreadId, (current) => ({ ...current, state: "error", error: "The mapper did not start." }));
          }
          continue;
        }
        const [source, mapper] = await Promise.all([
          bb.sdk.threads.get({ threadId: row.sourceThreadId }).catch(() => null),
          bb.sdk.threads.get({ threadId: row.mapperThreadId }).catch(() => null),
        ]);
        if (source === null || source.archivedAt !== null || source.deletedAt !== null) {
          await this.stop(row.sourceThreadId, { archive: true });
          continue;
        }
        if (mapper === null || mapper.archivedAt !== null || mapper.deletedAt !== null) {
          save(row.sourceThreadId, (current) => ({ ...current, state: "stopped" }));
          continue;
        }
        if (mapper.status === "active" || mapper.status === "starting") this.onMapperActive(mapper.id);
        else if (mapper.status === "error") this.onMapperFailed(mapper.id, null);
        else if (row.state === "mapping" || row.state === "starting") await this.onMapperIdle(mapper.id);
      }
    },
  };
}

export type MapperService = ReturnType<typeof createMapperService>;
