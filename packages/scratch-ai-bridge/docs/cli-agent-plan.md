# Scratch AI Bridge CLI 與班級批次分析執行計畫

更新：2026-10-19

狀態：Phase 0–2 的核心切片已實作；四份真實作品、混合損壞檔容錯與 30/100/500 檔數壓測已驗收。教師校準、跨平台/大型異質作品容量、真人閱讀學生回饋仍待完成。

### 目前進度（2026-10-19）

- Node 靜態 inspection、`inspect`、目錄 `batch`、JSONL/教師 Markdown/學生 Markdown/CSV/班級摘要已實作；不載入 VM/Canvas/extensions。教師摘要保留分數與 evidence 索引；`*-student.md` 不輸出分數或內部 evidence ID，只列最多三項白話定位與步驟。班級摘要對 partial 結果附匿名、去識別的原因。
- 四份真實作品最新結果為 2 `ok`、2 `partial`、0 `failed`；兩份 partial 原因是自製積木圖結構不一致（2 項）及 opaque blocks（14 個）加圖結構問題（3 項），不是檔案讀取失敗。私用姓名對照只留在本機 0700 資料夾。
- 初版限制回饋最多 60 項、證據最多 240 項；報告另有省略數及私用來源對照表。
- 以 3 KB 單一 fixture 複製壓測 30/100/500 檔均成功；500 檔 jobs=1/2 的 JSONL/摘要一致，序列約 0.75 秒、最高 RSS 約 137 MB。混合四份真實檔及一個壞 ZIP 為 2 ok/2 partial/1 failed，單一失敗不影響其他分析；這不代表異質大型專案的班級容量已驗收。
- Bridge 447 tests、lint、build/bundle budget、benchmark 及三瀏覽器 smoke 已通過；原生 Safari Remote Automation 與真人教師/學生驗收未通過或未執行。CI runs `39190336679`、`39191556581`、`39193245344` 成功。Safari WebDriver 尚待管理者啟用 Remote Automation。

## 1. 目標與優先順序

先讓老師與 coding agent 能在本機使用同一套 SB3 靜態分析、評分和回饋，再擴充整班批次。作品不會上傳，也不會在 CLI 中啟動 Scratch 專案、硬體或 extension。

交付順序：

1. 建立 Node 可用的靜態 SB3 inspection pipeline。
2. 提供單檔 `inspect` CLI，輸出版本化 JSON 和 Markdown。
3. 提供容錯的 `batch` CLI，支援目錄掃描、匿名代碼和班級摘要。
4. 用四份真實班級作品及合成壓力集驗收。
5. 再獨立規劃 agent 寫作功能（IR validate/compile/roundtrip/patch）與教師評分校準；這些不阻擋前四項交付。

本計畫沿用既有 `sb3-static-v2` rubric 和 analyzer/feedback 核心；CLI 不另建評分規則，不呼叫模型，不要求 Gemini API key。

## 2. 根因與設計決策

先前工作只新增計畫文件，沒有 CLI 入口、命令或執行驗收。原範圍把本機分析、全班批次、IR 編譯和 SB3 patch 綁在同一案，Node/瀏覽器相依性也尚未驗證。

Bridge 的 `decompileSb3WithBlockGraphs()` 會載入 Scratch VM；bitmap 匯入需要瀏覽器 Canvas。CLI 不應呼叫這條 UI/VM 匯入路徑。改以靜態路徑直接讀取 SB3 中的 `project.json` 和原始 block graph，將結果明確標成靜態分析，並保留 opaque blocks/extensions 的 coverage 限制。

### 靜態 inspection pipeline

Node CLI adapter 讀取檔案為 `Uint8Array`，依序呼叫或封裝下列既有模組：

1. `importLosslessSb3()`：重用 ZIP 安全邊界，取得原始 `projectJson`、entries 與 archive warnings。
2. `projectJsonToCanonicalWithReport()`：直接從原始 project JSON 建立 Canonical projection 和 block mappings；不經 Scratch VM、不解碼圖像、不執行 extension。
3. `extractProjectBlockGraphs()`：保留 VM/Canonical 未建模的原始積木與 coverage。
4. `analyzeCanonicalProject()`、`createProjectMap()`、`createProjectScore()`、`createProjectFeedback()`：使用既有分析、證據、評分和回饋規則。
5. CLI formatter：輸出 schema-versioned JSON 或 Markdown；不包含原始 SB3、素材 bytes 或完整 `project.json`。

此路徑與 VM 正規化結果可能不同，尤其是舊格式、malformed graphs、自訂積木和 extension。結果須標示 `analysisMode: "static-raw-sb3"`、`runtimeVerified: false`，列出 recognized/opaque/malformed coverage；不能暗示作品已執行。遇到無法轉為 Canonical 的區塊時，原始 graph 仍須保留於 coverage/evidence 索引，不得當成學生錯誤。

## 3. 命令與輸出合約

