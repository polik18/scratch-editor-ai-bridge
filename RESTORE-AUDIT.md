# Scratch AI Bridge — Recovery / Integration Audit

這份工程以使用者提供的 `scratch-editor-phase2-implemented(1).zip` 為基底，而不是以先前的 standalone 8-file 版本為基底。

## 完整性

- Phase 2 原始工程檔案數：3446
- 本版工程檔案數：3468
- 原 Phase 2 檔案缺失數：**0**
- `packages/scratch-gui`：保留
- `packages/scratch-vm`：保留
- `packages/scratch-paint`：保留
- `packages/scratch-render`：保留
- `packages/scratch-storage`：保留
- 其他原 monorepo workspace：保留

`ready-to-use/` 是額外附加的直接使用版；不再取代完整工程。

## 本輪正式 source 實作

- Phase 3：完成 VM write-path 決策文件；正式路徑採 `loadProject(projectJson)` + `saveProjectSb3()`。
- Phase 4：新增 Canonical IR → Scratch project JSON compiler，並由官方 Scratch VM 載入與輸出 `.sb3`。
- Phase 5：新增 `.sb3` → 官方 VM → `toJSON()` → Canonical IR decompiler。
- Phase 6：新增 project-JSON structural round-trip test。
- Phase 7：新增 Analysis IR、broadcast dependency 與靜態 diagnostics。
- Phase 8：Analyze UI source 已接入 upload/decompile/analyze/prompt/export。
- Phase 9：Generate UI source 已接入 validate/compile/download。

## 驗證

手動 source smoke tests：

- `02-green-flag-move-say.json`：PASS
- `03-repeat-score.json`：PASS
- `04-broadcast-flow.json`：PASS

檢查內容為 Canonical IR → Scratch project JSON → Canonical IR 的 script/opcode/broadcast structural signature。

TypeScript：使用暫時 Ajv ambient shim（僅因執行環境沒有安裝 npm dependencies）執行 `tsc --noEmit`，結果 PASS。

## 尚未宣稱完成

這份 recovery integration **不把 Phase 10–15 的正式 monorepo source integration 冒充為完成**。`ready-to-use/` 中保留先前直接使用版的 Procedures / Assets / Mapping 等實驗功能，但正式 `packages/scratch-ai-bridge/src` 仍應繼續依 Phase 10–15 計畫整合與測試。
