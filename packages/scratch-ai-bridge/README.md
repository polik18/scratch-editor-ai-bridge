# Scratch AI Bridge

Scratch AI Bridge is a browser-only bridge between AI-authored structured JSON and Scratch projects. This package lives **inside the complete Scratch Editor monorepo** and uses the official `@scratch/scratch-vm` workspace.

Public beta: [https://polik18.github.io/scratch-editor-ai-bridge/](https://polik18.github.io/scratch-editor-ai-bridge/)

## Important repository layout

Nothing in the surrounding Scratch Editor was removed. The normal workspaces remain available, including `scratch-gui`, `scratch-vm`, `scratch-paint`, `scratch-render`, and `scratch-storage`.

A prebuilt experimental direct-use page is additionally available at repository root:

```text
ready-to-use/Scratch-AI-Bridge.html
```

That file is an additive convenience artifact. It does not replace this TypeScript package or the Scratch Editor source tree.

## Implemented source path

```text
Generate:
Canonical IR
→ validate
→ Scratch 3 project JSON + content-addressed assets
→ temporary SB3 archive
→ Scratch VM loadProject(archive)
→ Scratch VM saveProjectSb3()
→ .sb3

Analyze:
.sb3
→ Scratch VM loadProject()
→ Scratch VM toJSON()
→ Canonical IR
→ Analysis IR
→ AI prompt
```

AI 回傳若使用常見簡寫（例如 script 直接寫成陣列、純量 input、字串 broadcast，或省略角色預設欄位），可先按
「修復 AI JSON」。修復器只補結構明確的內容，不會猜測遊戲規則；Validate 會再檢查未宣告的變數／清單／廣播、
缺少必要 input、錯置的事件帽，以及非布林條件等語意問題。

See `docs/status.md` and `docs/vm-write-path.md` for exact phase status and design decisions.
The full L1/L2/L3 completeness definition and staged implementation plan is in `docs/completeness-roadmap.md`.

## Commands

From repository root:

```sh
npm ci
npm run build:ai-bridge-deps
npm run dev --workspace=@scratch/scratch-ai-bridge
npm test --workspace=@scratch/scratch-ai-bridge
npm run lint --workspace=@scratch/scratch-ai-bridge
npm run build --workspace=@scratch/scratch-ai-bridge
npm run test:browser --workspace=@scratch/scratch-ai-bridge
```

Use the exact Node version in the repository `.nvmrc`. The dependency build is required after a clean install because
the official Scratch workspaces resolve several packages through their generated `dist/` entry points.

## GitHub Pages

The Pages workflow validates pull requests and deploys pushes to `main` or `develop`. The public repository is
[`polik18/scratch-editor-ai-bridge`](https://github.com/polik18/scratch-editor-ai-bridge), with GitHub Actions selected
as its Pages source. See `docs/deployment.md` for the release checklist and current limitations.
