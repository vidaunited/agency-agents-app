---
name: new-tauri-command
description: Step-by-step template for adding a Tauri IPC command to Agency Agents consistent with the existing 47 (Rust fn, registration, TS wrapper/type, tests, capability).
disable-model-invocation: true
---

# Add a Tauri command

Derived from `settings_get`/`settings_set` (`src-tauri/src/commands/settings.rs`), `corpus_get`
(`src-tauri/src/corpus/mod.rs`) and `project_forget` (`src-tauri/src/install/mod.rs`). Follow in order.

## 1. Rust function — `src-tauri/src/<module>.rs`

- Cross-cutting (settings/github/updater): put it in `src-tauri/src/commands/<cluster>.rs`; it is
  re-exported by `pub use <cluster>::*;` in `src-tauri/src/commands/mod.rs`.
  Subsystem commands live in `src-tauri/src/corpus/mod.rs` or `src-tauri/src/install/mod.rs`.
- Signature (see `corpus_get`, `corpus/mod.rs`): `#[tauri::command] pub async fn snake_name(app: AppHandle,
  state: State<'_, AppState>, arg: String) -> Result<Dto, AppError>`. Only take `app`/`state` if used
  (`catalog_detect(scan: bool)` takes neither). Sync is allowed for trivial reads (`app_version`, settings.rs).
- Imports as in settings.rs: `use tauri::State; use crate::error::AppError; use crate::state::AppState;`.
- DTOs go in `src-tauri/src/types.rs` with `#[derive(Debug, Clone, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]` (e.g. `ToolVersion`). Rust `snake_case` args arrive from the
  frontend as `camelCase` keys (`project_path` ↔ `projectPath`, `install.svelte.ts`).
- Errors: return `AppError::InvalidArgument { message }` for bad input (`corpus_get`), map I/O via
  `?` (`From<std::io::Error>` in `error.rs`). A new variant means editing `AppError` in `error.rs`
  **and** `AppErrorPayload` + `appErrorMessage()` in `src/lib/types.ts`.
- Anything outbound calls `state.require_network("<snake_name>").await?` first (`corpus_refresh`).
- Keep the logic in a pure helper the command wraps (`prune_project_rows`, `install/mod.rs`) so it is testable without an `AppHandle`.

## 2. Register — `src-tauri/src/lib.rs`

Add to `tauri::generate_handler![ … ]`: bare name for `commands::*` (`settings_get,`), fully-qualified
for subsystems (`corpus::corpus_get,`, `install::project_forget,`). Missing entry = runtime
"command not found" from `invoke`.

## 3. Frontend — `src/lib/types.ts` + caller

- Type: `export interface Dto { … }` in `src/lib/types.ts` (camelCase fields, e.g. `ToolVersion`).
- Cross-cutting commands get a typed wrapper in `src/lib/api.ts`:
  `export function snakeName(arg: string): Promise<Dto> { return invoke<Dto>("snake_name", { arg }); }`
  with a doc comment naming the error codes it can throw (see `githubRepoStats`).
- Corpus/catalog/install commands are invoked directly from their store
  (`src/lib/stores/corpus.svelte.ts` `invoke<Agent>("corpus_get", { slug })`) inside try/catch so a
  backend failure degrades to an empty state instead of throwing into the component tree.

## 4. Tests

- Rust: `#[cfg(test)] mod tests` at the bottom of the same module; `#[test]` for pure helpers
  (`prune_project_rows_drops_only_that_project`, `install/mod.rs`), `#[tokio::test]` with
  `tempfile::tempdir()` for async/filesystem paths (`corpus/mod.rs` tests, `settings.rs`
  `missing_file_is_first_launch`). Commands themselves are not called in tests (they need `State`).
- Frontend: only stores are tested, with the IPC mocked —
  `vi.mock("@tauri-apps/api/core", () => ({ invoke }))` (`src/lib/stores/install.test.ts`).
  There are no tests for `src/lib/api.ts` wrappers; add a store test if the store logic changed.

## 5. Capability

None for app commands: `src-tauri/capabilities/default.json` lists plugin permissions only
(`dialog:allow-open`, `updater:default`, …) and no existing command has an entry. Add a permission
there only if the frontend starts calling a new `@tauri-apps/plugin-*` API.

## 6. Verify (mirrors `.github/workflows/ci.yml`)

`cd src-tauri && cargo fmt --all && cargo clippy --all-targets -- -D warnings && cargo test`, then
`npm run check && npm test`.

## Minimal example — `catalog_configured` (already in the tree)

```rust
// src-tauri/src/corpus/mod.rs
#[tauri::command]
pub async fn catalog_configured(app: AppHandle) -> Result<bool, AppError> {
    let adir = app_data_dir(&app)?;
    Ok(catalog_source_path(&adir).exists())
}
// src-tauri/src/lib.rs, inside generate_handler![ … ]:   corpus::catalog_configured,
```
```ts
// src/lib/stores/catalog.svelte.ts
const configured = await invoke<boolean>("catalog_configured");
```
