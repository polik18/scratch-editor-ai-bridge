# Scratch AI Bridge 剩餘能力研究與實作計畫

日期：2026-10-31
狀態：研究完成、待執行
範圍：模型 provider 直連、原始 SB3 live patch、Scratch cloud variable sync、遊戲進度保存。本文件是研究基礎；provider 本機 MVP 已實作，其餘狀態與更新後實施順序以 [整合計畫](SB3-SAVE-REMOTE-PLAN.md) 為準。

Provider 直連現已擴充為「使用者自選模型 API + 外部 AI 的 MCP」雙接入；Tool Core、API/自訂模型、stdio MCP 的獨立階段與安全邊界詳見 [`AI-PROVIDER-AND-MCP-PLAN.md`](AI-PROVIDER-AND-MCP-PLAN.md)。本文件其餘 SB3、cloud sync、checkpoint 計畫仍有效。

## 決策摘要

四項能力不能合併成一個「開啟 AI／雲端」開關，因為它們的信任邊界不同：

1. **Provider 直連**：模型能提出與執行 Bridge tools，但模型回覆永遠只是資料；修改仍經 Bridge validator、revision gate、diff 與使用者確認。
2. **原始 SB3 live patch**：直接修改 SB3 的 `project.json`/block graph 並保留原 ZIP 資產與未知欄位，不先轉成 Canonical IR 再重編譯。另存新版本，不覆寫原檔。
3. **Cloud sync**：只同步 Scratch 定義的 cloud scalar variables；必須有受支援的使用者驗證、專案識別與修改權限。它不是進度存檔服務。
4. **遊戲進度保存**：第一版保存可辨識的本機 checkpoint，明確標示重啟/綠旗後恢復；不宣稱可以序列化任意 VM 執行緒、clone、extension 或做到無縫續跑。

### 建議落地次序

1. 先定義共同的 project fingerprint、revision、保存/匯出、操作審核與資料保留契約。
2. 建立 raw SB3 專用 patch adapter，先支援低風險 runtime/target 欄位；再處理 block graph。
3. 加本機 IndexedDB checkpoint；同步支援 Canonical 與 raw SB3 兩類 project identity。
4. 加 provider tool orchestration，調用既有 patch、preview、playtest 能力；首個 provider 先選一個完成端到端與安全驗證。
5. 最後才接 Scratch cloud provider；先解決登入/授權與支援政策，再啟用任何實際帳號連線。

## 現況與研究依據

### Repo 現況

- Canonical live patch 現在僅允許 Canonical project。Raw SB3 路徑保留原始 ZIP，避免轉換損失；兩者不得共用「先解碼成 Canonical、改完再全量重編譯」的捷徑。
- Bridge 的 Scratch VM adapter 已提供 `getProjectJson()`、`saveSb3()`、`loadSb3()`；`saveSb3()` 呼叫 Scratch VM serializer 建新 ZIP，未保證保留輸入 ZIP 中的每個未知項目或位元組。
- 本 repo 鎖定 Scratch VM 15.2.0。其 `Cloud` IO device 以 provider 抽象接入；未安裝 provider 時 cloud variable updates 不會同步。`setVariableValue()` 對 cloud var 會轉送 provider 更新。
- 同 repo 的 Scratch GUI cloud manager 以登入者、專案 ID、cloud permission、作品擁有/可修改狀態為連線條件；會在 project/user/permission 變更時斷線，對 video sensing/face sensing 有額外拒絕規則。cloud provider 有連線/重連與節流行為，應重用相容 provider 介面，不自行拼裝 WebSocket 協定。
- VM `toJSON()` 序列化原始 targets，不包含 clones；它用來存成作品，不等於完整 runtime suspend image。綠旗初始化腳本也可能覆寫還原值。
- 目前產品沒有 Scratch 帳號登入/授權、project ownership 判斷、provider key vault、伺服端模型 proxy 或遊戲 checkpoint store。

### 外部研究與限制

