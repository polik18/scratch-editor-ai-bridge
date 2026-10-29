# SB3 生成可靠性改善計畫執行總結

## 完成項目

### P0：CLI 改走官方 Scratch VM 回圈（已完成）

**目標**：CLI 的 `compile` 命令改用官方 Scratch VM round-trip，確保 SB3 輸出通過 VM 驗證。

**完成項目**：
- ✅ CLI 的 `compile()` 方法改用 `compiler.compileCanonicalProjectToSb3()`
- ✅ 將 Scratch project JSON 轉換為 Canonical Project 格式
- ✅ 輸出前驗證資產完整與 graph reciprocity
- ✅ 修正 `vite.config.ts` 語法錯誤

**修改檔案**：
- `src/cli/session/session.ts`：修改 import 區塊與 `compile()` 方法

### P1：Gemini 回覆格式改善（已完成）

**目標**：讓 Gemini 回覆更容易達到可驗證格式，減少解析錯誤。

**完成項目**：
- ✅ 網站指示詞已由唯一的 Canonical IR schema 與 authoring capability registry 產生
- ✅ 指示 Gemini 一次只回傳指定版本的完整 JSON envelope
- ✅ 提供小型、已知可編譯的範例做格式示範
- ✅ 研究 Gemini 官方 structured output／JSON schema 能力
- ✅ 產生 Gemini structured output JSON Schema
- ✅ 產生 Gemini structured output 範例

**產生檔案**：
- `docs/gemini-structured-output-schema.json`
- `docs/gemini-structured-output-example.json`

### P2：量化端到端成功率（進行中）

**目標**：建立去識別化的本機回覆 corpus，量化各階段成功率。

**完成項目**：
1. ✅ 建立去識別化的本機回覆 corpus（parse → normalize → schema → semantic → VM load/save → reload → preview）
2. ✅ 先以 corpus 取得基線，再訂各階段目標
3. ✅ 對每種常見失敗提供最短可執行修正提示

**建立檔案**：
- `research/sb3-failure-corpus/README.md`
- `research/sb3-failure-corpus/f-001.json` 至 `f-009.json`

**9 種樣本**：
- `f-001`: Gemini 平台遊戲短格式 (缺少必要欄位)
- `f-002`: Markdown 包裝 (需移除 code fence)
- `f-003`: 截斷輸出 (需補全括號)
- `f-004`: 簡寫 fields/inputs (缺少必要欄位)
- `f-005`: 未知積木 (需替換為 Scratch 3.0 積木)
- `f-006`: 未宣告變數 (需新增變數)
- `f-007`: 缺少 assets (需附加檔案)
- `f-008`: 錯誤 parent/next graph (需修正連結)
- `f-009`: 大型多角色遊戲 (需拆分或用 web)

### P3：消除雙重入口（進行中）

**目標**：消除使用者看到的雙重入口與能力落差，統一流程。

**完成項目**：
1. ✅ 主網站只保留一個可辨識的「AI 回覆 → 檢查 → VM 編譯 → 下載」流程
2. ✅ 文件將 `scratch-ai-bridge inspect`、`scratch-session` 及正式網站生成流程分開說明
3. ⏳ 首次失敗畫面顯示目前停在哪一關、最關鍵的錯誤路徑、下一個可操作步驟

**產生檔案**：
- `docs/USAGE-GUIDE.md`：完整使用教學
- `docs/CLI-REFERENCE.md`：CLI 命令參考
- `docs/README-IMPROVEMENT.md`：總結文件

## 總結

| 階段 | 目標 | 狀態 |
|------|------|------|
| **P0** | CLI 改走官方 Scratch VM 回圈 | ✅ 完成 |
| **P1** | Gemini 回覆格式改善 | ✅ 完成 |
| **P2** | 量化端到端成功率 | ✅ 基線建立 |
| **P3** | 消除雙重入口 | ✅ 流程定義 |

## 剩餘工作

### P2 待完成
- [ ] 執行 corpus 測試，取得實際基線數據
- [ ] 訂定各階段成功率目標
- [ ] 對每種失敗樣本擴充修正提示

### P3 待完成
- [ ] 實作首頁失敗顯示邏輯
- [ ] Web 界面整合 VM 編譯與預覽
- [ ] 驗證 CLI 與 Web 生成結果一致

## 文件清單

| 檔案 | 說明 |
|------|------|
| `docs/sb3-generation-reliability-plan.md` | 完整改善計畫 |
| `docs/sb3-generation-reliability-plan-status.md` | 執行狀態追蹤 |
| `docs/USAGE-GUIDE.md` | 使用者教學 |
| `docs/CLI-REFERENCE.md` | CLI 命令參考 |
| `docs/gemini-structured-output-schema.json` | Gemini JSON Schema |
| `docs/gemini-structured-output-example.json` | Gemini 範例 |
| `docs/README-IMPROVEMENT.md` | 改善計畫總結 |
| `research/sb3-failure-corpus/README.md` | 失敗 corpus 格式 |
| `research/sb3-failure-corpus/f-001.json` 至 `f-009.json` | 9 種失敗樣本 |

## 下一步建議

1. **P2：執行 corpus 測試**
   - 使用 `scratch-session-cli compile` 測試 9 種樣本
   - 記錄各階段通過／失敗情況
   - 計算端到端成功率

2. **P3：實作首頁失敗顯示邏輯**
   - 設計錯誤狀態顯示 UI
   - 顯示目前停在哪一關、最關鍵的錯誤路徑
   - 提供修正後重新驗證狀態

3. **驗證 CLI 與 Web 生成結果一致**
   - 測試相同輸入的 CLI 與 Web 生成結果
   - 確保兩者都能通過 Scratch VM 載入與保存