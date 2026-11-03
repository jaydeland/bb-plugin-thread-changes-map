---
name: system-map
description: Start, check, or stop the System Map, a background agent that keeps a live architecture and flow graph (d3) of the system a bb thread works on. Use when the user asks for a live visual of the system design, architecture, data flow, or "what this thread is building", or asks to open or refresh the map.
---

# System Map

The System Map plugin starts one hidden mapper agent per thread. The mapper
shares the thread's workspace, reads the conversation, `git status`, and the
thread's plan bar (`bb plan-progress show`), and draws the system as a lane
diagram: lanes, nodes, edges, flows with a note per hop, and plan steps linked
to nodes. It never edits files.

The user sees the map in two places:

- The **System Map** tab in the thread's right panel. It updates in real time.
- A browser page. `bb system-map status` prints its URL.

## Commands

Run these from the thread to map. `--thread <id>` targets another thread.

| Command | Effect |
| --- | --- |
| `bb system-map start` | Start the mapper, or wake a stopped one with a full refresh |
| `bb system-map status` | State, version, size, mapper thread id, and browser URL |
| `bb system-map refresh` | Ask the mapper to re-check the workspace and fix the map |
| `bb system-map show` | Print the current map as text |
| `bb system-map stop` | Stop the mapper and keep the map |

Add `--json` to `start`, `stop`, `refresh`, and `status` for machine-readable output.

## How updates arrive

- After each turn of the main thread, the mapper gets an update note with
  the new conversation items and the last assistant message.
- While the main thread works, the mapper gets at most one note per
  interval (setting `liveIntervalSeconds`, default 90 seconds).
- An idle mapper releases its runtime after `sleepAfterMinutes` (default 15).
  The next note resumes it.

Change settings with `bb plugin config system-map set <key> <value>`.
Use `providerId` and `model` to run the mapper on a cheaper model.

## Rules for agents

- Start the map only when the user asks for it. Each mapper is a separate
  agent session and uses tokens.
- Give the user the browser URL from `bb system-map status` as a Markdown
  link. Do not build the URL yourself.
