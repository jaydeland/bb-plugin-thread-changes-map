// @ts-check
// The Thread Changes Map view: a lane diagram (columns of nodes, shared-service rows
// below), a plan progress card, a hop-by-hop flow player, and a details bar.
// Plain ESM with d3 passed in, so the bb side panel (bundled d3) and the
// standalone browser page (served d3) share one source.

export const STATE_LABELS = {
  done: "Done",
  in_progress: "In progress",
  blocked: "Blocked or failed",
  todo: "To do",
  none: "No plan steps",
  neutral: "No plan steps",
};

/** Change tags: what this thread adds, edits, or affects. Stable and planned nodes have no tag. */
const CHANGE_LABELS = /** @type {Record<string, string>} */ ({
  new: "new",
  changed: "changed",
  impacted: "impacted, not changed",
  removed: "removed",
});

const OUTLINE_LABELS = [
  ["o-focus", "Pulsing blue ring: working"],
  ["o-pulse", "heavy cyan ring: changed in the latest map version"],
  ["o-hop", "cyan border: the current hop of the flow you follow"],
  ["o-selected", "heavy border: the node you clicked"],
];
const HINT = "Choose a flow to follow a request hop by hop; Back, Pause, Next, and Clear then step through it. Click a node or an edge for its decisions and plan steps.";
const HOP_MS = 1800;
const LANE_PAD = 16;
const LANE_HEADER = 58;
const LANE_GAP = 26;
const SUB_GAP = 40;
const NODE_GAP = 22;
const ROW_GAP = 44;
const ROW_LABEL = 46;

