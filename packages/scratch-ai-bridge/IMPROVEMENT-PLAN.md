# Scratch AI Bridge 改善計畫

**日期**: 2026-10-27  
**版本**: 1.0.0  
**問題來源**: 使用 scratch-editor-ai-bridge 建立平台遊戲時遇到的障礙

> **診斷已更新（2026-10-28）**：本文件以下把 `addBlock()` 的 `inputs` 格式列為主要根因，且把舊版程式變更標為已完成；這不足以解釋實際失敗樣本，也不可視為目前根因或驗收依據。`cyber-duel.sb3` 與 `star-collector.sb3` 的 ZIP 缺少所有 costume 資產，block fields／inputs 仍有應屬 Canonical draft 的 wrapper，且腳本沒有 `next` 連線。經確認低階 `scratch-session` compiler 只封裝 `project.json`，未經官方 Scratch VM round-trip。請以[新版 SB3 產生成功率改善計畫](docs/sb3-generation-reliability-plan.md)及[CLI agent 編輯計畫](docs/cli-agent-editing-plan.md)為準；此舊計畫保留作歷史記錄。

---

## 問題摘要

使用 `scratch-editor-ai-bridge` 建立 Scratch SB3 檔案時，發現以下問題：

1. **SB3 無法在 Scratch 編輯器播放**
2. **`addBlock()` API 的 `inputs` 格式不正確**
3. **Block 結構缺少必要欄位**（如 `topLevel`, `next`, `shadow`）
4. **腳本串接邏輯不清晰**（hat block 與 body block 的連接）
5. **CLI 工具與 API 文件不完整**

---

## 問題詳細診斷

### 問題 1：SB3 無法播放

**現象**：生成的 `star-collector.sb3` 在 Scratch 編輯器中無法載入或播放。

**診斷結果**：
- Block 的 `inputs` 欄位格式錯誤
  - ❌ 錯誤格式：`{type: 'reporter', id: 'x'}`
  - ✅ 正確格式：`{block: 'REPORTER_BLOCK_ID', shadow: 'REPORTER_SHADOW_ID'}`
- Block 的 `topLevel` 屬性未正確設定
  - 顶层腳本（如 `event_whenflagclicked`）應為 `topLevel: true`
  - 有 `parent` 的 block 應為 `topLevel: false`
- Block 之間缺少 `next` 連接
  - 多個 block 應以 `next` 欄位串接成腳本
- 缺少 reporter block（變數/輸入值）

### 問題 2：`addBlock()` API 設計問題

**現狀**：
```typescript
addBlock(
  targetName: string,
  opcode: string,
  opts: {
    fields?: Record<string, [string, string | null]>;
    inputs?: Record<string, CanonicalInputRef>;
    parent?: string | null;
    next?: string | null;
    shadow?: boolean;
  } = {}
): string
```

**問題**：
1. `inputs` 的 `CanonicalInputRef` 類型設計不直觀
2. `CanonicalInputRef` 定義為 `{block: string, shadow: string}`，但使用者難以理解
3. 沒有提供簡單的 "literal" 輸入方式（如直接傳數值）

### 問題 3：Hat Block 與 Body Block 串接

**現狀**：有 `attachBlockToHat()` 方法，但需要：
1. 先建立 hat block（如 `event_whenflagclicked`）
2. 建立 body block（如 `motion_gotoxy`）
3. 手動呼叫 `attachBlockToHat()` 串接

**問題**：
- 步驟繁瑣，容易出錯
- `attachBlockToHat()` 需要搜尋 hat block，效率低
- 沒有提供一次性建立 "hat + body" 的方法

### 問題 4：CLI 工具功能不完整

**現狀**：
- `scratch-session` CLI 提供基礎指令（`new`, `add-sprite`, `add-block`）
- 缺少高階指令（`add-platform-game`, `add-sprite-movement`）
- 沒有範例專案或教學文件

**問題**：
- CLI 只能建立簡單 block，無法建立完整遊戲邏輯
- 使用者需要手動拼接大量 block 結構

### 問題 5：文件不足

**現狀**：
- `README.md` 只有簡短介紹
- `API-ONBOARDING.md` 缺少詳細範例
- 沒有 "常見問題" 或 "錯誤排除" 文件

---

## 改善計畫

### Step 1：修復 `addBlock()` 的 `inputs` 格式

**目標**：讓 `inputs` 參數支援三種格式：
1. **Literal**（直接數值）：`{type: 'literal', value: 10}`
2. **Reporter**（引用其他 block）：`{type: 'reporter', id: 'REPORTER_ID'}`
3. **Variable**（引用變數）：`{type: 'variable', name: 'x velocity'}`

**實作**：
```typescript
type BlockInputValue = 
  | { type: 'literal'; value: number | string }
  | { type: 'reporter'; id: string }
  | { type: 'variable'; name: string };

interface AddBlockOptions {
  fields?: Record<string, [string, string | null]>;
  inputs?: Record<string, BlockInputValue>;
  parent?: string | null;
  next?: string | null;
  shadow?: boolean;
}
```

