// One row per mapped thread in the plugin's own SQLite database. The graph is
// stored as JSON because a map can grow past the 256 KiB thread-metadata cap.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { emptyGraph, parseGraph, type MapGraph } from "./model";

/**
 * starting: the mapper thread is being spawned.
 * mapping: the mapper is running a turn.
 * idle: the mapper finished and waits for the next update note.
 * sleeping: the idle mapper's runtime was released; the next note resumes it.
 * stopped: the user stopped the map, or the source thread went away.
 * error: the last mapper turn failed.
 */
export const MAP_STATES = [
  "starting",
  "mapping",
  "idle",
  "sleeping",
  "stopped",
  "error",
] as const;
export type MapState = (typeof MAP_STATES)[number];

export interface MapRow {
  sourceThreadId: string;
  mapperThreadId: string | null;
  state: MapState;
  graph: MapGraph;
  error: string | null;
  /** Outline items already sent to the mapper, so each note carries only new ones. */
  outlineCount: number;
  /** Update notes held while the mapper is busy, sent when it goes idle. */
  pendingNotes: string[];
  lastNoteAt: number;
  createdAt: number;
  updatedAt: number;
}

interface RawRow {
  source_thread_id: string;
  mapper_thread_id: string | null;
  state: string;
  graph_json: string;
  error: string | null;
  outline_count: number;
  pending_notes: string;
  last_note_at: number;
  created_at: number;
  updated_at: number;
}

function toRow(raw: RawRow): MapRow {
  let pendingNotes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.pending_notes);
    if (Array.isArray(parsed)) pendingNotes = parsed.filter((note) => typeof note === "string");
  } catch {
    pendingNotes = [];
  }
  return {
    sourceThreadId: raw.source_thread_id,
    mapperThreadId: raw.mapper_thread_id,
    state: (MAP_STATES as readonly string[]).includes(raw.state)
      ? (raw.state as MapState)
      : "error",
    graph: parseGraph(raw.graph_json),
    error: raw.error,
    outlineCount: raw.outline_count,
    pendingNotes,
    lastNoteAt: raw.last_note_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export type MapStore = ReturnType<typeof createMapStore>;

export function createMapStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS maps (
      source_thread_id TEXT PRIMARY KEY,
      mapper_thread_id TEXT,
      state TEXT NOT NULL,
      graph_json TEXT NOT NULL,
      error TEXT,
      outline_count INTEGER NOT NULL DEFAULT 0,
      pending_notes TEXT NOT NULL DEFAULT '[]',
      last_note_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS maps_mapper ON maps (mapper_thread_id)`,
  ]);

  const selectBySource = db.prepare("SELECT * FROM maps WHERE source_thread_id = ?");
  const selectByMapper = db.prepare("SELECT * FROM maps WHERE mapper_thread_id = ?");
  const selectLive = db.prepare("SELECT * FROM maps WHERE state != 'stopped'");
  const upsert = db.prepare(`INSERT INTO maps (
      source_thread_id, mapper_thread_id, state, graph_json, error, outline_count,
      pending_notes, last_note_at, created_at, updated_at
    ) VALUES (
      @source_thread_id, @mapper_thread_id, @state, @graph_json, @error, @outline_count,
      @pending_notes, @last_note_at, @created_at, @updated_at
    ) ON CONFLICT (source_thread_id) DO UPDATE SET
      mapper_thread_id = excluded.mapper_thread_id,
      state = excluded.state,
      graph_json = excluded.graph_json,
      error = excluded.error,
      outline_count = excluded.outline_count,
      pending_notes = excluded.pending_notes,
      last_note_at = excluded.last_note_at,
      updated_at = excluded.updated_at`);

  function write(row: MapRow): MapRow {
    upsert.run({
      source_thread_id: row.sourceThreadId,
      mapper_thread_id: row.mapperThreadId,
      state: row.state,
      graph_json: JSON.stringify(row.graph),
      error: row.error,
      outline_count: row.outlineCount,
      pending_notes: JSON.stringify(row.pendingNotes),
      last_note_at: row.lastNoteAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    });
    return row;
  }

  return {
    bySource(sourceThreadId: string): MapRow | null {
      const raw = selectBySource.get(sourceThreadId) as RawRow | undefined;
      return raw === undefined ? null : toRow(raw);
    },
    byMapper(mapperThreadId: string): MapRow | null {
      const raw = selectByMapper.get(mapperThreadId) as RawRow | undefined;
      return raw === undefined ? null : toRow(raw);
    },
    live(): MapRow[] {
      return (selectLive.all() as RawRow[]).map(toRow);
    },
    create(sourceThreadId: string, now: number): MapRow {
      return write({
        sourceThreadId,
        mapperThreadId: null,
        state: "starting",
        graph: emptyGraph(),
        error: null,
        outlineCount: 0,
        pendingNotes: [],
        lastNoteAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    },
    /** Read, change, and write one row; returns null when the row does not exist. */
    update(
      sourceThreadId: string,
      change: (row: MapRow) => MapRow,
      now: number,
    ): MapRow | null {
      const current = this.bySource(sourceThreadId);
      if (current === null) return null;
      return write({ ...change(current), updatedAt: now });
    },
  };
}
