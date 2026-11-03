# Plan Queue (2026-11-02)

**Last Updated**: 2026-11-02  
**Version**: 0.2.2  
**Status**: 🔜 待執行（4 個子計畫，共 25 個細項任務）

---

## Sub-plan A: 可編輯文字框 (Step 6)

**Status**: 🔜 待執行  
**Changes**:
- `src/main.ts:627`：移除 `placeholder` 屬性，改用 `data-placeholder` + 初始化 `value`
- `src/style.css:409-419`：新增 `[data-placeholder]::placeholder` 樣式
- （可選）新增清除按鈕 `×`

---

### A.1: 移除 placeholder 屬性

**Target Files**: `src/main.ts:627`  
**Input Contract**: `<textarea ... placeholder="例如：我想做一個關於深海探險的遊戲，主角是一條小魚。"></textarea>`  
**Action**: 移除 `placeholder` 屬性，改用 `data-placeholder` 屬性初始化提示文字  
**Verification Command**: 
```bash
npm run dev && open http://localhost:5173 | tail -n 25
# 檢查文字框可編輯，提示文字可見
```  
**Status**: 🔜 待執行

---

### A.2: 新增 CSS 樣式

**Target Files**: `src/style.css:409-419`  
**Input Contract**: 現有 `.request-input` 樣式  
**Action**: 新增 `[data-placeholder]::placeholder` 與 `:not([data-placeholder])::placeholder` 樣式  
**Verification Command**: 
```bash
npm run dev && open http://localhost:5173 | tail -n 25
# 使用開發者工具檢查 CSS 樣式
```  
**Status**: 🔜 待執行

---

## Sub-plan B: 全功能預覽 (Step 7)

**Status**: 🔜 待執行  
**Changes**:
- `src/preview/main.ts:607`：移除 `previewTimeout = window.setTimeout(stop, 120_000)`
- `src/main.ts:4098`：移除 120 秒計時器
- `src/main.ts:1700-1750`：新增 `playButton`、`stopButton`、`reloadButton`
- `src/preview/main.ts:120-145`：實作 `play()`、`restart()` 函式
- `src/preview/main.ts`：確認滑鼠/鍵盤事件傳遞
- `src/scratch/vm.ts:619-650`：檢查 `startScratchPreviewDrag` / `stopScratchPreviewDrag`

---

### B.1: 移除 120 秒預覽超時限制

**Target Files**: `src/preview/main.ts:607`, `src/main.ts:4098`  
**Input Contract**: `previewTimeout = window.setTimeout(stop, 120_000)`  
**Action**: 移除兩處 120 秒計時器設定  
**Verification Command**: 
```bash
npm run dev && sleep 130
# 預覽持續運作 > 120 秒不自動停止
```  
**Status**: 🔜 待執行

---

### B.2: 新增控制按鈕

**Target Files**: `src/main.ts:1700-1750`  
**Input Contract**: 原有 `startAnimation` 按鈕  
**Action**: 新增 `playButton`、`stopButton`、`reloadButton`  
**Verification Command**: 
```bash
npm run dev && open http://localhost:5173 | tail -n 25
# 預覽畫面顯示 3 個按鈕
```  
**Status**: 🔜 待執行

---

## Sub-plan C: AI 重修改流程 (Step 8)

**Status**: 🔜 待執行  
**Changes**:
- `src/main.ts`：新增 `#ai-iteration-panel` DOM 結構
- `src/core/capabilities/registry.ts:1047-1134`：新增 `createProjectIterationInstruction` 函式
- `src/main.ts:2200-2320`：實作 `aiIterateGenerateButton` 事件
- `src/main.ts:1006`：確保「貼回至 Scratch」流程可重複
- `src/core/capabilities/registry.ts`：更新提示模板

---

## Sub-plan D: 內建素材與音樂 (Step 9)

**Status**: 🔜 待執行  
**Changes**:
- `src/scratch/storage.ts`：確認支援 `BUILT_IN_SPRITE_VISUALS`、`BUILT_IN_BACKDROP_VISUALS`
- `packages/scratch-vm/src/blocks/scratch3_sound.js`：檢查 `play sound`、`set effect`、`play drum` 等 opcode
- `src/core/capabilities/registry.ts`：更新提示模板，加入「可使用內建素材」說明
- `src/main.ts:1530-1600`：新增 `built-in-assets` 面板
- `src/preview/main.ts:550-600`：實作 `addBuiltInAsset` 函式

---

## 驗證方式

| Task ID | Command | Expected Result |
|---------|---------|----------------|
| A.1 | `npm run dev && open http://localhost:5173` | Textbox is editable |
| B.1 | `npm run dev && sleep 130` | Preview runs > 120s |
| C.3 | `npm run dev && input "make fish faster"` | AI generates new version |
| D.4 | `npm run dev && open http://localhost:5173` | Built-in assets list visible |
