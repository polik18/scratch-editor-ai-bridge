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
- 26-opcode strict authoring vocabulary

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

Status: implemented for the current 26-opcode Canonical IR v1 authoring set.

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

All three passed IR → Scratch project JSON → IR structural signature comparison. All six built-in examples also pass
generated SB3 validation through official `scratch-parser` and the Scratch VM save path.

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

### Phase 9A — AI draft repair and semantic validation

Status: implemented (first hardening slice).

- the copyable AI instruction now states the complete target, script, input, and broadcast shapes instead of only listing opcodes
- common model shorthand is repaired non-destructively: missing target defaults, script arrays, scalar inputs, stack arrays,
  variable/list/broadcast shorthand, reporter blocks, and string broadcast declarations
- every automatic change has a path-specific repair record; ambiguous game logic is never silently rewritten
- semantic validation now checks symbol references, required inputs, stack types, event-hat placement, broadcast input types,
  and warns about numeric/list values used as Boolean conditions
- the user's Gemini platformer response is checked in as a regression fixture and runs through repair, validation, VM compile,
  download, re-upload, and analysis in the browser smoke test

This slice makes the reported Gemini response structurally usable. Its original game logic still remains only a simplified demo:
automatic repair does not invent missing platform physics or reinterpret ambiguous conditions.

### Phase 9B — Platform-game authoring core

Status: implemented (26-opcode capability slice).

- a typed capability registry now describes category, block shape, stage/sprite availability, required inputs/fields, and menu shadows
- AI authoring instructions are generated from the registry, preventing the prompt and validator vocabulary from drifting apart
- keyboard hats, XY movement, collision sensing, `<`, `=`, `>`, `and`, `or`, `not`, and costume switching are supported
- compiler and decompiler generate and restore official `sensing_touchingobjectmenu` and `looks_costume` shadow blocks
- semantic validation derives required inputs/fields and Boolean reporter rules from the registry; the compiler rejects semantic errors
- the built-in platformer example includes visible SVG assets, left/right controls, jump velocity, gravity, and platform collision
- browser smoke covers both the original Gemini shorthand repair and platformer validation/compile/download/re-import

This is not the full Scratch core opcode set. Rotation, glide, mouse input, color collision, clones, sounds, additional looks blocks,
list operations, and procedures remain for later capability slices.

### Phase 9C — Mixed AI response extraction

Status: implemented.

- accepts exact JSON or a complete AI notebook/chat response containing Python, text output, Markdown fences, and several JSON drafts
- scans balanced JSON objects and selects the largest valid Canonical IR candidate rather than blindly using the first draft
- limits copied AI responses to 2,000,000 characters and reports a clear error when no complete Canonical IR exists
- converts `{value: ...}` / `{name: ...}` field wrappers to scalar fields
- supplies `svg` only for name-only or visibly inline-SVG costumes whose missing format is unambiguous
- the prompt now explicitly forbids Python/tool execution and documents scalar fields plus costume `dataFormat`
- browser regression covers both the mixed Notebook response and Gemini's earlier 106-repair shorthand response

### Phase 9D — Copyable AI repair feedback

Status: A + B first release implemented; C + D remain staged. See [`ai-repair-feedback-plan.md`](ai-repair-feedback-plan.md).

- parser, normalizer, AJV schema, semantic validator, and Scratch VM compile failures map into Repair Report v1
- reports use stable status/code/path fields, retain the full untruncated issue set, and omit stack traces and local paths
- the UI groups summary counts and can copy a complete AI correction prompt, copy raw report JSON, or download the report
- denied Clipboard API access opens a selectable textarea fallback instead of failing silently
- one repair-time undo snapshot preserves the exact original AI response
- browser smoke clicks both copy actions, parses the copied report, verifies the 106-repair/3-review Gemini regression, and tests undo

Capability-derived minimal examples and the complete simulated "AI-corrected reply → compile" regression remain Phase C/D work;
the first release does not claim that the repair loop can infer ambiguous game intent.

### Phase 9E — Chinese student workflow

Status: first student-facing slice implemented.

- replaces the developer-first landing page with a four-step Chinese flow: describe, send to AI, paste reply, download
- combines the student's original project idea with the full capability-generated AI contract
- adds supported idea examples and leaves the AI response editor empty instead of showing raw JSON on first load
- provides one `檢查並製作 Scratch` action that extracts, repairs, validates, compiles, and downloads when safe
- stops on ambiguous game rules and offers a plain-language `複製修正訊息給 AI` action without exposing JSON paths by default
- moves Canonical IR, Repair Report, separate validation, and direct compile controls into teacher/advanced disclosure panels
- fixes the CSS bug that displayed inactive tab panels, and adds tab semantics, labels, keyboard focus, 44px controls,
  higher-contrast small text, and a keyboard-accessible file picker
- simplifies Analyze labels and hides raw Analysis/Canonical IR behind technical details

Student usability sessions and per-issue child-friendly explanations remain the next UX validation slice.

## Phase 10–15

Status: not yet claimed complete in the formal monorepo source.

The additive `ready-to-use/` build contains experimental support for procedures/assets/mapping/large-project guards from the prior standalone work, but those capabilities must still be integrated into the formal TypeScript modules and dependency-backed test suite before Phase 10–15 can be marked complete.

## Current verification

Verified with the exact Node version from `.nvmrc`:

- clean `npm ci`
- required official Scratch workspace builds
- ESLint + Prettier: pass
- Vitest: 15 files / 47 tests pass
- TypeScript + production Vite build: pass
- strict-CSP headless Chromium at a nested project path: student request composition, inactive-panel isolation, labeled inputs,
  keyboard file access, Gemini Notebook extraction, shorthand repair, Repair Report copy/undo, one-click student build,
  download, re-upload and analyze pass
- browser smoke test: no console/page errors and no failed HTTP requests; the same test is a Pages CI gate
- production source-map dependency reachability review: see `docs/security-audit.md`

## Public deployment

- repository: [polik18/scratch-editor-ai-bridge](https://github.com/polik18/scratch-editor-ai-bridge)
- GitHub Pages: [Scratch AI Bridge public beta](https://polik18.github.io/scratch-editor-ai-bridge/)
- deployment source: GitHub Actions on `main`
- external browser verification: HTTP 200, Scratch VM initialized, no console, page, or request failures

The current release level is GitHub Pages public beta, not full lossless Scratch compatibility. See
`docs/deployment.md` for remaining risks and `docs/completeness-roadmap.md` for the L1/L2/L3 completion plan.
