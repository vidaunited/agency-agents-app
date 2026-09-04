/**
 * Corpus store — `filtered()`, the division + search derivation every agent
 * list is built on (`AgentsWorkspace.svelte`'s `base`, the command palette,
 * the division landing). Pure over `corpus.agents`; no IPC is exercised, so
 * the Tauri bridge is mocked to a no-op.
 */
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "$lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { corpus } from "$lib/stores/corpus.svelte";

function agent(slug: string, name: string, category: string, description = "", vibe: string | null = null): Agent {
  return { slug, name, description, category, emoji: null, color: null, vibe, body: "" };
}

// Deliberately NOT in name order, so the sort is observable.
corpus.agents = [
  agent("zeta-dev", "Zeta Developer", "engineering", "Builds APIs"),
  agent("alpha-designer", "Alpha Designer", "design", "Pixels", "Calm and precise"),
  agent("mid-marketer", "Mid Marketer", "marketing", "Growth loops"),
];

const slugs = (category: string | null, query: string) => corpus.filtered(category, query).map((a) => a.slug);

describe("corpus.filtered()", () => {
  it("returns every agent sorted by name when nothing is filtered", () => {
    expect(slugs(null, "")).toEqual(["alpha-designer", "mid-marketer", "zeta-dev"]);
  });

  it("restricts to one division", () => {
    expect(slugs("engineering", "")).toEqual(["zeta-dev"]);
    expect(slugs("no-such-division", "")).toEqual([]);
  });

  it("matches the query case-insensitively against name, description and vibe", () => {
    expect(slugs(null, "  DEVELOPER ")).toEqual(["zeta-dev"]);
    expect(slugs(null, "pixels")).toEqual(["alpha-designer"]);
    expect(slugs(null, "precise")).toEqual(["alpha-designer"]);
  });

  it("does not match on the slug itself", () => {
    // The haystack is name + description + vibe — the filename slug is not
    // user-facing, so typing it finds nothing.
    expect(slugs(null, "zeta-dev")).toEqual([]);
  });

  it("combines division and query", () => {
    expect(slugs("design", "growth")).toEqual([]);
    expect(slugs("marketing", "growth")).toEqual(["mid-marketer"]);
  });

  it("treats a whitespace-only query as no query", () => {
    expect(slugs(null, "   ")).toHaveLength(3);
  });

  it("returns a fresh array and leaves the store's list untouched", () => {
    const out = corpus.filtered(null, "");
    out.pop();
    expect(corpus.agents.map((a) => a.slug)).toEqual(["zeta-dev", "alpha-designer", "mid-marketer"]);
  });
});