const STYLE = `
.smv { --smv-indigo: #5e5cfa; --smv-cyan: #2cc4e6; position: relative; display: flex; flex-direction: column;
  width: 100%; height: 100%; min-height: 0; background: var(--smv-bg); color: var(--smv-ink);
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.smv[data-theme="dark"] { color-scheme: dark; --smv-bg: #171a23; --smv-ink: #e9ebf1; --smv-muted: #98a0b3;
  --smv-card: #1f2330; --smv-lane: #1c202d; --smv-lane-line: #2b3144; --smv-node: #262b3b; --smv-node-line: #4b5266;
  --smv-edge: #6c7488; --smv-indigo-fill: #2d2c7d; --smv-red: #e5484d; --smv-red-fill: #5b1e25;
  --smv-green: #30a46c; --smv-amber: #f0a020; }
.smv[data-theme="light"] { color-scheme: light; --smv-bg: #f5f6f9; --smv-ink: #151821; --smv-muted: #5c6478;
  --smv-card: #ffffff; --smv-lane: #eef0f5; --smv-lane-line: #dde1ea; --smv-node: #ffffff; --smv-node-line: #b4bac8;
  --smv-edge: #8d94a6; --smv-indigo-fill: #e4e4ff; --smv-red: #d93036; --smv-red-fill: #fde6e7;
  --smv-green: #1f8a57; --smv-amber: #b97800; --smv-cyan: #0a91b0; }
.smv[data-host="bb"] { --smv-bg: var(--smv-host-surface); --smv-ink: var(--smv-host-ink); --smv-muted: var(--smv-host-muted);
  --smv-card: color-mix(in srgb, var(--smv-ink) 4%, var(--smv-bg)); --smv-lane: color-mix(in srgb, var(--smv-ink) 3%, var(--smv-bg));
  --smv-lane-line: color-mix(in srgb, var(--smv-ink) 11%, var(--smv-bg)); --smv-node: color-mix(in srgb, var(--smv-ink) 7%, var(--smv-bg));
  --smv-node-line: color-mix(in srgb, var(--smv-ink) 30%, var(--smv-bg)); --smv-edge: color-mix(in srgb, var(--smv-ink) 42%, var(--smv-bg)); }
.smv[data-host="bb"][data-theme="dark"] { --smv-indigo-fill: color-mix(in srgb, #5e5cfa 38%, var(--smv-bg)); --smv-red-fill: color-mix(in srgb, #e5484d 30%, var(--smv-bg)); }
.smv[data-host="bb"][data-theme="light"] { --smv-indigo-fill: color-mix(in srgb, #5e5cfa 14%, var(--smv-bg)); --smv-red-fill: color-mix(in srgb, #e5484d 12%, var(--smv-bg)); }
.smv * { box-sizing: border-box; }
.smv [hidden] { display: none !important; }
.smv button { font: inherit; color: var(--smv-ink); background: var(--smv-card); border: 1px solid var(--smv-lane-line);
  border-radius: 8px; padding: 5px 12px; cursor: pointer; white-space: nowrap; }
.smv button:hover:not(:disabled) { border-color: var(--smv-node-line); }
.smv button:disabled { opacity: 0.45; cursor: default; }
.smv button[aria-pressed="true"] { border-color: var(--smv-cyan); box-shadow: inset 0 0 0 1px var(--smv-cyan); }
.smv-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; padding: 18px 24px 4px; }
.smv-head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.smv-live { display: inline-flex; align-items: center; gap: 8px; color: var(--smv-muted); }
.smv-live::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--smv-muted); }
.smv-live[data-state="idle"]::before { background: var(--smv-green); }
.smv-live[data-state="mapping"]::before, .smv-live[data-state="starting"]::before { background: var(--smv-indigo); animation: smv-blink 1s ease-in-out infinite; }
.smv-live[data-state="error"]::before { background: var(--smv-red); }
.smv-meta { color: var(--smv-muted); font-size: 12px; }
.smv-chrome { display: flex; flex-direction: column; gap: 10px; padding: 10px 24px 0; }
.smv[data-mode="compact"] .smv-chrome { gap: 6px; padding: 8px 10px 0; }
.smv-card { background: var(--smv-card); border: 1px solid var(--smv-lane-line); border-radius: 10px; padding: 14px 18px; }
.smv[data-mode="compact"] .smv-card { padding: 8px 10px; }
.smv-progress { display: grid; grid-template-columns: minmax(160px, 260px) 1fr; gap: 10px 26px; align-items: start; }
.smv[data-mode="compact"] .smv-progress { grid-template-columns: 1fr; }
.smv-total b { display: block; font-size: 18px; }
.smv[data-mode="compact"] .smv-total b { display: inline; font-size: 13px; }
.smv-total span { color: var(--smv-muted); }
.smv-total .smv-toggle { margin-left: 8px; padding: 1px 8px; font-size: 12px; }
.smv-phases { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 18px; }
.smv-phase { min-width: 0; }
.smv-phase div:first-child { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.smv-phase div:first-child span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smv-phase div:first-child span:last-child { color: var(--smv-muted); font-variant-numeric: tabular-nums; }
.smv-bar { display: flex; gap: 2px; height: 8px; margin-top: 5px; border-radius: 4px; overflow: hidden; background: var(--smv-node); }
.smv-bar i { display: block; height: 100%; }
.smv-bar .done { background: var(--smv-green); } .smv-bar .in_progress { background: var(--smv-indigo); } .smv-bar .blocked { background: var(--smv-red); }
.smv-legend { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; color: var(--smv-muted); font-size: 12px; }
.smv-legend span { display: inline-flex; align-items: center; gap: 7px; }
.smv-legend i { display: inline-block; width: 22px; height: 12px; border-radius: 6px; border: 1.5px solid var(--smv-node-line); background: var(--smv-node); }
.smv-legend i.done { border-color: var(--smv-green); } .smv-legend i.in_progress { border-color: var(--smv-indigo); background: var(--smv-indigo-fill); }
.smv-legend i.blocked { border-color: var(--smv-red); background: var(--smv-red-fill); } .smv-legend i.none { border-style: dashed; }
.smv-legend i.line { width: 22px; height: 0; border-radius: 0; border: 0; border-top: 2px solid var(--smv-edge); background: none; }
.smv-legend i.assumed { border-top: 2px dashed var(--smv-amber); } .smv-legend i.hop { border-top-color: var(--smv-cyan); }
.smv-legend em { font-style: normal; }
.smv-legend .row { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; }
.smv-legend .row > strong { font-weight: 600; color: var(--smv-ink); }
.smv-legend i.o-focus { border-color: var(--smv-node-line); box-shadow: 0 0 0 2px var(--smv-card), 0 0 0 4px var(--smv-indigo); }
.smv-legend i.o-pulse { border-color: var(--smv-node-line); box-shadow: 0 0 0 3px var(--smv-cyan); opacity: 0.8; }
.smv-legend i.o-hop { border: 2.5px solid var(--smv-cyan); }
.smv-legend i.o-selected { border: 2.5px solid var(--smv-ink); }
.smv-handoff summary { cursor: pointer; }
.smv-handoff pre { white-space: pre-wrap; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--smv-muted);
  background: var(--smv-card); border: 1px solid var(--smv-lane-line); border-radius: 8px; padding: 10px 12px; max-height: 240px; overflow: auto; }
.smv-flowbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.smv-chips { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
.smv-chips button { border-radius: 999px; padding: 5px 14px; }
.smv-controls { display: flex; gap: 6px; margin-left: auto; }
.smv[data-mode="compact"] .smv-controls button { padding: 3px 8px; font-size: 12px; }
.smv[data-mode="compact"] .smv-chips { flex-basis: 100%; gap: 6px; }
.smv[data-mode="compact"] .smv-chips button { padding: 3px 10px; font-size: 12px; }
.smv-hint { background: var(--smv-card); border: 1px solid var(--smv-lane-line); border-radius: 10px; padding: 10px 16px; min-height: 42px; }
.smv[data-mode="compact"] .smv-hint { padding: 7px 10px; font-size: 12px; max-height: 34vh; overflow-y: auto; }
.smv-hint h3 { margin: 0; font-size: 14px; } .smv-hint p { margin: 4px 0; } .smv-hint ul { margin: 4px 0; padding-left: 18px; }
.smv-hint .muted { color: var(--smv-muted); }
.smv-hint .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--smv-node-line); }
.smv-hint .dot.done { background: var(--smv-green); } .smv-hint .dot.in_progress { background: var(--smv-indigo); } .smv-hint .dot.blocked { background: var(--smv-red); }
.smv-hint .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 18px; }
.smv-canvas { position: relative; flex: 1; min-height: 360px; margin-top: 10px; overflow: hidden; }
.smv[data-mode="compact"] .smv-canvas { min-height: 220px; margin-top: 6px; }
.smv-canvas svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; }
.smv-canvas svg:active { cursor: grabbing; }
.smv-lane rect { fill: var(--smv-lane); stroke: var(--smv-lane-line); stroke-width: 1; }
.smv-lane .title { fill: var(--smv-ink); font-size: 13px; font-weight: 700; letter-spacing: 0.14em; }
.smv-lane .sub { fill: var(--smv-muted); font-size: 12px; }
.smv-node { cursor: pointer; outline: none; }
.smv-node .box { fill: var(--smv-node); stroke: var(--smv-node-line); stroke-width: 1.5; }
.smv-node .label { fill: var(--smv-ink); font-size: 13px; font-weight: 700; text-anchor: middle; }
.smv-node .sub { fill: var(--smv-ink); opacity: 0.82; font-size: 12px; text-anchor: middle; }
.smv-node.st-done .box { stroke: var(--smv-green); }
.smv-node.st-in_progress .box { fill: var(--smv-indigo-fill); stroke: var(--smv-indigo); }
.smv-node.st-blocked .box { fill: var(--smv-red-fill); stroke: var(--smv-red); }
.smv-node.st-none .box { stroke-dasharray: 5 4; }
.smv-node.assumed .box { stroke: var(--smv-amber); stroke-dasharray: 6 4; }
.smv-node .tag { display: none; }
.smv-node .tag rect { stroke-width: 1.2; }
.smv-node .tag text { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-anchor: middle; }
.smv-node.ch-new .tag, .smv-node.ch-changed .tag, .smv-node.ch-impacted .tag, .smv-node.ch-removed .tag { display: inline; }
.smv-node.ch-new .tag rect { fill: var(--smv-green); stroke: var(--smv-green); } .smv-node.ch-new .tag text { fill: #fff; }
.smv-node.ch-changed .tag rect { fill: var(--smv-amber); stroke: var(--smv-amber); } .smv-node.ch-changed .tag text { fill: #1b1300; }
.smv-node.ch-impacted .tag rect { fill: var(--smv-card); stroke: var(--smv-muted); } .smv-node.ch-impacted .tag text { fill: var(--smv-ink); }
.smv-node.ch-removed .tag rect { fill: var(--smv-card); stroke: var(--smv-red); } .smv-node.ch-removed .tag text { fill: var(--smv-red); }
.smv-node.ch-removed .label { text-decoration: line-through; }
.smv-node:hover .box, .smv-node:focus-visible .box { stroke-width: 2.5; }
.smv-node.selected .box { stroke: var(--smv-ink); stroke-width: 2.5; }
.smv-node .halo { fill: none; stroke: var(--smv-indigo); stroke-width: 2; opacity: 0; }
.smv-node.focus .halo { opacity: 1; animation: smv-breathe 2.4s ease-in-out infinite; }
.smv-node .ring { fill: none; stroke: var(--smv-cyan); stroke-width: 2; opacity: 0; }
.smv-node.pulse .ring { animation: smv-pulse 1.4s ease-out 3; }
.smv-node.hop .box { stroke: var(--smv-cyan); stroke-width: 2.5; }
.smv-edge path.line { fill: none; stroke: var(--smv-edge); stroke-width: 1.5; }
.smv-edge.assumed path.line { stroke: var(--smv-amber); stroke-dasharray: 6 4; }
.smv-edge.selected path.line { stroke: var(--smv-ink); stroke-width: 2.5; }
.smv-edge.hop path.line { stroke: var(--smv-cyan); stroke-width: 3; }
.smv-edge path.hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }
.smv-edge text { fill: var(--smv-ink); font-size: 11px; paint-order: stroke; stroke: var(--smv-bg); stroke-width: 4px; stroke-linejoin: round; text-anchor: middle; display: none; }
.smv-edge.selected text, .smv-edge.hop text { display: block; }
.smv-ghost path { fill: none; stroke: var(--smv-cyan); stroke-width: 3; stroke-dasharray: 2 5; stroke-linecap: round; }
.smv-dot { fill: var(--smv-cyan); stroke: var(--smv-bg); stroke-width: 2; }
.smv .dim { opacity: 0.22; transition: opacity 180ms; }
.smv-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: var(--smv-muted); pointer-events: none; }
.smv-empty[hidden] { display: none; }
@keyframes smv-breathe { 0%, 100% { stroke-opacity: 0.95; } 50% { stroke-opacity: 0.2; } }
@keyframes smv-pulse { 0% { opacity: 0.95; stroke-width: 2; } 100% { opacity: 0; stroke-width: 14; } }
@keyframes smv-blink { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .smv-node.focus .halo, .smv-node.pulse .ring { animation: none; } }
`;

