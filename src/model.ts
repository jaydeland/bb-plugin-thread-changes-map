// The system map: lanes of nodes, edges, named flows, and the plan steps that
// say how far each part is. Changed only by validated, atomic patches. Pure
// code (no bb imports) so `node --test` can run it.
import { z } from "zod";

export const NODE_KINDS = [
  "service",
  "ui",
  "datastore",
  "queue",
  "external",
  "module",
  "api",
  "job",
  "actor",
] as const;
export const NODE_STATUSES = [
  "stable",
  "new",
  "changed",
  "planned",
  "problem",
  "removed",
] as const;
export const EDGE_KINDS = [
  "calls",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "depends",
  "renders",
  "flow",
] as const;
export const STEP_STATUSES = ["done", "in_progress", "blocked", "todo"] as const;
export const LANE_PLACEMENTS = ["column", "row"] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type LanePlacement = (typeof LANE_PLACEMENTS)[number];

/** How the viewer fills a node: from its plan steps, or from its own status when it has none. */
export type NodeState = StepStatus | "none" | "neutral";

export const LIMITS = {
  nodes: 250,
  edges: 600,
  flows: 20,
  lanes: 20,
  phases: 20,
  steps: 200,
  log: 40,
  focus: 12,
} as const;

const idSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/,
    "ids are 1-80 characters: letters, digits, and . _ : / -",
  );
/** Edge ids default to "source->target:kind", so they allow ">" and are longer. */
const edgeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/>-]{0,199}$/, "edge ids are 1-200 characters: letters, digits, and . _ : / - >");
const laneIdSchema = z.string().min(1).max(60);
const decisionsSchema = z.array(z.string().min(1).max(240)).max(8);

const nodeInputSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(80).optional(),
    subtitle: z
      .string()
      .max(60)
      .nullable()
      .optional()
      .describe("Second line in the box, for example \"POST /chat, SSE\"."),
    kind: z.enum(NODE_KINDS).optional(),
    group: laneIdSchema.nullable().optional().describe("The lane id this node sits in."),
    description: z.string().max(600).nullable().optional(),
    files: z.array(z.string().min(1).max(240)).max(12).optional(),
    status: z.enum(NODE_STATUSES).optional(),
    decisions: decisionsSchema.optional().describe("Design decisions about this part, one line each."),
    assumed: z
      .boolean()
      .optional()
      .describe("True when the part is inferred and not in the plan (drawn dashed amber)."),
  })
  .strict();

const edgeInputSchema = z
  .object({
    id: edgeIdSchema.optional(),
    source: idSchema,
    target: idSchema,
    kind: z.enum(EDGE_KINDS).optional().describe("Default: the edge's current kind, or calls for a new edge."),
    label: z.string().max(60).nullable().optional(),
    status: z.enum(NODE_STATUSES).optional(),
    decisions: decisionsSchema.optional(),
    assumed: z.boolean().optional(),
  })
  .strict();

const flowInputSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(400).nullable().optional(),
    steps: z.array(idSchema).min(2).max(24).describe("Ordered node ids, one per hop end."),
    notes: z
      .array(z.string().max(200))
      .max(23)
      .optional()
      .describe("notes[i] explains the hop from steps[i] to steps[i+1]."),
  })
  .strict();

const laneInputSchema = z
  .object({
    id: laneIdSchema,
    title: z.string().min(1).max(60).optional(),
    subtitle: z.string().max(80).nullable().optional(),
    placement: z
      .enum(LANE_PLACEMENTS)
      .optional()
      .describe("column: a vertical lane left to right; row: a band under the columns (shared services)."),
    order: z.number().int().min(0).max(99).optional(),
  })
  .strict();

const phaseInputSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    order: z.number().int().min(0).max(99).optional(),
  })
  .strict();

const stepInputSchema = z
  .object({
    id: idSchema,
    phase: idSchema.optional(),
    title: z.string().min(1).max(140).optional(),
    status: z.enum(STEP_STATUSES).optional(),
    nodes: z.array(idSchema).max(12).optional().describe("Node ids this step builds or changes."),
    edges: z.array(edgeIdSchema).max(12).optional(),
  })
  .strict();

