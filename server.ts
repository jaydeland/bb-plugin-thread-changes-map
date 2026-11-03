// Thread Changes Map: a hidden mapper agent per thread keeps a live architecture and
// flow graph. The side panel (app.tsx) and the browser page (/view) draw it.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAP_CHANNEL } from "./src/constants";
import { MAPPER_INSTRUCTIONS, MAPPER_ROLE, createMapperService } from "./src/mapper";
import { applyPatch, deriveView, describeGraph, patchSchema, type MapDerived, type MapGraph } from "./src/model";
import { renderViewerPage } from "./src/page";
import { createMapStore, type MapRow, type MapState } from "./src/store";

/** What the panel, the page, and the CLI see of one map. */
export interface MapDto {
  sourceThreadId: string;
  mapperThreadId: string | null;
  state: MapState;
  error: string | null;
  graph: MapGraph;
  /** Node fill and plan progress, computed on the server so both views agree. */
  derived: MapDerived;
  updatedAt: number;
}

const threadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "not a thread id");
const threadInput = z.object({ threadId: threadIdSchema }).strict();
const mapOutput = z.object({ map: z.custom<MapDto | null>() });

export const rpcContract = defineRpcContract({
  map_get: {
    input: z
      .object({
        threadId: threadIdSchema,
        /** The page origin the panel runs on, so the CLI can print a URL the user can open. */
        origin: z.string().max(200).optional(),
      })
      .strict(),
    output: z.object({
      map: z.custom<MapDto | null>(),
      isMapper: z.boolean(),
    }),
  },
  map_start: { input: threadInput, output: mapOutput },
  map_stop: { input: threadInput, output: mapOutput },
  map_refresh: { input: threadInput, output: z.object({ ok: z.literal(true) }) },
});

function toDto(row: MapRow | null): MapDto | null {
  if (row === null) return null;
  return {
    sourceThreadId: row.sourceThreadId,
    mapperThreadId: row.mapperThreadId,
    state: row.state,
    error: row.error,
    graph: row.graph,
    derived: deriveView(row.graph),
    updatedAt: row.updatedAt,
  };
}

/** Read a file shipped with the plugin, from source (server.ts) or from dist/server.js. */
async function readPluginFile(relative: string): Promise<string | null> {
  for (const base of ["./", "../"]) {
    try {
      return await readFile(fileURLToPath(new URL(`${base}${relative}`, import.meta.url)), "utf8");
    } catch {
      // Try the next layout.
    }
  }
  return null;
}

