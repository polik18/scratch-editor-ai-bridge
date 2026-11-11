# scratch-session CLI 交接計畫

**版本**: 2026-10-27  
**負責人**: Hermes Agent  
**目標**: 讓後續 agent 可無痛接手 `scratch-session` CLI 的開發與維護

---

## 目標

建立一個有狀態的 Scratch 專案 CLI，讓 AI agent 可以：

1. **建立/載入 Scratch 專案**
2. **新增/移除 sprite**
3. **新增/編輯/移除 block**
4. **新增 variable / list**
5. **編譯專案為 .sb3**
6. **驗證專案正確性**

所有操作透過 CLI 指令完成，狀態由 sidecar file 維持，支援跨指令的 session。

---

## 技術架構

### 核心元件

| 檔案 | 職責 |
| - | - |
| `src/cli/session/session.ts` | `ScratchSession` 類別，提供 session API (`newProject`, `addSprite`, `addBlock`, `compile`, `saveSb3` 等) |
| `src/cli/session-cli.ts` | CLI 入口，解析指令並呼叫 `ScratchSession` 方法 |
| `src/cli/session/uid.ts` | UID 生成器，符合 `@scratch/scratch-vm` 規範（20 字元，87 字元 soup） |

### 狀態管理

- **Sidecar file**: `.scratch-session.json`（專案目錄內）
- **內容**:
  ```json
  {
    "projectPath": null | "/path/to/project.sb3",
    "lastModified": "ISO8601 timestamp",
    "projectJson": { /* Scratch project JSON */ }
  }
  ```
- **載入邏輯**:
  1. 若 `projectPath` 存在且檔案存在 → 載入 `.sb3` → 解包 `project.json`
  2. 否則 → 載入 `projectJson`（new project）
  3. 否則 → 建立 new project

### 序列化

- **SB3 讀取**: 使用 `jszip` 解包 `.sb3` → 提取 `project.json`
- **SB3 寫入**: 使用 `jszip` 打包 `project.json` → 生成 `.sb3`
- **不依賴 `@scratch/scratch-vm`**: 避免 VM 的 storage module 依賴（瀏覽器環境）

---

## CLI 指令

### 語法

```sh
cd packages/scratch-ai-bridge
npx tsx src/cli/session-cli.ts <command> [args...]
```

### 指令列表

| 指令 | 參數 | 說明 |
| - | - | - |
| `new [name]` | `name` (optional) | 建立新專案 |
| `load <file.sb3>` | `file.sb3` | 載入 SB3 檔案 |
| `save [file.sb3]` | `file.sb3` (optional) | 儲存 SB3 |
| `info` | — | 顯示專案資訊 |
| `inspect` | — | 顯示完整 project JSON |
| `ls` | — | 列出 targets 與統計 |
| `add-sprite <name>` | `name`, `--x`, `--y`, `--direction`, `--visible`, `--draggable`, `--size` | 新增 sprite |
| `rm-sprite <name>` | `name` | 移除 sprite |
| `rename <old> <new>` | `oldName`, `newName` | 重新命名 |
| `add-block <target> <opcode>` | `target`, `opcode`, `--field KEY VAL`, `--input KEY BLOCKID SHADOWID`, `--parent ID`, `--next ID` | 新增 block |
| `rm-block <target> <blockId>` | `target`, `blockId` | 移除 block |
| `edit-block <target> <blockId>` | `target`, `blockId`, `--field KEY VAL`, `--input KEY BLOCKID SHADOWID`, `--parent ID`, `--next ID` | 編輯 block |
| `add-var <target> <name>` | `target`, `name`, `value` (optional) | 新增 variable |
| `add-list <target> <name>` | `target`, `name`, `value...` (optional) | 新增 list |
| `attach <target> <hat> <body>` | `target`, `hatOpcode`, `bodyBlockId` | 將 block 附加到 hat |
| `compile [output.sb3]` | `output.sb3` (optional) | 編譯為 SB3 |
| `preview [output.png]` | `output.png` (optional) | 預覽（目前只驗證 JSON） |

### 指令實作模式

