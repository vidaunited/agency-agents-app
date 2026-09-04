import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // Agency Agents uses 1430 (NOT 1420) so it never collides with the
    // brew-browser dev server it was forked from — both default to 1420, and a
    // shared port makes one app's webview load the other's frontend.
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Vitest (`npm test`) — the pure-logic layer only: stores + utils, no
  // component rendering, no DOM environment, no network. Lives here (not a
  // separate vitest.config) so the sveltekit plugin above supplies the `$lib`
  // alias and compiles the `.svelte.ts` rune modules the tests import.
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
