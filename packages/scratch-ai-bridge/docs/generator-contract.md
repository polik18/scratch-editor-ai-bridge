# Generator Contract

本文件定義 Generator 的輸入/輸出格式與驗證要求。

## 輸入格式

Generator 正式生成入口接受 Canonical IR JSON。Compiler 會先驗證 IR，再透過官方 Scratch VM 編譯；需要多角色、素材及巢狀積木圖時，這是可靠輸入格式。

```json
{
  "format": "scratch-ai-bridge/canonical-ir",
  "version": 1,
  "name": "My Scratch Game",
  "stage": { "kind": "stage", "name": "Stage", "variables": [], "lists": [], "costumes": [], "sounds": [], "scripts": [], "procedures": [] },
  "sprites": []
}
```

Generator 仍保留實驗性 `GameDesign` adapter，但它只消化內部 `spritesDef` 格式。舊版文件列出的 `sprites: SpriteDef[]` 會被拒絕，避免轉成空白作品卻回報成功。Markdown 目前不屬於可靠的生成格式。

### 實驗性 `spritesDef` JSON

```typescript
interface GameDesign {
  id: string;
  title: string;
  type: string;
  sprites: number;
  blocks: number;
  difficulty: string;
  version: string;
  created: string;
  designDoc: string;
  outputSb3: string;
  outputJson: string;
  spritesDef?: SpriteDef[];
  variables?: VariableDef[];
  lists?: ListDef[];
  scripts?: ScriptDef[];
}

interface SpriteDef {
  name: string;
  x?: number;
  y?: number;
  size?: number;
  direction?: number;
  visible?: boolean;
  costumeName?: string;
  costumes: CostumeDef[];
  sounds: SoundDef[];
}

interface CostumeDef {
  name: string;
  md5: string;
  bitmapResolution?: number;
  costumeCenterX?: number;
  costumeCenterY?: number;
  rotationCenterX?: number;
  rotationCenterY?: number;
}

interface SoundDef {
  name: string;
  md5: string;
  sampleCount?: number;
  rate?: number;
  format?: string;
}
```

需要保留正式的腳本及素材時，請使用 Canonical IR。

## 輸出格式

Generator 輸出兩種格式：

### 1. SB3 (Scratch 3.0 Project)

- Binary format: SB3 (ZIP with `project.json`)
- Output path: `{outputDir}/{input-basename}.sb3`; 若目錄不存在會自動建立。

### 2. Manifest JSON

```typescript
interface ManifestEntry {
  inputHash: string;      // SHA-256 of input
  toolVersion: string;    // Generator version
  gateResults: GateResult[];
  outputHash?: string;    // sha256:<64 lowercase hex characters>
  failurePath?: string[]; // Gates that failed
}

interface GateResult {
  name: string;
  status: 'pass' | 'fail';
  message?: string;
}
```

## 驗證要求

每次生成必須通過以下 gates：

1. **archive-validation**: SB3 ZIP 結構正確
2. **graph-validation**: Block graph reciprocity 正確
3. **vm-load**: VM 能正確載入 SB3
4. **vm-save**: VM 能正確儲存 SB3
5. **vm-reload**: VM 能正確 reload SB3

## 診斷格式

失敗時必須輸出診斷訊息：

```typescript
interface Diagnostic {
  type: 'error' | 'warning';
  stage: string;
  code: string;
  message: string;
  suggestion: string;
  location?: {
    target?: string;
    index?: number;
  };
}
```

## Generator Contract API

```typescript
export interface GeneratorOptions {
  outputDir?: string;
  manifest?: string;
  continueOnError?: boolean;
}

export async function generateGame(
  input: string,           // Path to design file
  options?: GeneratorOptions
): Promise<GeneratorResult>;

export interface GeneratorResult {
  success: boolean;
  output?: string;         // Path to output SB3
  manifest?: ManifestEntry;
  diagnostics: Diagnostic[];
}
```
