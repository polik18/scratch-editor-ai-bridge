# Scratch AI Bridge Improvement Status

**Last Updated**: 2026-10-30
**Version**: 0.2.1
**Status**: ✅ TypeScript compilation and package build verified; behavioral tests remain unrun

## Steps Completed

### Step 1: Package Session API ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:
- Created `src/api/index.ts` with `createSession()` helper
- Created `scripts/scratch-session.mjs` CLI entry
- Updated `package.json` to include `scratch-session` bin
- Updated `API-ONBOARDING.md`

**API Usage**:
```typescript
import { createSession } from '@scratch/scratch-ai-bridge/api';
const sess = await createSession();
await sess.newProject('My Project');
await sess.addSprite('Sprite1');
await sess.addBlock('Sprite1', 'motion_movesteps', { inputs: { STEPS: { type: 'literal', value: 10 } } });
const sb3 = await sess.compile();
```

### Step 2: Integrate oMLX for NLP Parsing ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:
- Created `src/nlp/parser.ts` with `parseNaturalLanguage()` and `applyCommandsToSession()`
- Created `src/nlp/index.ts` module exports
- Added `nlpParse` CLI command
- Updated `NLP-ONBOARDING.md`

**Features**:
- Pattern matching for common tasks (move, say, wait, etc.)
- Optional oMLX LLM integration (fallback)
- Confidence scoring (0.9 pattern match, 0.95 LLM)

**Usage**:
```bash
scratch-session nlpParse "Make the sprite move 10 steps"
```

### Step 3: Integrate Playwright for Preview Automation ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:
- Created `src/preview/automation.ts` with `previewScreenshot()` and `previewRun()`
- Created `src/preview/index.ts` module exports
- Added `preview-screenshot` CLI command
- Updated `PREVIEW-AUTOMATION.md`

**Features**:
- Playwright-based screenshot generation
- Headless Chromium launch
- Temporary file cleanup

**Usage**:
```bash
scratch-session preview-screenshot /tmp/preview.png
```

### Step 4: Build Prompt Template Library ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:
- Created `src/prompt/templates/common-issues.ts` with 10 templates
- Created `src/prompt/index.ts` module exports
- Updated `PROMPT-TEMPLATES.md`

**Templates**:
- **Structure**: Missing start blocks, detached scripts
- **Behavior**: Infinite loops, wait inside loops
- **Debug**: Sprite not visible, wrong directions
- **Learning**: Variable not set, score not updating
- **General**: Unknown blocks, unsupported features

**Usage**:
```typescript
import { getPromptTemplate } from '@scratch/scratch-ai-bridge/prompt';
const template = getPromptTemplate('structure', '缺少開始積木');
console.log(template?.prompt);
```

### Step 5: Create Web UI Editor ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:
- Created `src/ui/App.tsx` with DOM-based UI components
- Created `src/ui/style.css` with clean styles
- Created `src/ui/main.ts` browser entry point
- Created `src/ui/preview.html` preview page
- Updated `vite.config.ts` with `uiPreview` entry
- Updated `UI-ONBOARDING.md`

**Features**:
- Natural language prompt input
- Generate project from prompt
- Preview screenshot capture
- Download .sb3 export
- Status bar and output log

**Usage**:
```bash
npm run dev
# Visit: http://localhost:5173/src/ui/preview.html
```

## TypeScript Compilation Fix (2026-10-30)

**Status**: ✅ Complete for type-check and production build
**Initial check**: Before fixes, `npx tsc --noEmit --pretty false` reported **20 diagnostics**. The earlier 19-error count omitted one `main.ts` diagnostic.

### Initial diagnostic snapshot

| File | Count | Diagnostics and locations |
|---|---:|---|
| `src/cli/session-cli.ts` | 3 | TS6192 unused import declaration (line 37); TS2554 `inspect()` called with an argument although its signature expects none (line 231); TS6133 unused `_outputPath` (line 442). |
| `src/cli/session/session.ts` | 1 | TS6133 unused `patch` parameter in `applyPatchToProject()` (line 822). |
| `src/cli/session/validator.ts` | 3 | TS2367 compares `string` with `boolean` (line 170); TS2345 passes `unknown` where `BlockData` is required (line 258); TS6133 unused `allBlockIds` parameter (line 269). |
| `src/main.ts` | 5 | TS6133 unused `studentPreviewGeneration` (8565), `studentPreviewRenderQueue` (8569), `stopStudentAnimation` (9069), and `AI_INSTRUCTION` (9085); TS2339 `finish` is unavailable on inferred `never` (9073). |
| `src/ui/index.ts`, `src/ui/main.ts` | 3 | TS6142 JSX configuration missing for `App.tsx` (one each at `index.ts:2` and `main.ts:2`); TS2459 `init` is not exported from `main.ts` (`index.ts:5`). |
| `tests/compatibility/official-sb2-procedure-execution.test.ts` | 3 | TS2349 calls a `void` value (lines 335, 371, 409). |
| `tests/capabilities/registry.test.ts` | 2 | TS6133 unused `createVM` import (line 22) and `renderer` (line 50). |
| **Total** | **20** | Snapshot from the command above; line numbers can move as files change. |