- 已依 safe-web-research 流程以 robots、低頻串行請求讀取 OpenAI 官方 function-calling 與 production/key-safety 文件。function calling 是多輪編排：模型提出工具呼叫、應用程式執行、回傳結果，再讓模型完成；可限制可用工具。API key 應存放在安全位置/環境變數或 secret manager，不應放在程式碼或公開 repo。[OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)、[OpenAI production best practices](https://platform.openai.com/docs/guides/production-best-practices)。
- GitHub 官方 Scratch 原始碼頁在安全抓取期間回傳 challenge/WAF，流程立即停止，沒有改用 raw URL 或其他路徑繞過。Scratch 行為判斷改以 repo 內鎖定版本 source 為證；實作前需對照目標 VM/GUI 版本與上游官方文件，重新核對可能變動的限制。
- 不以猜測的 Scratch 私有 HTTP endpoint、瀏覽器 cookie 搬運、未經使用者授權的 WebSocket 或反向工程登入流程作為 cloud sync 設計前提。若沒有可支援的授權方式，cloud sync 應維持停用並清楚提示，而不是偷偷退化成匿名連線。

## 共用資料與安全契約（Phase 0）

### Project identity / revisions

為 Canonical 與 SB3 建立統一的 `ProjectIdentity`：

- `format` (`canonical` / `sb3`)、原始 archive SHA-256、`project.json` SHA-256、schema/adapter version、修改前 revision、父 revision。
- 每個 patch 帶 `baseRevision`、操作摘要、操作前後 hash、驗證 gates；任何過期 revision、來源不匹配、歧義 selector 均拒絕。
- Undo history 是有上限的 revision chain，不把完整 assets/作品任意重複放入 prompt 或 telemetry。原檔、AI 輸入、cloud values 預設不記錄到遠端 log。

### 人工確認與 commit 邊界

- **讀取/分析**可在使用者要求時由 AI tool 呼叫；**產生 patch**只建立待審候選；**套用**至少由使用者確認一次並顯示明確 diff。
- 雲端寫入、建立/刪除 cloud variable、覆寫/下載檔案、覆蓋 checkpoint 必須各有單獨確認；provider 不得把一個確認擴大成未來持續授權。
- 任意 JS、shell、URL fetch、filesystem 任意路徑、未 allowlist extension、任意 Scratch account API 一律不作模型工具。

## 工作流 A：模型 provider 直連

### 架構選擇

**建議採 local companion/provider gateway 作第一版**：Hosted GitHub Pages 是靜態前端，不能安全持有 provider secret。瀏覽器不放 API key 到 bundle、localStorage、IndexedDB 或 query string。Local companion 負責 OS credential store/使用者明確設定、provider HTTP、請求限額與 localhost origin/pairing token；頁面只透過受限本機 API 傳送 prompt、tool result 與取消訊號。

另一可行方向是 hosted backend/BYOK vault，但須另做帳號登入、tenant isolation、key encryption/rotation/deletion、quota/abuse 防護與營運成本，成本與隱私面大於 MVP。不要提供「把 API key 貼進網頁並永久記住」作替代方案。

### 分階段

**A0 — Provider/credential 決策與 threat model**

- 決定首個 provider、支援模型、計費顯示、BYOK 或自有帳單、key 刪除/撤銷；明訂僅由使用者手動啟動請求。
- 比較 local companion 與 hosted backend 的威脅模型、更新/安裝、localhost CSRF、配對生命週期、平台支援與營運責任。此決策完成前不動 API key。

**A1 — Adapter 與 tool contract**

- Provider-neutral `ProviderAdapter`：capabilities、request/cancel、structured tool calls、usage/error mapping；首 provider 用嚴格 JSON schema 與明確 tool allowlist。
- 工具先限 `inspect_project`、`inspect_playtest`、`propose_live_patch`、`run_playtest_scenario`。`apply_patch` 由 Bridge UI 控制並要求使用者確認，不能讓模型直接繞過。
- 每輪限制工具次數、input/output token、payload bytes、總 wall time、重試與費用；支援 Abort、網路錯誤與 rate limit。高階模型回傳內容依 untrusted input 處理。
- 小型上下文 packet：brief、project summary、相關 fragments/selector、最近 patch、playtest 失敗；不送素材 bytes、非相關所有 scripts、登入資訊或 cloud data。

**A2 — UX、privacy 與測試**

- 明示傳送哪些遊戲文字/結構到哪個 provider、使用模型與預估費用；提供逐次同意、取消、歷史刪除和外部 copy/paste fallback。
- 不記錄 API key、完整對話、使用者原始素材或 cloud values；本機 diagnostics 只記 request ID、延遲、token/費用摘要及錯誤分類。
- Fake provider 測試 tool loop、重複/未知工具、壞 JSON、schema 不合、拒絕授權、stale revision、超額停止與 key 不出現在 DOM/network logs/build artifacts。首 provider staging smoke 不使用真實 Scratch cloud account。

**驗收**：從使用者自然語言到模型產生候選 patch、Bridge 顯示 diff、確認套用、跑 scenario、以測試結果產生下一輪 patch，全程可取消並有成本/資料提示；錯誤或模型沒有工具支援時仍可 copy/paste。

## 工作流 B：原始 SB3 live patch

### 設計原則

新增獨立 `RawSb3PatchAdapter`，以原始 `project.json` 與保留所有 ZIP entry 的 archive layer 工作；Canonical adapter 保持原狀。每次輸出新 Blob/archive 並保留來源 bytes，禁止覆寫使用者輸入檔。

### 分階段

**B0 — Archive round-trip / preservation baseline**

- 以官方及實際匯入 fixture 建 preservation corpus：未知 opcode、unknown JSON properties、comments、monitors、extensions、costume/sound bytes、資料夾/zip entries、metadata、Unicode。記錄 entry name、byte length、hash；單純載入再保存應證明哪些可以 byte-preserve、哪些只能 semantic-preserve。
- 做 `RawSb3Document`：ZIP entry inventory、project JSON parser、原始 archive identity、嚴格壓縮檔 limits；不經 Canonical converter。

**B1 — Low-risk raw project.json operations**

- 先支援唯一 target 上的 x/y/direction/size/visible/currentCostume、tempo/volume 及既有非-cloud scalar 初始值；資料欄位定點改寫，其他 JSON subtree 與 ZIP asset entries 原樣保留。
- Runtime 即時變化接受後，更新原始 JSON 和 archive revision；runtime-only patch 明確標示「只影響這次執行」或「接受後寫回 SB3」，不可混淆兩者。
- Selector 採 project hash + `isStage`/target name/target ordinal/target subtree fingerprint；若同名 target 或 anchor 不唯一，停止請使用者選擇。

**B2 — Block graph structural operations**

- 初版限制 replace 已存在的 top-level script/subtree；selector 用原始 target + root block ID + root subtree hash。新增 block graph 必須分配唯一 IDs、連好 `next`/`parent`/inputs/shadow/topLevel 和變數/broadcast refs；remove 要確認沒有外部引用。
- 由 Scratch VM 對臨時 archive 執行 parse/deserialize/compile/再匯入驗證，但輸出仍以 original ZIP 改寫 `project.json`、保留其他 entries。任何 VM round-trip serializer 都不能直接取代原 archive，除非 preservation matrix 證明未丟資料。
- Merge 前重查原始 archive hash；若使用者/AI 已換檔就拒絕 stale patch。提交前產生檔案差異和保存報告。

**驗收**：未知 block、extension declarations、資產 entry hash 與未修改 project JSON 欄位保留；執行中 target/變數改動立即生效；套用/undo/redo 多輪可匯出並重新匯入 Scratch VM；惡意/歧義/過期 patch 不改原檔；每種 preservation claim 有自動測試證據。

## 工作流 C：遊戲進度保存

### 產品承諾

第一版承諾「從儲存點重啟遊戲」，不承諾精確恢復 VM 執行緒時間點。Scratch serializer 的 project state 不是 runtime suspend/resume 格式；clone、排程器、wait timer、隨機 generator、extension/hardware 與外部請求狀態不做一般化序列化。

### 分階段

**C0 — Checkpoint schema / policy**

- `GameProgressSnapshot` 至少含 snapshot schema version、Canonical/SB3 project hash、game/save slot、revision、timestamp、allowlisted original target/variable identifiers、可恢復位置/方向/大小/造型、遊戲明確標記的 checkpoint variables/lists。
- 預設排除 cloud variables、broadcasts、任意 extension-owned data、clone targets、網路/硬體內容、可執行 script/block graph、AudioContext 與 VM thread。欄位數、字串長度、snapshot bytes、slots 數有上限。
- 每款遊戲以 metadata 宣告可存欄位與 checkpoint trigger；不依變數名稱/AI 猜測哪些是關鍵進度。沒有宣告時只給使用者手動選擇的本機 variable/target 欄位。

**C1 — Local checkpoint MVP**

- IndexedDB per-origin store、opt-in、每 project 有有限 slots、覆蓋/刪除/匯出 UI；清除網站資料可能清除 saves，UI 要如實說明。不得把 localStorage 當大物件資料庫；儲存不帶 API keys。
- Save 時記 project hash 和 schema; load 時 hash 不同則提供差異與 explicit migration/match 流程，禁止按 index 靜默套錯角色。以新 VM/session 重啟，再套用允許欄位。設置「載入儲存進度」/「從頭開始」。
- 遊戲初始化腳本可能重設 values：MVP 在綠旗完成後恢復 checkpoint fields，然後呼叫明確的 resume hook 或觸發 checkpoint-resume broadcast。只有支援此生命週期的專案標記為可恢復；其餘顯示「儲存值可匯出，但遊戲需自備 resume entrypoint」。

**C2 — Optional sync export**

- 先做由使用者掌控的加密/明文 snapshot 匯出與匯入；未完成 cloud identity/consent前不自動同步。
- 真正跨裝置 sync 另設版本競爭、衝突 UI、加密/刪除、帳號權限和資料區域政策；不可把 snapshot JSON 塞進 Scratch cloud variable。

**驗收**：不同 game/project hash 不會套錯；變數/位置/造型在明確 resume hook 後恢復；fresh install/清除資料、quota error、破損/舊 schema、覆蓋與刪除都有可理解結果；cloud values/clone state 明確排除；重啟後 deterministic scenario 通過。

## 工作流 D：Scratch cloud variable sync

### 前置決策門

1. 確認要支援的是 Scratch 官網 cloud data，或 Bridge 自有雲端。兩者產品、登入、規範、隱私與運維完全不同，不共用一個泛稱「雲端存檔」。本計畫優先研究 Scratch cloud variables。
2. 確認可用的正式授權/登入/permission 機制、Scratch 專案 ID、使用者 ownership 和 deployment domain；不抓取/搬運 Scratch session cookie，不假設 API token 可取得。
3. 若沒有受支援且可審查的登入方式，將 Scratch cloud sync 標為不可用；可另行設計 Bridge 自有雲端，但需獨立產品/安全計畫。

### 分階段

**D0 — Offline contract and permission mock**

- 先以 mock cloud provider 測 protocol adapter、server-originated updates、connection state、throttle/backoff/cleanup、變數刪除/改名、project switch。依執行時載入之 Scratch VM 版本讀取 variable-count/value constraints，不在 Bridge 自行複製過時常數。
- 不在 preview iframe 內持有 Scratch auth；parent 提供只允許目前 project 的 provider channel。preview token 不是帳號 credential。

**D1 — Explicit Scratch account/project authorization**

- 做正式 sign-in/consent、own-project/permission gate、project ID binding、可撤銷連線。首次連線前顯示 cloud variable 名稱與將讀/寫的內容；讀取/寫入分別授權。
- 模仿 Scratch GUI 安全條件：未登入、不是可修改專案、project/user/permission 不匹配、作品無 cloud variable、video/face sensing extension 啟用時拒絕或立即斷線；登出、換作品、停止 preview 必須斷線並清 queue。

**D2 — Safe sync**

- 只允許 declared cloud scalars；值符合 Scratch 限制；rate limit、bounded queue、last-write-wins policy/衝突回報、離線期間不重播不可信舊值；所有 incoming data 在 VM allowlist 內套用。
- 清楚區分 Scratch server 狀態與本機 checkpoint；任何 cloud write 是外部副作用，先由使用者啟用此專案的 cloud sync，AI patch 不能自行建立/刪除變數或改 cloud values。
- 建 provider adapter contract，錯誤/斷線可安全退回 offline preview，不阻止遊戲本地執行；不得自動換到 Bridge 私有 server。

**驗收**：真實帳號測試需使用專用測試 project/帳號並手動 opt-in；非 owner、錯 project id、錯 token、換 project、退出、face/video sensing、rate exceeded、disconnect/reconnect、server message for unknown variable 都有測試；另一用戶/另一作品看不到資料；斷線時無雲端寫入或 queue replay。

## 整合驗收矩陣

| 能力 | Canonical live edit | Raw SB3 | Provider tool | Cloud sync | Local save |
|---|---:|---:|---:|---:|---:|
| Patch/schema/revision | 共用核心 | raw adapter | 只提案，不繞 gate | 不可直接 cloud write | 不修改 snapshot 結構 |
| Undo/redo | 已有 | 逐 revision archive | 人工確認後進既有 history | 外部寫入不可假裝可 undo；顯示補償寫入 | slot/version history |
| AI context | summary/fragments | 壓縮的 raw inventory/anchor | consent 後最小必要 context | 預設不送 cloud values | 預設不送 save values |
| Persistence | 編輯作品 | 新 archive | provider session/usage policy | Scratch 雲端只存 cloud scalar | IndexedDB snapshot |
| Failure gate | validate/compile | preserve/VM re-import | model/tool/schema/cost limits | auth/ownership/rate gate | schema/hash/quota/migration |

跨能力 browser acceptance：選 Canonical 或 raw SB3 → 選擇是否連 provider → AI 提出 patch → 審查套用 → deterministic playtest → 儲存本機 checkpoint → 重開遊戲恢復；cloud test 獨立測試並須另行 opt-in。分別驗證 provider off、offline、拒絕授權、provider failure、raw preservation fail、save migration fail、cloud disconnect 的退化路徑。

## 風險、指標與出入口

- **不先做 provider 但應先抽象**：Patch UI 可維持 copy/paste；provider adapter 只在工具契約穩定後加入，避免 provider 實作侵蝕 patch gate。
- **Raw SB3 preservation**：任何未知 entry hash 改變都視為 preservation regression；直接修改 project JSON 的安全範圍需由 fixture matrix 確認。
- **Cloud policy/credential**：Scratch cloud provider 的上游行為、auth 要求、帳號條件可能變動；每次實作前須核對官方規則/目前 Scratch GUI 版本。不要提交真實帳號、cookie、cloud values 或測試資產中的私人資料。
- **進度與遊戲程式互動**：初始化 script 可能覆蓋 snapshot；不支援的作品須清楚說明不能 resume，不以「讀取成功」假稱「遊戲恢復成功」。
- **成本與私隱**：provider 每次請求顯示模型/資料/預算；任何實際 provider API 開發前先決定使用者提供 key 或新建 credential 方案，絕不從環境中自行挑選秘密。

## 執行前需要確認的產品決策

1. Provider 直連先採 local companion BYOK（建議）還是 hosted backend？
2. Cloud sync 目標只限 Scratch cloud variables，還是要另做 Bridge 自有雲端存檔？建議分成兩個產品功能。
3. Progress save 預設只存本機 IndexedDB（建議），還是預期第一版即跨裝置？建議先本機，避免綁定尚未決定的登入/雲端方案。

以上決策不影響先做 raw SB3 preservation spike 與本機 checkpoint schema；provider credential 和 Scratch live account cloud write 需在各自決策後才進實作。

## 參考資料

- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)（官方文件；2026-10-31 擷取）
- [OpenAI production best practices](https://platform.openai.com/docs/guides/production-best-practices)（官方文件；2026-10-31 擷取）
- Scratch VM 15.2.0 本機鎖定 source：`packages/scratch-vm/src/io/cloud.js`、`packages/scratch-vm/src/virtual-machine.js`、`packages/scratch-vm/src/serialization/sb3.js`、`packages/scratch-vm/src/engine/runtime.js`。
- Scratch GUI 本機 source：`packages/scratch-gui/src/lib/cloud-manager-hoc.jsx`、`packages/scratch-gui/src/lib/cloud-provider.ts`。GitHub official page safe fetch encountered challenge; no bypass was attempted.
- 既有 Bridge live patch plan: `research/tool-evaluation/2026-10-30-starport/LIVE-EDITING-PLAN.md`。