const D3_CDN = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    providerId: {
      type: "string",
      label: "Mapper provider id (empty: the thread's provider)",
      default: "",
    },
    model: {
      type: "string",
      label: "Mapper model (empty: the provider's default)",
      default: "",
    },
    liveIntervalSeconds: {
      type: "number",
      label: "Mid-turn update interval in seconds (0: only after each turn)",
      experimental_schema: z.number().int().min(0).max(3600),
      default: 90,
    },
    sleepAfterMinutes: {
      type: "number",
      label: "Release an idle mapper after minutes (0: never)",
      experimental_schema: z.number().int().min(0).max(1440),
      default: 15,
    },
  });

  const store = createMapStore(bb);
  const publish = (row: MapRow) =>
    bb.realtime.publish(MAP_CHANNEL, {
      threadId: row.sourceThreadId,
      version: row.graph.version,
      state: row.state,
    });
  const mapper = createMapperService({ bb, store, settings: () => settings.get(), publish });

  /** The last bb origin a panel reported; used when no public app URL is configured. */
  let lastOrigin = (await bb.storage.kv.get<string>("lastOrigin")) ?? null;
  function rememberOrigin(origin: string | undefined) {
    if (origin === undefined || origin === lastOrigin || !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin)) return;
    lastOrigin = origin;
    void bb.storage.kv.set("lastOrigin", origin);
  }

  function viewUrl(threadId: string): string {
    let base = bb.server.experimental_appUrl ?? lastOrigin;
    if (base === null || base === "") base = bb.server.loopbackBaseUrl;
    return `${base.replace(/\/$/, "")}/api/v1/plugins/${bb.pluginId}/http/view?thread=${encodeURIComponent(threadId)}`;
  }

  /** Run an event handler without letting one failure stop the others. */
  function guard(label: string, work: () => Promise<void> | void) {
    Promise.resolve()
      .then(work)
      .catch((error) => bb.log.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`));
  }

  // --- The mapper's tools -------------------------------------------------

  bb.agents.registerTool({
    name: "thread_changes_map_apply",
    description:
      "Patch the live Thread Changes Map: add, change, or remove nodes, edges, and flows, and set the focus. Atomic: on errors nothing changes.",
    presentation: { label: { pending: "Updating the thread changes map", completed: "Updated the thread changes map" } },
    parameters: patchSchema,
    execute(patch, { threadId }) {
      const row = store.byMapper(threadId);
      if (row === null) {
        return { content: [{ type: "text", text: "Only a Thread Changes Map worker thread can change a map." }], isError: true };
      }
      const result = applyPatch(row.graph, patch, Date.now());
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Nothing changed. Fix these and call again:\n- ${result.errors.join("\n- ")}` }],
          isError: true,
        };
      }
      const saved = store.update(row.sourceThreadId, (current) => ({ ...current, graph: result.graph }), Date.now());
      if (saved !== null) publish(saved);
      const { graph } = result;
      const warnings = result.warnings.length === 0 ? "" : `\nWarnings:\n- ${result.warnings.join("\n- ")}`;
      return `Applied v${graph.version}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.flows.length} flows.${warnings}`;
    },
  });

  bb.agents.registerTool({
    name: "thread_changes_map_read",
    description: "Read the current Thread Changes Map as compact text: nodes, edges, flows, and focus.",
    presentation: { label: { pending: "Reading the thread changes map", completed: "Read the thread changes map" }, suppress: true },
    parameters: z.object({}).strict(),
    execute(_params, { threadId }) {
      const row = store.byMapper(threadId);
      if (row === null) {
        return { content: [{ type: "text", text: "Only a Thread Changes Map worker thread can read its map." }], isError: true };
      }
      return describeGraph(row.graph);
    },
  });

  bb.agents.configure((context) =>
    context.pluginMetadata.role === MAPPER_ROLE
      ? { tools: ["thread_changes_map_apply", "thread_changes_map_read"], skills: [], instructions: MAPPER_INSTRUCTIONS }
      : { tools: [], skills: ["thread-changes-map"] },
  );

  // --- Thread events: the live part --------------------------------------

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) =>
    guard("thread.idle", async () => {
      if (store.byMapper(thread.id) !== null) await mapper.onMapperIdle(thread.id);
      else if (store.bySource(thread.id) !== null) await mapper.onSourceIdle(thread.id, lastAssistantText);
    }),
  );
  bb.events.on("thread.active", ({ thread }) =>
    guard("thread.active", () => {
      if (store.byMapper(thread.id) !== null) mapper.onMapperActive(thread.id);
    }),
  );
  bb.events.on("thread.failed", ({ thread, error }) =>
    guard("thread.failed", () => {
      if (store.byMapper(thread.id) !== null) mapper.onMapperFailed(thread.id, error);
    }),
  );
  bb.events.on("turn.failed", (event) => guard("turn.failed", () => mapper.onMapperTurnFailed(event)));
  bb.events.on("experimental_thread.events", ({ thread }) =>
    guard("thread.events", async () => {
      if (store.bySource(thread.id) !== null) await mapper.onSourceProgress(thread.id, thread.status);
    }),
  );
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) =>
      guard(event, async () => {
        if (store.bySource(thread.id) !== null) await mapper.stop(thread.id, { archive: true });
        const worker = store.byMapper(thread.id);
        if (worker !== null) {
          const row = store.update(worker.sourceThreadId, (current) => ({ ...current, state: "stopped" }), Date.now());
          if (row !== null) publish(row);
        }
      }),
    );
  }

  bb.background.service("reconcile", {
    async start(signal) {
      await mapper.reconcile().catch((error) => bb.log.warn(`reconcile: ${String(error)}`));
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
  bb.background.schedule("sleep-idle-mappers", "*/5 * * * *", () => mapper.sleepIdleMappers());

  // --- RPC for the side panel --------------------------------------------

  bb.rpc.register(rpcContract, {
    map_get({ threadId, origin }) {
      rememberOrigin(origin);
      return { map: toDto(store.bySource(threadId)), isMapper: mapper.isMapperThread(threadId) };
    },
    async map_start({ threadId }) {
      return { map: toDto(await mapper.start(threadId)) };
    },
    async map_stop({ threadId }) {
      return { map: toDto(await mapper.stop(threadId)) };
    },
    async map_refresh({ threadId }) {
      await mapper.refresh(threadId);
      return { ok: true as const };
    },
  });

  // --- The browser page ---------------------------------------------------

  bb.http.route("GET", "/view", (c) => {
    const parsed = threadIdSchema.safeParse(c.req.query("thread"));
    if (!parsed.success) return c.text("Add ?thread=<thread id> to the URL.", 400);
    c.header("cache-control", "no-store");
    return c.html(renderViewerPage());
  });
  bb.http.route("GET", "/map", (c) => {
    const parsed = threadIdSchema.safeParse(c.req.query("thread"));
    if (!parsed.success) return c.json({ error: "not a thread id" }, 400);
    c.header("cache-control", "no-store");
    return c.json({ map: toDto(store.bySource(parsed.data)) });
  });
  bb.http.route("GET", "/viewer.js", async (c) => {
    const source = await readPluginFile("viewer/graph-view.js");
    if (source === null) return c.text("viewer not found", 500);
    return c.body(source, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
  });
  bb.http.route("GET", "/d3.js", async (c) => {
    const source = await readPluginFile("node_modules/d3/dist/d3.min.js");
    if (source === null) return c.redirect(D3_CDN, 302);
    return c.body(source, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=86400" });
  });

  // --- CLI for agents and the terminal ------------------------------------

  const threadOption = {
    thread: { type: "string", description: "Thread id (default: the calling thread)" },
    json: { type: "boolean", description: "Print JSON" },
  } as const;

  function resolveThread(option: string | undefined, contextThreadId: string | undefined): string {
    const threadId = option ?? contextThreadId;
    if (threadId === undefined) {
      throw new PluginCliError("no thread: run this from a bb thread or pass --thread", {
        code: "thread_required",
        hint: "Add --thread <thread id>.",
      });
    }
    const parsed = threadIdSchema.safeParse(threadId);
    if (!parsed.success) throw new PluginCliError(`not a thread id: ${threadId}`, { code: "invalid_thread" });
    return parsed.data;
  }

  function report(row: MapRow | null, threadId: string, json: boolean | undefined) {
    const url = viewUrl(threadId);
    if (json) {
      const map = toDto(row);
      const summary =
        map === null
          ? null
          : { state: map.state, version: map.graph.version, nodes: map.graph.nodes.length, edges: map.graph.edges.length, mapperThreadId: map.mapperThreadId, error: map.error };
      return { exitCode: 0, stdout: `${JSON.stringify({ threadId, map: summary, url })}\n` };
    }
    if (row === null) return { exitCode: 0, stdout: `No map for ${threadId}. Start one with: bb thread-changes-map start\n` };
    const { graph } = row;
    const lines = [
      `Thread changes map for ${threadId}: ${row.state}${row.error ? ` (${row.error})` : ""}`,
      `Version ${graph.version}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.flows.length} flows`,
      `Mapper thread: ${row.mapperThreadId ?? "(none)"}`,
      `Browser view: ${url}`,
      "Side panel: open the Thread Changes Map tab in the thread's right panel.",
    ];
    return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
  }

  bb.cli.register(
    defineCli({
      name: "thread-changes-map",
      summary: "Live architecture and flow map of a thread, kept by a background agent",
      commands: {
        start: cliCommand({
          summary: "Start the background mapper agent for a thread (or wake it with a full refresh)",
          options: threadOption,
          async run(input, ctx) {
            const threadId = resolveThread(input.options.thread, ctx.threadId);
            return report(await mapper.start(threadId), threadId, input.options.json);
          },
        }),
        stop: cliCommand({
          summary: "Stop the mapper agent and keep the map",
          options: threadOption,
          async run(input, ctx) {
            const threadId = resolveThread(input.options.thread, ctx.threadId);
            return report(await mapper.stop(threadId), threadId, input.options.json);
          },
        }),
        refresh: cliCommand({
          summary: "Ask the mapper to re-check the workspace and fix the map",
          options: threadOption,
          async run(input, ctx) {
            const threadId = resolveThread(input.options.thread, ctx.threadId);
            await mapper.refresh(threadId);
            return report(store.bySource(threadId), threadId, input.options.json);
          },
        }),
        status: cliCommand({
          summary: "Show the map's state, size, mapper thread, and browser URL",
          options: threadOption,
          async run(input, ctx) {
            const threadId = resolveThread(input.options.thread, ctx.threadId);
            return report(store.bySource(threadId), threadId, input.options.json);
          },
        }),
        show: cliCommand({
          summary: "Print the current map as text (nodes, edges, flows)",
          options: { thread: threadOption.thread },
          async run(input, ctx) {
            const threadId = resolveThread(input.options.thread, ctx.threadId);
            const row = store.bySource(threadId);
            return { exitCode: 0, stdout: `${row === null ? `No map for ${threadId}.` : describeGraph(row.graph)}\n` };
          },
        }),
      },
    }),
  );
}
