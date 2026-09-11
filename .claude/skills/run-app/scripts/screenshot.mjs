#!/usr/bin/env node
/**
 * screenshot.mjs — run the Agency Agents frontend in a headless browser and
 * screenshot a section.
 *
 * The Tauri shell only builds on macOS (see the skill's SKILL.md), so on Linux
 * the way to actually look at the app is to serve the production SvelteKit
 * build and stand in for the Rust backend with a fixture IPC bridge. Everything
 * rendered is the real build — real components, real scoped CSS, real tokens.
 * Only the data is synthetic.
 *
 * Usage:
 *   node .claude/skills/run-app/scripts/screenshot.mjs
 *   node .claude/skills/run-app/scripts/screenshot.mjs --section tools --theme dark
 *   node .claude/skills/run-app/scripts/screenshot.mjs --theme both --out /tmp/shots
 *
 * Options:
 *   --section  dashboard | personas | tools | teams | projects | runbooks | activity
 *              (default dashboard; "personas" is the Agents screen)
 *   --theme    light | dark | both            (default both)
 *   --out DIR  where PNGs land                (default <repo>/.screenshots)
 *   --width N  --height N                     (default 1500x1250)
 *   --fixture PATH                            (default the skill's fixtures/dashboard.json)
 *   --build    force `npm run build` even if build/ is present
 *   --keep     leave the staging dir in place and print it, for poking at
 */

import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Chromium must be awaited, not run with execFileSync: the static server below
// lives in THIS process, and a sync child blocks the event loop, so the server
// could never answer Chromium's request for the page. That deadlocks.
const run = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, "..");
const ROOT = path.resolve(SKILL, "..", "..", "..");

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const section = flag("section", "dashboard");
const themeArg = flag("theme", "both");
const themes = themeArg === "both" ? ["light", "dark"] : [themeArg];
const outDir = path.resolve(flag("out", path.join(ROOT, ".screenshots")));
const width = Number(flag("width", 1500));
const height = Number(flag("height", 1250));
const fixturePath = path.resolve(flag("fixture", path.join(SKILL, "fixtures", "dashboard.json")));

// ── 1. production build ───────────────────────────────────────────────────
const buildDir = path.join(ROOT, "build");
if (has("build") || !fs.existsSync(path.join(buildDir, "index.html"))) {
  console.log("· npm run build");
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
}

// ── 2. expand the fixture into backend payloads ───────────────────────────
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const agents = [];
const byDivision = {};
for (const d of fx.divisions) {
  byDivision[d.slug] = [];
  for (let i = 1; i <= d.count; i++) {
    const slug = `${d.slug}-${String(i).padStart(2, "0")}`;
    agents.push({
      slug, name: `${d.label} Agent ${i}`, description: `A ${d.label.toLowerCase()} specialist.`,
      category: d.slug, emoji: null, color: null, vibe: null, body: "",
    });
    byDivision[d.slug].push(slug);
  }
}
const categories = fx.divisions.map((d) => ({
  slug: d.slug, label: d.label, icon: "Folder", color: d.color, count: d.count,
}));

const toolDest = Object.fromEntries(fx.tools.map((t) => [t.id, t.dest]));
const mkRow = (slug, tool, scope, projectPath) => ({
  slug, name: slug, tool, scope, projectPath,
  dest: `${toolDest[tool] ?? "~"}/${slug}.md`,
  state: "current", updateKind: null, tracked: true,
});

const installed = [];
for (const g of fx.globalInstalls) {
  const slugs = g.agents === "all" ? agents.map((a) => a.slug) : agents.slice(0, g.agents).map((a) => a.slug);
  for (const s of slugs) installed.push(mkRow(s, g.tool, "user", null));
}
for (const p of fx.projectInstalls) {
  for (const s of byDivision[p.division] ?? []) installed.push(mkRow(s, p.tool, "project", p.path));
}
for (let i = 0; i < (fx.untrackedCount ?? 0) && i < installed.length; i++) installed[i].tracked = false;

// Claim rows for the non-current states, back to front so the untracked run above survives.
let cursor = installed.length - 1;
for (const [state, n] of Object.entries(fx.stateOverrides ?? {})) {
  for (let i = 0; i < n && cursor >= 0; i++, cursor--) installed[cursor].state = state;
}

const toolsList = fx.tools.map((t) => ({
  tool: t.id, label: t.label, detected: t.detected, scope: "user",
  userDest: t.dest, customPath: null,
  installedCount: installed.filter((r) => r.tool === t.id).length,
}));

