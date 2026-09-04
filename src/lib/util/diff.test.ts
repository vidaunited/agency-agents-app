/**
 * `diffLines` / `diffStat` — the dependency-free LCS line diff behind the
 * "review before Update" modal. Deterministic and pure, so the edge cases
 * (empty inputs, tie-breaks, the size guard) pin down exactly.
 */
import { describe, expect, it } from "vitest";

import { diffLines, diffStat, type DiffRow } from "$lib/util/diff";

const tags = (rows: DiffRow[]) => rows.map((r) => r.tag).join("");

describe("diffLines()", () => {
  it("emits only context rows for identical text, with matching line numbers", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(tags(rows)).toBe("   ");
    expect(rows.map((r) => [r.oldNo, r.newNo])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(diffStat(rows)).toEqual({ added: 0, removed: 0 });
  });

  it("treats two empty strings as one unchanged empty line", () => {
    // "".split("\n") is [""] — an empty file is one (empty) line, not zero.
    const rows = diffLines("", "");
    expect(rows).toEqual([{ tag: " ", text: "", oldNo: 1, newNo: 1 }]);
  });

  it("numbers an insertion against the NEW side only", () => {
    const rows = diffLines("a\nb\nc", "a\nx\nb\nc");
    expect(tags(rows)).toBe(" +  ");
    expect(rows[1]).toEqual({ tag: "+", text: "x", oldNo: null, newNo: 2 });
    // The line after the insertion keeps its old number and shifts its new one.
    expect(rows[2]).toEqual({ tag: " ", text: "b", oldNo: 2, newNo: 3 });
    expect(diffStat(rows)).toEqual({ added: 1, removed: 0 });
  });

  it("numbers a removal against the OLD side only", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    expect(tags(rows)).toBe(" - ");
    expect(rows[1]).toEqual({ tag: "-", text: "b", oldNo: 2, newNo: null });
    expect(rows[2]).toEqual({ tag: " ", text: "c", oldNo: 3, newNo: 2 });
  });

  it("renders a changed line as removal-then-addition", () => {
    // Tie-break in the LCS walk prefers consuming the old side first, so a
    // replaced line always reads `-old` then `+new`.
    const rows = diffLines("a\nb\nc", "a\nB\nc");
    expect(tags(rows)).toBe(" -+ ");
    expect(rows.slice(1, 3).map((r) => r.text)).toEqual(["b", "B"]);
    expect(diffStat(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("flushes trailing lines after one side runs out", () => {
    expect(tags(diffLines("a", "a\nb\nc"))).toBe(" ++");
    expect(tags(diffLines("a\nb\nc", "a"))).toBe(" --");
  });

  it("falls back to a wholesale replacement past the size guard", () => {
    const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const rows = diffLines(big, big);
    // 2500 + 2500 > 4000 → no LCS table; every old line removed, every new
    // line added, even though the texts are identical.
    expect(rows).toHaveLength(5000);
    expect(diffStat(rows)).toEqual({ added: 2500, removed: 2500 });
    expect(rows[0]).toEqual({ tag: "-", text: "line 0", oldNo: 1, newNo: null });
    expect(rows[2500]).toEqual({ tag: "+", text: "line 0", oldNo: null, newNo: 1 });
  });
});
