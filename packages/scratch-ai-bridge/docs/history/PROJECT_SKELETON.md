# Project Skeleton (2026-11-02)

**Generated**: 2026-11-02  
**Source**: `/Users/huangjianzhe/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge/src`

## Function Signatures

```typescript
// src/main.ts
export function init(): void
export function byId<T extends HTMLElement>(id: string): T
export function patchStatus(kind: string, message: string): void
export function setProjectRequest(value: string): void
export function setGameBrief(value: string): void
export function copyPromptToClipboard(): Promise<void>
export function copyBuildInstruction(): Promise<void>
export function copyImprovementInstruction(): Promise<void>
export function previewImportedProject(): Promise<void>
export function checkAndBuild(): Promise<void>
export function startAnimation(): Promise<void>
export function stopAnimation(): Promise<void>
export function reloadProject(): Promise<void>
export function localAiGenerate(): Promise<void>
export function localAiCancel(): void
export function mcpGenerate(): Promise<void>
export function mcpCancel(): void
export function updateImprovementInstruction(): void
export function aiIterateGenerate(): Promise<void>

// src/preview/main.ts
export function startProjectRuntime(vm: ScratchVMHandle): void
export function stopProjectRuntime(vm: ScratchVMHandle): void
export function postScratchIOData(vm: ScratchVMHandle, target: string, data: any): void
export function startScratchPreviewDrag(vm: ScratchVMHandle, x: number, y: number): void
export function stopScratchPreviewDrag(vm: ScratchVMHandle): void

// src/scratch/vm.ts
export function createOfflineScratchVM(): Promise<ScratchVMHandle>
export function loadSb3Archive(vm: ScratchVMHandle, archive: any): Promise<void>
export function runForTicksAsync(vm: ScratchVMHandle, ticks: number): Promise<void>

// src/core/capabilities/registry.ts
export function getPromptTemplate(category: string): string
export function createGameDesignDiscussionInstruction(prompt: string): string
export function createProjectFragmentInstruction(params: any): string
export function createStudentProjectInstruction(prompt: string, opts: any): string
export function estimatePromptSize(prompt: string): { characters: number; estimatedTokens: number }
export function createProjectIterationInstruction(params: any): string

// src/nlp/parser.ts
export function parseNaturalLanguage(prompt: string): ParsedPrompt
export function extractIntent(prompt: string): Intent
export function extractParameters(prompt: string): Parameters
```

## Class Signatures

```typescript
// ScratchVMHandle
class ScratchVMHandle {
  constructor(): void
  loadProject(json: any): void
  start(): void
  stopAll(): void
  postIOData(target: string, data: any): void
  getSprite(name: string): Sprite
  getStage(): Stage
}
```

## Key Variables

```typescript
// src/main.ts
let activeStudentAnimation: ActiveStudentAnimation | null
let localAiController: { current: AbortController | null }
let mcpController: { current: AbortController | null }
let localAiGenerateButton: HTMLButtonElement
let mcpGenerateButton: HTMLButtonElement

// src/preview/main.ts
let previewTimeout: number | null
let previewToken: string
let previewRevision: string
```

## Exported Modules

```typescript
// @scratch/scratch-vm
export { ScratchVM, type ScratchVMHandle } from '@scratch/scratch-vm'
export { createOfflineScratchStorage } from '@scratch/scratch-storage'
export { BUILT_IN_SPRITE_VISUALS, BUILT_IN_BACKDROP_VISUALS } from '@scratch/scratch-render'
```

## File Structure

```
src/
├── main.ts                 # Main UI logic (6588 lines)
├── style.css               # CSS styles (1471 lines)
├── preview/
│   └── main.ts             # Preview VM control (619 lines)
├── scratch/
│   ├── vm.ts               # VM wrapper (16721 lines)
│   ├── storage.ts          # Storage setup (23 lines)
│   └── index.ts            # Module exports
├── core/
│   └── capabilities/
│       └── registry.ts     # Capability definitions (1134 lines)
├── nlp/
│   └── parser.ts           # NLP parsing (9128 lines)
└── ui/
    ├── App.tsx             # React UI (7495 lines)
    └── main.ts             # UI entry (6 lines)
```

## Notes

- Total lines: ~60,000+ (full codebase)
- Functions to modify for Step 6-9: `init`, `byId`, `patchStatus`, `setProjectRequest`, `previewImportedProject`, `checkAndBuild`, `startAnimation`, `stopAnimation`, `localAiGenerate`, `mcpGenerate`, `createOfflineScratchVM`, `createProjectIterationInstruction`
- Key constraint: Each task must modify ≤2 files, ≤80 lines per file
