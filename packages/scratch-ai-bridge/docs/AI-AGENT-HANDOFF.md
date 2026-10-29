# Scratch AI Bridge — AI Agent Handoff

> **Start here.** This file is the current handoff and execution index for an AI CLI agent. Read it before changing files. Follow links only when the task needs the detailed contract. Update this file when verified project status or the next action changes.

## Project in one paragraph

Scratch AI Bridge is a browser-first tool inside the Scratch Editor monorepo. Its intended workflow is to turn a structured or AI-authored project into an `.sb3`, validate it with Scratch tooling, preview it in a Scratch VM, and let users inspect or preserve existing SB3 projects. The package is **not an MCP server**. The website has a local Scratch VM preview; it does not live-sync projects to the Scratch website or embed the official block editor.

## Current handoff status — 2026-10-29

- The package and its parent repository have extensive **uncommitted and untracked changes**. These include product code, tests, docs, research, `.bak`/`.backup` files, and `.DS_Store` files. Do not run `git reset`, broad cleanup, or delete untracked files. First inspect and preserve each item.
- There is no confirmed single authoritative project checkpoint in this checkout. Several status/plan documents disagree or describe experimental work as complete; treat source code and reproducible evidence as authoritative, and old completion badges as unverified.
- Previous investigation found TypeScript build errors and Vite/Scratch workspace import problems in this working state. **This handoff does not claim the current build passes.** Reproduce and record these before editing build configuration.
- Existing browser UI uses `src/main.ts` (about 2,278 lines); `src/ui/App.tsx` is a second UI path and its status/production role must be confirmed.
- A local Scratch VM preview already exists in the main app: static stage preview plus an isolated interactive iframe, keyboard/mouse input, stop control, and a 15-second execution limit. This is not the Scratch website editor. Some generation/import paths preview projects; the flow is not yet unified with all compile/download paths.
- `src/preview/automation.ts` is a placeholder: its Playwright screenshot path loads a blank page, not the real Scratch preview. Do not count it as visual verification.
- A previous playtest generated `Moonbase-Courier.sb3` outside the repository: 8 sprites, 249 blocks; Scratch VM load/save/reload retained 9 targets and 249 blocks; browser play completed 5/5 objectives without console errors. This was built from explicit Canonical IR, not generated end-to-end by a weak language model. The generator path initially accepted a documented unsupported shape and could produce an empty project; it was changed to reject that shape. Do not infer general model success from this one playtest.
- No implementation or cleanup is authorized by this handoff itself. Work on the specific user-requested task; preserve the existing dirty tree.

## First actions for the next agent

1. Run `git status --short` from the repository root and preserve the output in the task notes. Do not assume dirty files belong to you.
2. Confirm the package path is `packages/scratch-ai-bridge/` and read this file plus the root `AGENTS.md` instructions that apply to the requested task.
3. For implementation work, identify the specific authoritative source file and its current callers before editing. Reproduce the narrow failure first.
4. For cleanup, create a reviewed inventory and classify files before any deletion. Preserve research fixtures that reproduce bugs and any user-selected outputs.
5. Report exact files changed, evidence gathered, checks run, and remaining blockers. Do not label a stage complete without its acceptance evidence.

## Execution plan

### Phase 0 — Establish a safe baseline (P0)

- Inventory tracked changes, untracked files, backups, research artifacts, generated files, and `.DS_Store` files.
- Reconcile product entry points: website, `scratch-ai-bridge` inspect/batch CLI, `scratch-session`, Canonical generator, and experimental UI.
- Reproduce TypeScript and Vite failures independently; record command, first actionable error, and whether it blocks dev, build, or runtime.
- Keep one short current status/checkpoint. Do not treat `IMPROVEMENT-STATUS.md` or old `docs/status.md` completion claims as verified without source/evidence checks.

**Exit evidence:** reviewed file inventory; entry-point map; reproducible build/dev baseline; no accidental loss of pre-existing work.

### Phase 1 — Repository slimming and artifact policy (P0)

- Compare overlapping root and `docs/` plans, extract still-valid decisions, then keep one active roadmap and one concise status page. Archive only material with continuing historical value; remove duplicates only after review.
- After comparing them to source, remove confirmed obsolete backups and OS files. Add appropriate ignore rules at the correct repository level.
- Route test `.sb3`, temporary ZIPs, screenshots, manifests, and per-run logs to OS temp or an explicit output directory outside the repo. Ensure cleanup happens in `finally`; never remove user-selected output.
- Keep small, licensed, documented regression fixtures under `tests/fixtures/`; keep bulky raw model outputs outside the repo and retain a concise index.
- Add a non-destructive hygiene report for unexpectedly large/unignored files.

**Exit evidence:** before/after inventory; corpus tests still have required inputs; normal generation leaves no incidental repo artifacts; no user output was deleted.

### Phase 2 — Build reliability and one generation contract (P0)