### 第一版命令

```text
scratch-ai-bridge inspect <file.sb3> [--format json|markdown]
scratch-ai-bridge batch <directory> --out <new-directory> [--recursive] [--manifest <file.csv|json>] [--jobs 1|2]
```

開發階段先提供 workspace-local executable/npm script；獨立安裝或發布方式另外決策，不把尚未定案的 npm 發布流程當作 CLI MVP 的前置條件。

`inspect` 是唯一必要的單檔入口，輸出分析摘要、`sb3-static-v2` 結構參考分與各項明細、證據、coverage、建設性回饋、限制和錯誤狀態。未使用面向標示為 N/A，不直接給滿分；總分依適用面向換算。JSON 至少包含：

- `format`、`version`、`analyzerVersion`、`rubricVersion`
- `fileId`（內容 SHA-256，不輸出本機絕對路徑）及 `status`（`ok`、`partial`、`failed`）
- `summary`、`score`、`coverage`、`feedback`、`evidence`、`limitations`
- `analysisMode: "static-raw-sb3"`、`runtimeVerified: false`

stdout 只輸出結果 JSON/JSONL；進度和可操作錯誤寫到 stderr。Exit code：`0` 全部成功、`1` 批次含 partial/failed 檔案、`2` 命令列或 manifest 錯誤、`3` 無法恢復的內部錯誤、`130` 使用者中止。錯誤 JSON 不含 stack trace 或本機絕對路徑。

### Batch 首版行為

- 預設掃描指定目錄第一層 `.sb3`，不跟隨 symlink；`--recursive` 才遞迴。
- 未提供 manifest 時，使用穩定的匿名檔案代碼；有 manifest 時驗證欄位、重複 ID 和相對路徑，預設不把原始檔名/姓名放進班級彙總。
- 預設 `--jobs 1`；允許的最大並行先限制為 2。每份作品互相隔離，單檔錯誤不終止整批。
- 輸出目錄必須不存在；拒絕將輸出放在輸入目錄內。先寫暫存輸出，完整結束後再 rename 成正式結果。
- 另寫 `PRIVATE-teacher-source-map.csv` 對照匿名代碼與相對檔名，讓老師可辨認作品；此檔含學生識別資訊，需明確標示不得分享，班級摘要與個別回饋不帶來源檔名。
- 每份作品產生一筆 JSONL 結果和一份 Markdown；批次完成後產生 `class-summary.json` 與 CSV。摘要提供分數分布、criterion 分布、常見靜態診斷、coverage/partial 數與失敗清單，不產生預設排名。
- 批次本機執行，不存取網路、不呼叫 AI。報告不包含原始 project JSON、積木 ID、素材 bytes；敏感文字欄位採允許清單輸出，不能確認匿名化時就省略。
- `ProjectMap` 現有 evidence ID 可能編入 Scratch 原始 block ID；CLI formatter 必須將它映射為輸出專用、穩定的 evidence ID，並將角色名稱改成「舞台／角色 N」。不可只靠刪除 project JSON 就宣稱已匿名化。

## 4. 階段、實作項目與驗收門檻

### Phase 0 — 靜態 Node pipeline

**實作**

- 建立不匯入 `main.ts`、DOM UI、Scratch renderer、audio engine 的 inspection service。
- 用 archive parser、raw project JSON、raw block graphs 產生 Canonical projection、AnalysisIR、ProjectMap、score 和 feedback。
- 素材不解碼、不複製到輸出；保留 archive checksum/asset issue 的現有資訊。
- 對 unknown opcode、malformed graph、自訂 procedure、bitmap 和 extensions 回報 coverage/limitation；禁止執行學生 extension。

**驗收**

- 在 Node 24（repo `.nvmrc`）直接執行，不安裝 DOM shim；純 SVG 與含 PNG 的 SB3 均可產生靜態結果。
- 使用同一批 SB3 對照 web 靜態分析輸出的 summary/score/evidence。因 VM 正規化造成差異時，逐欄說明並保持靜態輸出可信，不要求錯誤地與 VM archive 完全相同。
- 損壞 ZIP、超出 archive limits、缺少 `project.json`、malformed block graph 都得到明確結果，程序不崩潰。

### Phase 1 — 單檔 inspect CLI

**實作**

- 增加 CLI parser、help/version、路徑處理、stdout/stderr protocol、穩定 exit codes。
- 支援 `inspect` JSON/Markdown；預設 JSON，UTF-8 路徑及含空白路徑可用。
- 添加輸出 schema/version 與 allowlist formatter，不暴露原始 archive/學生內容。
- 為 evidence 建立輸出 ID 映射；逐字訊息、變數/清單值、廣播名稱、角色原名、檔名和絕對路徑預設不輸出，若教學回饋需要其中欄位，先定義明確的安全欄位與匿名化規則。
- 大型作品輸出需有回饋/evidence 上限，並回報省略數；每個被保留的 evidence reference 必須仍能在輸出中找到。

