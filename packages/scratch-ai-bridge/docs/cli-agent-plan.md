# Scratch AI Bridge CLI 與整班批次回饋計畫

日期：2026-10-15

狀態：計畫完成，尚未實作 CLI。

## 1. 目標

讓同一套 Scratch AI Bridge 能在瀏覽器以外執行。老師可用終端機批次分析整班 `.sb3`；CLI 自己完成匯入、作品摘要、SB3-only 100 分估分和有證據的建設性回饋。Agent 也能在同一個對話/流程裡直接呼叫 CLI，將自然語言作品需求轉成 Canonical IR、驗證/修正、編譯 `.sb3`，或局部修改原作品。不需人工複製 JSON 到 Gemini。

CLI 的評分/分析/編譯不依賴模型 API key 或網路。若使用者透過 AI agent 提出自然語言作品需求，語言理解和 Canonical IR 草稿由目前的 agent/模型完成；Bridge CLI 接手 schema/semantic validation、compile、round-trip 驗證與 SB3 輸出。CLI 不綁定 Gemini，也不把模型呼叫藏在背景。

主要使用情境：

```text
scratch-ai-bridge batch ./班級作品 \
  --manifest ./students.csv \
  --format jsonl \
  --out ./reports
```

每份作品產生一份機器可讀 JSON 和學生可讀的 Markdown 回饋；另產生班級摘要與 CSV 成績表。老師可用匿名學生代碼對照檔案，避免把姓名寫進輸出。

## 2. 設計原則

- **共用產品核心**：CLI 直接呼叫既有 SB3 匯入、Analysis IR、Project Map、score 與 feedback 模組；不得另寫一套評分規則。
- **CLI 自己能交付結果**：即使沒有 AI agent，仍可輸出每位學生的分數明細、證據、分析限制和建設性回饋。模型只能是老師另外選用的後續協助。
- **Agent-friendly protocol**：stdout 僅輸出具版本欄位的 JSON 或 JSON Lines；進度、診斷日誌寫入 stderr。每個建議附 evidence ID 和可追溯位置。
- **離線優先和本機處理**：SB3 不上傳；不含模型金鑰、不自動呼叫外部服務。需複製/輸出外部 AI 提示時，由使用者明確選擇單份作品。
- **整批容錯**：單一作品失敗不停止其餘檔案；每筆明確標記成功/部分可讀/失敗，最終摘要列成功數、部分可讀數、失敗數。
- **匿名預設**：報告以 manifest 中的匿名 ID 為主；不把學生姓名、原始角色名、資產、引用文字或原始 SB3 寫入彙總檔/AI prompt。教師可選擇本機私有對照表，但不列入匿名報告。
- **估分需可解釋**：固定 rubric 版本和分數計算器；報告 score coverage、每項分數、分數依據、限制。不能從 SB3 推斷的測試歷程、理解程度、創意、美感不給分。

## 3. 建議架構

```text
Terminal / coding agent
        │ argv + files / stdin
        ▼
CLI adapter (parse args, batch, file IO, protocol)
        │
        ├── SB3 import adapter (Node runtime; no UI/renderer)
        ├── shared analyzer → Project Map / static feedback
        ├── shared score engine → sb3-static-v1 score
        ├── shared Canonical validator/compiler → SB3 authoring/editing
        └── report formatter → JSON, JSONL, Markdown, CSV
```

CLI adapter 不可匯入 `main.ts` 或 DOM UI。核心分析模組保持純資料轉換；Node 專用檔案讀取、路徑解析、stdin/stdout 與批次排程留在 adapter。既有 decompiler 有 Scratch VM、bitmap renderer 和 browser 輔助路徑；Phase 0 先確認 Node 端可安全載入 VM、哪些輸入需要 DOM/Canvas，並分清楚「純靜態分析」和「VM 正規化」兩條路徑。批次分析不需要 renderer、預覽畫面或音訊。

建議初期只提供單一安裝入口（`scratch-ai-bridge` executable）；在 workspace repo 內開發，發布/安裝方式另依 repo 的 package 發行策略決定。CLI 與 web 必須共用 rubric 版本和回饋規則。

## 4. CLI 指令與輸出合約

### 單份操作

