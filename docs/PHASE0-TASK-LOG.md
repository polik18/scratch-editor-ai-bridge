# Scratch AI Bridge — Phase 0 Task Log

## Entry: 2026-10-29 (hermes-agent)

### Phase 0 — Establish a safe baseline

#### 0.1 Git status inventory
```
M packages/.DS_Store
?? .DS_Store
?? .github/.DS_Store
?? packages/scratch-ai-bridge/src/cli/session-cli.ts.bak
?? packages/scratch-ai-bridge/src/cli/session-cli.ts.bak2
?? packages/scratch-ai-bridge/src/main.ts.backup
?? research/sb3-failure-2026-10-28/
```

#### 0.2 Entry-point mapping (per handoff links)
- Website + workflow orchestration: `src/main.ts` (~106KB, ~2,278 lines)
- Alternate UI path: `src/ui/App.tsx`, `src/ui/main.ts`
- CLI inspect/batch: `src/cli/main.ts`
- CLI session: `src/cli/session-cli.ts` (412 lines, 17 commands)
- CLI generator: `src/cli/generator.ts`, `src/cli/design-to-ir.ts`
- CLI batch: `src/cli/batch.ts` (304 lines)
- Compiler: `src/core/compiler/` (8 files)
- Archive I/O: `src/core/archive/` (SB3 via jszip)
- Session editing: `src/cli/session/session.ts` (606 lines)
- Preview helpers: `src/preview/` (automation.ts placeholder)
- Verification: `src/cli/verification.ts` (new in v0.1.0)

#### 0.3 Build/dev baseline

**Build script**:
```
tsc --noEmit && vite build && node scripts/copy-renderer-sandbox-assets.mjs && node scripts/generate-service-worker.mjs && node scripts/check-bundle-budget.mjs
```

**Package dependencies**:
- `@scratch/scratch-vm`: 15.2.0
- `@scratch/scratch-storage`: 15.2.0
- `@scratch/scratch-render`: 15.2.0
- `@scratch/scratch-svg-renderer`: 15.2.0
- `scratch-audio`: 2.0.268
- `playwright`: 1.63.0

**Git history**: 35,310 commits total; last commit (9a43e95f0f) adds game generation workflows

#### 0.4 Classify artifacts
| Artifact | Size | Status |
|----------|------|--------|
| `*.backup`, `*.bak` files | 3 × ~106KB + 2 × ~20KB | **Candidate for deletion** |
| `research/sb3-failure-2026-10-28/` | 2.0 MB | Research output (keep) |
| `packages/scratch-ai-bridge/research/sb3-failure-corpus/` | 44 KB | Research output (keep) |
| `.DS_Store` (3 instances) | < 1 KB | Git-ignored, safe to delete |

#### 0.5 Next steps (per AI-AGENT-HANDOFF.md)
- [x] 0.1 Execute `git status --short` → done
- [x] 0.2 Map entry points → done
- [ ] 0.3 Reproduce TypeScript/Vite failures → pending
- [x] 0.4 Classify backups/research artifacts → done
- [ ] 0.5 Create one concise status/checkpoint → pending
- [ ] 0.6 Cleanup (if owner permits) → pending

#### 0.6 Summary

**Current state (2026-10-29)**:
- v0.1.0 released (commit 9a43e95f0f)
- GitHub Pages deployed and verified
- CLI `inspect` / `batch` working (static analysis, no VM)
- CLI `compile` / `preview` complete with VM round-trip + verification gate
- Web UI: `src/main.ts` entry point (~2,278 lines)
- Session CLI: 17 commands implemented via `ScratchSession` class

**Known issues**:
- TypeScript/Vite build not yet executed
- Backup files present (to be removed after verification)
- Preview automation placeholder (`src/preview/automation.ts`) not yet implemented