- Repair the current TypeScript build and Vite workspace module resolution as separate work items. Avoid blanket `any` or ignored errors as fixes.
- Select one supported contract for input schema, Canonical IR conversion, output path, diagnostics, manifest, and validation gates.
- Make website and supported CLI generation call the same Canonical IR/Scratch VM compiler. Clearly label `ScratchSession` as experimental until its editing guarantees meet the same gates.
- Unsupported input must fail with a useful path and repair instruction; never report success for an empty or incomplete project.
- Report archive/assets, graph/schema, VM load, VM save, and reload outcomes separately.

**Exit evidence:** package build and dev UI start; same fixture via web and CLI has matching project/assets/gate results; unsupported inputs fail explicitly.

### Phase 3 — Real preview and interactive edit loop (P1)

- Reuse one preview component for generated, imported, and edited SB3 projects. Compile once, show that artifact in the stage, and make download an explicit export action.
- Add play/stop/restart, keyboard/mouse interaction, visible runtime state, and bounded cleanup. On an edit, show a reviewable patch/diff, validate it, then refresh the stage; retain the last working version and provide undo on failure.
- Replace the blank-page Playwright placeholder in `src/preview/automation.ts` with the real preview app and real SB3 load, or rename/remove it until that works.
- State clearly that this is an embedded Scratch VM preview. Evaluate embedding Scratch GUI/block editing separately; it adds significant dependency/build complexity and is not equivalent to opening a project on scratch.mit.edu.

**Exit evidence:** browser automation captures the actual stage; generated/imported paths use the same preview; a rule edit changes observable behavior; undo restores the prior project.

### Phase 4 — Web workflow and code organization (P1)

- Confirm whether `src/ui/App.tsx` is production, experimental, or unused. Keep one production entry point.
- Organize the main journey as create → review → generate → play → edit → export. Put raw JSON, IR, mappings, and detailed diagnostics under advanced tools.
- Split `src/main.ts` by feature responsibility (generation, preview, import/analysis, repair, export) without changing behavior in the same step.
- Use truthful stage labels and a consistent error/status component. Check keyboard navigation, focus, narrow screens, and new-user completion.

**Exit evidence:** one supported UI path; a new user can complete a sample without editing JSON; advanced diagnostics remain available; browser smoke covers key paths.

### Phase 5 — Visual/behavior fidelity and model capability (P1)

- Extend `docs/game-behavior-spec.md` into a versioned spec: stage, characters, controls, collisions, scoring, win/loss, restart, and required visual states. Give each requirement an ID.
- Build deterministic VM behavior checks with fixed input sequences, controlled time/randomness, and observable sprite/variable/broadcast/end-state assertions.
- Capture stage screenshots at fixed 480×360 size and named checkpoints; compare important regions/positions with documented tolerance. Distinguish original assets, library assets, generated assets, and fallback illustrations.
- Generate large games in small validated increments; return structured diagnostics/diffs to the model and support rollback.
- Evaluate strong and weaker models on the same fixed prompts. Record sample count, first-pass success, repair rounds, behavior and visual pass rates, and failure types. The current app's prompt-copy/paste flow does not enforce provider-side structured output.

**Exit evidence:** repeatable requirement-linked behavior and screenshot results; model comparison includes denominators and failures, not selected demos only.

## Source and reference map

- Website and most workflow orchestration: [`src/main.ts`](../src/main.ts)
- Alternate UI path to classify: [`src/ui/App.tsx`](../src/ui/App.tsx), [`src/ui/main.ts`](../src/ui/main.ts)
- Scratch VM, renderer, preview I/O and runtime helpers: [`src/scratch/vm.ts`](../src/scratch/vm.ts), [`src/preview/main.ts`](../src/preview/main.ts)
- Current placeholder Playwright automation: [`src/preview/automation.ts`](../src/preview/automation.ts)
- Canonical generation: [`src/cli/generator.ts`](../src/cli/generator.ts), [`src/cli/design-to-ir.ts`](../src/cli/design-to-ir.ts), [`src/core/compiler/compiler.ts`](../src/core/compiler/compiler.ts)
- Lossless archive import/export: [`src/core/archive/sb3-archive.ts`](../src/core/archive/sb3-archive.ts)
- Experimental session editing: [`src/cli/session/session.ts`](../src/cli/session/session.ts), [`src/cli/session-cli.ts`](../src/cli/session-cli.ts)
- Behavior spec draft: [`docs/game-behavior-spec.md`](game-behavior-spec.md)
- Detailed agent-editing plan: [`docs/cli-agent-editing-plan.md`](cli-agent-editing-plan.md)
- SB3 reliability plan: [`docs/sb3-generation-reliability-plan.md`](sb3-generation-reliability-plan.md)
- Detailed end-to-end plan: [`docs/sb3-end-to-end-detailed-execution-plan.md`](sb3-end-to-end-detailed-execution-plan.md)
- Package scripts and CLI declarations: [`package.json`](../package.json)

## Useful commands (run from repository root)

```sh
git status --short
npm run build:ai-bridge-deps
npm run build --workspace=@scratch/scratch-ai-bridge
npm test --workspace=@scratch/scratch-ai-bridge
npm run test:browser --workspace=@scratch/scratch-ai-bridge
```

Run only the checks relevant to the requested work; record failures accurately. Do not claim these commands have passed based on this handoff.
