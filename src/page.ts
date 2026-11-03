// The standalone browser page: the full Thread Changes Map view (header, plan
// progress, flow player, lane diagram), fed by polling the /map route.

const PAGE_SCRIPT = `
import { createGraphView } from "./viewer.js";
const threadId = new URLSearchParams(location.search).get("thread");
const media = matchMedia("(prefers-color-scheme: light)");
const theme = () => document.documentElement.dataset.theme || (media.matches ? "light" : "dark");
const view = createGraphView(window.d3, document.getElementById("app"), { mode: "full", header: true, theme: theme() });
media.addEventListener("change", () => view.setTheme(theme()));
let current = null;

async function poll() {
  try {
    const response = await fetch("map?thread=" + encodeURIComponent(threadId), { headers: { accept: "application/json" } });
    if (response.ok) {
      const { map } = await response.json();
      const key = map ? map.state + ":" + map.graph.version : "none";
      if (key !== current) {
        current = key;
        if (map === null) view.setEmptyText("No map for this thread yet. Start it from the Thread Changes Map tab in bb, or run: bb thread-changes-map start");
        else if (map.state === "error") view.setEmptyText("The mapper failed: " + (map.error || "unknown error"));
        else view.setEmptyText("The mapper agent is exploring the workspace. The first map appears here in a minute or two.");
        if (map !== null) {
          view.update(map);
          document.title = (map.graph.title || "Thread changes map") + " · Thread Changes Map";
        }
      }
    }
  } catch {}
  setTimeout(poll, 2000);
}
poll();
`;

/** The viewer page; it reads the thread id from its own `?thread=` query. */
export function renderViewerPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thread Changes Map</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { background: #171a23; }
  @media (prefers-color-scheme: light) { body { background: #f5f6f9; } }
  #app { height: 100%; }
  #app .smv { padding-bottom: 16px; }
  #app .smv-canvas { margin: 12px 24px 0; }
</style>
<script src="d3.js"></script>
</head>
<body>
<div id="app"></div>
<script type="module">${PAGE_SCRIPT}</script>
</body>
</html>`;
}
