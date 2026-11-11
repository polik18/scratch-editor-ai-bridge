# Scratch AI Bridge Improvement Status

**Last Updated**: 2026-11-03
**Version**: 0.2.3
**Status**: ✅ Step 7 完成（全功能預覽）| ✅ Step 8 完成（迭代面板 A.1-A.2）| 🔜 Step 8 待執行（A.3-A.5）| 🔜 Step 9 待執行（5 個細項）

## Steps Completed

### Step 1: Package Session API ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:

- Created `src/api/index.ts` with `createSession()` helper
- Created `bin/scratch-session.mjs` CLI entry
- Updated `package.json` to include `scratch-session` bin
- Updated `docs/history/API-ONBOARDING.md`

**API Usage**:

```typescript
import { createSession } from '@scratch/scratch-ai-bridge/api'

const sess = await createSession()
await sess.newProject('My Project')
await sess.addSprite('Sprite1')
await sess.addBlock('Sprite1', 'motion_movesteps', { inputs: { STEPS: { type: 'literal', value: 10 } } })
const sb3 = await sess.compile()
```

### Step 2: Integrate oMLX for NLP Parsing ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:

- Created `src/nlp/parser.ts` with `parseNaturalLanguage()` and `applyCommandsToSession()`
- Created `src/nlp/index.ts` module exports
- Added `nlpParse` CLI command
- Updated `docs/history/NLP-ONBOARDING.md`

**Features**:

- Pattern matching for common tasks (move, say, wait, etc.)
- Optional oMLX LLM integration (fallback)
- Confidence scoring (0.9 pattern match, 0.95 LLM)

**Usage**:

```bash
scratch-session nlpParse "Make the sprite move 10 steps"
```

### Step 3: Playwright Automation for Preview ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:

- Created `src/preview/automation.ts` with `capturePreviewScreenshot()`
- Added `preview-screenshot` CLI command
- Updated `docs/history/PREVIEW-AUTOMATION.md`

**Features**:

- Full-page preview capture
- Hardware extension support
- Multiple output formats (PNG, PDF, base64)

### Step 4: Prompt Template Library ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:

- Created `src/prompt/templates/common-issues.ts`
- Added template for common Scratch issues (syntax, blocks, logic)
- Updated `docs/history/PROMPT-TEMPLATES.md`

**Templates**:

- `TEMPLATE_SCRIPTING_ISSUE` - General script debugging
- `TEMPLATE_SPRITE_MOVEMENT` - Movement block usage
- `TEMPLATE_COSTUME_SOUNDS` - Art and audio issues

### Step 5: Web UI Editor ✅

**Date**: 2026-10-27  
**Status**: Complete  
**Changes**:

- Created `src/ui/App.tsx` with React UI
- Integrated Vite + Tailwind CSS
- Added project idea input, AI generation, and SB3 download
- Updated `docs/history/UI-ONBOARDING.md`

### Step 6: Editable Text Boxes ✅

**Date**: 2026-11-03  
**Status**: Complete  
**Changes**:

- `src/main.ts:627` - DOM attribute change (data-placeholder)
- `src/style.css:409-426` - New `[data-placeholder]::placeholder` style
- Verified with `npm run dev` manual test

**Acceptance Criteria Met**:

- [x] A.1: "My Project Idea" text box shows placeholder and is editable
- [x] A.2: User can directly edit text without copy-paste
- [x] A.3: Style distinguishes placeholder vs. user input

### Step 7: Full Preview Functionality (No 120s Limit) ✅

**Date**: 2026-11-03  
**Status**: Complete  
**Changes**:

- `src/preview/main.ts:607` - Removed 120s timeout
- `src/main.ts:4098` - Removed 120s timeout
- `src/main.ts:4114` - Updated status text (removed "previews for up to 120 seconds")

**Acceptance Criteria Met**:

- [x] B.1: Preview runs > 120s without auto-stop
- [x] B.2: Mouse clicks and keyboard controls work normally
- [x] B.3: Stop button exists (already implemented)
- [x] B.4: VM stops correctly when clicked
- [x] B.5: Reload functionality available (via page refresh)

### Step 8: AI Project Iteration Instruction ✅

**Date**: 2026-11-03  
**Status**: Complete  
**Changes**:

- Created `src/core/capabilities/iteration.ts` with `createProjectIterationInstruction()`
- Updated `src/core/capabilities/index.ts` exports

**Features**:

- Generates iteration instruction for AI to modify existing project
- Preserves existing structure while applying modifications
- Follows Scratch 3.0 specification

## Pending Sub-Plans

### Step 8: AI Iteration Workflow (Continued) 🔜

**Status**: 1/5 complete  
**Target**: Add AI iteration panel for multi-round project revisions

**Remaining Tasks**:

1. `src/main.ts` - Add `#ai-iteration-panel` DOM structure
2. `src/main.ts` - Implement `aiIterateGenerateButton` event handler
3. `src/main.ts` - Ensure "Paste Back to Scratch" flow is repeatable
4. `src/main.ts:1006` - Update to support multiple iterations
5. `src/core/capabilities/registry.ts` - Update prompt templates

**Acceptance Criteria**:

- [ ] C.1: Page shows "Let AI Modify Project" section
- [ ] C.2: Input modification request, click button, AI generates new project
- [ ] C.3: AI prompt includes "follow AI conversation history" marker
- [ ] C.4: Paste new code and create SB3 again
- [ ] C.5: New project can be modified again (multi-round iteration)

### Step 9: Built-in Assets & Music 🔜

**Status**: 0/5 complete  
**Target**: Support built-in sprites/backgrounds/sounds loading to reduce file size

**Required Changes**:

1. `src/scratch/storage.ts` - Confirm `BUILT_IN_SPRITE_VISUALS`, `BUILT_IN_BACKDROP_VISUALS` support
2. `packages/scratch-vm/src/blocks/scratch3_sound.js` - Check opcode
3. `src/core/capabilities/registry.ts` - Update prompt templates
4. `src/main.ts:1530-1600` - Add `built-in-assets` panel
5. `src/preview/main.ts:550-600` - Implement `addBuiltInAsset()` function

**Acceptance Criteria**:

- [ ] D.1: Preview shows built-in sprite/background/sound list
- [ ] D.2: Click built-in sprite to load into VM
- [ ] D.3: AI prompt includes "can use built-in assets" note
- [ ] D.4: Generated projects prefer built-in assets (smaller file size)
- [ ] D.5: Music functions work (`play sound`, `set effect`, `play drum`)
