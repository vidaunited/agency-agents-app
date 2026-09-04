/**
 * Install store — `reconcile()` coalescing.
 *
 * Pure-logic test (no component rendering): the Tauri IPC bridge is mocked so
 * nothing leaves the process, and the store's `$state` fields are read
 * directly. What's under test is the module-level in-flight guard in
 * `install.svelte.ts` — many views call `reconcile()` on mount, and they must
 * share ONE `installs_reconcile` scan rather than each starting their own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledAgent } from "$lib/types";

// Hoisted so the `vi.mock` factory (itself hoisted above the imports) can
// reference the same spy the assertions use.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { install } from "$lib/stores/install.svelte";

function row(slug: string): InstalledAgent {
  return {
    slug,
    name: slug,
    tool: "claudeCode",
    scope: "user",
    projectPath: null,
    dest: `/home/u/.claude/agents/${slug}.md`,
    state: "current",
    updateKind: null,
    tracked: true,
  };
}

/** A promise settled by hand, so a backend call can be held open mid-test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("install.reconcile()", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.unstubAllGlobals();
  });

  it("coalesces concurrent callers into one backend call", async () => {
    const scan = deferred<InstalledAgent[]>();
    invoke.mockReturnValueOnce(scan.promise);

    const callers = [install.reconcile(), install.reconcile(), install.reconcile()];

    expect(install.reconciling).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("installs_reconcile", { projectRoots: [] });

    scan.resolve([row("a"), row("b")]);
    await Promise.all(callers);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(install.installed.map((r) => r.slug)).toEqual(["a", "b"]);
    expect(install.reconciled).toBe(true);
    expect(install.reconciling).toBe(false);
  });

  it("starts a fresh backend call once the previous one has settled", async () => {
    invoke.mockResolvedValueOnce([row("a")]);
    await install.reconcile();
    invoke.mockResolvedValueOnce([row("a"), row("c")]);
    await install.reconcile();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(install.installed.map((r) => r.slug)).toEqual(["a", "c"]);
  });

  it("keeps the previous result when the backend fails", async () => {
    invoke.mockResolvedValueOnce([row("keep")]);
    await install.reconcile();
    invoke.mockRejectedValueOnce(new Error("ledger unreadable"));

    await expect(install.reconcile()).resolves.toBeUndefined();

    expect(install.installed.map((r) => r.slug)).toEqual(["keep"]);
    expect(install.reconciling).toBe(false);
    // The failed flight released the guard: the next call goes to the backend.
    invoke.mockResolvedValueOnce([]);
    await install.reconcile();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("feeds the registered project roots (strings only) to the sweep", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "agency-agents:projects:v1" ? JSON.stringify(["/p/one", 42, null, "/p/two"]) : null,
    });
    invoke.mockResolvedValueOnce([]);

    await install.reconcile();

    expect(invoke).toHaveBeenCalledWith("installs_reconcile", { projectRoots: ["/p/one", "/p/two"] });
  });

  it("survives a corrupt project-roots entry", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "{not json" });
    invoke.mockResolvedValueOnce([]);

    await install.reconcile();

    expect(invoke).toHaveBeenCalledWith("installs_reconcile", { projectRoots: [] });
  });
});
