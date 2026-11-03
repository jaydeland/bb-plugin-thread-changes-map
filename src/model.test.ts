// Run with `npm test` (node --test strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, deriveView, describeGraph, emptyGraph, parseGraph, patchSchema, type MapGraph } from "./model.ts";

function apply(graph: MapGraph, patch: unknown): MapGraph {
  const result = applyPatch(graph, patchSchema.parse(patch), 1000);
  assert.ok(result.ok, result.ok ? "" : result.errors.join("; "));
  return result.graph;
}

const base = () =>
  apply(emptyGraph(), {
    summary: "initial map",
    title: "Shop",
    upsertNodes: [
      { id: "web", label: "Web app", kind: "ui" },
      { id: "api", label: "API", kind: "service", group: "backend" },
      { id: "db", label: "Postgres", kind: "datastore", group: "backend" },
    ],
    upsertEdges: [
      { source: "web", target: "api", kind: "calls", label: "REST" },
      { source: "api", target: "db", kind: "writes" },
    ],
    upsertFlows: [{ id: "checkout", name: "Checkout", steps: ["web", "api", "db"] }],
    focus: ["api"],
  });

test("an initial patch creates version 1 with default edge ids", () => {
  const graph = base();
  assert.equal(graph.version, 1);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ["web->api:calls", "api->db:writes"]);
  assert.deepEqual(graph.focus, ["api"]);
  assert.equal(graph.log.at(-1)?.summary, "initial map");
});

test("a partial node update keeps other fields and marks changedIn", () => {
  const graph = apply(base(), { summary: "api changes", upsertNodes: [{ id: "api", status: "changed" }] });
  const api = graph.nodes.find((node) => node.id === "api");
  assert.equal(api?.label, "API");
  assert.equal(api?.status, "changed");
  assert.equal(api?.changedIn, 2);
  assert.equal(graph.nodes.find((node) => node.id === "web")?.changedIn, 1);
});

test("a dangling edge rejects the whole patch", () => {
  const result = applyPatch(
    base(),
    patchSchema.parse({
      summary: "bad",
      upsertNodes: [{ id: "cache", label: "Redis", kind: "datastore" }],
      upsertEdges: [{ source: "api", target: "queue" }],
    }),
    1000,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors[0], /unknown node\(s\) "queue"/);
});

test("a new node without label and kind is an error", () => {
  const result = applyPatch(base(), patchSchema.parse({ summary: "x", upsertNodes: [{ id: "ghost" }] }), 1000);
  assert.equal(result.ok, false);
});

test("removing a node drops its edges, focus, and flow steps", () => {
  const graph = apply(base(), { summary: "drop api", removeNodeIds: ["api"] });
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.focus, []);
  assert.deepEqual(graph.flows[0]?.steps, ["web", "db"]);
  const smaller = apply(graph, { summary: "drop db", removeNodeIds: ["db"] });
  assert.deepEqual(smaller.flows, []);
});

test("describeGraph lists nodes, edges, and flows", () => {
  const text = describeGraph(base());
  assert.match(text, /- api \[service\/stable\] API \| backend/);
  assert.match(text, /web->api:calls: web -calls-> api "REST"/);
  assert.match(text, /checkout "Checkout": web > api > db/);
});

const planned = () =>
  apply(base(), {
    summary: "plan",
    upsertLanes: [{ id: "backend", title: "Backend", subtitle: "apps/api", order: 1 }],
    upsertPhases: [{ id: "p1", name: "Build" }],
    upsertSteps: [
      { id: "s1", phase: "p1", title: "Write API", status: "done", nodes: ["api"] },
      { id: "s2", phase: "p1", title: "Wire DB", status: "todo", nodes: ["api", "db"] },
    ],
  });

test("node fill: all done, any started, blocked wins, no steps", () => {
  let graph = planned();
  let states = deriveView(graph).nodeStates;
  assert.equal(states.api, "in_progress");
  assert.equal(states.db, "todo");
  assert.equal(states.web, "none");
  graph = apply(graph, { summary: "db done", upsertSteps: [{ id: "s2", status: "done" }] });
  assert.equal(deriveView(graph).nodeStates.api, "done");
  graph = apply(graph, {
    summary: "blocked",
    upsertSteps: [{ id: "s3", phase: "p1", title: "Migrate", status: "blocked", nodes: ["db"] }],
  });
  assert.equal(deriveView(graph).nodeStates.db, "blocked");
});

test("a status-only step update keeps title, phase, and links", () => {
  const graph = apply(planned(), { summary: "move", upsertSteps: [{ id: "s2", status: "in_progress" }] });
  const step = graph.steps.find((candidate) => candidate.id === "s2");
  assert.deepEqual([step?.title, step?.phase, step?.nodes], ["Wire DB", "p1", ["api", "db"]]);
  const { progress } = deriveView(graph);
  assert.deepEqual([progress.done, progress.inProgress, progress.total], [1, 1, 2]);
  assert.deepEqual(progress.phases[0], { id: "p1", name: "Build", total: 2, done: 1, inProgress: 1, blocked: 0 });
});

test("a new step needs a known phase", () => {
  const result = applyPatch(
    planned(),
    patchSchema.parse({ summary: "x", upsertSteps: [{ id: "s9", phase: "nope", title: "Ghost" }] }),
    1000,
  );
  assert.equal(result.ok, false);
});

test("parseGraph fills fields an older version did not store", () => {
  const old = JSON.stringify({ version: 2, nodes: [{ id: "a", label: "A", kind: "service", status: "stable" }], edges: [] });
  const graph = parseGraph(old);
  assert.deepEqual([graph.nodes[0].decisions, graph.nodes[0].assumed, graph.steps, graph.lanes], [[], false, [], []]);
});

test("an edge update without kind keeps the old kind", () => {
  const graph = apply(base(), {
    summary: "status only",
    upsertEdges: [{ id: "api->db:writes", source: "api", target: "db", status: "changed" }],
  });
  const edge = graph.edges.find((candidate) => candidate.id === "api->db:writes");
  assert.deepEqual([edge?.kind, edge?.status, graph.edges.length], ["writes", "changed", 2]);
});

test("an impacted node keeps its tag and fills like a stable one", () => {
  const graph = apply(base(), { summary: "api change touches web", upsertNodes: [{ id: "web", status: "impacted" }] });
  assert.equal(graph.nodes.find((node) => node.id === "web")?.status, "impacted");
  assert.equal(deriveView(graph).nodeStates.web, "neutral");
});