```typescript
commands: Record<string, CommandHandler> = {
  async new(argv) {
    // 1. 建立新 session
    const sess = new ScratchSession();
    sess.newProject(argv[0] ?? 'Untitled');

    // 2. 儲存至 sidecar
    await saveSession(sess);

    // 3. 回傳訊息
    console.log(`✓ New project "${argv[0] ?? 'Untitled'}" created.`);
  },

  async addSprite(argv) {
    // 1. 載入現有 session
    const sess = await loadSession();

    // 2. 修改 session
    const id = sess.addSprite(argv[0], { x: 0, y: 0, ... });

    // 3. 儲存
    await saveSession(sess);

    // 4. 回傳訊息
    console.log(`✓ Added sprite "${argv[0]}" (id=${id})`);
  },
};
```

---

## 核心 API

### `ScratchSession` 類別

| 方法 | 簽名 | 說明 |
| - | - | - |
| `newProject(name?)` | `newProject(name?: string): void` | 建立新專案（Stage + blank costume） |
| `loadSb3(path)` | `loadSb3(path: string): Promise<void>` | 從 SB3 載入 |
| `loadProjectJson(json)` | `loadProjectJson(json: Record<string, unknown>): void` | 從 JSON 載入 |
| `getProjectJson()` | `getProjectJson(): Record<string, unknown>` | 取得 project JSON |
| `info()` | `info(): SessionInfo` | 取得專案資訊 |
| `inspect()` | `inspect(): InspectResult` | 取得 targets 詳細資訊 |
| `listTargets()` | `listTargets(): string[]` | 取得 targets 名稱列表 |
| `addSprite(name, opts?)` | `addSprite(name: string, opts?: AddSpriteOptions): string` | 新增 sprite |
| `removeSprite(name)` | `removeSprite(name: string): void` | 移除 sprite |
| `renameTarget(old, new)` | `renameTarget(old: string, new: string): void` | 重新命名 target |
| `addBlock(target, opcode, opts?)` | `addBlock(target: string, opcode: string, opts?: BlockOptions): string` | 新增 block |
| `removeBlock(target, blockId)` | `removeBlock(target: string, blockId: string): void` | 移除 block |
| `editBlock(target, blockId, opts?)` | `editBlock(target: string, blockId: string, opts?: BlockOptions): void` | 編輯 block |
| `addVariable(target, name, value)` | `addVariable(target: string, name: string, value: number | string): string` | 新增 variable |
| `addList(target, name, values?)` | `addList(target: string, name: string, values?: (number | string)[]): string` | 新增 list |
| `attachBlockToHat(target, hatOpcode, bodyBlockId)` | `attachBlockToHat(target: string, hatOpcode: string, bodyBlockId: string): void` | 附加 block 到 hat |
| `compile()` | `compile(): Promise<Uint8Array>` | 編譯為 SB3 bytes |
| `saveSb3(path?)` | `saveSb3(path?: string): Promise<string>` | 儲存為 SB3 |

---

## 開發環境設定

### 安裝依賴

```sh
cd /Users/huangjianzhe/Git/scratch-editor-ai-bridge
npm ci
```

### 開發指令

```sh
# 執行 CLI
npx tsx src/cli/session-cli.ts new TestProject

# 執行測試（若已實作）
npm test --workspace=packages/scratch-ai-bridge

# 建置（若需要）
npm run build --workspace=packages/scratch-ai-bridge
```

### 套件依賴

| 套件 | 用途 |
| - | - |
| `jszip` | SB3 解包/打包 |
| `@types/jszip` | TypeScript 型態 |
| `tsx` | TypeScript 執行環境（CLI 使用） |

---

## 常見問題

### Q3: Block ID 如何生成？

**A**: 使用 `uid()`（從 `src/cli/session/uid.ts`），符合 `@scratch/scratch-vm` 規範：
- 長度: 20 字元
- 字元集: `!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_abcdefghijklmnopqrstuvwxyz{|}~`（87 字元）
- 演算法: 參考 `scratch-vm/src/util/uid.js` 的 87 字元 soup + 洗牌
- 目的: 避免 ID 衝突（與 Scratch VM 一致）

### Q4: 如何找到 existing block 的 ID？

**A**: 使用 `inspect` 指令，輸出為 JSON，包含所有 block 的 ID。範例：

