#!/bin/sh
# PostToolUse hook (matcher Write|Edit|MultiEdit) — after Claude edits a
# .ts/.svelte file under src/, run the vitest tests related to that file
# (step A), then a whole-project svelte-check (step B). Mirrors the frontend
# half of .github/workflows/ci.yml (`npm run check` + `npm test`).
#
# Measured on 2026-09-05 in this repo (482 files, Node v22.22.2):
#   svelte-check --threshold error --output machine : 12.4 s  (under the 60 s mark)
#   vitest related <one file> --run                 : 2-3 s
# Both fit the 180 s hook timeout set in .claude/settings.json.
#
# Exit codes: 0 = pass or not applicable; 2 = failure (stderr goes to Claude).
# Set AGENCY_SKIP_FRONTEND_CHECK=1 to bypass entirely.

[ "${AGENCY_SKIP_FRONTEND_CHECK:-0}" = "1" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
ROOT=$(cd "$ROOT" 2>/dev/null && pwd) || exit 0

# The hook payload is JSON on stdin; we only need tool_input.file_path.
# Unparsable payload → empty → exit 0.
FILE=$(node -e '
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(d).tool_input.file_path;
    if (typeof p === "string") process.stdout.write(p);
  } catch {}
});
' 2>/dev/null)
[ -n "$FILE" ] || exit 0

# Normalise to a repo-relative path (absolute inside the repo, or already relative).
case "$FILE" in
  "$ROOT"/*) REL=${FILE#"$ROOT"/} ;;
  /*) exit 0 ;;
  *) REL=$FILE ;;
esac

# Only .ts / .svelte under src/, never .d.ts.
case "$REL" in
  src/*) ;;
  *) exit 0 ;;
esac
case "$REL" in
  *.d.ts) exit 0 ;;
  *.ts|*.svelte) ;;
  *) exit 0 ;;
esac

cd "$ROOT" || exit 0

# GNU coreutils `timeout`. On macOS it ships as `gtimeout` (brew install
# coreutils); with neither present the steps run unbounded and only the
# hook-level 180 s timeout applies.
if command -v timeout >/dev/null 2>&1; then TO=timeout
elif command -v gtimeout >/dev/null 2>&1; then TO=gtimeout
else TO=""
fi

OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

# Step A — the tests whose import graph includes the edited file (60 s budget).
$TO ${TO:+60} npx vitest related "$REL" --run --passWithNoTests >"$OUT" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "frontend-check: vitest related $REL failed (exit $rc)" >&2
  tail -n 30 "$OUT" >&2
  exit 2
fi

# Step B — whole-project svelte-check (120 s budget). Skipped when the project
# root has no svelte.config.js — i.e. it is not this SvelteKit app (the temp
# project in src/lib/util/claude-hooks.test.ts relies on this guard).
[ -f svelte.config.js ] || exit 0
[ -f .svelte-kit/tsconfig.json ] || npx svelte-kit sync >/dev/null 2>&1
$TO ${TO:+120} npx svelte-check --tsconfig ./tsconfig.json --threshold error --output machine >"$OUT" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "frontend-check: svelte-check failed (exit $rc)" >&2
  if grep -q ' ERROR ' "$OUT"; then
    grep ' ERROR ' "$OUT" | head -n 30 >&2
  else
    tail -n 30 "$OUT" >&2
  fi
  exit 2
fi

exit 0
