See the system a thread builds while it builds it. System Map starts a
background agent for a thread. The agent maps the architecture and the
request and data flows, and it updates the map while the thread works.

## What you get

- A **System Map** tab in every thread's right panel: a lane diagram of
  the system (people, UIs, services, external systems, shared services), with
  plan progress per phase, node fill from plan steps, and flows you follow hop
  by hop.
- A browser page with the same live map, for a second screen or for sharing.
- A `bb system-map` command to start, check, refresh, show, or stop a map.

## How it works

The mapper is a hidden bb thread that shares the thread's workspace. It
reads the conversation and `git status`, never edits files, and writes the
map only through its `system_map_apply` tool. After each turn of the main
thread, and at most every 90 seconds while it works, the mapper gets an
update note and patches the map. The panel redraws in place and pulses the
parts that changed. An idle mapper releases its runtime after 15 minutes.