**驗收**

- 一個向量作品、一個 bitmap 作品、一個含 opaque extension 的作品都能輸出可 parse 的 JSON。
- `stdout` 可直接 pipe 給 `jq`；日誌只在 `stderr`。
- 測試含空格、中文檔名、無效輸入、超限 archive、缺檔；錯誤 code/message 符合合約。
- CLI 顯示 static-only；沒有任何輸出聲稱 runtime/FPS 已驗證。

### Phase 2 — 班級 batch

**實作**

- 加入目錄掃描、匿名 file ID、CSV/JSON manifest、逐檔容錯、jobs 上限、JSONL/Markdown/班級摘要/CSV。
- 保護輸出路徑、拒絕覆寫、採原子輸出；中斷時不留下看似完成的摘要。
- 先不做快取/續跑；只有大量實測顯示必要時，再另立階段設計 checkpoint/resume。

**驗收**

- 目錄混放有效、損壞、unsupported/partial `.sb3`；各檔結果狀態正確，失敗不影響其他作品。
- 重跑同一輸入時拒絕覆寫舊報告；symlink/遞迴行為符合指定參數。
- manifest 缺欄、重複 ID、路徑逃逸在任何作品開始分析前就報錯。
- jobs=1 和 jobs=2 的逐檔內容一致；並行不超過設定值。

### Phase 3 — 四份真實作品試跑與批次穩定性

**輸入樣本**

使用者提供的四份比賽作品位於 `~/Desktop/貓咪盃比賽/`。檔名可能被改成含組別/參賽者資訊的名稱，執行時以 `.sb3` 掃描結果確認，不依賴舊 basename。檢查過的樣本包含 PNG、WAV 與以下 extensions：`videoSensing`、`text2speech`、`faceSensing`、`handpose2scratch`、`facemesh2scratch`、`music`。Extension 只記錄/標示，不載入執行。

**驗收**

- 四份作品一批完成，逐檔列出 `ok`/`partial`/`failed`、target/block 數、recognized/opaque coverage、score、回饋數與限制。
- 每個回饋 evidence ID 可對回報告內 evidence；score 可由同版 rubric 重算。
- 對每份 partial/failed 追查具體原因並修正可修的 importer/mapper 問題；真正 unsupported 的內容要保留限制，不用猜測補齊。
- 原始作品不變，輸出只寫入明確指定的新目錄。
- 再用 30/100/500 個 fixture 做時間與記憶體量測，據此設定支援上限；沒有數據前不宣稱可穩定處理任意班級規模。

### Phase 4 — 教師試用與評分校準

- 教師盲評多類型匿名作品（遊戲、故事、動畫、藝術與含 extensions 作品），逐項比較 rubric 分數與教師判斷。
- 報告各 criterion 的偏差和 coverage 對分數信心的影響；未經校準時明確標「依 SB3 靜態結構估分」，允許停用總分而保留證據回饋。
- 實際確認學生版 Markdown 可讀、回饋不把 extension/unsupported opcode 誤判為學生錯誤。

### Phase 5 — Agent 寫作/修改工具（另案）

在 inspect/batch 穩定後才加入 `validate-ir`、`compile-ir`、`roundtrip`、`patch`。每個命令分開驗收 JSON stdin/stdout、錯誤定位、Scratch VM 載入與未知資料保留；未經使用者要求，不將其納入批次分析 MVP。

## 5. 資安、隱私與品質界線

- SB3、manifest 和檔名都是不可信輸入；沿用 archive 邊界、路徑正規化、檔案數/大小/解壓上限，不執行 archive 內程式碼或 extension。
- 所有處理在本機；預設不網路、不 AI、不輸出素材 bytes。stdout 僅供機器協定，私人 debug 不得混入。
- 不將學生姓名/學號當作預設輸出識別；班級摘要使用匿名 ID。單份報告只輸出產生教學回饋必需的欄位。
- `sb3-static-v2` 是結構參考分，不衡量創意、美感、理解力、玩法手感或 FPS，不得單獨作正式成績；未經教師校準前不可當作正式成績。
- CLI 分析即使成功，也不等同 Scratch 執行驗證；runtime、感測器硬體和線上服務均標示 unavailable/not verified。

## 6. 首個可交付版本定義

只有以下條件都通過，才稱為「CLI 批次分析可用」：

1. Node 靜態 pipeline 與 `inspect` 命令已實作並有回歸驗收。
2. `batch` 能處理混合成功/失敗輸入並產生 JSONL、個別回饋、摘要及 CSV。
3. 上述四份真實作品有逐檔結果，輸入原檔未被修改。
4. Windows/macOS/Linux 的路徑、stdout/stderr、exit code smoke 通過，並有實測容量界線。
5. docs、CLI `--help`、輸出 schema 與實際行為一致。

本文件是執行計畫，並不代表 CLI 已存在或批次已完成。
