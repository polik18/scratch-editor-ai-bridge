# Scratch AI Bridge implementation status

## 基線與回復狀態

本工程以完整 `scratch-editor` monorepo 為基底。`scratch-gui`、`scratch-vm`、`scratch-paint`、`scratch-render`、`scratch-storage` 與其他既有 workspace 均保留；直接使用版只放在根目錄 `ready-to-use/`，不再取代工程本體。

## Phase 0 — Project bootstrap

Status: implemented.

### Phase 0A — Compatibility fixture baseline

Status: implemented.

- explicit matrix of 30 official SB2/SB3/sprite fixtures with parse-only, lossless, and VM-normalized expectations
- deterministic project-JSON signature/comparator that keeps fields outside the current Canonical IR visible
- CI test verifies fixture presence, classification completeness, and official VM save/reload for the VM-normalized baseline
- archives with a prefixed `project.json` (for example `origin.sb3`) are intentionally classified as archive-boundary cases until Raw Archive IR exists

### Completeness roadmap Phase 1A — Raw Archive IR slice

Status: implemented (initial slice).

- `importLosslessSb3()` reads `project.json` without invoking Scratch VM and keeps every ZIP entry, unknown project fields, asset bytes, dates, compression label, and SHA-256 digest
- `exportLosslessSb3()` reconstructs an archive from the raw entries without VM normalization
- path traversal, malformed JSON, entry-count, compressed-size, uncompressed-size, and project-size limits are covered by the archive boundary
- nested `project.json` archives are retained with an explicit warning; they are not silently treated as standard root-level SB3 files

### Completeness roadmap Phase 1B — ZIP central-directory hardening

Status: implemented.

- parses central-directory entries before decompression and retains original order, filename encoding flag, compression method, CRC-32, compressed/uncompressed sizes, flags, attributes, and local-header offset
- rejects duplicate filenames, path traversal, absolute/drive paths, encrypted archives, ZIP64, multi-disk archives, unsupported compression, symbolic-link entries, malformed local headers, and declared size overruns
- lossless export preserves entry ordering, uncompressed bytes, timestamps, and STORE/DEFLATE selection; compressed bytes are not claimed to be byte-for-byte identical
- adversarial tests cover malformed data, path traversal, duplicate filenames, encryption flags, and ZIP64 declarations

## Phase 1 — Canonical IR

Status: implemented.

- versioned Canonical IR types/schema
- strict validator
- five fixtures
- Phase 1 opcode vocabulary

## Phase 2 — Scratch VM Adapter

Status: implemented.

Public adapter boundary:

```ts
createVM()
loadSb3(file)
loadProjectJson(project)
saveSb3(vm)
getProjectJson(vm)
getTargets(vm)
getBlocks(target)
```

`loadProjectJson()` 與 `getProjectJson()` 是本輪新增，讓 compiler/decompiler 可以走 Scratch VM 官方 load/serialize path，而不必直接碰 runtime graph。

VM 現在會掛上官方 `scratch-storage`，並以離線 archive-only 模式啟動，避免 GitHub Pages 專案子路徑觸發 upstream worker 絕對路徑 404。

正式瀏覽器 build 會從官方 `scratch-parser 6.0.1` SB3 schemas 產生靜態 validator，供 VM 載入路徑使用；因此 CSP 不需要 `unsafe-eval`。Vitest 的官方相容性測試仍直接使用未替換的官方 parser。

## Phase 3 — VM write path

Status: implemented.

Decision documented in `docs/vm-write-path.md`.

正式 compiler path：

```text
Canonical IR
→ Scratch 3 project JSON + MD5 assets
→ temporary SB3 archive
→ Scratch VM loadProject(archive)
→ Scratch VM saveProjectSb3()
```

## Phase 4 — IR → Scratch Compiler

Status: implemented for Canonical IR v1 block set.

Files:

- `src/core/compiler/project-json.ts`
- `src/core/compiler/compiler.ts`

Includes deterministic symbol/block IDs, variables/lists/broadcast fields, nested substacks, valid fallback
costumes/sounds, content-addressed asset files and official VM serialization.

## Phase 5 — SB3 → Canonical IR

Status: implemented for the v1 structural model; unknown Scratch opcodes are preserved for analysis but are not yet part of the strict v1 validator vocabulary.

Files:

- `src/core/decompiler/project-json.ts`
- `src/core/decompiler/decompiler.ts`

The decompiler loads `.sb3` through Scratch VM, obtains official serialized project JSON via `toJSON()`, then removes Scratch graph IDs from the Canonical representation.

## Phase 6 — Round Trip

Status: basic structural round-trip and official parser compatibility implemented.

Verified smoke fixtures:

- `02-green-flag-move-say.json`
- `03-repeat-score.json`
- `04-broadcast-flow.json`

All three passed IR → Scratch project JSON → IR structural signature comparison. All five built-in examples also pass
generated SB3 validation through official `scratch-parser`.

## Phase 7 — Analysis IR

Status: implemented for current Canonical IR.

Includes:

- project/target/script summaries
- block/variable/list/broadcast counts
- broadcast sender/receiver dependency map
- detached-script diagnostic
- broadcast without receiver / receiver without sender
- forever without obvious yield
- variable initialization inside forever

## Phase 8 — Analyze UI

Status: source implemented.

Flow:

```text
upload .sb3
→ Scratch VM
→ Canonical IR
→ Analysis IR
→ diagnostics
→ AI prompt
→ export JSON
```

## Phase 9 — Generate UI

Status: source implemented.

Flow:

```text
AI JSON
→ validate
→ Scratch project JSON
→ Scratch VM
→ saveProjectSb3()
→ download .sb3
```

## Phase 10–15

Status: not yet claimed complete in the formal monorepo source.

The additive `ready-to-use/` build contains experimental support for procedures/assets/mapping/large-project guards from the prior standalone work, but those capabilities must still be integrated into the formal TypeScript modules and dependency-backed test suite before Phase 10–15 can be marked complete.

## Current verification

Verified with the exact Node version from `.nvmrc`:

- clean `npm ci`
- required official Scratch workspace builds
- ESLint + Prettier: pass
- Vitest: 11 files / 28 tests pass
- TypeScript + production Vite build: pass
- strict-CSP headless Chromium at a nested project path: generate, download, re-upload and analyze pass
- browser smoke test: no console/page errors and no failed HTTP requests; the same test is a Pages CI gate
- production source-map dependency reachability review: see `docs/security-audit.md`

## Public deployment

- repository: [polik18/scratch-editor-ai-bridge](https://github.com/polik18/scratch-editor-ai-bridge)
- GitHub Pages: [Scratch AI Bridge public beta](https://polik18.github.io/scratch-editor-ai-bridge/)
- deployment source: GitHub Actions on `main`
- external browser verification: HTTP 200, Scratch VM initialized, no console, page, or request failures

The current release level is GitHub Pages public beta, not full lossless Scratch compatibility. See
`docs/deployment.md` for remaining risks and `docs/completeness-roadmap.md` for the L1/L2/L3 completion plan.
