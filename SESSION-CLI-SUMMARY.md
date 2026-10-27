# scratch-session CLI 交接總結

**日期**: 2026-10-27  
**狀態**: ✅ Phase 1 完成（CLI 功能完整實作）

---

## 完成項目

### 1. CLI 入口 (`src/cli/session-cli.ts`)
- [x] 註冊所有指令（`new`, `load`, `save`, `info`, `inspect`, `ls`, `add-sprite`, `rm-sprite`, `rename`, `add-block`, `rm-block`, `edit-block`, `add-var`, `add-list`, `attach`, `compile`, `preview`）
- [x] Sidecar file 管理（`.scratch-session.json`）
- [x] 狀態載入/儲存邏輯

### 2. Session 類別 (`src/cli/session/session.ts`)
- [x] `newProject()` - 建立新專案（Stage + blank costume）
- [x] `loadSb3()` - 從 SB3 載入
- [x] `loadProjectJson()` - 從 JSON 載入
- [x] `getProjectJson()` - 取得 project JSON
- [x] `info()` - 取得專案資訊
- [x] `inspect()` - 取得 targets 詳細資訊
- [x] `listTargets()` - 取得 targets 名稱列表
- [x] `addSprite()` - 新增 sprite
- [x] `removeSprite()` - 移除 sprite
- [x] `renameTarget()` - 重新命名 target
- [x] `addBlock()` - 新增 block
- [x] `removeBlock()` - 移除 block
- [x] `editBlock()` - 編輯 block
- [x] `addVariable()` - 新增 variable
- [x] `addList()` - 新增 list
- [x] `attachBlockToHat()` - 附加 block 到 hat
- [x] `compile()` - 編譯為 SB3 bytes（使用 `jszip`）
- [x] `saveSb3()` - 儲存為 SB3（使用 `jszip`）

### 3. UID 生成器 (`src/cli/session/uid.ts`)
- [x] `uid()` - 20 字元長度，87 字元 soup（符合 scratch-vm 規範）
- [x] `uidTarget()` - 針對 target ID 的 UID 生成

### 4. 交接文件 (`SESSION-CLI-ONBOARDING.md`)
- [x] 目標與架構說明
- [x] 指令列表與範例
- [x] 核心 API 文件
- [x] 開發環境設定
- [x] 常見問題（10 個 Q&A）
- [x] 後續開發方向（Phase 2-3）

---

## 測試結果

### 基本功能
```sh
# 建立新專案
npx tsx src/cli/session-cli.ts new MyProject
# ✓ New project "MyProject" created.

# 新增 sprite
npx tsx src/cli/session-cli.ts add-sprite Cat --x 50
# ✓ Added sprite "Cat" (id=FYw]v,AFp:NDP`ALkAo-)

# 新增 block
npx tsx src/cli/session-cli.ts add-block Cat event_whenflagclicked
# ✓ Added block event_whenflagclicked on "Cat" (id=s@k%+bA]`Xa-}!r?DzVa)

npx tsx src/cli/session-cli.ts add-block Cat motion_movesteps 10 --parent event_whenflagclicked0
# ✓ Added block motion_movesteps on "Cat" (id=dsLal]]Ac{L0crD+1%Ro)

# 編譯
npx tsx src/cli/session-cli.ts compile output.sb3
# ✓ Compiled and saved to "output.sb3"

# 儲存
npx tsx src/cli/session-cli.ts save output.sb3
# ✓ Saved to "output.sb3"

# 載入
npx tsx src/cli/session-cli.ts load output.sb3
# ✓ Loaded "output.sb3" (2 targets: Stage, Cat)
```

### 驗證項目
- [x] Sidecar file 正確生成（`.scratch-session.json` 包含 `projectJson`）
- [x] SB3 可正確讀寫（720-830 bytes，包含 project.json）
- [x] Block ID 符合 scratch-vm 規範（20 字元，87 字元 soup）
- [x] Compile 不失敗（JSON → SB3）
- [x] 跨指令狀態維持（`loadSession()` 從 sidecar 載入）

---

## 限制與待解決問題

### Phase 1 限制
- [x] 無 costume/sound 資產管理（只管理 metadata）
- [x] `preview` 只驗證 JSON，無 VM 執行
- [x] Block graph 操作需手動指定 block ID

### Phase 2 待實作
- [ ] Natural language → IR 轉譯層
- [ ] 自動補全 block
- [ ] 自動修正錯誤

### Phase 3 待實作
- [ ] Playwright 執行 SB3
- [ ] 截圖功能
- [ ] 程式碼 → SB3 → 執行 → 截圖

---

## 接手指南

### 立即可做
1. 執行 `npx tsx src/cli/session-cli.ts help` 確認指令列表
2. 執行 `npx tsx src/cli/session-cli.ts new TestProject` 建立新專案
3. 執行 `npx tsx src/cli/session-cli.ts add-sprite Cat` 新增 sprite
4. 執行 `npx tsx src/cli/session-cli.ts compile output.sb3` 編譯專案

### 程式碼結構
- `src/cli/session-cli.ts` - CLI 入口（指令解析）
- `src/cli/session/session.ts` - `ScratchSession` 類別（核心 API）
- `src/cli/session/uid.ts` - UID 生成器

### 修改注意事項
- **SB3 I/O**: 使用 `jszip`，避免 `@scratch/scratch-vm` 的 storage 依賴
- **UID 生成**: 使用 `uid()`，確保與 scratch-vm 一致
- **Sidecar file**: `.scratch-session.json` 為單一來源（包含 `projectJson`）

---

## 歷史記錄

| 日期 | 事件 |
| - | - |
| 2026-10-27 | 完成 scratch-session CLI 初始實作（Phase 1） |

---

**完成時間**: 2026-10-27 08:30 CST  
**總行數**: `session-cli.ts` (411 lines), `session.ts` (635 lines), `uid.ts` (29 lines), `SESSION-CLI-ONBOARDING.md` (318 lines)  
**測試狀態**: 全部通過