const source = { kind: "managed", path: fx.catalog.root };
const IPC = {
  app_version: "0.0.0-harness",
  settings_get: {
    paranoidMode: false, catalogStaleBannerDays: 14, caskIconMode: "all", trendingTtlMinutes: 60,
    githubEnabled: false, aiFeaturesEnabled: true, updateAutoCheck: false, enhancedTrendingEnabled: false,
    vulnerabilityScanningEnabled: false, liveEnrichmentEnabled: false, toolPaths: {},
  },
  corpus_list: agents,
  corpus_categories: categories,
  installs_reconcile: installed,
  tools_list: toolsList,
  tool_versions: [],
  runbooks_list: [],
  activity_list: [],
  catalog_configured: true,
  catalog_source_get: source,
  catalog_status: {
    source, root: fx.catalog.root, isGit: true, branch: "main", commit: "0000000",
    lastCommitSubject: "harness", lastCommitDate: "2026-01-01T00:00:00Z", dirtyCount: 0,
    remoteUrl: `https://github.com/${fx.catalog.repoSlug}.git`, repoSlug: fx.catalog.repoSlug,
    version: "0.0.0", fetchedAt: "2026-01-01T00:00:00Z",
  },
  catalog_check_updates: {
    isGit: true, behind: fx.catalog.behind ?? 0, ahead: 0, changedFiles: 0, diffstat: "",
    upToDate: (fx.catalog.behind ?? 0) === 0,
  },
};

// ── 3. stage the build and inject the bridge ──────────────────────────────
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "agency-harness-"));
fs.cpSync(buildDir, stage, { recursive: true });

const projectPaths = [...new Set(fx.projectInstalls.map((p) => p.path))];
const bridge = `<script>
/* Fixture Tauri bridge — injected by .claude/skills/run-app. Must run before the
   app bundle: @tauri-apps/api's invoke() reads window.__TAURI_INTERNALS__. */
(function () {
  var DATA = ${JSON.stringify(IPC)};
  var q = new URLSearchParams(location.search);
  var theme = q.get("theme") || "light";
  try {
    localStorage.setItem("agency-agents:default-section", q.get("section") || "dashboard");
    localStorage.setItem("agency-agents:projects:v1", ${JSON.stringify(JSON.stringify(projectPaths))});
  } catch (e) {}
  window.__TAURI_INTERNALS__ = {
    invoke: function (cmd) {
      return Object.prototype.hasOwnProperty.call(DATA, cmd)
        ? Promise.resolve(DATA[cmd])
        : Promise.reject({ code: "internal", message: "no fixture for " + cmd });
    },
    transformCallback: function (cb) { var id = Math.random(); window["_cb" + id] = cb; return id; },
    unregisterCallback: function () {},
    convertFileSrc: function (p) { return p; },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
  /* The theme lives in a store, not storage — restamp rather than reach into it. */
  setInterval(function () { document.documentElement.dataset.theme = theme; }, 50);
})();
</script>`;

const indexPath = path.join(stage, "index.html");
const html = fs.readFileSync(indexPath, "utf8");
if (!html.includes("<head>")) throw new Error("built index.html has no <head> to inject into");
fs.writeFileSync(indexPath, html.replace("<head>", "<head>\n" + bridge, 1));

// ── 4. serve (SPA fallback: adapter-static routes everything to index.html) ─
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  let file = path.join(stage, rel);
  if (!file.startsWith(stage) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = indexPath;
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// ── 5. drive chromium ─────────────────────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const globs = ["/opt/pw-browsers", path.join(os.homedir(), ".cache/ms-playwright")];
  for (const base of globs) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      for (const bin of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = path.join(base, d, bin);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("no Chromium found — set CHROME_PATH");
}
const chrome = findChrome();
fs.mkdirSync(outDir, { recursive: true });

for (const theme of themes) {
  const out = path.join(outDir, `${section}-${theme}.png`);
  await run(chrome, [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${width},${height}`,
    // The SPA hydrates and then awaits several store loads; without a virtual-time
    // budget the capture lands on an empty shell.
    "--virtual-time-budget=9000",
    `--screenshot=${out}`,
    `http://127.0.0.1:${port}/?theme=${theme}&section=${section}`,
  ]);
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`· ${out}  (${kb} KB)`);
}

server.close();
if (has("keep")) console.log(`· staging kept at ${stage}`);
else fs.rmSync(stage, { recursive: true, force: true });
