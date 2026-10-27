# Scratch AI Bridge Improvement Plan

**Original Date**: 2026-10-27  
**Current Status**: ✅ Complete  
**Version**: 0.2.0

## Overview

This document describes the improvement plan for scratch-editor-ai-bridge to enable AI agent integration with Scratch projects.

## Goals

1. ✅ Package Session API as callable Node.js module
2. ✅ Integrate oMLX for natural language parsing
3. ✅ Add Playwright preview automation
4. ✅ Build prompt template library
5. ✅ Create Web UI editor

## Architecture

```
scratch-editor-ai-bridge/
├── src/
│   ├── api/              # Node.js API for AI agents
│   │   └── index.ts
│   ├── nlp/              # Natural language parsing
│   │   ├── parser.ts
│   │   └── index.ts
│   ├── preview/          # Preview automation
│   │   ├── automation.ts
│   │   └── index.ts
│   ├── prompt/           # Prompt templates
│   │   ├── templates/
│   │   │   └── common-issues.ts
│   │   └── index.ts
│   ├── ui/               # Web UI
│   │   ├── App.tsx
│   │   ├── style.css
│   │   ├── main.ts
│   │   └── preview.html
│   └── cli/
│       └── session-cli.ts (updated)
├── scripts/
│   └── scratch-session.mjs
└── package.json (updated)
```

## Step-by-Step Implementation

### Step 1: Package Session API

**Goal**: Expose ScratchSession as a callable Node.js module.

**Changes**:
- Created `src/api/index.ts` with `createSession()` helper
- Updated CLI to use new API

**Result**: AI agents can now use `createSession()` to create and edit Scratch projects.

### Step 2: Integrate oMLX for NLP Parsing

**Goal**: Convert natural language to Scratch blocks.

**Changes**:
- Created `src/nlp/parser.ts` with pattern matching and LLM fallback
- Added `nlpParse` CLI command

**Result**: Natural language prompts can be parsed to Scratch blocks.

### Step 3: Add Playwright Preview Automation

**Goal**: Capture screenshots of Scratch projects.

**Changes**:
- Created `src/preview/automation.ts` with `previewScreenshot()`
- Added `preview-screenshot` CLI command

**Result**: Projects can be previewed and screenshots captured.

### Step 4: Build Prompt Template Library

**Goal**: Provide common issue responses for AI agents.

**Changes**:
- Created `src/prompt/templates/common-issues.ts` with 10 templates
- Added `getPromptTemplate()`, `getTemplatesByCategory()`, `getAllTemplates()`

**Result**: AI agents can provide structured feedback based on project analysis.

### Step 5: Create Web UI Editor

**Goal**: Browser-based editor for AI-generated projects.

**Changes**:
- Created `src/ui/App.tsx` with DOM-based UI
- Added `uiPreview` entry to Vite config

**Result**: Users can interact with AI-generated projects in browser.

## Testing

```bash
# Test all features
npx tsx -e "import('./src/api/index.js').then(...)"

# Test CLI
scratch-session nlpParse "Make the sprite move 10 steps"
scratch-session preview-screenshot /tmp/preview.png

# Test Web UI
npm run dev
```

## Future Enhancements

1. Real-time preview with Scratch VM
2. Block-based editor (scratch-blocks)
3. Multiple sprites support
4. Custom sprite upload
5. Project templates
6. Export to JSON/JS