let instanceCount = 0;

/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {any} d3 The d3 namespace (v7).
 * @param {HTMLElement} container The element the view fills.
 * @param {{ theme?: "light" | "dark", mode?: "full" | "compact", header?: boolean, host?: "bb" }} [options]
 */
export function createGraphView(d3, container, options = {}) {
  const uid = `smv${++instanceCount}`;
  const mode = options.mode ?? "full";
  const root = el("div", "smv");
  root.dataset.theme = options.theme ?? "dark";
  root.dataset.mode = mode;
  if (options.host) root.dataset.host = options.host;
  const style = el("style");
  style.textContent = STYLE;
  root.append(style);

  // --- Chrome --------------------------------------------------------------
  const head = el("div", "smv-head");
  const title = el("h1", "", "Thread changes map");
  const live = el("span", "smv-live", "Loading");
  const meta = el("span", "smv-meta");
  head.append(title, live, meta);
  if (options.header) root.append(head);

  const chrome = el("div", "smv-chrome");
  const progressCard = el("div", "smv-card smv-progress");
  const handoff = /** @type {HTMLDetailsElement} */ (el("details", "smv-handoff"));
  const handoffSummary = el("summary");
  const handoffText = el("pre");
  handoff.append(handoffSummary, handoffText);
  const flowbar = el("div", "smv-flowbar");
  const chips = el("div", "smv-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Follow a flow");
  const controls = el("div", "smv-controls");
  const backButton = /** @type {HTMLButtonElement} */ (el("button", "", "Back"));
  const pauseButton = /** @type {HTMLButtonElement} */ (el("button", "", "Pause"));
  const nextButton = /** @type {HTMLButtonElement} */ (el("button", "", "Next"));
  const clearButton = /** @type {HTMLButtonElement} */ (el("button", "", "Clear"));
  const fitButton = /** @type {HTMLButtonElement} */ (el("button", "", "Fit"));
  for (const button of [backButton, pauseButton, nextButton, clearButton, fitButton]) button.type = "button";
  backButton.title = "Go to the previous hop of the flow";
  pauseButton.title = "Stop or start the automatic step through the flow";
  nextButton.title = "Go to the next hop of the flow";
  clearButton.title = "Stop following the flow";
  fitButton.title = "Zoom to show the whole map";
  controls.append(backButton, pauseButton, nextButton, clearButton, fitButton);
  flowbar.append(chips, controls);
  const hint = el("div", "smv-hint");
  chrome.append(progressCard, handoff, flowbar, hint);
  root.append(chrome);

  const canvas = el("div", "smv-canvas");
  const empty = el("div", "smv-empty", "Waiting for the first map…");
  canvas.append(empty);
  root.append(canvas);
  container.append(root);

  const measureContext = document.createElement("canvas").getContext("2d");
  /** @param {string} text @param {string} font */
  function textWidth(text, font) {
    if (measureContext === null) return text.length * 7;
    measureContext.font = font;
    return measureContext.measureText(text).width;
  }

  // --- SVG -----------------------------------------------------------------
  const svg = d3.select(canvas).append("svg").attr("role", "img").attr("aria-label", "Thread changes map diagram");
  const defs = svg.append("defs");
  for (const [id, color] of [
    [`${uid}-arrow`, "var(--smv-edge)"],
    [`${uid}-arrow-amber`, "var(--smv-amber)"],
    [`${uid}-arrow-hop`, "var(--smv-cyan)"],
    [`${uid}-arrow-ink`, "var(--smv-ink)"],
  ]) {
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,0 L10,5 L0,10 z")
      .style("fill", color);
  }
  const viewport = svg.append("g");
  const laneLayer = viewport.append("g");
  const edgeLayer = viewport.append("g");
  const ghostLayer = viewport.append("g").attr("class", "smv-ghost");
  const nodeLayer = viewport.append("g");
  const dotLayer = viewport.append("g");

  // --- State ---------------------------------------------------------------
  /** @type {any} */
  let map = null;
  /** @type {Map<string, any>} */
  let boxes = new Map();
  /** @type {any[]} */
  let routes = [];
  /** @type {{ kind: "node" | "edge", id: string } | null} */
  let selected = null;
  /** @type {string | null} */
  let flowId = null;
  let hop = 0;
  let paused = false;
  let hopTimer = 0;
  let frame = 0;
  let userMoved = false;
  let width = 0;
  let height = 0;
  let lastVersion = -1;
  let progressOpen = true;
  const memory = {
    /** @type {Map<string, number>} first-seen index per lane */
    laneSeen: new Map(),
    /** @type {Map<string, number>} sub-column per node */
    sub: new Map(),
    /** @type {Map<string, string[]>} node order per lane slot */
    order: new Map(),
  };

  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 2.5])
    .clickDistance(4)
    .on("zoom", (/** @type {any} */ event) => {
      viewport.attr("transform", event.transform);
      if (event.sourceEvent) userMoved = true;
    });
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", () => select(null));

  // --- Layout --------------------------------------------------------------
  function nodeFont(bold = true) {
    return `${bold ? "700 13px" : "12px"} system-ui, -apple-system, "Segoe UI", sans-serif`;
  }

  /** @param {any} graph */
  function computeLanes(graph) {
    const meta = new Map(graph.lanes.map((/** @type {any} */ lane) => [lane.id, lane]));
    /** @type {Map<string, any[]>} */
    const members = new Map();
    for (const node of graph.nodes) {
      const id = node.group ?? "__other";
      if (!memory.laneSeen.has(id)) memory.laneSeen.set(id, memory.laneSeen.size);
      members.set(id, [...(members.get(id) ?? []), node]);
    }
    return [...members.entries()]
      .map(([id, nodes]) => {
        const lane = meta.get(id);
        return {
          id,
          title: lane?.title ?? (id === "__other" ? "Other" : id),
          subtitle: lane?.subtitle ?? null,
          placement: lane?.placement ?? "column",
          order: lane?.order ?? 100 + (memory.laneSeen.get(id) ?? 0),
          seen: memory.laneSeen.get(id) ?? 0,
          nodes,
        };
      })
      .sort((a, b) => a.order - b.order || a.seen - b.seen);
  }

  /** @param {any} graph */
  function layout(graph) {
    const degree = new Map();
    /** @type {Map<string, string[]>} */
    const neighbors = new Map();
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      neighbors.set(edge.source, [...(neighbors.get(edge.source) ?? []), edge.target]);
      neighbors.set(edge.target, [...(neighbors.get(edge.target) ?? []), edge.source]);
    }
    const lanes = computeLanes(graph);
    /** @type {Map<string, any>} */
    const next = new Map();
    const columns = lanes.filter((lane) => lane.placement !== "row");
    const rows = lanes.filter((lane) => lane.placement === "row");

    // Sizes: one width per lane, taller boxes for hubs.
    for (const lane of lanes) {
      let laneWidth = 150;
      for (const node of lane.nodes) {
        const labelWidth = textWidth(node.label, nodeFont(true));
        const subWidth = node.subtitle ? textWidth(node.subtitle, nodeFont(false)) : 0;
        laneWidth = Math.max(laneWidth, Math.min(240, Math.ceil(Math.max(labelWidth, subWidth)) + 30));
      }
      lane.nodeWidth = laneWidth;
      for (const node of lane.nodes) {
        const base = node.subtitle ? 52 : 40;
        const h = Math.min(220, base + Math.max(0, (degree.get(node.id) ?? 0) - 6) * 9);
        next.set(node.id, { id: node.id, data: node, lane: lane.id, w: laneWidth, h, x: 0, y: 0 });
      }
    }

    // Sub-columns inside a column lane, from the lane's own edges.
    for (const lane of columns) {
      const ids = new Set(lane.nodes.map((/** @type {any} */ node) => node.id));
      const inner = graph.edges.filter((/** @type {any} */ edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
      const rank = new Map([...ids].map((id) => [id, 0]));
      for (let pass = 0; pass < ids.size; pass += 1) {
        let moved = false;
        for (const edge of inner) {
          if ((rank.get(edge.target) ?? 0) <= (rank.get(edge.source) ?? 0) && (rank.get(edge.source) ?? 0) < 3) {
            rank.set(edge.target, (rank.get(edge.source) ?? 0) + 1);
            moved = true;
          }
        }
        if (!moved) break;
      }
      const wantTwo = ids.size > 7 || (inner.length > 0 && ids.size >= 4);
      for (const id of ids) {
        const known = memory.sub.get(id);
        memory.sub.set(id, known !== undefined && wantTwo ? known : wantTwo && (rank.get(id) ?? 0) > 0 ? 1 : 0);
      }
      const used = new Set([...ids].map((id) => memory.sub.get(id)));
      if (used.size === 1) for (const id of ids) memory.sub.set(id, 0);
      lane.subs = used.size === 1 ? 1 : 2;
    }

    // Column x positions.
    let cursor = 0;
    for (const lane of columns) {
      lane.x = cursor;
      lane.w = LANE_PAD * 2 + lane.subs * lane.nodeWidth + (lane.subs - 1) * SUB_GAP;
      cursor += lane.w + LANE_GAP;
      for (const node of lane.nodes) {
        const box = next.get(node.id);
        box.x = lane.x + LANE_PAD + (memory.sub.get(node.id) ?? 0) * (lane.nodeWidth + SUB_GAP);
      }
    }
    const columnsWidth = Math.max(0, cursor - LANE_GAP);

    // Slot order: a slot seen for the first time sorts by neighbor position;
    // a known slot keeps its order and only places the nodes that are new.
    const previous = boxes;
    /** @param {string} key @param {string[]} ids @param {(id: string) => number} want */
    function slotOrder(key, ids, want) {
      const known = memory.order.get(key);
      let order;
      if (known === undefined || known.length === 0) {
        order = [...ids].sort((a, b) => want(a) - want(b));
      } else {
        order = known.filter((id) => ids.includes(id) && previous.has(id));
        for (const id of ids.filter((candidate) => !order.includes(candidate))) {
          const target = want(id);
          const index = order.findIndex((other) => want(other) > target);
          if (index < 0) order.push(id);
          else order.splice(index, 0, id);
        }
      }
      return order;
    }
    /** @param {string} id @param {"x" | "y"} axis */
    function neighborCenter(id, axis) {
      const list = (neighbors.get(id) ?? []).map((other) => next.get(other)).filter(Boolean);
      if (list.length === 0) return Number.NaN;
      return d3.mean(list, (/** @type {any} */ box) => (axis === "y" ? box.y + box.h / 2 : box.x + box.w / 2));
    }
    /** @param {string} id @param {"x" | "y"} axis */
    function wanted(id, axis) {
      const center = neighborCenter(id, axis);
      if (!Number.isNaN(center)) return center;
      const box = next.get(id);
      return axis === "y" ? box.y + box.h / 2 : box.x + box.w / 2;
    }

    // Column y positions: stack, then pull each box toward its neighbors.
    const top = LANE_HEADER;
    const slots = columns.flatMap((lane) =>
      Array.from({ length: lane.subs }, (_, sub) => ({
        key: `${lane.id}|${sub}`,
        ids: lane.nodes.filter((/** @type {any} */ node) => (memory.sub.get(node.id) ?? 0) === sub).map((/** @type {any} */ node) => node.id),
        order: /** @type {string[]} */ ([]),
      })),
    );
    for (const slot of slots) {
      const known = memory.order.get(slot.key) ?? [];
      slot.order = [...known.filter((id) => slot.ids.includes(id)), ...slot.ids.filter((id) => !known.includes(id))];
      let y = top;
      for (const id of slot.order) {
        const box = next.get(id);
        const before = previous.get(id);
        box.y = before ? before.y : y;
        y = box.y + box.h + NODE_GAP;
      }
    }
    for (let pass = 0; pass < 4; pass += 1) {
      for (const slot of pass % 2 === 0 ? slots : [...slots].reverse()) {
        slot.order = slotOrder(slot.key, slot.ids, (id) => wanted(id, "y"));
        let floor = top;
        for (const id of slot.order) {
          const box = next.get(id);
          const want = wanted(id, "y") - box.h / 2;
          box.y = Math.max(floor, (box.y + want) / 2);
          floor = box.y + box.h + NODE_GAP;
        }
      }
    }
    for (const slot of slots) memory.order.set(slot.key, slot.order);
    // The neighbor pull drifts everything down; lift the columns back to the header.
    let highest = Infinity;
    for (const slot of slots) for (const id of slot.order) highest = Math.min(highest, next.get(id).y);
    if (Number.isFinite(highest) && highest > top) {
      for (const slot of slots) for (const id of slot.order) next.get(id).y -= highest - top;
    }
    let columnsBottom = top;
    for (const lane of columns) {
      for (const node of lane.nodes) columnsBottom = Math.max(columnsBottom, next.get(node.id).y + next.get(node.id).h);
    }
    const columnHeight = columnsBottom + LANE_PAD + 6;
    for (const lane of columns) {
      lane.y = 0;
      lane.h = columnHeight;
    }

    // Row lanes: one band under the columns, nodes left to right.
    const bandTop = columns.length > 0 ? columnHeight + ROW_GAP : 0;
    let rowCursor = 0;
    let bandHeight = 0;
    for (const lane of rows) {
      const ids = slotOrder(`${lane.id}|row`, lane.nodes.map((/** @type {any} */ node) => node.id), (id) => {
        const center = neighborCenter(id, "x");
        return Number.isNaN(center) ? 1e6 : center;
      });
      memory.order.set(`${lane.id}|row`, ids);
      let x = rowCursor + LANE_PAD;
      let tallest = 0;
      for (const id of ids) {
        const box = next.get(id);
        const center = neighborCenter(id, "x");
        const want = Number.isNaN(center) ? x : center - box.w / 2;
        box.x = Math.max(x, want);
        box.y = bandTop + LANE_PAD + 14;
        x = box.x + box.w + NODE_GAP;
        tallest = Math.max(tallest, box.h);
      }
      lane.x = rowCursor;
      lane.y = bandTop;
      lane.w = Math.max(x - NODE_GAP + LANE_PAD - rowCursor, textWidth(lane.title.toUpperCase(), "700 13px system-ui") * 1.25 + LANE_PAD * 2);
      lane.tallest = tallest;
      rowCursor = lane.x + lane.w + LANE_GAP;
      bandHeight = Math.max(bandHeight, tallest + LANE_PAD + 14 + ROW_LABEL);
    }
    // Stretch the last row lane to the columns' width so the band lines up.
    if (rows.length > 0 && rowCursor - LANE_GAP < columnsWidth) rows[rows.length - 1].w += columnsWidth - (rowCursor - LANE_GAP);
    for (const lane of rows) lane.h = bandHeight;
    return { lanes, boxes: next };
  }

  /** Pick sides, spread ports along each side, and build cubic paths. */
  function route(graph, laidOut) {
    const requests = new Map();
    const list = [];
    for (const edge of graph.edges) {
      const s = laidOut.get(edge.source);
      const t = laidOut.get(edge.target);
      if (!s || !t || s === t) continue;
      let from;
      let to;
      if (t.x >= s.x + s.w + 8) [from, to] = ["right", "left"];
      else if (t.x + t.w <= s.x - 8) [from, to] = ["left", "right"];
      else if (t.y >= s.y + s.h) [from, to] = ["bottom", "top"];
      else [from, to] = ["top", "bottom"];
      const item = { edge, s, t, from, to, p0: null, p1: null };
      list.push(item);
      for (const [box, side, other] of [
        [s, from, t],
        [t, to, s],
      ]) {
        const key = `${box.id}|${side}`;
        requests.set(key, [...(requests.get(key) ?? []), { item, end: box === s ? "p0" : "p1", other }]);
      }
    }
    for (const [key, entries] of requests) {
      const side = key.slice(key.lastIndexOf("|") + 1);
      const vertical = side === "left" || side === "right";
      entries.sort((/** @type {any} */ a, /** @type {any} */ b) =>
        vertical ? a.other.y + a.other.h / 2 - (b.other.y + b.other.h / 2) : a.other.x + a.other.w / 2 - (b.other.x + b.other.w / 2),
      );
      entries.forEach((/** @type {any} */ entry, /** @type {number} */ index) => {
        const box = entry.item[entry.end === "p0" ? "s" : "t"];
        const fraction = (index + 1) / (entries.length + 1);
        const inset = entry.end === "p1" ? 2 : 0;
        const point =
          side === "left"
            ? { x: box.x - inset, y: box.y + box.h * (0.15 + 0.7 * fraction) }
            : side === "right"
              ? { x: box.x + box.w + inset, y: box.y + box.h * (0.15 + 0.7 * fraction) }
              : side === "top"
                ? { x: box.x + box.w * (0.15 + 0.7 * fraction), y: box.y - inset }
                : { x: box.x + box.w * (0.15 + 0.7 * fraction), y: box.y + box.h + inset };
        entry.item[entry.end] = point;
      });
    }
    for (const item of list) {
      const { p0, p1, from } = item;
      if (from === "left" || from === "right") {
        const direction = from === "right" ? 1 : -1;
        const dx = Math.max(26, Math.abs(p1.x - p0.x) * 0.45);
        item.d = `M${p0.x},${p0.y} C${p0.x + direction * dx},${p0.y} ${p1.x - direction * dx},${p1.y} ${p1.x},${p1.y}`;
      } else {
        const direction = from === "bottom" ? 1 : -1;
        const dy = Math.max(26, Math.abs(p1.y - p0.y) * 0.45);
        item.d = `M${p0.x},${p0.y} C${p0.x},${p0.y + direction * dy} ${p1.x},${p1.y - direction * dy} ${p1.x},${p1.y}`;
      }
      item.mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    }
    return list;
  }

  // --- Drawing -------------------------------------------------------------
  /** @param {any[]} lanes */
  function drawLanes(lanes) {
    laneLayer
      .selectAll("g.smv-lane")
      .data(lanes, (/** @type {any} */ lane) => lane.id)
      .join((/** @type {any} */ enter) => {
        const g = enter.append("g").attr("class", "smv-lane");
        g.append("rect").attr("rx", 10);
        g.append("text").attr("class", "title");
        g.append("text").attr("class", "sub");
        return g;
      })
      .each(function (/** @type {any} */ lane) {
        const g = d3.select(this);
        const row = lane.placement === "row";
        g.select("rect").transition().duration(420).attr("x", lane.x).attr("y", lane.y).attr("width", lane.w).attr("height", lane.h);
        const titleY = row ? lane.y + lane.h - 26 : lane.y + 26;
        g.select(".title").transition().duration(420).attr("x", lane.x + LANE_PAD + 2).attr("y", titleY);
        g.select(".title").text(lane.title.toUpperCase());
        g.select(".sub").transition().duration(420).attr("x", lane.x + LANE_PAD + 2).attr("y", titleY + 17);
        g.select(".sub").text(lane.subtitle ?? "");
      });
  }

  function drawNodes() {
    const states = map?.derived?.nodeStates ?? {};
    const focus = new Set(map?.graph.focus ?? []);
    nodeLayer
      .selectAll("g.smv-node")
      .data([...boxes.values()], (/** @type {any} */ box) => box.id)
      .join(
        (/** @type {any} */ enter) => {
          const g = enter
            .append("g")
            .attr("class", "smv-node")
            .attr("tabindex", 0)
            .attr("role", "button")
            .attr("transform", (/** @type {any} */ box) => `translate(${box.x},${box.y})`)
            .style("opacity", 0);
          g.append("rect").attr("class", "halo").attr("rx", 12);
          g.append("rect").attr("class", "ring").attr("rx", 11);
          g.append("rect").attr("class", "box").attr("rx", 9);
          g.append("text").attr("class", "label");
          g.append("text").attr("class", "sub");
          const tag = g.append("g").attr("class", "tag");
          tag.append("rect").attr("rx", 4).attr("height", 15);
          tag.append("text");
          g.append("title");
          g.on("click", (/** @type {any} */ event, /** @type {any} */ box) => {
            event.stopPropagation();
            select(selected?.kind === "node" && selected.id === box.id ? null : { kind: "node", id: box.id });
          }).on("keydown", (/** @type {KeyboardEvent} */ event, /** @type {any} */ box) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              select({ kind: "node", id: box.id });
            }
          });
          return g;
        },
        (/** @type {any} */ update) => update,
        (/** @type {any} */ exit) => exit.transition().duration(250).style("opacity", 0).remove(),
      )
      .each(function (/** @type {any} */ box) {
        const g = d3.select(this);
        const state = states[box.id] ?? "neutral";
        const node = box.data;
        g.attr("class", `smv-node st-${state}`)
          .classed("assumed", node.assumed)
          .classed("focus", focus.has(box.id))
          .classed(`ch-${node.status}`, node.status in CHANGE_LABELS)
          .attr("aria-label", `${node.label}${node.subtitle ? `, ${node.subtitle}` : ""}, ${STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (state)]}${node.status in CHANGE_LABELS ? `, ${CHANGE_LABELS[node.status]}` : ""}${node.assumed ? ", assumed" : ""}`);
        const tagText = node.status in CHANGE_LABELS ? node.status.toUpperCase() : "";
        const tagWidth = tagText.length * 6.4 + 12;
        g.select(".tag").attr("transform", `translate(${box.w - tagWidth - 8},-8)`);
        g.select(".tag rect").attr("width", tagWidth);
        g.select(".tag text").attr("x", tagWidth / 2).attr("y", 11).text(tagText);
        g.transition().duration(420).style("opacity", 1).attr("transform", `translate(${box.x},${box.y})`);
        g.select(".halo").attr("x", -5).attr("y", -5).attr("width", box.w + 10).attr("height", box.h + 10);
        g.select(".ring").attr("x", -3).attr("y", -3).attr("width", box.w + 6).attr("height", box.h + 6);
        g.select(".box").attr("width", box.w).attr("height", box.h);
        const middle = box.h / 2;
        g.select(".label").attr("x", box.w / 2).attr("y", node.subtitle ? middle - 3 : middle + 5).text(clip(node.label, box.w - 16, true));
        g.select(".sub").attr("x", box.w / 2).attr("y", middle + 15).text(node.subtitle ? clip(node.subtitle, box.w - 16, false) : "");
        g.select("title").text(`${node.label}${node.subtitle ? `\n${node.subtitle}` : ""}${node.description ? `\n\n${node.description}` : ""}`);
      });
  }

  /** @param {string} text @param {number} max @param {boolean} bold */
  function clip(text, max, bold) {
    if (textWidth(text, nodeFont(bold)) <= max) return text;
    let cut = text;
    while (cut.length > 1 && textWidth(`${cut}…`, nodeFont(bold)) > max) cut = cut.slice(0, -1);
    return `${cut}…`;
  }

  function drawEdges() {
    edgeLayer
      .selectAll("g.smv-edge")
      .data(routes, (/** @type {any} */ item) => item.edge.id)
      .join(
        (/** @type {any} */ enter) => {
          const g = enter.append("g").attr("class", "smv-edge");
          g.append("path").attr("class", "line").attr("d", (/** @type {any} */ item) => item.d).style("opacity", 0);
          g.append("path").attr("class", "hit");
          g.append("text");
          g.append("title");
          g.on("click", (/** @type {any} */ event, /** @type {any} */ item) => {
            event.stopPropagation();
            select(selected?.kind === "edge" && selected.id === item.edge.id ? null : { kind: "edge", id: item.edge.id });
          });
          return g;
        },
        (/** @type {any} */ update) => update,
        (/** @type {any} */ exit) => exit.remove(),
      )
      .each(function (/** @type {any} */ item) {
        const g = d3.select(this);
        g.classed("assumed", item.edge.assumed);
        g.select("path.line")
          .attr("marker-end", `url(#${uid}-arrow${item.edge.assumed ? "-amber" : ""})`)
          .transition()
          .duration(420)
          .style("opacity", 1)
          .attr("d", item.d);
        g.select("path.hit").attr("d", item.d);
        g.select("text").attr("x", item.mid.x).attr("y", item.mid.y - 6).text(item.edge.label ?? item.edge.kind);
        g.select("title").text(`${label(item.edge.source)} ${item.edge.kind} ${label(item.edge.target)}${item.edge.label ? `: ${item.edge.label}` : ""}`);
      });
  }

  /** @param {string} id */
  function label(id) {
    return boxes.get(id)?.data.label ?? id;
  }

  // --- Chrome rendering ------------------------------------------------------
  function renderHeader() {
    if (!options.header || map === null) return;
    const graph = map.graph;
    title.textContent = graph.title ?? "Thread changes map";
    live.dataset.state = map.state;
    const word = { starting: "starting", mapping: "mapping", idle: "live", sleeping: "sleeping", stopped: "stopped", error: "error" }[/** @type {"idle"} */ (map.state)] ?? map.state;
    live.textContent = graph.version > 0 ? `${word}, v${graph.version}` : word;
    const last = graph.log[graph.log.length - 1];
    meta.textContent = last ? `state v${last.version} at ${new Date(last.at).toLocaleTimeString()}, changed: ${last.summary}` : "";
  }

  function legend() {
    const box = el("div", "smv-legend");
    const items = [
      ["done", "done"],
      ["in_progress", "in progress"],
      ["blocked", "blocked or failed"],
      ["todo", "todo"],
      ["none", "no plan steps"],
      ["line", "call"],
      ["line assumed", "assumed, not in the plan"],
      ["line hop", "current hop"],
    ];
    for (const [className, text] of items) {
      const item = el("span");
      item.append(el("i", className), el("em", "", text));
      box.append(item);
    }
    if (mode === "full") box.append(el("span", "", "Node fill: a blocked step wins, then all done, then any started step."));
    const outlines = el("div", "row");
    outlines.append(el("strong", "", "Outlines"));
    for (const [className, text] of OUTLINE_LABELS) {
      const item = el("span");
      item.append(el("i", className), el("em", "", text));
      outlines.append(item);
    }
    box.append(outlines);
    return box;
  }

  function renderProgress() {
    const progress = map?.derived?.progress;
    progressCard.replaceChildren();
    const total = el("div", "smv-total");
    if (!progress || progress.total === 0) {
      total.append(el("b", "", "No plan steps yet"), el("span", "", " The mapper links plan steps to nodes as it finds the plan."));
    } else {
      total.append(
        el("b", "", `${progress.done} of ${progress.total} steps done`),
        el("span", "", `${mode === "compact" ? " · " : ""}${progress.inProgress} in progress, ${progress.blocked} blocked or failed, ${progress.todo} todo`),
      );
    }
    if (mode === "compact") {
      const toggle = /** @type {HTMLButtonElement} */ (el("button", "smv-toggle", progressOpen ? "Hide" : "Details"));
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        progressOpen = !progressOpen;
        renderProgress();
      });
      total.append(toggle);
    }
    progressCard.append(total);
    if (!progressOpen) return;
    if (progress && progress.phases.length > 0) {
      const phases = el("div", "smv-phases");
      progress.phases.forEach((/** @type {any} */ phase, /** @type {number} */ index) => {
        const item = el("div", "smv-phase");
        const line = el("div");
        line.append(el("span", "", `${index} ${phase.name}`), el("span", "", `${phase.done}/${phase.total}`));
        line.title = phase.name;
        const bar = el("div", "smv-bar");
        for (const [className, count] of [
          ["done", phase.done],
          ["in_progress", phase.inProgress],
          ["blocked", phase.blocked],
        ]) {
          if (count === 0 || phase.total === 0) continue;
          const part = el("i", /** @type {string} */ (className));
          part.style.width = `${(/** @type {number} */ (count) / phase.total) * 100}%`;
          bar.append(part);
        }
        item.append(line, bar);
        phases.append(item);
      });
      progressCard.append(phases);
    }
    progressCard.append(legend());
  }

  function renderHandoff() {
    const value = map?.graph.handoff;
    handoff.hidden = !value || value.text.trim() === "";
    if (!value) return;
    handoffSummary.textContent = `Handoff from ${value.source}`;
    handoffText.textContent = value.text;
  }

  function renderFlows() {
    const flows = map?.graph.flows ?? [];
    flowbar.hidden = flows.length === 0 && mode === "compact";
    chips.replaceChildren(
      ...flows.map((/** @type {any} */ flow) => {
        const chip = /** @type {HTMLButtonElement} */ (el("button", "", flow.name));
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(flow.id === flowId));
        if (flow.description) chip.title = flow.description;
        chip.addEventListener("click", () => setFlow(flow.id === flowId ? null : flow.id));
        return chip;
      }),
    );
    const active = flowId !== null;
    // The hop controls only mean something while a flow plays.
    for (const button of [backButton, pauseButton, nextButton, clearButton]) button.hidden = !active;
    pauseButton.textContent = paused ? "Play" : "Pause";
    fitButton.disabled = boxes.size === 0;
  }

  /** @param {string} status */
  function stepDot(status) {
    return el("span", `dot ${status}`);
  }

  function renderHint() {
    hint.replaceChildren();
    const graph = map?.graph;
    const flow = currentFlow();
    if (flow) {
      const from = flow.steps[hop];
      const to = flow.steps[hop + 1];
      hint.hidden = false;
      const heading = el("h3", "", `${flow.name}: hop ${hop + 1} of ${flow.steps.length - 1}`);
      const line = el("p", "", `${label(from)} → ${label(to)}`);
      hint.append(heading, line);
      const note = flow.notes[hop];
      if (note) hint.append(el("p", "muted", note));
      return;
    }
    if (selected && graph) {
      if (selected.kind === "node") renderNodeDetails(graph, selected.id);
      else renderEdgeDetails(graph, selected.id);
      return;
    }
    hint.textContent = graph && graph.nodes.length > 0 ? HINT : "";
    hint.hidden = !graph || graph.nodes.length === 0;
  }

  /** @param {any} graph @param {string} id */
  function renderNodeDetails(graph, id) {
    hint.hidden = false;
    const node = graph.nodes.find((/** @type {any} */ candidate) => candidate.id === id);
    if (!node) return;
    const state = map.derived?.nodeStates?.[id] ?? "neutral";
    hint.append(el("h3", "", node.label));
    hint.append(
      el(
        "p",
        "muted",
        [node.subtitle, STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (state)], node.assumed ? "assumed, not in the plan" : null, node.status === "stable" ? null : node.status]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    if (node.description) hint.append(el("p", "", node.description));
    const cols = el("div", "cols");
    const steps = graph.steps.filter((/** @type {any} */ step) => step.nodes.includes(id));
    if (node.decisions.length > 0) cols.append(section("Decisions", node.decisions.map((/** @type {string} */ text) => el("li", "", text))));
    if (steps.length > 0) cols.append(section("Plan steps", steps.map((/** @type {any} */ step) => stepItem(graph, step))));
    const out = graph.edges.filter((/** @type {any} */ edge) => edge.source === id).map((/** @type {any} */ edge) => el("li", "", `${edge.kind} ${label(edge.target)}${edge.label ? ` (${edge.label})` : ""}`));
    const into = graph.edges.filter((/** @type {any} */ edge) => edge.target === id).map((/** @type {any} */ edge) => el("li", "", `${label(edge.source)} ${edge.kind}${edge.label ? ` (${edge.label})` : ""}`));
    if (out.length > 0) cols.append(section("Calls / uses", out));
    if (into.length > 0) cols.append(section("Used by", into));
    if (node.files.length > 0) cols.append(section("Files", node.files.map((/** @type {string} */ file) => el("li", "muted", file))));
    hint.append(cols);
  }

  /** @param {any} graph @param {string} id */
  function renderEdgeDetails(graph, id) {
    hint.hidden = false;
    const edge = graph.edges.find((/** @type {any} */ candidate) => candidate.id === id);
    if (!edge) return;
    hint.append(el("h3", "", `${label(edge.source)} → ${label(edge.target)}`));
    hint.append(el("p", "muted", [edge.kind, edge.label, edge.assumed ? "assumed, not in the plan" : null].filter(Boolean).join(" · ")));
    const cols = el("div", "cols");
    const steps = graph.steps.filter((/** @type {any} */ step) => step.edges.includes(id));
    if (edge.decisions.length > 0) cols.append(section("Decisions", edge.decisions.map((/** @type {string} */ text) => el("li", "", text))));
    if (steps.length > 0) cols.append(section("Plan steps", steps.map((/** @type {any} */ step) => stepItem(graph, step))));
    if (cols.childElementCount === 0) cols.append(el("p", "muted", "No decisions or plan steps for this edge yet."));
    hint.append(cols);
  }

  /** @param {any} graph @param {any} step */
  function stepItem(graph, step) {
    const item = el("li");
    const phase = graph.phases.find((/** @type {any} */ candidate) => candidate.id === step.phase);
    item.append(stepDot(step.status), `${step.title}`, el("span", "muted", phase ? ` · ${phase.name}` : ""));
    return item;
  }

  /** @param {string} heading @param {HTMLElement[]} items */
  function section(heading, items) {
    const box = el("div");
    const list = el("ul");
    list.append(...items);
    box.append(el("p", "", heading), list);
    /** @type {HTMLElement} */ (box.firstChild).style.fontWeight = "600";
    return box;
  }

  // --- Highlight, flows, selection -------------------------------------------
  function currentFlow() {
    if (map === null || flowId === null) return null;
    return map.graph.flows.find((/** @type {any} */ flow) => flow.id === flowId) ?? null;
  }

  /** The routed edge between two nodes, either direction. */
  function hopRoute(/** @type {string} */ a, /** @type {string} */ b) {
    return routes.find((item) => item.edge.source === a && item.edge.target === b) ?? routes.find((item) => item.edge.source === b && item.edge.target === a) ?? null;
  }

  function applyHighlight() {
    const flow = currentFlow();
    /** @type {Set<string> | null} */
    let keepNodes = null;
    /** @type {Set<string> | null} */
    let keepEdges = null;
    /** @type {Set<string>} */
    const hopNodes = new Set();
    /** @type {string | null} */
    let hopEdge = null;
    if (flow) {
      keepNodes = new Set(flow.steps);
      keepEdges = new Set();
      for (let index = 0; index + 1 < flow.steps.length; index += 1) {
        const item = hopRoute(flow.steps[index], flow.steps[index + 1]);
        if (item) keepEdges.add(item.edge.id);
      }
      hopNodes.add(flow.steps[hop]).add(flow.steps[hop + 1]);
      hopEdge = hopRoute(flow.steps[hop], flow.steps[hop + 1])?.edge.id ?? null;
    } else if (selected?.kind === "node") {
      const id = selected.id;
      keepNodes = new Set([id]);
      keepEdges = new Set();
      for (const item of routes) {
        if (item.edge.source === id || item.edge.target === id) {
          keepNodes.add(item.edge.source).add(item.edge.target);
          keepEdges.add(item.edge.id);
        }
      }
    } else if (selected?.kind === "edge") {
      const item = routes.find((candidate) => candidate.edge.id === selected?.id);
      if (item) {
        keepNodes = new Set([item.edge.source, item.edge.target]);
        keepEdges = new Set([item.edge.id]);
      }
    }
    nodeLayer
      .selectAll("g.smv-node")
      .classed("dim", (/** @type {any} */ box) => keepNodes !== null && !keepNodes.has(box.id))
      .classed("hop", (/** @type {any} */ box) => hopNodes.has(box.id))
      .classed("selected", (/** @type {any} */ box) => selected?.kind === "node" && selected.id === box.id);
    edgeLayer
      .selectAll("g.smv-edge")
      .classed("dim", (/** @type {any} */ item) => keepEdges !== null && !keepEdges.has(item.edge.id))
      .classed("hop", (/** @type {any} */ item) => item.edge.id === hopEdge)
      .classed("selected", (/** @type {any} */ item) => selected?.kind === "edge" && selected.id === item.edge.id)
      .each(function (/** @type {any} */ item) {
        const marker = item.edge.id === hopEdge ? "-hop" : selected?.kind === "edge" && selected.id === item.edge.id ? "-ink" : item.edge.assumed ? "-amber" : "";
        d3.select(this).select("path.line").attr("marker-end", `url(#${uid}-arrow${marker})`);
      });
    // A hop with no edge between its ends gets a dotted guide line.
    const ghost = flow && hopEdge === null ? ghostPath(flow.steps[hop], flow.steps[hop + 1]) : null;
    ghostLayer
      .selectAll("path")
      .data(ghost ? [ghost] : [])
      .join("path")
      .attr("d", (/** @type {string} */ d) => d)
      .attr("marker-end", `url(#${uid}-arrow-hop)`);
  }

  /** @param {string} a @param {string} b */
  function ghostPath(a, b) {
    const s = boxes.get(a);
    const t = boxes.get(b);
    if (!s || !t) return null;
    const p0 = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    const p1 = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    return `M${p0.x},${p0.y} L${p1.x},${p1.y}`;
  }

  /** Move a dot along the current hop, from its first step to its second. */
  function animateHop(/** @type {number} */ time) {
    const flow = currentFlow();
    if (!flow) return;
    const from = flow.steps[hop];
    const item = hopRoute(from, flow.steps[hop + 1]);
    /** @type {SVGPathElement | null} */
    let path = null;
    let reverse = false;
    if (item) {
      edgeLayer.selectAll("g.smv-edge").each(function (/** @type {any} */ candidate) {
        if (candidate.edge.id === item.edge.id) path = /** @type {SVGPathElement} */ (/** @type {Element} */ (this).querySelector("path.line"));
      });
      reverse = item.edge.source !== from;
    } else {
      path = ghostLayer.select("path").node();
    }
    if (path) {
      const length = path.getTotalLength();
      const t = ((time % 1400) / 1400) * length;
      const point = path.getPointAtLength(reverse ? length - t : t);
      dotLayer.selectAll("circle").data([0]).join("circle").attr("class", "smv-dot").attr("r", 5).attr("cx", point.x).attr("cy", point.y);
    }
    frame = requestAnimationFrame(animateHop);
  }

  function scheduleHop() {
    clearInterval(hopTimer);
    if (flowId === null || paused) return;
    hopTimer = window.setInterval(() => step(1, true), HOP_MS);
  }

  /** @param {number} delta @param {boolean} [wrap] */
  function step(delta, wrap = false) {
    const flow = currentFlow();
    if (!flow) return;
    const hops = flow.steps.length - 1;
    hop = wrap ? (hop + delta + hops) % hops : Math.max(0, Math.min(hops - 1, hop + delta));
    applyHighlight();
    renderHint();
  }

  /** @param {string | null} id */
  function setFlow(id) {
    flowId = id;
    hop = 0;
    paused = false;
    selected = null;
    cancelAnimationFrame(frame);
    dotLayer.selectAll("circle").remove();
    if (id !== null) frame = requestAnimationFrame(animateHop);
    scheduleHop();
    applyHighlight();
    renderFlows();
    renderHint();
  }

  /** @param {{ kind: "node" | "edge", id: string } | null} target */
  function select(target) {
    if (target !== null && flowId !== null) setFlow(null);
    selected = target;
    applyHighlight();
    renderHint();
  }

  backButton.addEventListener("click", () => {
    paused = true;
    scheduleHop();
    step(-1);
    renderFlows();
  });
  nextButton.addEventListener("click", () => {
    paused = true;
    scheduleHop();
    step(1);
    renderFlows();
  });
  pauseButton.addEventListener("click", () => {
    paused = !paused;
    scheduleHop();
    renderFlows();
  });
  clearButton.addEventListener("click", () => setFlow(null));
  fitButton.addEventListener("click", () => {
    userMoved = false;
    fit(true);
  });

  function pulse(/** @type {Set<string>} */ ids) {
    if (ids.size === 0) return;
    nodeLayer.selectAll("g.smv-node").each(function (/** @type {any} */ box) {
      if (!ids.has(box.id)) return;
      const element = /** @type {SVGGElement} */ (/** @type {unknown} */ (this));
      element.classList.remove("pulse");
      void element.getBoundingClientRect();
      element.classList.add("pulse");
      setTimeout(() => element.classList.remove("pulse"), 4500);
    });
  }

  /** @type {{ minX: number, minY: number, maxX: number, maxY: number } | null} */
  let bounds = null;
  function fit(animate = true) {
    if (bounds === null || width === 0 || height === 0) return;
    const pad = mode === "compact" ? 10 : 20;
    const scale = Math.max(0.1, Math.min(1, (width - pad * 2) / (bounds.maxX - bounds.minX), (height - pad * 2) / (bounds.maxY - bounds.minY)));
    const transform = d3.zoomIdentity
      .translate(width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale, pad - bounds.minY * scale)
      .scale(scale);
    (animate ? svg.transition().duration(450) : svg).call(zoom.transform, transform);
  }

  const resizeObserver = new ResizeObserver(() => {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    if (!userMoved) fit(false);
  });
  resizeObserver.observe(canvas);

  return {
    /**
     * Draw a new map version. Lanes keep their order and nodes keep their
     * place in a lane, so live updates move little.
     */
    update(/** @type {any} */ next) {
      map = next;
      const graph = next.graph;
      const laidOut = layout(graph);
      boxes = laidOut.boxes;
      routes = route(graph, boxes);
      bounds = null;
      for (const lane of laidOut.lanes) {
        bounds = {
          minX: Math.min(bounds?.minX ?? Infinity, lane.x),
          minY: Math.min(bounds?.minY ?? Infinity, lane.y),
          maxX: Math.max(bounds?.maxX ?? -Infinity, lane.x + lane.w),
          maxY: Math.max(bounds?.maxY ?? -Infinity, lane.y + lane.h),
        };
      }
      empty.hidden = graph.nodes.length > 0;
      if (flowId !== null && currentFlow() === null) setFlow(null);
      if (selected?.kind === "node" && !boxes.has(selected.id)) selected = null;
      if (selected?.kind === "edge" && !routes.some((item) => item.edge.id === selected?.id)) selected = null;
      const flow = currentFlow();
      if (flow && hop > flow.steps.length - 2) hop = 0;
      drawLanes(laidOut.lanes);
      drawEdges();
      drawNodes();
      renderHeader();
      renderProgress();
      renderHandoff();
      renderFlows();
      renderHint();
      applyHighlight();
      if (lastVersion >= 0 && graph.version > lastVersion) {
        pulse(new Set(graph.nodes.filter((/** @type {any} */ node) => node.changedIn === graph.version).map((/** @type {any} */ node) => node.id)));
      }
      lastVersion = graph.version;
      if (!userMoved) setTimeout(() => fit(true), 30);
    },
    /** Show a message in the empty diagram area (for example while the mapper starts). */
    setEmptyText(/** @type {string} */ text) {
      empty.textContent = text;
    },
    setFlow,
    select,
    fit() {
      userMoved = false;
      fit(true);
    },
    setTheme(/** @type {"light" | "dark"} */ theme) {
      root.dataset.theme = theme;
    },
    /** The view's root element, for host-provided CSS variables. */
    element: root,
    destroy() {
      clearInterval(hopTimer);
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      root.remove();
    },
  };
}
