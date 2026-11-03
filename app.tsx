// System Map side panel: a fixed tab in every thread's right panel. It starts
// the background mapper agent and mounts the shared view in compact mode.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as d3 from "d3";
import {
  UrlLink,
  definePluginApp,
  experimental_usePluginId,
  useRealtime,
  useRpc,
  type ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MAP_CHANNEL } from "./src/constants";
import type { MapState } from "./src/store";
import type { MapDto, rpcContract } from "./server";
import { createGraphView, type GraphView } from "./viewer/graph-view.js";

const STATE_LABELS: Record<MapState, string> = {
  starting: "Starting",
  mapping: "Mapping",
  idle: "Live",
  sleeping: "Sleeping",
  stopped: "Stopped",
  error: "Error",
};

const STATE_DOTS: Record<MapState, string> = {
  starting: "bg-indigo-500 animate-pulse",
  mapping: "bg-indigo-500 animate-pulse",
  idle: "bg-green-600",
  sleeping: "bg-muted-foreground",
  stopped: "bg-muted-foreground",
  error: "bg-destructive",
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The thread's map, refetched on every server signal for this thread. */
function useMap(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [map, setMap] = useState<MapDto | null | undefined>(undefined);
  const [isMapper, setIsMapper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("map_get", { threadId, origin: window.location.origin }).then(
      (result) => {
        setMap(result.map);
        setIsMapper(result.isMapper);
        setError(null);
      },
      (cause: unknown) => setError(messageOf(cause)),
    );
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime(MAP_CHANNEL, (payload) => {
    if (typeof payload === "object" && payload !== null && (payload as { threadId?: unknown }).threadId === threadId) {
      refetch();
    }
  });
  return { rpc, map, isMapper, error, setError, refetch };
}

/** Paint a CSS color on a 1x1 canvas to get its sRGB value, whatever color space the theme uses. */
function luminanceOf(color: string): number {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context === null) return 1;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Keep the view's ink, surface, and light/dark steps in line with the bb theme. */
function useHostTheme(probe: RefObject<HTMLDivElement | null>, view: GraphView | null) {
  useEffect(() => {
    const element = probe.current;
    if (element === null || view === null) return;
    const apply = () => {
      const styles = getComputedStyle(element);
      const muted = element.querySelector<HTMLElement>("[data-probe=muted]");
      const target = view.element.style;
      target.setProperty("--smv-host-ink", styles.color);
      target.setProperty("--smv-host-surface", styles.backgroundColor);
      if (muted) target.setProperty("--smv-host-muted", getComputedStyle(muted).color);
      view.setTheme(luminanceOf(styles.backgroundColor) < 0.5 ? "dark" : "light");
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", apply);
    };
  }, [probe, view]);
}

function StatusChip({ map }: { map: MapDto }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn("size-2 rounded-full", STATE_DOTS[map.state])} />
      {STATE_LABELS[map.state]}
      {map.graph.version > 0 ? `, v${map.graph.version}` : ""}
    </span>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

function SystemMapTab({ threadId }: ExperimentalThreadTabProps) {
  const pluginId = experimental_usePluginId();
  const { rpc, map, isMapper, error, setError, refetch } = useMap(threadId);
  const [busy, setBusy] = useState<"start" | "stop" | "refresh" | null>(null);
  const [view, setView] = useState<GraphView | null>(null);
  const probe = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const hasMap = map !== undefined && map !== null;

  useEffect(() => {
    if (!hasMap || canvas.current === null) return;
    const created = createGraphView(d3, canvas.current, { mode: "compact", host: "bb" });
    setView(created);
    return () => {
      created.destroy();
      setView(null);
    };
  }, [hasMap]);
  useHostTheme(probe, view);
  useEffect(() => {
    if (view === null || !map) return;
    view.setEmptyText(
      map.state === "error"
        ? `The mapper failed: ${map.error ?? "unknown error"}`
        : "The mapper agent is exploring the workspace. The first map appears here in a minute or two.",
    );
    view.update(map);
  }, [view, map]);

  const run = async (action: "start" | "stop" | "refresh") => {
    setBusy(action);
    try {
      if (action === "start") await rpc.call("map_start", { threadId });
      else if (action === "stop") await rpc.call("map_stop", { threadId });
      else await rpc.call("map_refresh", { threadId });
      refetch();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const viewUrl = `${window.location.origin}/api/v1/plugins/${pluginId}/http/view?thread=${encodeURIComponent(threadId)}`;
  const live = hasMap && map.state !== "stopped";
  const latest = hasMap ? map.graph.log[map.graph.log.length - 1] : undefined;

  return (
    <div ref={probe} className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <span data-probe="muted" className="hidden text-muted-foreground" />
      {isMapper ? (
        <Centered>This is a System Map worker thread. Open the map from its main thread.</Centered>
      ) : map === undefined ? (
        <Centered>{error ?? "Loading the map…"}</Centered>
      ) : map === null ? (
        <Centered>
          <Icon name="Workflow" className="mx-auto size-6 text-muted-foreground" />
          <p className="max-w-xs">
            Start a background agent that maps the system this thread works on: lanes, flows, and plan progress. The
            map updates while the thread works.
          </p>
          <Button size="sm" disabled={busy !== null} onClick={() => void run("start")}>
            {busy === "start" ? "Starting…" : "Start system map"}
          </Button>
          {error ? <p className="text-destructive">{error}</p> : null}
        </Centered>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <StatusChip map={map} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={latest?.summary}>
              {map.graph.title ?? "System map"}
              {latest ? ` · ${latest.summary}` : ""}
            </span>
            {live ? (
              <>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("refresh")}>
                  {busy === "refresh" ? "Asking…" : "Refresh"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("stop")}>
                  {busy === "stop" ? "Stopping…" : "Stop"}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("start")}>
                {busy === "start" ? "Starting…" : "Resume"}
              </Button>
            )}
            <UrlLink
              href={viewUrl}
              className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium hover:bg-state-hover"
            >
              Open in browser
            </UrlLink>
          </div>
          {error ? <p className="border-b border-border px-3 py-1.5 text-xs text-destructive">{error}</p> : null}
          <div ref={canvas} className="min-h-0 flex-1" />
        </>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "system-map",
    title: "System Map",
    icon: "Workflow",
    tooltip: "Live architecture and flow map, kept by a background agent",
    layout: "flush",
    component: SystemMapTab,
  });
});
