# Scratch AI Bridge：Provider API 與 MCP 雙接入計畫

日期：2026-10-31
狀態：計畫完成，尚未實作
目標：讓使用者可以在 Bridge 內使用自己選擇的 AI 模型，也可以從 Codex、Claude Desktop 等外部 AI 透過 MCP 操作 Bridge；兩條路徑共用同一組遊戲工具與安全規則。

## 使用者體驗目標

使用者可選擇：

1. **Bridge 內建 AI（Provider API）**：在 Bridge 裡輸入需求，由 Bridge 呼叫使用者設定的模型，模型可多輪檢查、提出 patch、執行 playtest，再依結果繼續修改。
2. **外部 AI（MCP）**：留在 Codex 或其他 MCP host 對話，由該 AI 呼叫 Bridge 提供的工具。
3. **不連模型**：照目前方式複製 prompt、貼回結果，或自行使用 Bridge 的編輯功能。

這是三種入口，不是三套遊戲邏輯。模型輸出一律是待驗證的資料，不能跳過 Bridge 的 validator、revision 檢查、差異預覽與套用確認。

## 名詞簡述

- **Provider API** 是 Bridge 主動向模型服務送出請求。Bridge 負責對話、工具呼叫迴圈及呈現結果。
- **MCP** 是 Bridge 對外公布工具的通用協定。外部 AI host 提供模型與對話，Bridge 不會因為支援 MCP 就自動取得模型或 key。
- **OpenAI-compatible endpoint** 是許多雲端服務及本機推論伺服器提供的相容 API 介面。使用者可填服務網址、模型 ID 及自己的憑證；相容只代表通訊格式相近，不保證每個模型都支援工具呼叫或相同品質。

## 建議架構

```text
Bridge UI ── Provider API adapter ── 使用者選定的雲端或本機模型
    │
    ├── 共用 Bridge Tool Core ── inspect / patch proposal / playtest
    │
外部 AI host ── MCP server adapter ──┘
```

### 共用 Tool Core

先將可安全呼叫的 Bridge 能力整理為與模型供應商、MCP SDK 無關的 typed tool contract。API 的 function/tool calling 與 MCP tools 都只負責轉接至這個核心，不能各自實作另一份修改規則。

第一批工具：

- `inspect_project`：取得目前作品摘要、選取角色及指定範圍的積木資訊。
- `inspect_playtest`：讀取使用者已執行的測試結果與錯誤摘要。
- `propose_live_patch`：產生帶有 `baseRevision` 的待審 patch。
- `run_playtest_scenario`：執行受限、可取消的測試情境。
- `get_patch_status`：查候選 patch 的驗證及套用狀態。

第一版不提供模型直接執行 `apply_patch`、任意 JavaScript、任意 Scratch opcode、shell、任意檔案讀寫、任意網址抓取或帳號 API。使用者必須在 Bridge 看到修改差異並確認後才套用。

## Provider API：可接使用者自己的模型

### Provider 設定

設定頁支援多個可命名設定檔，每個設定檔包含：

- 連線類型：預設雲端 provider，或 OpenAI-compatible 自訂 endpoint。
- API base URL、model ID、使用者提供的 API key（可選，依服務要求）。
- 可選的服務端額外參數需經明確 allowlist；不得讓任意 header、任意 URL scheme 或請求轉址繞過安全檢查。
- 連線測試、模型能力摘要（tool calling / structured output / context window 若 provider 可回報）、啟用狀態及刪除設定。

支援本機模型服務（例如使用者自行架設的 OpenAI-compatible server），但連線位置、CORS、HTTPS/localhost 限制及工具呼叫能力須在實作時逐平台驗證。對不支援 tool calling 的模型提供「生成 patch JSON」的降級流程，仍須通過相同 validator，不假裝它具備原生工具能力。

### 憑證與請求安全

- Hosted 靜態網頁不持有或永久儲存 API key。API 請求經本機 companion/provider gateway；憑證使用 OS credential store 或使用者明確選擇的短期記憶方式。若無 companion，提供清楚的手動 prompt 流程，不把 key 放進 bundle、localStorage、IndexedDB、URL 或診斷紀錄。
- 本機 gateway 限制 origin、綁定 loopback、採短效配對 token、限制允許 endpoint 與 redirect，並提供撤銷/停止服務方式。自訂 endpoint 輸入須防 SSRF：瀏覽器直連只連使用者指定 origin；gateway 不可盲目代理任意第三方 URL。
- 每次請求清楚顯示 provider、model、送出的遊戲資料摘要和請求次數；可取消、限制輪數/時間/輸出大小。費用估算若 provider 不提供可靠價格，不顯示假精確數字。
- 對話只保存使用者明確選擇的必要內容；診斷資訊不含 key、完整 prompt、SB3 素材或私密作品內容。

