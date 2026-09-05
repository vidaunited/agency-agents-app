#!/bin/sh
# SessionStart hook — automates the AGENTS.md §2 "Session Startup" Memory Bank
# load (Fast Track set) without editing AGENTS.md. Everything printed to stdout
# by a SessionStart hook is added to Claude's context.
#
# Prints, each preceded by a "### <path>" line and capped at 20,000 bytes
# (with a "[truncated]" marker when cut):
#   memory-bank/activeContext.md
#   memory-bank/NEXT-SESSION.md
#   memory-bank/tasks/<newest YYYY-MM>/README.md
#
# Always exits 0. A missing file is reported on one "(missing) <path>" line.

ROOT="${CLAUDE_PROJECT_DIR:-.}"
CAP=20000

emit() {
  rel=$1
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then
    echo "(missing) $rel"
    return 0
  fi
  echo "### $rel"
  head -c "$CAP" "$f"
  size=$(wc -c < "$f" | tr -d ' ')
  if [ "$size" -gt "$CAP" ]; then
    printf '\n[truncated] %s: showing first %s of %s bytes\n' "$rel" "$CAP" "$size"
  fi
  echo
}

echo "## Memory Bank (auto-loaded by .claude/hooks/memory-bank-load.sh — AGENTS.md §2 Session Startup, Fast Track)"
emit "memory-bank/activeContext.md"
emit "memory-bank/NEXT-SESSION.md"

# Newest task month: directory names are YYYY-MM, so the shell's sorted glob
# expansion puts the newest last.
latest=""
for d in "$ROOT"/memory-bank/tasks/*/; do
  [ -d "$d" ] && latest=$d
done
if [ -n "$latest" ]; then
  emit "memory-bank/tasks/$(basename "$latest")/README.md"
else
  echo "(missing) memory-bank/tasks/YYYY-MM/README.md (no task directories found)"
fi

exit 0
