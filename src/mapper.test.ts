// Run with `npm test`. A small fake bb and an in-memory store stand in for the host.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createMapperService } from "./mapper.ts";
import { emptyGraph } from "./model.ts";
import type { MapRow, MapStore } from "./store.ts";

function setup(options: { sendFails?: boolean } = {}) {
  let row: MapRow = {
    sourceThreadId: "src",
    mapperThreadId: "map",
    state: "idle",
    graph: emptyGraph(),
    error: null,
    outlineCount: 0,
    pendingNotes: [],
    lastNoteAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  const sent: string[] = [];
  const retries: Array<{ turnRequestId?: string; sendAt?: number }> = [];
  const failSend = { value: options.sendFails ?? false };
  const store = {
    bySource: (id: string) => (row.sourceThreadId === id ? row : null),
    byMapper: (id: string) => (row.mapperThreadId === id ? row : null),
    live: () => [row],
    update: (_id: string, change: (current: MapRow) => MapRow, now: number) => {
      row = { ...change(row), updatedAt: now };
      return row;
    },
  } as unknown as MapStore;
  const bb = {
    log: { warn() {} },
    sdk: {
      threads: {
        conversationOutline: async () => ({ items: [] }),
        send: async (args: { input: Array<{ text: string }> }) => {
          if (failSend.value) throw new Error("Provider \"claude-code\" is not running");
          sent.push(args.input[0].text);
        },
        retry: async (args: { turnRequestId?: string; sendAt?: number }) => {
          retries.push(args);
        },
      },
    },
  } as unknown as BbPluginApi;
  const mapper = createMapperService({
    bb,
    store,
    settings: async () => ({ providerId: "", model: "", liveIntervalSeconds: 90, sleepAfterMinutes: 15 }),
    publish: () => {},
  });
  return { mapper, sent, retries, failSend, row: () => row };
}

const rejected = (attemptNumber: number) => ({
  threadId: "map",
  requestId: `req-${attemptNumber}`,
  inputAccepted: false,
  attemptNumber,
});

test("a note the provider never took is retried, and a later thread.failed keeps the notice", async () => {
  const { mapper, retries, row } = setup();
  await mapper.onMapperTurnFailed(rejected(1));
  mapper.onMapperFailed("map", "Command turn.submit failed");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].turnRequestId, "req-1");
  assert.ok((retries[0].sendAt ?? 0) > Date.now());
  assert.equal(row().state, "error");
  assert.match(row().error ?? "", /attempt 2 of 3/);
});

test("the retry stops at the attempt cap", async () => {
  const { mapper, retries, row } = setup();
  await mapper.onMapperTurnFailed(rejected(1));
  await mapper.onMapperTurnFailed(rejected(2));
  mapper.onMapperFailed("map", "Command turn.submit failed");
  await mapper.onMapperTurnFailed(rejected(3));
  assert.equal(retries.length, 2);
  assert.match(row().error ?? "", /after 3 attempts/);
});

test("a turn that started and then failed is not retried", async () => {
  const { mapper, retries, row } = setup();
  mapper.onMapperActive("map");
  mapper.onMapperFailed("map", "context window exceeded");
  await mapper.onMapperTurnFailed({ ...rejected(1), inputAccepted: true });
  assert.equal(retries.length, 0);
  assert.equal(row().error, "context window exceeded");
});

test("a retried turn that starts clears the notice", async () => {
  const { mapper, row } = setup();
  await mapper.onMapperTurnFailed(rejected(1));
  mapper.onMapperActive("map");
  assert.equal(row().state, "mapping");
  assert.equal(row().error, null);
  mapper.onMapperFailed("map", "overloaded");
  assert.equal(row().error, "overloaded");
});

test("a send that throws holds the note, and the next update sends both", async () => {
  const { mapper, sent, failSend, row } = setup({ sendFails: true });
  await assert.rejects(mapper.onSourceIdle("src", "first turn"));
  assert.equal(row().state, "error");
  assert.equal(row().pendingNotes.length, 1);
  failSend.value = false;
  await mapper.onSourceIdle("src", "second turn");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /first turn[\s\S]*second turn/);
  assert.equal(row().state, "mapping");
  assert.deepEqual(row().pendingNotes, []);
});