```json
{
  "targets": [
    {
      "name": "Cat",
      "blocks": {
        "pxzOYA^,1|/YY4p[Pa@1": {
          "opcode": "motion_movesteps",
          "inputs": {
            "STEPS": {
              "block": null,
              "shadow": "math_number"
            }
          }
        }
      }
    }
  ]
}
```

### Q5: 為什麼 `add-block` 的 `--parent` 指令要指定 block ID 而不是 block index？

**A**: Scratch 的 block graph 是 linked list（`next` pointer），不是 array。每個 block 有唯一 ID，`parent` 指定要附加到哪個 hat block（hat 是 parent），`next` 指定下一個 block。這與 Scratch UI 的 drag-and-drop 行為一致。

### Q6: 如何修改 existing block 的輸入值？

**A**: 使用 `edit-block` 指令，指定 `--field KEY VAL`。範例：

```sh
# 將 motion_movesteps 的 STEPS 從 20 改為 50
npx tsx src/cli/session-cli.ts edit-block Cat pxzOYA^,1|/YY4p[Pa@1 --field STEPS 50
```

### Q7: `compile` 與 `save` 有什麼差異？

**A**:
- `compile`: 只驗證 JSON 並產生 SB3 bytes（不寫入磁碟），用於快速檢查專案是否有效
- `save`: 寫入磁碟並更新 sidecar file 的 `projectPath`，用於永久儲存

### Q8: 如何添加 costume 或 sound？

**A**: 目前不支援（Phase 1 的限制）。Costume/sound 需要 asset data（base64 encoded），目前 `ScratchSession` 只管理 metadata。未來需擴充 `addCostume()` / `addSound()` API。

### Q9: `preview` 指令目前可以做什麼？

**A**: 目前只驗證 JSON 並輸出警告訊息（VM 無 storage module）。未來將整合 Playwright 來：
1. 載入 SB3
2. 執行程式碼
3. 截圖

### Q10: Sidecar file 會被 Git 追蹤嗎？

**A**: 不會。應加入 `.gitignore`：
```
.scratch-session.json
*.scratch-session.json
```

---

## 後續開發方向

### Phase 1: 完成 CLI 功能（✅ 已完成）
- [x] Session 管理（`newProject`, `loadSb3`, `loadProjectJson`）
- [x] Sprite 管理（`addSprite`, `removeSprite`, `renameTarget`）
- [x] Block 管理（`addBlock`, `removeBlock`, `editBlock`）
- [x] Variable / List 管理（`addVariable`, `addList`）
- [x] Hat wiring（`attachBlockToHat`）
- [x] SB3 I/O（`compile`, `saveSb3`）
- [x] Sidecar file 管理（`.scratch-session.json`）

### Phase 2: AI Agent 整合（待實作）
- [ ] Natural language → IR 轉譯層
- [ ] 自動補全 block
- [ ] 自動修正錯誤

### Phase 3: Preview Integration（待實作）
- [ ] Playwright 執行 SB3
- [ ] 截圖功能
- [ ] 程式碼 → SB3 → 執行 → 截圖

---

## 交接清單

### 必讀文件
- [x] `AGENTS.md`（本檔案）
- [x] `src/cli/session-cli.ts`（CLI 主程式）
- [x] `src/cli/session/session.ts`（Session API）
- [x] `src/cli/session/uid.ts`（UID generator）

### 必測指令
```sh
# 建立新專案
npx tsx src/cli/session-cli.ts new TestProject

# 新增 sprite
npx tsx src/cli/session-cli.ts add-sprite Sprite1 --x 100

# 新增 block
npx tsx src/cli/session-cli.ts add-block Sprite1 motion_movesteps 10

# 編譯
npx tsx src/cli/session-cli.ts compile output.sb3
```

### 必驗證項目
- [x] Sidecar file 正確生成（`.scratch-session.json`）
- [x] SB3 可正確讀寫
- [x] Block ID 符合 scratch-vm 規範
- [x] Compile 不失敗（JSON → SB3）

---

## 歷史記錄

| 日期 | 事件 |
| - | - |
| 2026-10-27 | 完成 scratch-session CLI 初始實作 |
