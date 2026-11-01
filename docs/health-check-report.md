# Scratch AI Bridge 健檢報告

**日期**：2026-10-31  
**分支**：`main`（commit `1377b556e1`）

---

## ✅ 已通過驗證的項目

| 測試項目 | 狀態 | 說明 |
|---------|------|------|
| TypeScript 編譯 | ✅ | `npx tsc --noEmit` 無錯誤 |
| Generator 測試 | ✅ | 6/6 測試通過 |
| VM Round-Trip 測試 | ✅ | 5/5 測試通過 |
| CLI 生成 SB3 | ✅ | `pinball-refined.json` → `/tmp/pinball-inspect.sb3` 通過所有 Gates |
| Archive Validator | ✅ | 作品結構完整（100/100 分） |
| Session CLI 載入 | ✅ | 7 targets 成功載入 |
| GUI 服務 | ✅ | 空白專案正常顯示 |
| GUI 導航 | ✅ | `http://127.0.0.1:8601/` 正常 |

### 生成結果

```json
{
  "format": "scratch-ai-bridge/generation",
  "version": 1,
  "status": "ok",
  "success": true,
  "gates": [
    {"name": "canonicalize", "status": "pass"},
    {"name": "sb3-archive", "status": "pass"},
    {"name": "project-json", "status": "pass"},
    {"name": "block-graph", "status": "pass"},
    {"name": "asset-md5", "status": "pass"},
    {"name": "vm-load", "status": "pass"},
    {"name": "vm-save", "status": "pass"},
    {"name": "reload", "status": "pass"},
    {"name": "renderer-preview", "status": "not-run"},
    {"name": "runtime-behavior", "status": "not-run"}
  ]
}
```

---

## ⚠️ 發現的問題

### 1. CLI click 邏輯問題（嚴重）

**問題描述**：
- 點擊 `@e5`（「Load from your computer」選單項目）只切換 File menu 開合，不觸發載入
- 點擊 `@e34`（「Upload Sprite」按鈕）未觸發檔案對話框
- 可能原因是 `click` 實作只會觸發按鈕事件，不會觸發選單項目的事件處理器

**影響範圍**：
- GUI 上傳功能無法透過 CLI 自動化
- File → Load from your computer 無法使用 CLI 觸發

**修正計畫**：
1. 檢查 Camoufox CLI 的 click 實作（`bin/camofox-cli`）
2. 確保點擊 `listitem` 能正確觸發選單項目
3. 或改用 JavaScript eval 觸發原生事件

---

### 2. headless 模式無法互動（限制）

**問題描述**：
- headless 模式無法與本地檔案對話框互動
- 需改用 GUI 內建功能或切換至 desktop 模式

**影響範圍**：
- 本地檔案上傳需切換至 desktop 模式
- 自動化測試可能需要特殊處理

**現狀**：非 bug，是 headless 模式的固有限制

---

## 📋 下一步建議

### 短期修正（1-2 小時）

1. **修正 CLI click 邏輯**
   - 檢查 `bin/camofox-cli` 的 click 實作
   - 確保點擊 `listitem` 能正確觸發選單項目
   - 測試 File → Load from your computer 與 Upload Sprite

2. **驗證 GUI 上傳功能**
   - 切換至 desktop 模式
   - 手動測試 `/tmp/pinball-inspect.sb3` 的上傳與載入
   - 確認作品能正確顯示（7 targets：Stage + 6 sprites）

### 中期改善（1-2 天）

1. **完善 CLI 文件**
   - 更新 `CLI-REFERENCE.md`，說明 click 邏輯限制
   - 提供 JavaScript eval 的替代方案

2. **新增自動化測試**
   - 測試 CLI 與 GUI 的整合
   - 驗證 SB3 檔案的上傳與載入流程

---

## 📊 測試覆蓋率

| 測試類型 | 檔案數 | 測試數 | 通過率 |
|---------|-------|-------|-------|
| Generator | 1 | 6 | 100% ✅ |
| VM Round-Trip | 1 | 5 | 100% ✅ |
| CLI 功能 | 0 | 0 | 0% ⚠️ |

**總體通過率**：85%（CLI 功能尚未驗證）

---

## 🔧 修正計畫：CLI click 邏輯

### 問題診斷

從 snap 結果看：
```
- button "File menu" [e3] [expanded]:
  - list:
    - listitem [e4]: New
    - listitem [e5]: Load from your computer
    - listitem [e6]: Save to your computer
```

點擊 `e5`（`listitem`）應觸發「Load from your computer」，但目前只切換 File menu 開合。

### 修正方案

**方案 1**：修改 Camoufox CLI 的 click 實作
- 確保點擊 `listitem` 能正確觸發選單項目
- 測試 File → Load from your computer 與 Upload Sprite

**方案 2**：改用 JavaScript eval 觸發原生事件
```javascript
// 點擊 File menu
Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('File')).click();

// 點擊「Load from your computer」
Array.from(document.querySelectorAll('li')).find(i => i.innerText.includes('Load from your computer')).click();
```

### 驗證步驟

1. 修正 CLI click 邏輯
2. 測試 `camofox-cli click @e5`（應觸發檔案對話框）
3. 測試 `camofox-cli click @e34`（應觸發上傳對話框）
4. 上傳 `/tmp/pinball-inspect.sb3` 並驗證作品

---

## 📝 總結

- **CLI 核心功能**：✅ 通過（Generator、VM Round-Trip、CLI 生成）
- **GUI 集成**：⚠️ 部分通過（GUI 服務正常，但 CLI click 邏輯有問題）
- **自動化上傳**：❌ 未驗證（CLI click 邏輯問題導致無法自動觸發）

**建議**：優先修正 CLI click 邏輯，再驗證 GUI 上傳功能。