- `analyze <file.sb3>`：回傳專案摘要、積木理解覆蓋、確定診斷、限制與 evidence IDs。
- `score <file.sb3>`：回傳 100 分總分、六項規準得分/配分、解釋、證據、覆蓋率與暫定分數說明。
- `feedback <file.sb3>`：本機規則產生正向觀察、一項優先改進、學生能懂的下一步/問題；每一項都附 evidence ID。這是可直接使用的回饋，不要求 Gemini 幫忙潤飾。
- `inspect <file.sb3>`：一次輸出 analyze、score 和 feedback 的版本化 JSON envelope；這是 agent 建議使用的主入口。
- `validate-ir <file.json|->`：檢查 agent 產生/修改的 Canonical IR，輸出 schema 與語意 issue JSON Pointer，保持現有 repair feedback vocabulary。
- `compile-ir <file.json|-> --out <project.sb3>`：通過 validator 後編譯 Scratch 專案；拒絕無效 IR，不靜默丟掉未知欄位。
- `roundtrip <file.json|-> --out <project.sb3>`：編譯後經 Scratch VM 重新載入，輸出成功狀態與可比對摘要；清楚區分可編譯、VM 可載入和原始需求功能完成度。
- `patch <source.sb3> <patch.json> --out <edited.sb3>`：套用現有保留式 block-graph patch，只變更指定積木並保留其他未知 extension/原始 archive 資料；patch 無法安全定位時拒絕寫檔。

`--format json` 適合 agent；`--format markdown` 適合直接給學生/教師閱讀。JSON 至少有 `format`、`version`、`rubricVersion`、`fileId`、`status`、`score`、`coverage`、`summary`、`feedback`、`evidence`、`limitations`。格式需以 schema/version 管理，避免 agent 綁定不穩定欄位。

### 整班批次

- `batch <directory>` 預設只讀指定目錄第一層 `.sb3`，不追蹤 symlink；遞迴需明確 `--recursive`。
- 支援 CSV/JSON manifest，把匿名 `studentId` 對應本機相對檔案路徑；manifest 欄位驗證失敗需在開始處理前報錯。
- 每份作品各輸出一筆 JSONL 和個別 Markdown；`class-summary.json`/CSV 彙整分數分布、中位數、各面向分數分布、常見靜態診斷、待人工看檔數及失敗清單。
- `--jobs N` 控制並行度；預設低並行以限制記憶體。單檔採用現有 archive 大小/壓縮比限制；批次另設檔案數、總輸出大小與取消處理上限。
- 預設輸出目錄新建且不覆寫；若使用者要求覆寫，先檢查輸出路徑不在輸入作品資料夾內。寫檔採暫存檔再 rename，避免中斷留下看似完整的報告。
- 單檔損壞或 unsupported opcode 不影響整批；輸出 `partial` 加 coverage 限制，不能直接把 Bridge 不認識的積木扣成學生錯誤。
- 統計班級分數只報告全體摘要；需避免把排名/名次做預設輸出，個人化報告各自獨立。

### Agent 呼叫合約與寫作流程

- 分析/批次：Agent 執行 `inspect` 或 `batch --format jsonl`，可用 stdin 傳 manifest，stdout 僅有結果資料。
- 新作品：Agent 將使用者自然語言需求在目前對話中轉成 Canonical IR，透過 stdin 呼叫 `validate-ir`；若有 issue，讀 JSON Pointer/修正建議後重新送入；成功後呼叫 `roundtrip` 寫出 `.sb3`。過程由 agent tool call 串接，不需學生/老師手動貼 prompt 或搬運 JSON。
- 修改作品：Agent 先 `inspect` 原 SB3，向使用者確認修改範圍後呼叫 `patch`；CLI 回報改動積木和保留內容的摘要，產生新的輸出檔，不覆寫來源檔。
- 若 agent 用 MCP/tool wrapper，wrapper 只將 tool arguments 傳給 CLI 並回傳 envelope；核心邏輯只維護一份，沒有 provider-specific Gemini adapter。
- 單檔錯誤不把 stack trace 寫入 JSON stdout；stderr 顯示人類可讀診斷，輸出 envelope 內用安全錯誤代碼。
- 建議 exit codes：`0` 全數完成、`1` 批次有單檔錯誤/部分讀取、`2` CLI 用法或 manifest 錯誤、`3` 無法恢復的內部錯誤、`130` 使用者中止。
- agent 可直接將 `feedback` 給使用者；若 agent 想重述，提示合約要求保留 evidence ID、分數與限制，不可聲稱測試過或更改評分。
- 不要求 MCP。先把 CLI JSON/JSONL 穩定化；若未來需要工具協定，可薄包一層 MCP server 並呼叫同一 CLI/core。

