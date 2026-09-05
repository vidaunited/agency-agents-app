/**
 * Claude Code hooks — `.claude/hooks/memory-bank-load.sh` (SessionStart) and
 * `.claude/hooks/frontend-check.sh` (PostToolUse on Write|Edit|MultiEdit).
 *
 * Pure process tests: each case spawns the POSIX-sh script with a hook payload
 * on stdin and asserts on exit code + stdout/stderr. Lives under src/ because
 * vite.config.js only includes `src/**\/*.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const HOOKS = join(REPO, ".claude", "hooks");
const MEMORY_BANK_LOAD = join(HOOKS, "memory-bank-load.sh");
const FRONTEND_CHECK = join(HOOKS, "frontend-check.sh");

/**
 * Run a hook script the way Claude Code does: `sh <script>` with the payload
 * on stdin and CLAUDE_PROJECT_DIR set. Vitest's own `VITEST*` / `TEST`
 * variables are stripped so a nested `npx vitest` (step A of frontend-check)
 * starts from a clean slate instead of thinking it is a worker.
 */
function runHook(
  script: string,
  opts: { projectDir: string; stdin?: string; env?: Record<string, string>; timeout?: number },
) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("VITEST") && k !== "TEST") env[k] = v;
  }
  Object.assign(env, { CLAUDE_PROJECT_DIR: opts.projectDir }, opts.env ?? {});
  return spawnSync("sh", [script], {
    input: opts.stdin ?? "",
    env,
    cwd: opts.projectDir,
    encoding: "utf8",
    timeout: opts.timeout ?? 15_000,
  });
}

const payload = (filePath: string) => JSON.stringify({ tool_input: { file_path: filePath } });

describe("memory-bank-load.sh (SessionStart)", () => {
  it("prints the three file headers from the real repo and exits 0", () => {
    const r = runHook(MEMORY_BANK_LOAD, { projectDir: REPO });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("### memory-bank/activeContext.md");
    expect(r.stdout).toContain("### memory-bank/NEXT-SESSION.md");
    expect(r.stdout).toMatch(/### memory-bank\/tasks\/\d{4}-\d{2}\/README\.md/);
    expect(r.stdout).not.toContain("(missing)");
  });

  it("reports a missing file on one line, picks the newest task month, and truncates at 20,000 bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "mb-load-"));
    try {
      mkdirSync(join(dir, "memory-bank", "tasks", "2026-05"), { recursive: true });
      mkdirSync(join(dir, "memory-bank", "tasks", "2026-07"), { recursive: true });
      writeFileSync(join(dir, "memory-bank", "activeContext.md"), "x".repeat(25_000));
      // NEXT-SESSION.md deliberately absent.
      writeFileSync(join(dir, "memory-bank", "tasks", "2026-05", "README.md"), "OLD MONTH\n");
      writeFileSync(join(dir, "memory-bank", "tasks", "2026-07", "README.md"), "NEW MONTH\n");

      const r = runHook(MEMORY_BANK_LOAD, { projectDir: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("### memory-bank/activeContext.md");
      expect(r.stdout).toContain("(missing) memory-bank/NEXT-SESSION.md");
      expect(r.stdout).toContain("### memory-bank/tasks/2026-07/README.md");
      expect(r.stdout).toContain("NEW MONTH");
      expect(r.stdout).not.toContain("OLD MONTH");
      expect(r.stdout).toContain("[truncated] memory-bank/activeContext.md: showing first 20000 of 25000 bytes");
      // The body itself was cut, not just labelled.
      expect(r.stdout).not.toContain("x".repeat(20_001));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("frontend-check.sh (PostToolUse)", () => {
  it("exits 0 silently for a file outside src/", () => {
    const r = runHook(FRONTEND_CHECK, {
      projectDir: REPO,
      stdin: payload(join(REPO, "README.md")),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("exits 0 silently for a .d.ts under src/ and for an unparsable payload", () => {
    // The path filter runs before any filesystem access, so the file need not exist.
    const dts = runHook(FRONTEND_CHECK, { projectDir: REPO, stdin: payload("src/lib/ambient.d.ts") });
    expect(dts.status).toBe(0);
    expect(dts.stdout + dts.stderr).toBe("");

    const junk = runHook(FRONTEND_CHECK, { projectDir: REPO, stdin: "not json" });
    expect(junk.status).toBe(0);
    expect(junk.stdout + junk.stderr).toBe("");
  });

  it("exits 0 under AGENCY_SKIP_FRONTEND_CHECK=1 even for a src/ file", () => {
    const r = runHook(FRONTEND_CHECK, {
      projectDir: REPO,
      stdin: payload(join(REPO, "src", "lib", "util", "diff.ts")),
      env: { AGENCY_SKIP_FRONTEND_CHECK: "1" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });

  describe("in a temp project with vitest but no svelte.config.js", () => {
    // Step B is guarded on svelte.config.js, so this project exercises step A
    // alone. node_modules is a symlink to the repo's so `npx vitest` resolves
    // without a network install.
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "frontend-check-"));
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "hook-fixture", private: true, type: "module", devDependencies: { vitest: "^2.1.9" } }),
      );
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
      mkdirSync(join(dir, "src", "lib"), { recursive: true });
      writeFileSync(join(dir, "src", "lib", "good.ts"), "export const good = () => 1;\n");
      writeFileSync(
        join(dir, "src", "lib", "good.test.ts"),
        'import { expect, it } from "vitest";\nimport { good } from "./good";\nit("good", () => expect(good()).toBe(1));\n',
      );
      writeFileSync(join(dir, "src", "lib", "bad.ts"), "export const bad = () => 2;\n");
      writeFileSync(
        join(dir, "src", "lib", "bad.test.ts"),
        'import { expect, it } from "vitest";\nimport { bad } from "./bad";\nit("bad is one", () => expect(bad()).toBe(1));\n',
      );
      expect(existsSync(join(dir, "node_modules", ".bin", "vitest"))).toBe(true);
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("exits 2 with the vitest failure on stderr when a related test fails", () => {
      const r = runHook(FRONTEND_CHECK, {
        projectDir: dir,
        stdin: payload(join(dir, "src", "lib", "bad.ts")),
        timeout: 90_000,
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("frontend-check: vitest related src/lib/bad.ts failed");
      expect(r.stderr).toMatch(/bad is one|FAIL|failed/);
    }, 120_000);

    it("exits 0 when the related test passes and skips svelte-check (no svelte.config.js)", () => {
      const r = runHook(FRONTEND_CHECK, {
        projectDir: dir,
        stdin: payload("src/lib/good.ts"),
        timeout: 90_000,
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe("");
    }, 120_000);
  });
});