/** The `system_map_apply` tool's parameters. */
export const patchSchema = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(280)
      .describe("One line: what this patch changes. Shown in the header and change log."),
    title: z.string().min(1).max(100).optional(),
    overview: z
      .string()
      .max(1200)
      .optional()
      .describe("A short paragraph that explains the system as a whole."),
    focus: z
      .array(idSchema)
      .max(LIMITS.focus)
      .optional()
      .describe("Node ids the main thread works on now. Replaces the focus."),
    upsertLanes: z.array(laneInputSchema).max(LIMITS.lanes).optional(),
    removeLaneIds: z.array(laneIdSchema).max(LIMITS.lanes).optional(),
    upsertNodes: z
      .array(nodeInputSchema)
      .max(80)
      .optional()
      .describe(
        "Add or change nodes. A new node needs label and kind; for an existing node send only the fields that change.",
      ),
    upsertEdges: z
      .array(edgeInputSchema)
      .max(160)
      .optional()
      .describe("Add or change edges. Both ends must exist. The default id is source->target:kind."),
    removeNodeIds: z.array(idSchema).max(80).optional(),
    removeEdgeIds: z.array(edgeIdSchema).max(160).optional(),
    upsertFlows: z
      .array(flowInputSchema)
      .max(10)
      .optional()
      .describe("Named request or data paths, followed hop by hop in the viewer."),
    removeFlowIds: z.array(idSchema).max(20).optional(),
    upsertPhases: z.array(phaseInputSchema).max(LIMITS.phases).optional(),
    removePhaseIds: z.array(idSchema).max(LIMITS.phases).optional(),
    upsertSteps: z
      .array(stepInputSchema)
      .max(120)
      .optional()
      .describe("Plan steps. A new step needs phase and title; to move a step send only {id, status}."),
    removeStepIds: z.array(idSchema).max(120).optional(),
    handoff: z
      .object({ source: z.string().min(1).max(120), text: z.string().max(4000) })
      .strict()
      .nullable()
      .optional()
      .describe("The latest handoff or log notes, with where they came from (for example docs/LOG.md)."),
  })
  .strict();

export type MapPatch = z.output<typeof patchSchema>;

export interface MapLane {
  id: string;
  title: string;
  subtitle: string | null;
  placement: LanePlacement;
  order: number;
}

export interface MapNode {
  id: string;
  label: string;
  subtitle: string | null;
  kind: NodeKind;
  group: string | null;
  description: string | null;
  files: string[];
  status: NodeStatus;
  decisions: string[];
  assumed: boolean;
  /** The version that added the node. */
  addedIn: number;
  /** The last version that changed the node. The viewer pulses it when this is the current version. */
  changedIn: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string | null;
  status: NodeStatus;
  decisions: string[];
  assumed: boolean;
  addedIn: number;
  changedIn: number;
}

export interface MapFlow {
  id: string;
  name: string;
  description: string | null;
  steps: string[];
  notes: string[];
  changedIn: number;
}

export interface MapPhase {
  id: string;
  name: string;
  order: number;
}

export interface MapStep {
  id: string;
  phase: string;
  title: string;
  status: StepStatus;
  nodes: string[];
  edges: string[];
  changedIn: number;
}

export interface MapLogEntry {
  version: number;
  at: number;
  summary: string;
}

export interface MapGraph {
  version: number;
  title: string | null;
  overview: string | null;
  focus: string[];
  lanes: MapLane[];
  nodes: MapNode[];
  edges: MapEdge[];
  flows: MapFlow[];
  phases: MapPhase[];
  steps: MapStep[];
  handoff: { source: string; text: string } | null;
  log: MapLogEntry[];
}

export function emptyGraph(): MapGraph {
  return {
    version: 0,
    title: null,
    overview: null,
    focus: [],
    lanes: [],
    nodes: [],
    edges: [],
    flows: [],
    phases: [],
    steps: [],
    handoff: null,
    log: [],
  };
}