## 5. 階段與驗收

### Phase 0 — Node 執行環境/依賴邊界

- 確認 Node LTS/`.nvmrc`、VM 初始化、ZIP/PNG/SVG/Sound 處理是否依賴 DOM/Canvas/Audio。
- 為 CLI 明確標示不產生視覺預覽、不執行 extension 硬體、不聲稱 runtime verified。
- 用 fixture 確認同一 `.sb3` 在 CLI 與 web 的 Canonical/evidence/score 結果相同；如 Node VM 不可用，定義純靜態輸入路徑及較低 coverage 狀態。

### Phase 1 — 單檔 CLI

- 跨平台 executable、help/version、路徑和 stdin 支援；stdout 純 JSON，stderr 日誌，穩定 exit codes。
- 單份 `.sb3` 可產出 `inspect` envelope 和 Markdown；中間錯誤不暴露 stack/path 私密資訊。
- Windows/macOS/Linux smoke，測含空白/Unicode 路徑、無效 ZIP、超大/壓縮炸彈邊界、未知積木和 bitmap archive。

### Phase 2 — Agent 寫作與保留式修改

- `validate-ir`/`compile-ir`/`roundtrip`/`patch` 具穩定 JSON input/output；支援 stdin/stdout pipe，不要求暫存明文作品資料。
- 以 Gemini Platformer IR、正常 Canonical fixture、schema/semantic 失敗修正案例、保留未知 extension 的 `.sb3` patch 回歸。
- 編譯產物能由 Scratch VM 載入；報告只宣稱通過的技術階段，不把編譯成功說成需求全部實作。
- agent 能用單一 tool workflow 產出新 `.sb3`，並將錯誤定位/修正回圈串起來，不需人工複製貼上。

### Phase 3 — 本機教學回饋

- 規則回饋由 Bridge 自己產生，不依賴外部 AI；必須能由證據 ID 定位到 target/script/block。
- 最少一項作品優點、一項高價值下一步和一個引導問題；找不到可靠依據時坦白說資料不足。
- 輸出直接給學生閱讀的 Markdown 和給 agent 使用的 JSON；敏感字串/素材不預設進輸出。

### Phase 4 — 整班批次

- 目錄掃描/manifest、匿名學生 ID、並行上限、逐檔容錯、checkpoint/resume、每份報告和班級摘要/CSV。
- 中途停止後可安全續跑且不重複/覆寫其他班級資料；以作品 SHA-256、analyzer/rubric version 做快取 key，快取只存在使用者指定的本機資料夾。
- 30/100/500 檔案壓力樣本記憶體/時間指標；任意單檔錯誤不會丟失其他結果。

### Phase 5 — 評分校準與教師試用

- 先以匿名、多類型 Scratch 專案由教師盲評，涵蓋遊戲、故事、動畫、藝術、不同作品規模和 opaque extensions。
- 報告 Bridge 分數與教師分數的面向分歧，不以單一平均遮蓋偏差；調整前先找出規則誤判來源。
- 未通過校準前輸出必須標為「依 SB3 靜態結構估分」，教師可停用數字分數而保留證據回饋。

## 6. 主要風險與邊界

- Scratch VM 對 Node/瀏覽器環境的依賴可能使某些 SB3 只能做 Raw Archive/graph 靜態分析；輸出需清楚區分 Canonicalized 與 raw-only。
- 目前 `sb3-static-v1` 是啟發式初版，不是經教師驗證的正式評量工具。整班試用前需校準及回報不確定性，不能把 batch 排名或自動分數直接作唯一學期成績。
- 學生姓名/學號可能藏在檔名、角色名、廣播名、文字積木及 metadata；匿名報告需以允許清單輸出欄位，不能只刪除可見姓名欄。
- `.sb3` 是 ZIP/JSON/素材不可信輸入；沿用 archive 防護，限制輸入數量、展開大小、單檔執行時間、並行度及輸出路徑，且不得執行 student extension 或 arbitrary code。
- 若未來加入 LLM 版本，預設每份個別 opt-in；整班批次禁止自動外傳學生作品/回饋包。

## 7. 本階段邊界

這份計畫描述 CLI/agent/batch 方向；目前已部署的 web 評分功能不因 CLI 計畫改變。本文件本身不表示 CLI 已存在、已發布或已支援整班批次。
