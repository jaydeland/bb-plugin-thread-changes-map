import type { MapDerived, MapGraph, NodeState } from "../src/model";

/** What the view draws: one map version and the server's derived fill and progress. */
export interface ViewInput {
  graph: MapGraph;
  derived: MapDerived;
  state: string;
}

export interface GraphView {
  update(input: ViewInput): void;
  setEmptyText(text: string): void;
  setFlow(flowId: string | null): void;
  select(target: { kind: "node" | "edge"; id: string } | null): void;
  fit(): void;
  setTheme(theme: "light" | "dark"): void;
  readonly element: HTMLDivElement;
  destroy(): void;
}

export const STATE_LABELS: Record<NodeState, string>;

export function createGraphView(
  d3: unknown,
  container: HTMLElement,
  options?: {
    theme?: "light" | "dark";
    mode?: "full" | "compact";
    header?: boolean;
    host?: "bb";
  },
): GraphView;