## MCP：讓外部 AI 操作 Bridge

### 部署方式

- **第一版採本機 stdio MCP server**，由 MCP host 啟動 Bridge companion 子程序。適合 Codex、桌面 AI 與 IDE；不需讓公網服務暴露本機 Scratch 專案。
- 將工具核心與 MCP transport 分離。未來若要讓遠端 MCP host 連接，再另加 Streamable HTTP、身分驗證、配對/授權、來源限制與多 session 隔離；不把開發用無驗證 HTTP server 當成正式功能。
- MCP host 支援與設定方式依各 host 實際能力驗證；MCP 是標準介面，不代表所有 host 的 UI、同意提示、資源處理都一致。

### MCP 工具範圍

- MCP tools 只映射共用 Tool Core 上已允許的操作。
- `propose_live_patch` 只產生待審 patch。模型不能藉由連續呼叫或工具描述文字推定已有套用授權。
- 專案讀取限目前由使用者明確選取並開啟的 project/session；不提供任意本機路徑存取。
- MCP 呼叫必須帶 project/session identity 及 revision；切換專案、過期 revision、未知工具或超額呼叫一律回明確錯誤，不猜測目標。
- Bridge UI 顯示目前連線的 host、可用工具、最近呼叫、資料摘要及停止連線控制；使用者可逐項停用寫入提案或 playtest 工具。

## 共通安全與品質規則

1. **讀取與修改分層**：模型可以在授權範圍內讀取摘要和測試結果；patch 必須是候選資料；套用由 Bridge UI 的人工確認控制。
2. **最小上下文**：只提供目前任務所需的 brief、相關角色/積木片段、revision 與最近測試結果；不預設傳送全部 assets、全部腳本或完整 SB3。
3. **共同驗證**：API 與 MCP 使用同一 schema、capability registry、patch validator、stale revision gate、undo/revision chain 和 playtest sandbox。
4. **資源限制**：對話輪數、tool call 數、payload bytes、執行時間、取消與重複請求 idempotency 均有上限。
5. **可回復性**：provider/MCP 中斷不損壞現有遊戲；可回到手動 copy/paste、拒絕候選 patch、撤銷已套用 revision。
6. **端點界線**：模型只能使用 allowlist tools；任何外部內容視為不可信輸入，不可藉 prompt injection 提升權限。

## 實施階段與完成條件

### Phase 0：需求與介面契約

- 盤點現有 live patch、playtest、project session、local companion 能力及目前 hosted Pages 限制。
- 定義共用 tool schema、錯誤碼、revision/project identity、取消與事件記錄欄位。
- 釐清首次使用：本機 companion 由誰安裝/啟動、key 如何輸入/刪除、目前作品如何授權給 MCP session。
- 輸出威脅模型及資料流圖；在此之前不讀取或使用任何 API key。

**完成條件**：API 與 MCP 對同一組 fixture 產生相同的 tool inputs/outputs，並有明確確認邊界。

### Phase 1：抽取共用 Tool Core

- 將現有 UI/bridge actions 包成 typed、可測的核心服務；保留現有 UI 呼叫方式。
- 為每個工具定義 JSON schema、資料大小上限、revision 條件、權限需求與副作用分類。
- 建 fake host 測試未授權、未知工具、stale revision、錯誤 payload、重複呼叫、取消及超額。

**完成條件**：不需 provider/MCP 即能透過測試 harness 驗證全套工具與安全行為。

### Phase 2：Provider API 與自訂模型

- 完成 provider-neutral tool loop 與可插拔 adapter：先做 OpenAI-compatible endpoint adapter，再依需求加原生 provider adapter。
- 加入模型設定、憑證生命週期、連線測試、錯誤分類、請求取消和手動 JSON fallback。
- 以 mock endpoint 驗證不同工具呼叫格式、相容性差異、壞 JSON、timeout、rate limit 與不支援 tool calling 的回退。
- 使用真實 provider smoke test 前，先由使用者明確選擇要使用/重用的 credential；不得從環境變數自動選 key。

