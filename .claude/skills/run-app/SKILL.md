---
name: run-app
description: Launch Agency Agents and screenshot a section (Dashboard, Tools, Teams, Projects, Agents, Runbooks, Activity). Use this whenever you need to SEE the app rather than just typecheck it — verifying a UI change, checking a layout in light and dark, confirming a chart renders, or when asked to "run the app", "start it", "screenshot the dashboard", or "show me what it looks like". Read this BEFORE trying to build the Tauri shell on Linux, which cannot work and will waste your time.
---

# Running Agency Agents

## On macOS, ignore this skill

`npm run tauri dev` gives you the real desktop app with the real Rust backend
reading your real catalog and installs. Nothing here beats that. This skill
exists for Linux containers — Claude Code on the web, CI — where that command
cannot work.

## Why the Tauri shell will not build here

Two hard blockers, so don't spend an `apt-get` on it:

- **No `webkit2gtk`.** Tauri's Linux webview needs it; the container doesn't
  have it, and pulling the full Linux Tauri toolchain in is a long detour.
- **The shell is macOS-specific anyway.** `src-tauri/src/lib.rs` applies an
  `NSVisualEffectView` for window vibrancy — a Cocoa API. A Linux build is not
  the app you're trying to look at.

What you actually want to see — every screen, every component, every token — is
the SvelteKit frontend. That runs anywhere.

## The one command

```bash
node .claude/skills/run-app/scripts/screenshot.mjs
```

PNGs land in `.screenshots/` (gitignored). Options:

```bash
--section  dashboard | personas | tools | teams | projects | runbooks | activity
           default dashboard. "personas" is the Agents screen — the sidebar
           label and the internal id disagree.
--theme    light | dark | both       default both
--out DIR  default <repo>/.screenshots
--width N --height N                 default 1500x1250
--fixture PATH                       default fixtures/dashboard.json
--build    force a rebuild even if build/ exists
--keep     leave the staging dir in place and print it, for poking at
```

**Look at the PNG.** A blank or sidebar-only frame means the app didn't finish
booting, not that it rendered nothing.

## What is real and what is not

Real: the production `adapter-static` build — actual Svelte components, actual
scoped CSS, actual design tokens, actual chart geometry. If a layout is broken
here it is broken in the app.

Synthetic: the data. There is no Rust backend, so the script stands in for it
(see below). Say so when you report results — "232 agents" in a screenshot is a
fixture, not somebody's install.

Not covered: hover and focus states (a screenshot is one static frame), window
chrome and vibrancy, and anything that depends on real filesystem scanning.

## How it works, in case you need to change it

1. `npm run build` → `build/`, a static SPA.
2. Copy `build/` to a temp dir and inject a `<script>` at the top of `<head>`
   of `index.html`. It has to be *before* the app bundle, because
   `@tauri-apps/api`'s `invoke()` just calls `window.__TAURI_INTERNALS__.invoke`,
   and that global has to exist by the time the app's first store runs.
3. The injected bridge does three things:
   - answers `invoke(cmd)` from a table of fixture payloads, rejecting unknown
     commands (stores soft-fail, which is what they do on a real backend error);
   - seeds `localStorage`, because two bits of state never touch the backend —
     `agency-agents:default-section` decides the landing screen, and
     `agency-agents:projects:v1` is the registered project list, without which
     project-scoped installs have nowhere to hang;
   - restamps `document.documentElement.dataset.theme` on an interval, since the
     theme lives in a Svelte store rather than storage.
4. Serve the staged dir and drive headless Chromium at it.

### Two things that will bite you

**Serve from a separate process, or await the browser.** The script's static
server runs in the same Node process. Calling Chromium with `execFileSync`
blocks the event loop, so the server can never answer the browser's request for
the page and the whole thing deadlocks with an empty `.screenshots/`. The script
uses `await promisify(execFile)` for exactly this reason — don't "simplify" it
back.

**Keep `--virtual-time-budget`.** The SPA hydrates and *then* awaits several
store loads. Without it you capture the empty shell.

## The fixture

`fixtures/dashboard.json` is a compact spec the script expands into full backend
payloads — division counts become agents, `globalInstalls`/`projectInstalls`
become install rows. Edit the numbers to reshape what the charts have to cope
with. Useful knobs:

- **`divisions`** — add or remove entries to test the chart palette's eight-slot
  cap and the "Other" fold. Drop to six and the fold disappears.
- **`stateOverrides`** — all rows are `current` by default, which renders the
  Install-health donut as a single legend row. Set `outdated`/`modified`/
  `removed`/`foreign` to light up the others.
- **`tools[].detected`** — drives the green/grey dot in Coverage by tool.
- **`catalog.behind`** — the "N behind" pill next to Update from GitHub.

It lives under `.claude/` and not `src/`, so it can never be imported by the
app. It is a test fixture, not production data.

## Adding a command

If a screen renders empty, it is probably calling an `invoke` the fixture table
doesn't answer — the bridge rejects unknown commands and the store soft-fails to
its empty state. Find the call (`grep -rn 'invoke<' src/lib/stores/`), work out
the payload shape from `src/lib/types.ts`, and add a key to the `IPC` object in
`scripts/screenshot.mjs`. The Dashboard needs `corpus_list`,
`corpus_categories`, `installs_reconcile`, `tools_list`, `catalog_source_get`,
`catalog_configured`, `catalog_status` and `settings_get`; other sections need
more.