**修改 `addBlock()`**：
```typescript
function normalizeInput(input: BlockInputValue): CanonicalInputRef | null {
  if (input.type === 'literal') {
    // 建立 reporter block 並回傳其 ID
    const reporterId = this.createLiteralReporter(input.value);
    return { block: reporterId, shadow: reporterId + '_shadow' };
  } else if (input.type === 'reporter') {
    return { block: input.id, shadow: input.id + '_shadow' };
  } else if (input.type === 'variable') {
    // 建立 variable reporter block
    const varId = this.createVariableReporter(input.name);
    return { block: varId, shadow: varId + '_shadow' };
  }
  return null;
}
```

### Step 2：提供 "Hat + Body" 一次性建立方法

**目標**：簡化 hat block 與 body block 的建立流程

**實作**：
```typescript
async addHatWithBody(
  targetName: string,
  hatOpcode: string,
  bodyBlocks: Array<{ opcode: string; opts?: AddBlockOptions }>,
  parent?: string | null,
  next?: string | null
): Promise<string> {
  // 建立 hat block
  const hatId = await this.addBlock(targetName, hatOpcode, {
    parent,
    next: null,
  });

  // 建立 body blocks 並串接
  let prevBodyId: string | null = null;
  for (const blockDef of bodyBlocks) {
    const bodyId = await this.addBlock(targetName, blockDef.opcode, blockDef.opts);
    if (prevBodyId) {
      this.editBlock(targetName, prevBodyId, { next: bodyId });
    } else {
      // 串接到 hat
      this.editBlock(targetName, hatId, { next: bodyId });
    }
    prevBodyId = bodyId;
  }

  return hatId;
}
```

**使用範例**：
```typescript
await session.addHatWithBody('Hero', 'event_whenflagclicked', [
  { opcode: 'motion_gotoxy', opts: { inputs: { X: { type: 'literal', value: 0 }, Y: { type: 'literal', value: 0 } } } },
  { opcode: 'motion_movesteps', opts: { inputs: { STEPS: { type: 'literal', value: 10 } } } },
]);
```

### Step 3：增加 reporter block 建立方法

**目標**：支援變數與 reporter block 的建立

**實作**：
```typescript
// 建立變數 reporter block
async createVariableReporter(targetName: string, variableName: string): Promise<string> {
  const varId = await this.addBlock(targetName, 'data_variable', {
    fields: { VARIABLE: { type: 'variable', value: variableName } },
  });
  return varId;
}

// 建立數值 reporter block
async createLiteralReporter(targetName: string, value: number | string): Promise<string> {
  const reporterId = await this.addBlock(targetName, 'math_number', {
    fields: { NUM: { type: 'literal', value } },
  });
  return reporterId;
}
```

### Step 4：提供高階指令與範例

**目標**：讓 CLI 可以快速建立常見遊戲模式

**實作**：
```bash
# 建立平台遊戲
scratch-session add-platform-game "Star Collector"

# 建立角色移動邏輯
scratch-session add-sprite-movement "Hero" --arrows --jump

# 建立敵人 AI
scratch-session add-enemy "Enemy" --patrol --detect-player
```

**範例專案**：
```bash
# 在 scripts/ 目錄新增範例
scripts/platform-game-star-collector.mjs
scripts/scrolling-background.mjs
scripts/sprite-animation.mjs
```

### Step 5：改善文件與錯誤處理

**目標**：讓使用者能快速上手並排除問題

**實作**：
1. 新增 `TROUBLESHOOTING.md`：
   - "SB3 無法播放" 排除步驟
   - 常見錯誤訊息與解法
2. 新增 `TUTORIALS.md`：
   - 從零開始建立第一個專案
   - 建立簡單遊戲（跳躍、碰撞、計分）
3. 改善錯誤訊息：
   - 當 `inputs` 格式錯誤時，提示正確格式
   - 當 block 串接錯誤時，提示缺少的欄位

---

## 預期成果

| 改善項目 | 預期效果 |
|---------|---------|
| Step 1 | SB3 可正確在 Scratch 播放 |
| Step 2 | Hat + Body 串接自動完成，減少手動拼接 |
| Step 3 | Reporter block 支援變數與數值，減少額外建立 |
| Step 4 | CLI 提供高階指令，快速建立常見模式 |
| Step 5 | 文件完整，使用者可快速上手與排除問題 |

---

## 執行順序

1. **Step 1（優先級：高）**：修復 `inputs` 格式問題，確保 SB3 可播放
2. **Step 2（優先級：中）**：簡化 Hat + Body 串接流程
3. **Step 3（優先級：中）**：支援 reporter block 建立
4. **Step 4（優先級：低）**：提供高階指令與範例
5. **Step 5（優先級：高）**：改善文件與錯誤處理

---

## 備註

- 此計畫基於實際使用經驗，問題已復現並診斷
- 所有改善應保持向後相容（API 可新增參數，但不改變現有行為）
- 每個 Step 完成後應有測試案例驗證