**完成條件**：使用者能設定自己的 endpoint/model，在 Bridge 內完成「描述需求 → 多輪工具操作 → patch 候選 → 差異確認 → 套用 → playtest → 依結果再修」；憑證不出現在瀏覽器持久儲存、建置產物或 logs。

### Phase 3：本機 stdio MCP

- 增加 companion MCP server，將 allowlist tools 映射至共用 Tool Core。
- 定義 host 啟動/關閉、目前 project/session 配對、權限提示、錯誤回傳、版本相容性和日誌清理。
- 以 MCP SDK client 測試工具 discover/call、schema、並行呼叫、專案切換、host 斷線、patch 確認隔離及 tool limits。
- 撰寫 Codex 等 host 的設定與移除步驟，不預設任何 host 已有對 Bridge 的存取權。

**完成條件**：外部 host 可發現工具並提出 patch，Bridge 能正確要求使用者確認；host 無法直接套用 patch 或存取未選取專案。

### Phase 4：雙路徑整合與文件

- 同一 project 同時連 Provider API 與 MCP 時，避免 session/revision race；一方套用變更後另一方舊候選必須因 revision 過期而失效。
- Bridge UI 可暫停或撤銷任一連線，並辨識候選 patch 來源（provider/profile 或 MCP host）。
- 增加 API/MCP 隱私說明、故障排除、key 刪除、host 停用、離線降級及使用者資料流示意。
- 更新 README、部署文件、功能矩陣與安全測試說明。

**完成條件**：API、MCP、手動模式可切換；跨模式 stale patch、取消、拒絕、撤銷與離線行為均有測試與使用者可見狀態。

### Phase 5（可選）：遠端 MCP

- 只有明確需要跨裝置/遠端 host 時才設計 Streamable HTTP。
- 要求可撤銷的使用者授權、每 host identity、TLS、來源/速率限制、session 隔離、token rotation、資料保留政策及部署監控。
- 不共用瀏覽器 session cookie、不允許未驗證公網工具端點、不把 MCP transport token 當成模型 API key。

**完成條件**：完成獨立安全審查與多租戶/身分驗證驗收後才可公開部署。

## 建議先後順序

1. Phase 0 → Phase 1：先讓 Bridge 能力不綁 UI、provider 或 MCP。
2. Phase 2：先滿足「直接在 Bridge 使用自選模型」，先以 OpenAI-compatible endpoint 覆蓋雲端及自架服務。
3. Phase 3：提供 MCP，讓使用者選擇沿用 Codex/其他 host。
4. Phase 4：整合雙模式與文件。
5. Phase 5 僅在出現遠端使用需求後評估。

選這個順序是因為 API 直連符合 Bridge 內直接創作的使用目標；先做共用 Tool Core 後，MCP 不會複製或削弱既有安全規則。MCP 可與 API 並存，並非二選一。

## 風險與未決事項

- OpenAI-compatible 不等於完全相容；model tool calling、schema 支援、streaming、token usage 及錯誤格式各家不同，需能力探測與相容性測試，不可只按廠牌猜測。
- 本機模型 endpoint 的安全性由使用者部署環境影響；Bridge 必須限制連線，但不能保證第三方 server 的可靠性或資料處理方式。
- Local companion 的安裝、更新、code signing、跨平台 credential store 與 localhost 來源驗證是實際工程成本。開始 provider API 開發前仍須依 credential gate 確認使用者選擇，不得自行使用現存環境憑證。
- stdio MCP 通常需要使用者設定 host 啟動子程序；每種 host 設定格式/授權 UI 不盡相同，需分別驗證。
- 遠端 HTTP MCP 會大幅增加認證與營運範圍，不列入 MVP。

## 相關文件

- 現有其他剩餘能力計畫（SB3 raw patch、checkpoint、Scratch cloud）：[`REMAINING-CAPABILITIES-PLAN.md`](REMAINING-CAPABILITIES-PLAN.md)
- 現有 live editing 計畫：[`LIVE-EDITING-PLAN.md`](LIVE-EDITING-PLAN.md)
- 專案 AI agent 現況：[`packages/scratch-ai-bridge/docs/AI-AGENT-HANDOFF.md`](../../../packages/scratch-ai-bridge/docs/AI-AGENT-HANDOFF.md)
- MCP 官方架構與 host/client/server 概念：[MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- MCP 官方 transport 文件：[MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