### Fixes applied

- Removed unused imports/arguments and corrected the CLI `inspect()` call to match the session API.
- Corrected validator typing and removed an unused parameter. The `next` check now follows the declared Scratch block type (`string | null`).
- Configured TypeScript to preserve TSX for Vite and exported `init` from the UI entry module.
- Replaced the browser UI's Node-only Playwright screenshot call with an in-browser Scratch VM canvas render and PNG download. The CLI Playwright automation remains Node-only.
- Moved Node filesystem/path imports in `ScratchSession` into the file load/save methods so browser entry points do not eagerly load Node builtins.
- Fixed three compatibility-test cleanup expressions that JavaScript parsed as attempts to call the preceding `void` result. Removed unused test declarations and attached the renderer mock built by the capability test helper.
- Removed unused declarations in the duplicated `main()` preview setup and used a typed mutable state container to avoid impossible `never` narrowing.

The `plan/apply/undo/diff()` methods do not implement patch operations. They now report `unsupported`, and `apply()` throws instead of saving an unchanged project as if a patch succeeded. Implementing transactional patch operations, undo history, and semantic diffs remains a separate functional task.

### Verification results

- `npx tsc --noEmit --pretty false`: **passed, 0 diagnostics**.
- `npm run build`: **passed**, including Vite bundle generation, service worker generation, and bundle-budget checks.
- Build warnings remain for `node:path` and `node:fs/promises` being externalized in Node-only session methods, unresolved runtime `new URL()` expressions, and large Scratch renderer/VM chunks. These warnings did not fail the build; browser runtime verification is still needed.
- Tests and the `scratch-session compile` workflow were not run.

### Remaining work

1. Run focused tests and browser verification for session creation, preview PNG download, and the compatibility test cleanup.
2. Implement the documented patch schema and real `plan/apply/undo/diff` behavior before advertising those CLI operations as supported.
3. Reassess the remaining bundler warnings and browser runtime behavior, especially the Node-only session load/save methods.

## Current Capabilities

### AI Agent Integration

✅ **Session API**: Node.js module for AI agents  
✅ **NLP Parsing**: Natural language to Scratch blocks  
✅ **Preview Automation**: Screenshot generation  
✅ **Prompt Templates**: Common issue responses  
✅ **Web UI**: Browser-based editor  

### CLI Commands

| Command | Description |
|---------|-------------|
| `scratch-session new` | Create new project |
| `scratch-session addSprite <name>` | Add sprite |
| `scratch-session addBlock <sprite> <opcode> <json>` | Add block |
| `scratch-session compile` | Compile to SB3 |
| `scratch-session nlpParse "<prompt>"` | Parse natural language |
| `scratch-session preview-screenshot <output>` | Capture screenshot |

### Web UI

| Feature | Status |
|---------|--------|
| Prompt input | ✅ |
| Generate project | ✅ |
| Preview screenshot | ✅ |
| Download SB3 | ✅ |
| Status log | ✅ |

## Files Modified/Created

### New Files

- `src/api/index.ts`
- `src/nlp/parser.ts`
- `src/nlp/index.ts`
- `src/preview/automation.ts`
- `src/preview/index.ts`
- `src/prompt/templates/common-issues.ts`
- `src/prompt/index.ts`
- `src/ui/App.tsx`
- `src/ui/style.css`
- `src/ui/main.ts`
- `src/ui/preview.html`
- `scripts/scratch-session.mjs`
- `API-ONBOARDING.md`
- `NLP-ONBOARDING.md`
- `PREVIEW-AUTOMATION.md`
- `PROMPT-TEMPLATES.md`
- `UI-ONBOARDING.md`

### Modified Files

- `package.json` (added `scratch-session` bin, updated scripts)
- `src/cli/session-cli.ts` (added `nlpParse` and `previewScreenshot` commands, fixed compile() optional parameter)
- `src/cli/session/session.ts` (added SessionInfo.name field, JSZip wrapper, plan/apply/undo/diff methods, unused variable suppressions)
- `vite.config.ts` (added `uiPreview` entry)

## Testing

```bash
# Test all features
npx tsx -e "import('./src/api/index.js').then(async ({ createSession }) => { ... })"

# Test CLI
scratch-session nlpParse "Make the sprite move 10 steps"
scratch-session preview-screenshot /tmp/preview.png

# Test Web UI
npm run dev
# Visit: http://localhost:5173/src/ui/preview.html

# Verify TypeScript compilation (current focus)
npx tsc --noEmit
npm run build
```

## Known Limitations

- oMLX endpoint requires authentication (placeholder integration)
- Web UI uses DOM API instead of React (lightweight alternative)
- Preview requires Playwright (browser automation overhead)
- Patch planning/application, undo history, and semantic diff are intentionally unsupported pending implementation; see the dated status above.
