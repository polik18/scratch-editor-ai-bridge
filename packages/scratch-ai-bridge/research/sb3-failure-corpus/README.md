# SB3 生成失敗 corpus

## 概述

- **版本**: 1.0
- **建立日期**: 2026-10-28
- **總樣本數**: 9 (P2 基線樣本)
- **去識別化**: 所有樣本已移除使用者姓名、專案名稱、資產內容等個人識別資訊

## 样本結構

每個樣本包含：
1. `id`: 去識別化 ID (e.g., `f-001`)
2. `source`: 來源 (e.g., `gemini-platformer-shorthand`)
3. `format`: 回覆格式 (e.g., `canonical-ir`, `ai-response`)
4. `parse`: 解析是否成功
5. `normalize`: 正規化是否成功
6. `schema`: Schema 驗證是否成功
7. `semantic`: 語意驗證是否成功
8. `vm_compile`: VM 編譯是否成功
9. `vm_reload`: VM 重新載入是否成功
10. `preview`: 預覽是否成功
11. `error_code`: 首要錯誤碼
12. `error_message`: 錯誤訊息
13. `error_location`: 錯誤位置 (JSON Pointer)
14. `fix_prompt`: 最短可執行修正提示

## 樣本列表

### f-001: Gemini 平台遊戲短格式
- **來源**: `tests/fixtures/gemini-platformer-shorthand.json`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ⚠️ (需擴充)
  - `semantic`: ⚠️ (需擴充)
  - `vm_compile`: ❌ (待測試)
  - `vm_reload`: ❌ (待測試)
  - `preview`: ❌ (待測試)
- **錯誤碼**: `MISSING_REQUIRED_FIELDS`
- **錯誤訊息**: 缺少必要欄位 (`stage.variables`, `stage.costumes`, `sprites[].x`, `sprites[].y` 等)
- **錯誤位置**: `/stage`, `/sprites/0`, `/sprites/1`, `/sprites/2`, `/sprites/3`
- **修正提示**: 補上 `stage.variables`, `stage.costumes`, `sprites[].x`, `sprites[].y` 等必要欄位

### f-002: Markdown 包裝
- **來源**: `markdown-wrapped-response`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ⚠️
  - `semantic`: ⚠️
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `MARKDOWN_WRAPPED_JSON`
- **錯誤訊息**: AI 回覆包含 Markdown code fence (```json ... ```)，需先提取 JSON 內容
- **錯誤位置**: `/meta/origin`
- **修正提示**: 移除 Markdown code fence (```json ... ```)，直接輸出純 JSON

### f-003: 截斷輸出
- **來源**: `truncated-output`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ⚠️
  - `normalize`: ⚠️
  - `schema`: ❌
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `TRUNCATED_OUTPUT`
- **錯誤訊息**: AI 回覆因 token 限制被截斷，導致 JSON 不完整
- **錯誤位置**: `/meta/truncation`
- **修正提示**: 增加 token 限制或使用多輪對話分段輸出；若已截斷，補全缺失的括號與欄位

### f-004: 簡寫 fields/inputs
- **來源**: `shorthand-fields`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ❌
  - `schema`: ❌
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `MISSING_REQUIRED_FIELDS`
- **錯誤訊息**: 缺少必要欄位 (stage.variables, stage.costumes, sprites[].x, sprites[].y, sprites[].currentCostumeIndex)
- **錯誤位置**: `/stage, /sprites/0`
- **修正提示**: 補上 stage.variables, stage.costumes, sprites[].x, sprites[].y, sprites[].currentCostumeIndex

### f-005: 未知積木
- **來源**: `unknown-blocks`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ✅
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `UNSUPPORTED_BLOCKS`
- **錯誤訊息**: 包含未支援的積木類型 (procedures_definition, data_listof, data_replaceitemoflist)
- **錯誤位置**: `/sprites/0/scripts`
- **修正提示**: 替換未支援積木為 equivalent Scratch 3.0 積木；或移除該功能

### f-006: 未宣告變數
- **來源**: `undefined-variables`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ✅
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `UNDEFINED_VARIABLE`
- **錯誤訊息**: 變數 'score' 未宣告即使用於 'change score by 1' 與 'set score to 0'
- **錯誤位置**: `/sprites/0/scripts`
- **修正提示**: 在 stage 或 sprites[0].variables 中新增 'score' 變數

### f-007: 缺少 assets
- **來源**: `missing-assets`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ✅
  - `semantic`: ✅
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `MISSING_ASSETS`
- **錯誤訊息**: Costume 'costume1' md5 'abc123' 不存在於 archive
- **錯誤位置**: `/stage/costumes/0, /sprites/0/costumes/0`
- **修正提示**: 新增對應的 md5 'abc123' 與 'def456' 的 costume 檔案至 archive

### f-008: 錯誤 parent/next graph
- **來源**: `broken-parent-next-graph`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ✅
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `BROKEN_GRAPH`
- **錯誤訊息**: Block graph 中 next 與 parent 連結中斷
- **錯誤位置**: `/sprites/0/scripts/0/block1, /sprites/0/scripts/0/block2`
- **修正提示**: 修正 next 與 parent 指向：block1.next 指向 block2；block2.parent 指向 block1

### f-009: 大型多角色遊戲
- **來源**: `large-multi-sprite-game`
- **格式**: `scratch-ai-bridge/canonical-ir`
- **結果**:
  - `parse`: ✅
  - `normalize`: ✅
  - `schema`: ✅
  - `semantic`: ❌
  - `vm_compile`: ❌
  - `vm_reload`: ❌
  - `preview`: ❌
- **錯誤碼**: `SIZE_LIMIT_EXCEEDED`
- **錯誤訊息**: Sprite 數量 15 超過 CLI 限制 (預設 5)；總 block 數 850 超過限制 (預設 200)
- **錯誤位置**: `/sprites, /sprites/*/scripts`
- **修正提示**: 拆分大型專案為多個小專案；或使用 web 界面而非 CLI 生成

## 執行步驟

1. **Parse**: 解析 JSON
2. **Normalize**: 正規化格式
3. **Schema**: 驗證 Schema
4. **Semantic**: 驗證語意
5. **VM Compile**: VM 編譯
6. **VM Reload**: VM 重新載入
7. **Preview**: 預覽

## 待擴充樣本

- [ ] f-010: AI 回覆格式錯誤 (非 canonical-ir)
- [ ] f-011: JSON Schema 驗證錯誤 (欄位類型不符)
- [ ] f-012: 重複的 block ID

## 下一步

1. 以現有樣本取得基線 (P2 完成)
2. 訂各階段目標
3. 對每種常見失敗提供最短可執行修正提示 (P2 完成)
4. 建立端到端測試流程 (P2 完成)
5. 消除雙重入口，統一「AI 回覆 → 檢查 → VM 編譯 → 下載」流程 (P3 待執行)
6. 文件分離：CLI (`inspect`, `session`) vs. web workflow (P3 待執行)