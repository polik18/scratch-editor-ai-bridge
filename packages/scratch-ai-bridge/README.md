# Scratch AI Bridge

Scratch AI Bridge is a browser-only bridge between AI-authored structured JSON and Scratch projects. This package lives **inside the complete Scratch Editor monorepo** and uses the official `@scratch/scratch-vm` workspace.

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

The Pages workflow validates pull requests and deploys pushes to `main` or `develop`. In the repository settings,
select **GitHub Actions** as the Pages source once. See `docs/deployment.md` for the release checklist and current
limitations.