export type PatchResult =
  | { ok: true; graph: MapGraph; warnings: string[] }
  | { ok: false; errors: string[] };

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Copy the fields the input sets; keep the others. */
function merge<T extends object>(previous: T, input: Partial<T>): T {
  const next = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/**
 * Apply a patch atomically: either every change lands as one new version, or
 * nothing changes and the errors say what to fix.
 */
export function applyPatch(graph: MapGraph, patch: MapPatch, now: number): PatchResult {
  const version = graph.version + 1;
  const errors: string[] = [];
  const warnings: string[] = [];
  const lanes = new Map(graph.lanes.map((lane) => [lane.id, { ...lane }]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, { ...node }]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, { ...edge }]));
  const flows = new Map(graph.flows.map((flow) => [flow.id, { ...flow }]));
  const phases = new Map(graph.phases.map((phase) => [phase.id, { ...phase }]));
  const steps = new Map(graph.steps.map((step) => [step.id, { ...step }]));

  for (const id of patch.removeLaneIds ?? []) {
    if (!lanes.delete(id)) warnings.push(`removeLaneIds: no lane "${id}"`);
  }
  for (const id of patch.removeNodeIds ?? []) {
    if (!nodes.delete(id)) warnings.push(`removeNodeIds: no node "${id}"`);
  }
  for (const id of patch.removeEdgeIds ?? []) {
    if (!edges.delete(id)) warnings.push(`removeEdgeIds: no edge "${id}"`);
  }
  for (const id of patch.removeFlowIds ?? []) {
    if (!flows.delete(id)) warnings.push(`removeFlowIds: no flow "${id}"`);
  }
  for (const id of patch.removePhaseIds ?? []) {
    if (!phases.delete(id)) warnings.push(`removePhaseIds: no phase "${id}"`);
  }
  for (const id of patch.removeStepIds ?? []) {
    if (!steps.delete(id)) warnings.push(`removeStepIds: no step "${id}"`);
  }

  for (const input of patch.upsertLanes ?? []) {
    const previous = lanes.get(input.id);
    lanes.set(
      input.id,
      merge(
        previous ?? {
          id: input.id,
          title: input.id,
          subtitle: null,
          placement: "column",
          order: lanes.size,
        },
        input,
      ),
    );
  }

  for (const input of patch.upsertNodes ?? []) {
    const previous = nodes.get(input.id);
    if (previous === undefined) {
      if (input.label === undefined || input.kind === undefined) {
        errors.push(`node "${input.id}" is new, so it needs label and kind`);
        continue;
      }
      nodes.set(input.id, {
        id: input.id,
        label: input.label,
        subtitle: input.subtitle ?? null,
        kind: input.kind,
        group: input.group ?? null,
        description: input.description ?? null,
        files: input.files ?? [],
        status: input.status ?? "stable",
        decisions: input.decisions ?? [],
        assumed: input.assumed ?? false,
        addedIn: version,
        changedIn: version,
      });
      continue;
    }
    const next = merge(previous, input);
    if (!sameJson(next, previous)) next.changedIn = version;
    nodes.set(input.id, next);
  }

  // Edges whose ends are gone go with them.
  for (const [id, edge] of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) edges.delete(id);
  }
  for (const input of patch.upsertEdges ?? []) {
    const kind = input.kind ?? (input.id === undefined ? undefined : edges.get(input.id)?.kind) ?? "calls";
    const id = input.id ?? `${input.source}->${input.target}:${kind}`;
    const missing = [input.source, input.target].filter((end) => !nodes.has(end));
    if (missing.length > 0) {
      errors.push(
        `edge "${id}" points at unknown node(s) ${missing.map((end) => `"${end}"`).join(", ")}; add the node(s) in upsertNodes first`,
      );
      continue;
    }
    const previous = edges.get(id);
    const { id: _id, ...fields } = input;
    const base: MapEdge = previous ?? {
      id,
      source: input.source,
      target: input.target,
      kind,
      label: null,
      status: "stable",
      decisions: [],
      assumed: false,
      addedIn: version,
      changedIn: version,
    };
    const next = merge(base, fields);
    if (previous !== undefined && !sameJson(next, previous)) next.changedIn = version;
    edges.set(id, next);
  }

  for (const input of patch.upsertFlows ?? []) {
    const missing = input.steps.filter((step) => !nodes.has(step));
    if (missing.length > 0) {
      errors.push(`flow "${input.id}" names unknown node(s) ${missing.map((step) => `"${step}"`).join(", ")}`);
      continue;
    }
    flows.set(input.id, {
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      steps: input.steps,
      notes: input.notes ?? [],
      changedIn: version,
    });
  }
  // A removed node drops out of every flow that named it, with the note of its hop.
  for (const [id, flow] of flows) {
    if (flow.steps.every((step) => nodes.has(step))) continue;
    const steps = flow.steps.filter((step) => nodes.has(step));
    if (steps.length < 2) flows.delete(id);
    else flows.set(id, { ...flow, steps, notes: [], changedIn: version });
  }

  for (const input of patch.upsertPhases ?? []) {
    const previous = phases.get(input.id);
    phases.set(input.id, merge(previous ?? { id: input.id, name: input.name, order: phases.size }, input));
  }
  for (const [id, step] of steps) {
    if (!phases.has(step.phase)) steps.delete(id);
  }
  for (const input of patch.upsertSteps ?? []) {
    const previous = steps.get(input.id);
    if (previous === undefined && (input.phase === undefined || input.title === undefined)) {
      errors.push(`step "${input.id}" is new, so it needs phase and title`);
      continue;
    }
    const phase = input.phase ?? previous?.phase;
    if (phase === undefined || !phases.has(phase)) {
      errors.push(`step "${input.id}" names unknown phase "${phase}"; add it in upsertPhases first`);
      continue;
    }
    const base: MapStep = previous ?? {
      id: input.id,
      phase,
      title: input.title ?? input.id,
      status: "todo",
      nodes: [],
      edges: [],
      changedIn: version,
    };
    const next = merge(base, input);
    if (!sameJson(next, previous)) next.changedIn = version;
    steps.set(input.id, next);
  }
  // Steps keep only links to parts that still exist.
  for (const [id, step] of steps) {
    const linkedNodes = step.nodes.filter((node) => nodes.has(node));
    const linkedEdges = step.edges.filter((edge) => edges.has(edge));
    if (linkedNodes.length !== step.nodes.length || linkedEdges.length !== step.edges.length) {
      for (const node of step.nodes) if (!nodes.has(node)) warnings.push(`step "${id}": no node "${node}"`);
      for (const edge of step.edges) if (!edges.has(edge)) warnings.push(`step "${id}": no edge "${edge}"`);
      steps.set(id, { ...step, nodes: linkedNodes, edges: linkedEdges });
    }
  }

  let focus = graph.focus.filter((id) => nodes.has(id));
  if (patch.focus !== undefined) {
    focus = patch.focus.filter((id) => {
      if (nodes.has(id)) return true;
      warnings.push(`focus: no node "${id}"`);
      return false;
    });
  }

  const sizes: Array<[string, number, number]> = [
    ["nodes", nodes.size, LIMITS.nodes],
    ["edges", edges.size, LIMITS.edges],
    ["flows", flows.size, LIMITS.flows],
    ["lanes", lanes.size, LIMITS.lanes],
    ["phases", phases.size, LIMITS.phases],
    ["steps", steps.size, LIMITS.steps],
  ];
  for (const [name, size, limit] of sizes) {
    if (size > limit) errors.push(`the map would have ${size} ${name}; the limit is ${limit}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const log = [...graph.log, { version, at: now, summary: patch.summary }];
  return {
    ok: true,
    warnings,
    graph: {
      version,
      title: patch.title ?? graph.title,
      overview: patch.overview ?? graph.overview,
      focus,
      lanes: [...lanes.values()],
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      flows: [...flows.values()],
      phases: [...phases.values()],
      steps: [...steps.values()],
      handoff: patch.handoff === undefined ? graph.handoff : patch.handoff,
      log: log.slice(-LIMITS.log),
    },
  };
}

export interface PhaseProgress {
  id: string;
  name: string;
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
}

export interface MapDerived {
  nodeStates: Record<string, NodeState>;
  progress: {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    todo: number;
    phases: PhaseProgress[];
  };
}

const FALLBACK_STATES: Record<NodeStatus, NodeState> = {
  stable: "neutral",
  new: "in_progress",
  changed: "in_progress",
  planned: "todo",
  problem: "blocked",
  removed: "none",
};

/**
 * Node fill: a blocked step wins, then all done, then any started step.
 * A node with no steps uses its own status; once a plan exists, a stable node
 * without steps reads as "no plan steps".
 */
export function deriveView(graph: MapGraph): MapDerived {
  const stepsByNode = new Map<string, MapStep[]>();
  for (const step of graph.steps) {
    for (const node of step.nodes) stepsByNode.set(node, [...(stepsByNode.get(node) ?? []), step]);
  }
  const hasPlan = graph.steps.length > 0;
  const nodeStates: Record<string, NodeState> = {};
  for (const node of graph.nodes) {
    const linked = stepsByNode.get(node.id) ?? [];
    if (linked.length === 0) {
      const fallback = FALLBACK_STATES[node.status];
      nodeStates[node.id] = hasPlan && fallback === "neutral" ? "none" : fallback;
    } else if (linked.some((step) => step.status === "blocked")) nodeStates[node.id] = "blocked";
    else if (linked.every((step) => step.status === "done")) nodeStates[node.id] = "done";
    else if (linked.some((step) => step.status !== "todo")) nodeStates[node.id] = "in_progress";
    else nodeStates[node.id] = "todo";
  }
  const phases = [...graph.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase) => {
      const steps = graph.steps.filter((step) => step.phase === phase.id);
      return {
        id: phase.id,
        name: phase.name,
        total: steps.length,
        done: steps.filter((step) => step.status === "done").length,
        inProgress: steps.filter((step) => step.status === "in_progress").length,
        blocked: steps.filter((step) => step.status === "blocked").length,
      };
    });
  const count = (status: StepStatus) => graph.steps.filter((step) => step.status === status).length;
  return {
    nodeStates,
    progress: {
      total: graph.steps.length,
      done: count("done"),
      inProgress: count("in_progress"),
      blocked: count("blocked"),
      todo: count("todo"),
      phases,
    },
  };
}

/** A compact text form of the map for the mapper agent, bounded by the map limits. */
export function describeGraph(graph: MapGraph): string {
  if (graph.version === 0) return "The map is empty (version 0).";
  const { progress } = deriveView(graph);
  const lines = [
    `Version ${graph.version}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.flows.length} flows, ${progress.done} of ${progress.total} plan steps done.`,
    `Title: ${graph.title ?? "(none)"}`,
    `Focus: ${graph.focus.join(", ") || "(none)"}`,
    "Lanes (id [placement order] title | subtitle):",
    ...[...graph.lanes]
      .sort((a, b) => a.order - b.order)
      .map((lane) => `- ${lane.id} [${lane.placement} ${lane.order}] ${lane.title}${lane.subtitle ? ` | ${lane.subtitle}` : ""}`),
    "Nodes (id [kind/status] label | subtitle | lane):",
    ...graph.nodes.map(
      (node) =>
        `- ${node.id} [${node.kind}/${node.status}${node.assumed ? "/assumed" : ""}] ${node.label}${node.subtitle ? ` | ${node.subtitle}` : ""}${node.group ? ` | ${node.group}` : ""}`,
    ),
    "Edges (id: source -kind-> target):",
    ...graph.edges.map(
      (edge) =>
        `- ${edge.id}: ${edge.source} -${edge.kind}-> ${edge.target}${edge.label ? ` "${edge.label}"` : ""}${edge.assumed ? " [assumed]" : ""}${edge.status === "stable" ? "" : ` [${edge.status}]`}`,
    ),
    "Flows:",
    ...graph.flows.map((flow) => `- ${flow.id} "${flow.name}": ${flow.steps.join(" > ")}`),
    "Plan (phase: step id [status] title -> nodes):",
    ...[...graph.phases]
      .sort((a, b) => a.order - b.order)
      .flatMap((phase) => [
        `- ${phase.id} "${phase.name}"`,
        ...graph.steps
          .filter((step) => step.phase === phase.id)
          .map((step) => `  - ${step.id} [${step.status}] ${step.title}${step.nodes.length > 0 ? ` -> ${step.nodes.join(", ")}` : ""}`),
      ]),
  ];
  return lines.join("\n");
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Parse stored JSON back to a graph, filling fields that older versions did not store. */
export function parseGraph(json: string): MapGraph {
  let value: Partial<MapGraph>;
  try {
    value = JSON.parse(json) as Partial<MapGraph>;
  } catch {
    return emptyGraph();
  }
  if (typeof value !== "object" || value === null || !Array.isArray(value.nodes)) return emptyGraph();
  const base = emptyGraph();
  return {
    ...base,
    ...value,
    lanes: (value.lanes ?? []).map((lane) => ({ ...lane, subtitle: lane.subtitle ?? null, placement: lane.placement ?? "column" })),
    nodes: value.nodes.map((node) => ({
      ...node,
      subtitle: node.subtitle ?? null,
      group: node.group ?? null,
      description: node.description ?? null,
      files: asStrings(node.files),
      decisions: asStrings(node.decisions),
      assumed: node.assumed === true,
    })),
    edges: (value.edges ?? []).map((edge) => ({
      ...edge,
      label: edge.label ?? null,
      decisions: asStrings(edge.decisions),
      assumed: edge.assumed === true,
    })),
    flows: (value.flows ?? []).map((flow) => ({ ...flow, description: flow.description ?? null, notes: asStrings(flow.notes) })),
    phases: value.phases ?? [],
    steps: (value.steps ?? []).map((step) => ({ ...step, nodes: asStrings(step.nodes), edges: asStrings(step.edges) })),
    handoff: value.handoff ?? null,
    focus: asStrings(value.focus),
    log: value.log ?? [],
  };
}
