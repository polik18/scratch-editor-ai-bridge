# Scratch 專案品質改善計畫（唯一交接檔）

> 本檔是「學生作品 → 得到可解釋的 Scratch 專案品質與成績」這條主線的**唯一交接入口與唯一執行檔**。適用範圍包含遊戲、動畫、故事、互動藝術、音樂、問答、模擬、教學作品和混合型 Scratch 專案。接手者只以本檔第 0 節的現行主線為準；舊節、舊任務卡和舊報告只作證據，不另開平行計畫。完成或中斷都要回寫本檔的進度表與交接紀錄。
>
> 原始建立：2026-11-10（Claude Code）。當時的分支／工作樹只代表歷史證據；接手時以 `git status --short --branch` 和本節現行任務為準。

> 檔名 `game-quality-plan.md` 沿用早期遊戲基準的歷史名稱；自 2026-11-19 起，第 0 節的現行範圍是所有 Scratch 專案，遊戲只是其中一種 `projectType`。

## 0. 唯一交接入口：通用 Scratch 專案生成與評量主線 v2（2026-11-19）

### 0.1 目標與核心決策

目前最重要的問題不是 Bridge 不會編譯，而是把「Scratch 專案設計」和「Scratch 實作格式」同時塞給 AI，讓 AI 在最需要創意的時候先忙著遵守格式。後續主線採用以下分工：

1. **先讓 AI 自由發揮**：第一階段只談作品想法、受眾體驗、內容、互動、敘事、教學目的、節奏和風格；不要求 JSON、opcode、scratchblocks、Game Spec、Scratch 積木清單或 `requirementCoverage`。AI 可以用最自然、最短或最完整的文字表達，系統不得因格式不符而打回。
2. **再把創意轉給 Scratch**：第二階段才由 AI 加上 Bridge 提供的相關能力資料，把第一階段內容轉成可分段執行的互動、敘事、模擬或教學流程。Bridge 負責編譯、資產、ID、變數、廣播、格式修復、匯入、執行驗證和報告；AI 仍負責取捨內容與處理「如何近似」的決定。
3. **分段實作，不要求一次完成整個作品**：先做最小可驗證的核心體驗，再逐段增加角色、場景、段落、互動、動畫、音效、資料和特殊機制。每一段都能 build、執行或播放、回報，再交給 AI 決定下一個修正。
4. **不靜默刪除創意**：Scratch 暫時做不到的內容要標成「待實作／可近似／需替代方案」，保留原始意圖與選擇理由；不能為了通過 schema 而悄悄變成另一種作品。

這不是把 AI 限制得更細，而是把限制延後到真正需要產生 Scratch 內容的階段，並只提供當下用得到的能力資料。第一階段的自然語言不是新的嚴格格式；下面的欄位是 Bridge 內部可選的抽取結果，不是要求 AI 必須照填的表單。

### 0.2 交接規則（接手者照做）

1. 先讀本節，再讀第 2 節進度表；不要從其他 `docs/history/*plan*` 判斷目前主線。
2. 檢查 `git status --short --branch`，確認自己工作的 worktree；不要直接使用第 3 節歷史 worktree 的假設。
3. 只挑本節 0.5 的第一個未完成任務；若要改順序，先在本節和第 7 節留下理由。
4. 每次只完成一個可驗收切片：更新程式、測試、證據和第 2 節／第 7 節；中斷也要留下已知問題與下一個命令。
5. 任何新的品質計畫、替代交接檔或平行 roadmap 都不建立；需要新方向時改寫本節的版本與交接紀錄。

**唯一入口路徑**：`packages/scratch-ai-bridge/docs/history/game-quality-plan.md`。套件 README、`AGENTS.md` 和舊文件都只能指向這個檔案。

### 0.3 目標架構與責任邊界

| 階段 | AI 看到的內容與主要工作 | Bridge／系統承擔的工作 | 產出與驗收 |
| --- | --- | --- | --- |
| A. 自由創作 | 使用者需求與簡短引導；自由提出作品概念、目的、受眾、內容、互動、敘事、教學方式和風格，不看 Scratch 規格 | 保存原文；不要求結構化、不做 opcode 教學、不用長規格壓縮創意 | `CreativeBrief` 原文可讀；不得因缺少 JSON／積木而失敗 |
| B. 專案轉譯 | 只收到 A 的原文、意圖錨點和當下相關的少量能力卡；決定內容流程、互動、狀態、完成條件與近似方案 | 抽取意圖錨點；按需提供能力；把不可用能力明確列出；維持原文與轉譯的對照 | `ProjectPlan` 可追溯到原意；沒有靜默遺失或無理由改變作品類型 |
| C. 分段實作 | 一次處理一個垂直切片，例如「場景＋互動＋回饋」或「角色＋對白＋轉場」；依執行回饋決定下一片 | 產生／合併局部 script、變數、廣播、資產和角色；管理 ID 與編譯；保留可回復版本 | 每片都能 build、執行或播放；核心切片可驗證；失敗可局部修復 |
| D. 執行與修正 | 讀取畫面、輸入、狀態變化、敘事流程和使用者感受，判斷作品是否符合原意，選擇修正方向 | 自動執行／播放驗證、截圖／狀態採集、錯誤分類、最小 repair handoff、回滾與匯出 SB3 | `RuntimeReport`；`done` 必須包含作品可驗證結果，不可只代表 schema 通過 |

### 0.4 內部資料契約（最小化上下文）

- `CreativeBrief`：保留 AI 的自然語言原文與使用者原始需求；不強迫 AI 輸出固定 schema。
- `IntentAnchors`：Bridge 在 A 完成後才抽取的少量錨點，例如受眾、目的、內容、互動、敘事／教學流程、狀態、完成條件、節奏、視覺／聲音風格；不把完整規格塞回 AI。
- `ProjectPlan`：只包含本次切片需要的內容、互動、輸入、狀態、角色和驗收條件；不注入全量 opcode 或整份能力目錄。
- `ImplementationFragment`：可合併、可回復的局部 Scratch 實作；格式可先採 scratchblocks-style 或其他較短表示法，再由 Bridge 轉成內部 IR。
- `RuntimeReport`：實際輸入或播放流程、角色／變數／場景是否變化、音效／動畫／對白是否觸發、與意圖錨點的偏差，以及下一個最小修正建議。

契約的原則是「原文保留、抽取延後、上下文按需、結果可回溯」。任何為了方便 parser 而新增的欄位，都必須證明它能降低模型負擔或提高意圖保留，否則不加入第一階段。

### 0.5 現行任務序列（新的主線）

| ID | 任務 | 驗收條件 | 狀態 |
| --- | --- | --- | --- |
| V2-0 | 建立兩階段 benchmark 對照組 | 同一模型、同一組跨類型題目比較舊單段 Game Spec、A→B、A→B→C；記錄 prompt 長度、build、執行／播放、意圖保留、媒體表達與人工品質 | ✅ 完成：同一模型 `Cyber-Tiel-Coder-35B` × 10 題跨類型 × spec／a-b／a-b-c，跑三輪（r1～r3）；記錄提示長度、建置、實際執行、需求意圖保留、媒體種類、近似決策與失敗類型。結果：a-b-c（加回歸防護）意圖約 0.7，spec 0.38～0.65、a-b 0.27～0.42。摘要 `research/project-quality-benchmark/runs/2026-11-19-cybertiel35b-v2.md`；人工品質評分依使用者決定跳過 |
| V2-1 | 實作 A：自由創作入口 | AI 不必輸出 JSON／opcode／Scratch 規格；原文可直接保存；提示與回覆測試確認沒有長能力清單 | ✅ 完成：`createFreeCreationPrompt`（<400 字、無格式與能力清單），A 原文逐字保存；`tests/creative/pipeline.test.ts` |
| V2-2 | 實作 B：意圖錨點與按需能力卡 | 只注入當前切片相關能力；每個無法支援的意圖都有保留、近似或替代決策 | ✅ 完成：`extractIntentAnchors`、13 張按需能力卡、`createProjectPlan`；做不到的想法（拖曳、連線、3D…）都有近似／替代／延後決策並在報告列出 |
| V2-3 | 實作 C：局部片段與可回復狀態 | 核心迴圈可先 build／playtest，再追加內容；局部修正不需重寫整份作品 | ✅ 完成：`applyFragment`／`undoFragment`、`(replace)` 局部取代；每段建置＋試玩，失敗回滾該段後帶試玩發現重做一次 |
| V2-4 | 整合 scratchblocks-style 轉譯 | 先覆蓋 benchmark 的常用積木，再逐步補多角色、動畫、感測、分身；保持短輸出與可讀錯誤 | ✅ 完成：`parseScratchblocksProject` 多角色／舞台段落，補場景、分身、提問、滑行、特效、大小、變數 reporter、四則運算、join |
| V2-5 | 實作 D：作品執行品質門檻 | `done` 不能只由 schema／VM 載入決定；未實際執行／播放時必須明確標記，完成作品不得以 `not-run` 收尾 | ✅ 完成：`completion()` 對 `not-run` 一律 `done=false`；`create` 只有實際試玩且規劃的意圖全部觀察到才 `done` |
| V2-6 | 資產、音效、動畫與視覺品質 | 轉譯階段能按作品意圖選官方素材；至少有可驗證的媒體／互動事件；素材不足時回報替代方案 | ✅ 完成（程式面）：按名稱解析官方造型／背景／音效，`assets.alternatives` 回報缺的素材與替代名；試玩記錄聲音、造型、背景、對白、顯示、分身、提問事件。美感仍需 V2-7 人工評 |
| V2-7 | 人工品質評測與回歸 | 每輪保留同模型基準、代表作品、失敗類型和人工評分；不得只用編譯成功率宣稱品質提升 | ✅ 完成（人工評分依使用者決定跳過）：三輪同模型基準、`--baseline` 回歸比較、失敗類型統計與代表作品（`output/bench/2026-11-19-cybertiel35b-v2*`）；由回歸發現並修正「後段刪掉已驗證功能」的退步。`ratings.csv` 留給日後真人評分 |
| V2-8 | 評分分層與鑑別度 rubric | 將 `sb3-static-v3` 限定為診斷分；正式分數必須含意圖、實際試玩、玩法深度、回饋與可信度 | ✅ 完成：`static-diagnostic`／`runtime-assessment`／`formal-grade` 三層；內建 10 種 projectType 通用評量表（意圖、深度、反思需 AI／教師判定，不猜分） |
| V2-9 | `formal-grade` 核心評量器 | 同一份版本化 rubric 可由 CLI、API、MCP 呼叫；輸出分項證據、限制、信心和人工複核狀態 | ✅ 完成：`src/core/grading/evaluate.ts` 單一核心；逐項得分、證據、信心、複核原因、`highScoreEvidence`；未執行一律 pending |
| V2-10 | 教師批次收件與 CSV 成績表 | 一批 `.sb3` 加 manifest／作業 rubric 可隔離處理；產出匿名成績 CSV、複核佇列、JSON 詳報和私有對照表 | ✅ 完成：CLI `grade <資料夾>` → `grades.csv`、`review-queue.csv`、`class-summary.json`、逐筆 JSON／MD、`PRIVATE-teacher-source-map.csv`；單檔失敗隔離、教師調整留痕 |
| V2-11 | MCP／API／CLI 接入 | 支援 `grade_sb3`、`grade_sb3_batch`、CLI `grade` 和穩定 JSON API；外部 AI provider 可插拔且預設不外傳學生作品 | ✅ 完成：MCP `validate_rubric`／`draft_rubric`／`grade_sb3`／`grade_sb3_batch`／`get_grade_report`（限 output/ 內）；本機 JSON API `npm run grading-api`（127.0.0.1＋token，job 與 CSV 下載）；不外傳學生作品 |
| V2-12 | 教師校準與鑑別度驗證 | 以簡單、複雜、完整、破損、不同類型作品做盲評；檢查高分天花板、低分誤判、教師一致性與排名相關性 | ⏸️ 依使用者決定（2026-11-19）先跳過真人參與部分；盲評材料一鍵產生（`calibrate prepare`）與校準工具已完成並實測，待 30 件作品與兩位教師：`calibrate <報告> --teachers <csv>` 算 Spearman、MAE、各項誤差、教師一致性、複核召回、90+ 比例、覆蓋率反向檢查；需 ≥30 件作品、≥2 位教師 |
| V2-13 | 班級內相對校準與分數範圍 | 支援每個年級／班級／作業獨立分組，預設有效作品 80–100、目標眾數約 90；同時保留 raw score，不把跨年級排名混在一起 | ✅ 完成：`calibrateCohorts`（年級／班級／作業／rubric hash 分組、midrank＋常態映射、raw／cohort／final 三分數；低信心、未執行不灌分，缺完整證據最高 89） |
| V2-14 | 分布、例外與跨年級報表 | CSV 顯示 raw／cohort／final 三種分數、排名、信心、未完成與複核原因；驗證 30 人批次不會全 100 或全 80 | ✅ 完成：30 件固定測試批次驗證 80–100、眾數與中位數約 90、單調不倒置、破損／待定在範圍外；同分、三成滿分、眾數偏移、覆蓋率反向都有警告 |
| V2-15 | 教師自訂 rubric 與課堂規準編輯器 | 老師可自訂評量項目、配分、部分得分、證據來源和人工複核；系統不得自行增加或改變老師未要求的評量項目 | ✅ 完成：文字規準 → `rubric draft`（只建議檢查，不改配分）、網頁編輯器 `src/ui/teacher-rubric.html`、`rubric approve` 核准後才產生正式成績 |
| V2-16 | rubric 驗證器與可重現評分 | CLI／API／MCP 使用同一份 rubric；檢查配分總和、criterion ID、測試設定與 rubric hash，逐項輸出得分和證據 | ✅ 完成：`validateRubric`（配分總和、ID、級距、子項目、檢查類型、runtime 設定）、內容 hash、核准過期偵測；CLI／API／MCP 共用 |

**第一個實作任務固定為 V2-0。** 先取得可重複的兩階段證據，再改提示與 pipeline；若 benchmark 發現某個階段增加負擔，優先縮小該階段的上下文，而不是把更多規則加回 A。

> **順序調整（2026-11-19 Claude Code）**：V2-0 需要真實模型，但本機 oMLX 端點要 API key、環境中沒有，且依第 3 節規定不得自行翻設定檔找金鑰。因此先完成不依賴模型的 V2-1～V2-16 程式與測試，並把 V2-0 的 benchmark 工具做好、離線驗證；拿到金鑰後直接執行第 7 節最上方的命令補上同模型對照。若結果顯示某階段增加負擔，依本段原則縮小該階段上下文。

### 0.6 評分機制重整：診斷分與正式成績分分離

#### 目前查到的結構性問題

1. `src/core/analyzer/project-score.ts` 的 `sb3-static-v3` 是固定 100 分的 **SB3 靜態結構參考分**，只分析事件腳本、流程、資料、互動、完整性和組織；`src/cli/inspect.ts` 明確把 `runtimeVerified` 設成 `false`。
2. 目前沒有評估「是否符合原始遊戲目標」「核心迴圈是否有趣」「難度／進程」「玩家回饋」「動畫／音效是否服務玩法」「複雜功能是否真的可用」。因此結構完整的小作品可能被高估，功能很多但 Bridge 看不懂或尚未試玩的作品可能被低估。
3. `state`、`interaction` 等面向會依適用性重新換算分母。這對避免因沒有某種積木而扣分有幫助，但也代表不同作品的 100 分不是完全同一組能力比較；它不能直接當班級正式成績。
4. 現有 `runBatch` 雖然能批次輸出 `scores.csv`，欄位只有 `studentId,status,score,coverage`，實際是靜態 inspection，不是執行作品後的通用 Scratch 專案評量；目前 MCP 也只有 inspect／讀取／修改相關工具，沒有批次評分入口。
5. `docs/history/teacher-review-improvement-plan.md` 已正確警告「結構參考分不是正式成績」，但尚未提供本次要的正式評分、教師批次交件和鑑別度校準路線。該文件保留作學生回饋與限制證據；正式 Scratch 專案成績改由本檔主線管理。

#### 新的評分分層

| 分層 | 用途 | 是否可當成績 | 必要證據 |
| --- | --- | --- | --- |
| `static-diagnostic` | 快速找結構問題、提供 AI／學生修正線索 | 不可 | SB3 讀取、積木證據、coverage；沿用 `sb3-static-v3`，不再稱品質分 |
| `runtime-assessment` | 自動驗證能否啟動、播放、互動、轉場、狀態變化、內容流程、聲音／動畫 | 只能作正式分的一部分 | 真實 VM／預覽執行、測試情境、截圖／狀態／事件證據 |
| `formal-grade` | 教師批次成績；將作業意圖、執行證據、內容深度和呈現品質綜合 | 可以，但必須有 rubric 版本與可信度 | `static-diagnostic` + `runtime-assessment` + 作業／設計 brief + AI／教師評量；低可信度進人工複核 |

未執行作品不能產生正式分數。沒有 runtime 證據時，輸出 `pending`／`reviewRequired=true`，不可用靜態分補成 100，也不可把 `not-run` 視為通過。

#### 建議的 `formal-grade` 100 分 rubric（第一版，必須經教師校準）

這張通用表只是沒有指定課堂規準時的 fallback。**只要老師提供自己的 rubric，就以老師的評量項目、配分和部分得分規則為最高優先**；系統不得因為自己的通用表而額外要求「一定要有關卡、分數、敵人、變數、多人或遊戲勝負」。

| 面向 | 配分 | 判斷重點 | 防止錯判的規則 |
| --- | ---: | --- | --- |
| 作業意圖與核心目標 | 20 | 是否實現自己宣稱的作品目標、受眾、內容、互動、敘事或教學目的 | 以學生 brief／教師作業 rubric 為準，不以系統猜測代替需求 |
| 可執行性與可靠度 | 25 | 能否啟動、播放、互動、轉場、產生狀態變化並穩定完成主要流程 | 高分必須有實際情境證據；只會載入但沒有可觀察結果不能滿分 |
| 內容深度與結構 | 20 | 故事、資訊、互動、模擬、教學層次、變化或多段流程是否有意義 | 不按積木數、角色數或檔案大小加分；無意義堆功能不算深度 |
| 互動回饋與視覺／聲音表達 | 15 | 操作回應、對白／轉場、動畫、音效、畫面是否幫助受眾理解作品 | 素材多不等於高分；必須與作品意圖和可觀察事件連得起來 |
| 程式結構與可維護性 | 10 | 事件、狀態、模組化、命名、重複與錯誤風險 | 只評功能性結構；未知 extension 或 Bridge 看不懂不得直接當學生錯誤 |
| 測試、反思與完成度 | 10 | 是否測過核心路徑、修正問題、說明限制與設計取捨 | 可由 AI 輔助整理，但高風險／低信心案例必須教師複核 |

這套 rubric 不把「大」直接換成高分，也不把「簡單」直接判低分：一個刻意做極簡但敘事、互動、資訊設計或視覺表達很好的作品可以高分；一個只有單一動作、沒有內容流程或受眾回饋的作品不能因為 schema 正確而拿滿分；一個大型作品則依「宣稱的功能有多少真正可執行」計分，未完成的裝飾和未接腳本不算成就，也不因 Bridge 無法辨識就自動扣分。

#### 教師自訂 rubric：課堂規準優先

老師可以針對每一堂課建立一份 rubric，不必使用通用六面向。每個評量項目至少包含：`id`、給學生／教師看的名稱、`points`、判定說明、證據來源和部分得分方式。老師可以只寫自然語言，系統再提出可執行的測試草案；老師確認前，草案不能直接變成正式成績。

推薦的 rubric 結構如下：

```json
{
  "format": "scratch-ai-bridge/rubric",
  "version": 1,
  "id": "big-fish-small-fish-animation-v1",
  "title": "大魚吃小魚 Scratch 動畫",
  "projectType": "animation",
  "totalPoints": 100,
  "criteria": [
    {
      "id": "swimming",
      "title": "大魚、小魚的游泳方式正確",
      "points": 30,
      "mode": "partial",
      "evidence": ["runtime", "visual"],
      "levels": [
        { "ratio": 1, "description": "大魚和小魚都以本課要求的方式持續游泳" },
        { "ratio": 0.5, "description": "只有一種魚的游泳方式正確" },
        { "ratio": 0, "description": "沒有依要求游泳或作品無法觀察" }
      ],
      "testPlan": [
        "啟動作品後觀察大魚的移動方向、速度與持續性",
        "啟動作品後觀察小魚的移動方向、速度與持續性"
      ]
    },
    {
      "id": "eat-feedback",
      "title": "大魚碰到小魚，小魚消失並播放吃掉的音效",
      "points": 30,
      "mode": "components",
      "evidence": ["runtime", "audio"],
      "components": [
        { "id": "collision", "points": 10, "description": "大魚碰到小魚時能辨認碰撞事件" },
        { "id": "disappear", "points": 10, "description": "被吃的小魚會消失或隱藏" },
        { "id": "sound", "points": 10, "description": "吃掉事件播放指定音效" }
      ],
      "testPlan": ["讓大魚與小魚在測試情境中相遇，記錄碰撞、可見性和聲音事件"]
    },
    {
      "id": "clone-respawn",
      "title": "小魚被吃掉後，新的小魚分身在別處出現",
      "points": 40,
      "mode": "partial",
      "evidence": ["runtime", "static"],
      "levels": [
        { "ratio": 1, "description": "被吃掉後會在不同位置出現新的小魚，效果像另一條魚游進來" },
        { "ratio": 0.5, "description": "有重新出現但位置、分身或觸發條件不完全正確" },
        { "ratio": 0, "description": "沒有新的小魚出現或無法驗證" }
      ],
      "testPlan": ["連續觸發吃魚事件，觀察新小魚是否出現、位置是否改變、是否仍能互動"]
    }
  ]
}
```

這個例子中，系統只能按照 30／30／40 計算，不能因為作品多了背景、角色或其他積木自行加分，也不能因為沒有「關卡」而扣分。每個 criterion 的結果都要回傳：`earnedPoints`、`maxPoints`、`status`、`evidence`、`confidence`、`reviewRequired` 和 `teacherNote`。例如第二項可能得到 20/30，明確指出碰撞與消失通過，但音效沒有證據；第三項若分身只在原地出現，則依老師定義的部分得分，不由模型自由決定。

教師可以選擇三種 criterion 判分模式：

- `binary`：通過就是滿分，未通過為 0 分；適合明確的必要功能。
- `partial`：老師預先定義 0／50／100% 或更多級距；適合游泳方式、故事完整度、模擬準確度。
- `components`：把一項拆成老師指定的子項目；適合「碰撞＋消失＋音效」這種複合要求。

AI 的角色是把老師的自然語言規準轉成 `testPlan`、找出證據和標記不確定；AI 不得改配分、補充未要求的功能或在沒有證據時猜測通過。老師可在 UI、CLI、API 或 MCP 中查看並核准測試草案，核准後產生固定 `rubricHash`，整批 30 份作品使用同一版本。班內相對校準只能作用在 rubric 計算完成後的總 `rawScore`，不能改寫任何 criterion 的原始得分。

#### 通用 `projectType` profile

正式評量不把所有 Scratch 專案都當遊戲。作業 manifest 或教師 rubric 應提供 `projectType`；沒有提供時，系統只能提出暫定分類並標記 `reviewRequired`，不能自行把動畫當遊戲評分。所有 profile 共用「意圖、可執行性、內容深度、表達／回饋、結構、測試」核心，再由 profile 指定適用證據、權重和執行情境：

| `projectType` | 主要驗證內容 | 不應強迫要求 |
| --- | --- | --- |
| `game` | 控制、挑戰、狀態、勝負／進程、重玩 | 不要求每個遊戲都有多關卡或多人 |
| `animation` | 時間軸、場景／造型轉換、動作連貫、音畫表達 | 不要求玩家操作或勝負 |
| `story` | 敘事目的、角色／場景、對白、分支或轉場、結尾完整度 | 不要求得分、碰撞或敵人 |
| `interactive-art` | 輸入到回饋的關係、視覺／聲音意圖、探索性、互動穩定度 | 不要求傳統目標或通關 |
| `music` | 節奏、聲音事件、演奏／控制、段落結構、回饋 | 不要求角色移動或故事 |
| `quiz`／`tutorial` | 內容正確、題目／步驟流程、回饋、進度、重試 | 不要求遊戲式勝負或複雜動畫 |
| `simulation` | 模型／狀態、輸入、可觀察變化、解釋性、重設 | 不要求固定答案或關卡 |
| `mixed`／`custom` | 由教師 rubric 明確定義核心目標與證據 | 不由系統猜測缺少的必要功能 |

`not-applicable` 表示該面向不適用，不扣分；但也不會因為不適用就自動送滿分。每個 profile 必須提供可驗證的最低核心面向，權重總和固定為 100，並在報告中列出實際採用的 profile、權重和排除面向。這樣三年級的動畫、六年級的遊戲、另一班的互動藝術可以各自公平評量，同時仍能用 `rawScore` 追蹤同一 profile 的品質進步。

#### 鑑別度與防止虛高／低估

- **高分門檻**：90 分以上必須同時具備作業意圖證據、主要流程 runtime 通過、至少一組可觀察的內容／互動／敘事／模擬進程，以及可追溯的受眾回饋；單純靜態結構永遠不能到高分。
- **簡單作品防虛高**：開放式作品 rubric 必須評「內容深度」「受眾回饋」「完成度」；只有一個動作、沒有內容流程或互動結果的作品，即使乾淨可編譯，也只能得到相應的可靠度與結構分，不能補滿其他面向。
- **大型作品防低估**：測試情境由 brief／作品地圖動態產生，不能只試 4.5 秒或只看前幾個腳本；允許分階段、分場景、分段落和多輪執行。功能已證明可用的 opaque／extension 內容進入人工複核，不直接歸零。
- **不以規模代替品質**：積木數、角色數、資產數、SB3 bytes、程式行數都只能當診斷資料，不進公式；真正加分的是有意義、可執行、可重玩的功能。
- **可信度分開呈現**：每筆結果同時輸出 `score`、`confidence`、`evidenceCoverage`、`runtimeStatus`、`reviewRequired`。低 coverage、未跑完、AI 與靜態證據矛盾時，成績列為待複核，不輸出假精確的小數。
- **教師可覆寫但留痕**：教師可調整分數與理由；原始自動分、調整後分、rubric 版本、reviewer、時間和理由都保留，不能覆蓋原始證據。

#### 唯一評量核心與外接方式

所有入口都呼叫同一個純核心 `evaluateSb3`／`evaluateBatch`，不得各自發展一套分數：

1. **CLI**：新增 `bridge grade <資料夾或檔案> --manifest 班級.csv --assignment 作業.json --rubric rubric.json --playtest --out 報告資料夾`。保留既有 `inspect`／`batch` 作診斷工具；正式成績只能走 `grade`，避免誤把舊 `scores.csv` 當成正式成績。
2. **API**：提供版本化 JSON API（單檔、批次 job、查詢結果、下載 CSV／JSON）；核心不依賴 HTTP。API 預設本機或校內網路，支援 job id、重試、逐檔失敗隔離、rubric hash 和結果 hash。
3. **MCP**：新增 `grade_sb3`、`grade_sb3_batch`、`get_grade_report`、`export_grade_csv`；工具說明必須要求作業 rubric 與試玩設定，並回傳「正式分／診斷分」的區別。MCP 不直接把學生檔案送外部模型，除非教師明確選擇 provider。
4. **AI／API provider**：只作證據摘要、意圖對照和開放式品質面向評量；provider 以 adapter 接入 OpenAI-compatible、Gemini、Anthropic 或校內模型。沒有 provider 時仍能跑靜態與 runtime，無法判斷的面向標記 `pending`，不猜分。
5. **輸出**：每批產生 `grades.csv`（教師成績表）、`review-queue.csv`（待複核）、`class-summary.json`（統計與分布）、逐筆 JSON／Markdown 詳報、`PRIVATE-teacher-source-map.csv`（只留本機）。CSV 至少包含 `studentId,finalScore,diagnosticScore,autoScore,teacherScore,confidence,evidenceCoverage,runtimeStatus,reviewRequired,rubricVersion,status` 及各 rubric 分項欄位。

#### 教師批次流程

教師提供一個資料夾 `.sb3`、一份匿名或本機 manifest、一份作業 rubric／設計 brief 和可選的測試設定；系統逐檔分析、試玩、評量，單檔失敗不影響整批。輸出先按匿名 ID 排序，姓名對照只寫入權限受控的私有 CSV；外部 AI 預設不接觸原始 SB3、姓名、原始檔名或對話。教師先看 `review-queue.csv`，再匯出最終 `grades.csv`。

#### V2-12 校準驗收

正式成績不能只靠自動測試宣稱可信。第一輪至少建立 30 件匿名代表作品：極簡但完整、內容單薄、結構複雜且完整、複雜但半成品、遊戲、動畫、故事、互動藝術、音樂／問答／模擬、使用 extension、靜態分析不完整等各類都要有。至少兩位教師獨立盲評，再比較：

- 內容單薄作品不得因可編譯而進入最高分區；大型且真正可執行的作品不得因規模或 opaque evidence 系統性落在低分區。
- 自動分與教師中位數的 Spearman 排名相關、各 rubric 的平均絕對誤差、教師間一致性、低信心案例召回率，都要記錄在 benchmark。
- 檢查分數分布是否大量集中 90–100、是否出現 coverage 越低分數越高、是否只靠增加積木／角色就升分；任何一項失敗都不能標成「可正式打成績」。
- 校準前名稱只能是「試行正式評量」；校準後固定 rubric 版本，後續版本變更必須重新跑對照並保留舊成績可重現。

#### 0.6.5 三十人班級的相對校準規則

使用者指定的「預設 80～100、眾數約 90」是**同一評量群組內的成績校準設定**，不是把所有作品的品質都宣稱為 80 分以上。評量群組必須至少包含 `gradeLevel`、`classId`、`assignmentId` 和 `rubricVersion`；三年級與六年級、不同作業或不同 rubric 不直接混排。

預設設定寫成可版本化的 `grading-policy.json`：

```json
{
  "mode": "cohort-calibrated",
  "scoreRange": { "min": 80, "max": 100 },
  "targetMode": 90,
  "relativeWeight": 0.5,
  "cohortKey": ["gradeLevel", "classId", "assignmentId", "rubricVersion"],
  "minimumCohortSize": 10,
  "recommendedCohortSize": 30,
  "tiePolicy": "midrank",
  "incompletePolicy": "pending-or-below-range"
}
```

計算分成三步，並且三種分數都寫入報表：

1. `rawScore`：依正式 rubric、runtime 證據和 AI／教師評量得到的絕對品質分。這是跨批次追蹤作品進步的主要依據。
2. `cohortScore`：只在同一評量群組內按照 `rawScore` 排名。使用 midrank 處理同分，將百分位經常態化映射到設定範圍；30 人時中心值落在約 90，兩端接近 80／100。這個分數表達「在本班本次作業的位置」，不能拿來比較不同年級。
3. `finalScore`：依 `relativeWeight` 混合絕對分與群組分，並套用高分證據門檻、runtime 門檻和教師複核規則。預設有效且證據完整的作品落在 80～100；未完成、不能啟動、沒有核心路徑證據或低信心作品不得因排名被灌進範圍，改為 `pending` 或依教師設定標為 below-range。

第一版的建議公式是：

```text
absoluteBand = min + rawScore / 100 × (max - min)
rankPercentile = (midrank - 0.5) / cohortSize
cohortBand = clamp(targetMode + spread × inverseNormal(rankPercentile), min, max)
finalScore = round((1 - relativeWeight) × absoluteBand + relativeWeight × cohortBand)
```

其中 `spread` 由範圍和群組大小決定，預設讓 30 人的 `cohortScore` 形成以 90 為中心的分布。系統要在輸出前檢查眾數、中央値、四分位距、80／90／100 人數與未完成數；若分布異常（例如全部 100、全部 80、coverage 越低反而越高），標記校準警告，不得自動宣稱成績合理。`targetMode=90` 是分布目標，不得用任意調分消除 raw score 的品質差異。

這套規則解決兩個相反問題：

- **避免六年級通通 100**：同一六年級班級內仍依作品品質與完成度排序，只有真正高品質、證據完整、在班內明顯突出者接近 100；其他作品會在 80～100 內形成差異。
- **避免三年級通通 80**：同一三年級班級內採自己的 cohort 分布；作品雖然不應和六年級直接比複雜度，但班內表現好的作品可以接近 100，不能因年級低就全部壓在 80。

報表一定同時提供 `rawScore`、`cohortScore`、`finalScore`、`rank`、`percentile`、`mode`、`median`、`confidence`、`runtimeStatus`、`reviewRequired` 和 `calibrationWarnings`。教師看到的成績表預設用 `finalScore`，但可以追溯 raw score；管理者查看跨年級成效時應用 raw score／rubric 面向，不得用 cohort final score 直接比較三年級和六年級。

「眾數約 90」本身不是教育品質證明，所以 V2-14 必須用固定測試批次驗證：30 件中包含特別好、普通、內容單薄、大型完整、大型半成品、遊戲、動畫、故事、互動藝術、音樂／問答／模擬、破損和低信心案例；預期是分數有層次、眾數接近 90，但破損／未完成仍保持 pending 或 below-range。若只是靠排名讓所有作品都有漂亮分數，仍視為失敗。

### 0.7 本版完成定義

本改善計畫只有在以下條件都成立時才算完成：第一階段能讓 AI 在沒有 Scratch 格式負擔下產生有辨識度的 Scratch 專案設計；第二階段能保留設計意圖並只取用必要能力；Bridge 能分段實作、執行／播放、修正與匯出；跨類型基準和人工評測都顯示成品品質、複雜度或受眾體驗提升；教師能以 CLI／API／MCP 批次取得有 rubric 版本、可信度、證據和複核狀態的 CSV 成績表；V2-12～V2-14 校準證明內容單薄作品不會虛高、複雜且可執行作品不會因規模或工具盲點系統性低估，同年級同作業的 30 人批次能形成可解釋的分布。單純「JSON 可解析」「SB3 可下載」或「靜態分 100」都不算完成。

## 1. 為什麼要做：診斷結論

使用者回報「效果奇差無比」。2026-11-10 實測（commit `aa094128a0`）的結論：**解析層沒問題，問題在架構與成品品質**。

| #   | 根因                                                                                                                                                                            | 證據                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | 最難的工作交給外部 AI 盲寫：學生要把約 12.5K 字元的規格貼到聊天 AI，AI 得一次寫出整份自訂 Canonical IR JSON，**沒有任何完整範例**，還要附 requirementCoverage 的 JSON Pointer。 | `createStudentProjectInstruction('貓咪接蘋果')` 輸出 12,510 字元；這種格式 AI 沒學過，比 scratchblocks 長好幾倍。              |
| R2  | 造型只有約 12 種手繪 preset，音效永遠無聲。官方素材庫已盤點，卻沒接進生成。                                                                                                     | 「蘋果」編出來是寫著 "Apple" 的綠方塊；`src/core/visuals/catalog.ts` 沒有任何程式引用；無資料的 sound 會被編成 `silentWav()`。 |
| R3  | 從不實際試玩：成功只代表 schema、語意檢查和 VM 載入通過，`runtime-behavior` 一律標 not-run。                                                                                    | `src/cli/generator.ts`；修正迴圈只處理格式錯誤，不處理玩法錯誤。                                                               |
| R4  | 首頁混亂：37 個按鈕、23 個輸入欄，步驟編號「1、2、2」，還沒有作品就顯示「修改作品」；`main.ts` 單檔 6,876 行。                                                                  | gh-pages 首頁截圖。                                                                                                            |
| R5  | 計畫多、量測少：40 多份計畫和狀態文件，卻從來沒量過成品品質；lint 有 1,388 個錯誤，CI 是靠跳過檢查才變綠。                                                                      | `docs/`、`DIAGNOSIS-2026-11-02.md`。                                                                                           |

已驗證**不是**主因的：normalizer 能把常見的格式亂寫修好（夾雜說明文字、陣列沒包成 script、欄位多包一層、`all-around` 拼錯），30 項自動修復後照樣能編成 SB3。

## 2. 進度表（接手者必須更新）

| 步驟 | 內容                                       | 狀態                                | 證據／備註                                                                                     |
| ---- | ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0a   | 品質基準工具：10 題＋無頭試玩評分          | ✅ 完成                             | commit `b78adb48f1`；兩份手寫回覆試跑 78%（不是真實基準）                                      |
| 0b   | **用真實模型跑出 baseline 分數**           | ✅ 完成（本機 baseline，0/10 編譯） | Qwen 80B local；10 題已生成，build 0/10；見 T0b                                                |
| 1a   | 官方素材庫接入生成（提示、下載、補齊）     | ✅ 完成（Node 驗證）                | 611/611 測試、build 與打包預算通過                                                             |
| 1b   | 在真實瀏覽器驗證素材下載與 CSP             | ✅ 完成                             | Playwright Chromium 線上／斷網 smoke；官方 Apple MD5、CSP、fallback 均通過                     |
| 1c   | 學生「換一個素材」介面、離線備援、隱私說明 | ✅ 完成                             | Chromium 線上／暖快取離線／冷離線、換素材重編譯與復原均通過                                    |
| 2a   | 精簡製作指令並附完整範例（目標 ≤ 6K 字元） | ✅ 完成（同模型平均 8%）            | 10 題提示 5,878–5,939 字；最終重跑 `t2a-r3`，builds 1/10、plays-sound 1/1、animated-sprite 1/1 |
| 2b   | scratchblocks 文字格式可行性實驗           | ✅ 完成（採用後續受控整合方向）     | 同模型／同 10 題：平均 61%、build 10/10；見 T2b 證據                                           |
| 3    | 網頁內自動試玩，玩法錯誤回饋給學生         | ✅ 完成                             | 共享判斷模組、瀏覽器自動試玩、修正 handoff；見 T3 完成紀錄                                     |
| 4    | 首頁精簡成單一路線                         | ✅ 完成                             | 首屏主操作按鈕 7 → 2；見 T4 完成紀錄                                                           |
| 5    | 文件與工程整理                             | ✅ 完成                             | 舊計畫已在套件與根目錄索引標示為歷史參考；見 T5 完成紀錄                                       |

| V2   | 通用生成與評量主線 v2（第 0 節）           | ✅ 完成（V2-12 真人盲評依使用者決定暫緩） | V2-0～V2-11、V2-13～V2-16 完成；V2-12 工具完成、真人部分 ⏸️，見第 7 節 |

建議順序：**1b → 0b → 2a → 3 → 1c → 4 → 2b → 5**。1b 只要幾分鐘，卻決定上線後素材功能能不能用；0b 是之後所有改動的比較基準。

## 3. 位置與環境

| 項目         | 位置                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始碼工作樹 | `/Users/huangjianzhe/Git/scratch-editor-ai-bridge`（分支 `main`）。這是現行唯一工作樹；「歷史工作樹」一列是 2026-11-10 的狀態，只作證據 |
| 套件         | `packages/scratch-ai-bridge`（TypeScript + Vite + Vitest） |
| 歷史工作樹   | `Git/scratch-ai-bridge-improvement-plan`（`feat/bridge-asset-library-benchmark`）與 `Git/scratch-bridge-paper-feedback`（他人未提交修改，不要碰）；不要再以它們為開發基準 |
| 線上網址     | https://polik18.github.io/scratch-editor-ai-bridge/（部署前先確認 `main` 已推送並經使用者同意） |
| 本機模型     | oMLX 在 `127.0.0.1:8000`，需要 API key。**不要自行翻設定檔找金鑰**（會被權限擋下），請向使用者索取                                                                                                                                  |

## 4. 已完成內容（commit `b78adb48f1`）

### 4.1 官方素材庫接入（步驟 1a）

| 檔案                                       | 作用                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build/generate-asset-library-index.mjs` | 從 `packages/scratch-gui/src/lib/libraries/{sprites,backdrops,sounds}.json` 產生精簡索引。指令 `npm run generate:asset-library`                                                          |
| `src/core/visuals/library-index.json`      | 產生出的索引：343 角色、85 背景、354 音效，只有名稱、標籤和 md5ext／中心點／取樣率，約 172 KB／gzip 54 KB。已列入 `.prettierignore`，**不要手改**                                        |
| `src/core/visuals/library-zh.ts`           | 中文關鍵字對照官方名稱：角色、背景、音效三張表。名稱都必須存在於索引，由測試把關                                                                                                         |
| `src/core/visuals/library.ts`              | 核心模組，見下                                                                                                                                                                           |
| `src/core/capabilities/registry.ts`        | 新增 `createLibraryAssetInstruction(assetContext)`；`createAuthoringInstruction(withCoverage, assetContext)` 與片段指令改列候選素材；不再列 `BUILT_IN_*` preset                          |
| `src/main.ts` 約 4976–4990 行              | `compileProjectToBlob(project, options)` 編譯前先跑 `resolveLibraryAssets`；兩條 AI 生成路徑（約 5026、5239 行）帶 `{ replaceModelSvg: true }`；狀態訊息改用 `describeLibraryResolution` |
| `index.html`                               | CSP `connect-src` 只多加 `https://assets.scratch.mit.edu`                                                                                                                                |
| `tests/visuals/library.test.ts`            | 11 個測試：對照表、候選挑選、提示內容、補齊動畫與音效、找不到、下載失敗、換掉 AI 畫的 SVG、VM 載入、MD5 驗證                                                                             |

`library.ts` 的行為規則：

1. **候選挑選** `selectLibraryCandidates(text)`：依序取中文關鍵字命中（長詞優先，例如「北極熊」先於「熊」）、英文名稱命中、常用素材（Cat、Ball、Star…）。上限 24 角色／10 背景／16 音效。
2. **只補沒有資料的素材** `resolveLibraryAssets(project, fetcher, { replaceModelSvg })`：
   - 角色造型的比對順序：造型名稱完全等於某官方造型名，再來是造型名或角色名對到官方角色（含中文關鍵字）。
   - 背景依背景名稱比對，對不到再用作品名稱。
   - 音效依名稱比對，對不到再用中文關鍵字。
3. **整組帶入**：角色只寫一個造型且對到官方角色時，補上該角色的其他造型；如果 sounds 是空的，也補上它原本的音效。
4. **換掉 AI 畫的圖**：`replaceModelSvg: true` 只用在 AI 生成路徑；匯入的 SB3 一律保留原圖。
5. **下載**：`createScratchAssetFetcher()` 會先檢查 md5ext 格式，下載後核對 MD5、在記憶體快取，失敗時不丟例外，記入 `fetchFailures`，該造型退回 preset 簡單圖形。

### 4.2 品質基準工具（步驟 0a）

| 檔案                                 | 作用                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research/game-quality-benchmark/cases.json` | 10 題：catch-apples、space-dodge、space-shooter、mouse-maze、jump-collect、pop-balloons、two-player-pong、deep-sea-rescue、car-racing、whack-a-mole。每題定義按鍵與預期移動軸向，以及是否預期自己動、狀態變化 |
| `research/game-quality-benchmark/README.md`  | 用法與各檢查項定義                                                                                                                                                                                            |
| `scripts/bench/game-benchmark.ts`          | `npm run benchmark:games -- prompts                                                                                                                                                                           | generate | score --run <dir> [--cases a,b] [--force]` |
| `src/cli/playtest.ts`                | `PlaytestRunner`：以 vite preview 開 `dist/preview.html`，用 headless Chromium 送鍵盤和點擊，透過現有的 `capture-game-progress` 訊息讀取角色和變數狀態，再比對截圖像素                                        |

評分項目：builds、runs、moves-on-its-own、key（每個按鍵一項）、state-changes-in-play、library-art、plays-sound、animated-sprite。分數 = 通過數 ÷ 項目數。

### 4.3 驗證紀錄（2026-11-10）

- `vitest run`：74 個測試檔、613 個測試全部通過。
- `npm run build`：通過；APP 打包 1.51 MiB gzip，上限 1.75 MiB。
- `npm run test:browser`：Chromium 完整回歸 smoke 通過，含修復／重匯入迴圈、學生操作、離線 reload、CSP、官方 SB3 預覽與品質量測。
- `npm run test:student-flow`：學生候選預覽、捨棄、採用、重新載入與儲存失敗流程通過。
- `npm run test:asset-library-browser`：Chromium 線上下載官方 Apple 素材，SB3 內原始位元組 MD5 為 `3826a4091a33e4d26f87a2fac7cf796b`，狀態列顯示官方造型／音效且 CSP 違規為 0；斷網時退回簡單圖形並顯示下載失敗，CSP 違規仍為 0。
- T0b 本機 baseline：使用 `qwen3-coder-next-80b-local`（`http://172.22.35.142:8091/v1`），10/10 題回覆生成完成；pipeline build 0/10，parse 2/10、normalize 8/10，runtime／素材／音效／動畫檢查皆未執行。最常見失敗為 `requirementCoverage` evidence pointer 不存在或指向非 block（8 題），另有 2 題 JSON 語法不完整。證據：`research/game-quality-benchmark/runs/2026-11-10-local-qwen3-coder-next-80b-local/report.{json,md}` 與 10 份 prompt／response。
- T2a 最終本機對照：同一 `qwen3-coder-next-80b-local`、同一 10 題，學生提示由原本約 13K 壓到 5,878–5,939 字；最終 `t2a-r3` 平均 check pass rate 8%，`builds` 1/10、`runs` 1/1、`plays-sound` 1/1、`animated-sprite` 1/1，`two-player-pong` 單題 82%。`t2a`／`t2a-r2` 是提示詞迭代證據：前者 0/10（語意錯誤），後者 0/10（模型輸出 JSON 語法錯誤）。證據：`research/game-quality-benchmark/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2a-r3/`。
- 為保留官方素材的精確 `md5ext`，修正 compiler／project JSON／decompiler 的 raw-byte MD5 路徑；新增 exact-archive-MD5 回歸測試。
- 新增和修改的檔案 ESLint 零錯誤、Prettier 通過。全套件 lint 沒有跑，既有基準約 1,388 個錯誤。
- 基準試跑：兩份手寫回覆，平均 78%，未通過的是 plays-sound 和 animated-sprite。截圖確認畫面是官方貓、蘋果和 Forest 背景。
- **沒跑的**：真實模型、部署。

### 4.4 已知限制與風險

1. 補齊造型會帶入該官方角色的**全部**造型。有些角色的造型是不同顏色或款式（Ball-a～e、Fish-a～d），用 `looks_nextcostume` 時會換色而不是動作動畫。可以考慮對這類角色只補「看起來像動畫」的造型。
2. `latestLibraryReport` 是模組層級的變數。如果兩次編譯同時進行，例如即時修改預覽和製作作品並行，狀態訊息可能顯示別次編譯的結果。
3. 試玩不追蹤分身（clone），點擊只會點原始角色；按鍵是在 iframe 內用合成的 KeyboardEvent 送出。遊戲如果在測按鍵前就結束了，按鍵檢查會失敗，這屬於真實的品質訊號，但判讀時要看截圖。
4. T2a 已把學生製作指令壓到 6K 內，但本地 Qwen 仍常把廣播 input、變數 reporter 或事件腳本寫錯；提示改善後已有 1/10 可完整 build，尚不足以宣稱模型能穩定產出作品。
5. 首頁寫著「專案不上傳」。現在會向 Scratch 官方伺服器下載素材，作品本身不會上傳，但說明文字應該補上（T1c）。
6. 中文對照表約 300 詞，靠人工挑選，還沒有命中率數據。可用 0b 報告裡的 placeholder 清單補詞。

## 5. 共同規則（每張卡都適用）

- 用繁體中文和使用者溝通。不 push、不部署、不開 PR，除非使用者明確要求。
- 開工先跑 `git status --short --branch`。跑完測試後，`research/dual-front-game/__pycache__/costume_shapes.cpython-313.pyc` 常會被改到，用 `git checkout -- <path>` 還原，**不要提交**。
- 不要碰 paper-feedback 工作樹和學生的原始作品，也不要自行搜尋任何金鑰。
- 修 bug 先寫會失敗的測試（見 AGENTS.md）。commit 訊息使用 Conventional Commits，結尾附上 Co-Authored-By。
- 品質門檻：`npx tsc --noEmit -p packages/scratch-ai-bridge`、`vitest run`、`npm run build`（含打包預算）都要通過；改過的檔案 ESLint 和 Prettier 零錯誤，不要整包 `--fix`。
- 影響成品的改動，必須附上 `benchmark:games` 的前後比較，用同一個模型、同一份 cases。不要只用單元測試宣稱品質提升。
- 不另開新的計畫文件，進度一律寫回本檔。

## 6. 任務卡

### T1b 在真實瀏覽器驗證素材下載（約 30 分鐘）

- **目的**：確認上線後，主站在 CSP 限制下能從 `assets.scratch.mit.edu` 下載素材，製作出含官方素材的 SB3。
- **做法**：`npm run build` 後用 `vite preview` 開主站，貼上一份手寫回覆，裡面有造型 `{"name":"Apple","dataFormat":"svg"}`（結構可參考 `tests/visuals/library.test.ts`），按「檢查並製作 Scratch」。可以參考 `scripts/smoke/student-flow-smoke.mjs`，把它寫成 Playwright smoke。
- **驗收**：
  - 下載的 SB3 裡 Apple 造型的 MD5 是 `3826a4091a33e4d26f87a2fac7cf796b`；
  - 狀態列顯示「已放入 N 個 Scratch 官方造型」；
  - 瀏覽器 console 沒有 CSP 違規；
  - 斷網時退回簡單圖形，並顯示「下載失敗」說明。
- **注意**：service worker 只攔截同源請求（`scripts/build/generate-service-worker.mjs`），不會擋下素材下載。

### T0b 真實模型基準（約 1 小時，需要使用者協助）

- **目的**：取得改動前後可以比較的分數，之後每一步都對照這份基準。
- **做法**：
  1. 向使用者取得 `BENCH_BASE_URL`、`BENCH_MODEL`、`BENCH_API_KEY`；或請使用者把 `prompts` 產生的 10 份訊息貼到 Gemini 或 ChatGPT，回覆存成 `<id>.response.txt`。
  2. 執行目錄放在 `research/game-quality-benchmark/runs/<日期>-<模型>/`。PNG 已被 gitignore；report.md、report.json 和回覆要提交，當作基準。
  3. 想知道素材庫本身的效果，可以把 `main` `aa094128a0` 的提示和本分支的提示各跑一輪，比較 library-art 那一項。
- **驗收**：本檔的進度表填入模型名稱、日期、各檢查項通過率，以及最常見的 3 種失敗原因。

### T2a 精簡製作指令並附完整範例

- **目的**：讓 AI 少犯錯、輸出變短（R1）。
- **做法**：
  - 在 `registry.ts` 的 `createAuthoringInstruction`／`createStudentProjectInstruction`：
    - 附一份**完整、可玩**的小遊戲 IR 範例，例如接東西遊戲，用官方素材、音效和造型切換。範例要放進 `src/core/ir/examples/` 並有測試確認它能編譯；
    - 積木清單只列遊戲常用的約 50 個，其他在需要時再提供；
    - 學生版指令拿掉 requirementCoverage 的 JSON Pointer 記帳，改成簡單的 `"features":["..."]` 清單，或乾脆移除，要同步檢查 `response-envelope.ts` 和 UI 上依賴它的地方；
    - 要求 AI 在得分、碰撞、勝負時播放音效，會動的角色用造型切換做動畫。
- **驗收**：
  - 指令 ≤ 6,000 字元，用 `estimatePromptSize` 量；
  - 同一個模型跑 0b，builds、plays-sound、animated-sprite 的通過率都不低於 baseline，且平均分數提高；
  - 既有測試同步更新。

- **完成紀錄（2026-11-10 Codex）**：新增 `src/core/ir/examples/07-apple-catcher.json` 與可編譯測試；學生版改用常用 opcode、官方素材短候選、完整接蘋果範例及 `features` 清單；response envelope 與學生結果 UI 同步支援 `features`，舊的 `requirementCoverage` 仍向後相容。最終同模型重跑 10 題，提示 5,878–5,939 字，平均 8%（baseline 0%），符合本卡最低驗收；非零結果集中在一題，後續若要提升模型穩定性應處理廣播／輸入契約或進入 T2b scratchblocks 實驗。

### T3 網頁內自動試玩與玩法回饋

- **目的**：學生按「製作」後，Bridge 先自己試玩幾秒，抓出「按鍵沒反應、什麼都不動、分數不會變」，並給出可以直接複製回 AI 的修正訊息（R3）。
- **做法**：
  - 主站已有 preview iframe 和 `capture-game-progress` 訊息協定，可以重用 `src/cli/playtest.ts` 的判斷邏輯，把純判斷部分抽成瀏覽器和 Node 共用的模組。
  - 從需求文字推斷控制鍵，例如提到「左右鍵」或「空白鍵」。推斷不出來時，就只檢查「會不會自己動」和「狀態有沒有變」。
  - 失敗時產生白話說明和修正訊息，接到現有的 repair handoff（`createRepairPrompt` 一帶）。
- **驗收**：
  - 用故意寫壞的 fixture 測試：按鍵沒綁定、迴圈裡沒有移動積木；應各自被抓到，並提示正確的修正方向；
  - 好的 fixture 不能誤報；
  - 試玩總時間 ≤ 5 秒，有進度顯示。

- **完成紀錄（2026-11-10 Codex）**：新增 `src/core/playtest/feedback.ts`，把需求按鍵推斷、按鍵／角色位移／變數變化判斷與白話修正訊息抽成瀏覽器與 Node 共用模組；`src/cli/playtest.ts` 改用同一套純判斷。學生完成製作後，預覽 iframe 會在 4.5 秒預算內自動啟動、擷取進度、測試推斷出的按鍵，並顯示進度與通過／警告結果；警告會附加到既有 `createRepairPrompt` handoff，可直接複製回 AI。新增 `playtest-key` 安全訊息協定、自動試玩取消門，未改變既有手動預覽流程。4 個單元測試覆蓋未綁定按鍵、空迴圈、正常平台遊戲與無法推斷按鍵時的自主進度檢查；`npm test` 77/77 檔、622/622 測試，`npm run test:student-flow`、build／bundle budget、改檔 ESLint／Prettier 通過。完整 Chromium smoke 曾在本次整合中通過一次；後續重跑於不同步驟出現非固定 renderer `ERR_ABORTED`／預覽重載等待逾時，未視為穩定通過，需後續另追環境或既有 smoke 時序。T3 只改執行期試玩與回饋，未改模型提示或生成 pipeline，因此未重跑 Qwen 10 題生成 benchmark；沿用 T2b 同模型證據作為生成品質基準。尚未 push／部署。

### T1c 素材體驗補完

- **做法**：
  - 作品完成後顯示「本作品使用的素材」縮圖列。每個角色有「換一個」按鈕，候選來自同標籤或同中文關鍵字的官方素材；換的時候只改 costumes 和 sounds，不動積木，然後重新編譯。
  - 首頁說明補一句：只會向 Scratch 官方伺服器下載素材，作品本身不會上傳。
  - 離線備援：使用瀏覽器 Cache Storage 以 `md5ext` 驗證後保存已下載素材；暖快取可離線重建，冷離線則顯示清楚的下載失敗與簡單圖形 fallback，不把第三方素材直接打包進 repo。
  - 處理限制 4.4-1：對顏色款式型的官方角色只補第一個造型，或改用標籤判斷。
- **驗收**：`npm run test:asset-library-browser` 以 Chromium 驗證線上官方 Apple MD5、角色換成 Cat 後重新編譯下載、按「回到上一個可用作品」復原、同一 context 暖快取離線與全新 context 冷離線 fallback；兩種離線情境 CSP 違規皆為 0。`npm test` 75/75 檔、616/616 測試，build 與 bundle budget 通過；首頁隱私文字明確說明只下載 Scratch 官方素材且作品不會上傳。

### T4 首頁精簡（R4）

- **做法**：
  - 主線只留：寫想法 → 複製 → 貼回 → 頁內試玩 → 下載。
  - 修改作品、玩法討論、大型作品分片、教師工具，等作品出現後才顯示，或收進「進階」。
  - 修正步驟編號「1、2、2」，以及第二個步驟 2 的說明矛盾。
- **注意**：`src/main.ts` 的 HTML 模板在約 520–1100 行。改之前先和使用者確認 paper-feedback 工作樹的狀態，避免大範圍衝突。拆檔（生成、匯入分析、教師工具各一檔）可以和 T4 一起做，但要分開提交。
- **驗收**：`test:student-flow` 和 `test:browser` 都通過；首頁首屏的按鈕數有明顯下降，記錄改前改後的數字；附桌面和窄螢幕截圖。
- **完成紀錄（2026-11-10 Codex）**：主線保留「寫下想法 → 複製製作訊息 → 貼回回答 → 檢查並製作 Scratch」，將想法範例、玩法討論、大型作品片段、範例載入與教師／進階工具收進折疊區；既有作品檢查頁籤改以「進階：檢查已有作品」呈現，保留原 aria 名稱供既有測試與輔助技術使用。修正首頁步驟文字為「1 寫下想法、2 交給 AI、3 貼回回答、4 試玩下載」。以 `#generate-panel` 初始可見按鈕計算，改前 7 個（3 個靈感範例、2 個複製操作、製作、載入範例）降為 2 個（複製製作訊息、檢查並製作）；桌面與 390px 窄版截圖已保存於 `test-results/t4-home-desktop.png`、`test-results/t4-home-narrow.png`。`npm run build`、`npm run test:student-flow`、改檔 ESLint／Prettier 通過；browser smoke 的 renderer bundle 可預期取消由 T5 修正後，`npm run test:browser` 連續兩次通過；尚未 push／部署。

### T2b scratchblocks 文字格式實驗（視 T2a 結果決定）

- **問題**：讓 AI 輸出 scratchblocks 文字，再由 Bridge 轉成 IR，是否比 JSON 更準？
- **做法**：新增獨立 `src/core/scratchblocks/parser.ts` 與 `scripts/bench/scratchblocks-benchmark.ts`，先支援基準 10 題實際出現的帽子、控制、移動、感測、資料、音效、廣播與分身等積木；同一 `qwen3-coder-next-80b-local`、同一 10 題送入文字格式，再轉 Canonical IR，沿用既有素材／編譯／無頭試玩 pipeline。
- **驗收**：證據目錄 `research/game-quality-benchmark/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2b-scratchblocks/`，比較報告 `comparison.md`：JSON T2a 平均 8%、build 1/10、平均回覆 17,282 字；scratchblocks prototype 平均 61%、build 10/10、run 10/10、平均回覆 757 字、parser warnings 0。結論：**採用 scratchblocks-style 作為後續受控整合方向，但暫不直接接入 UI**；尚須補齊動畫、多角色、多感測／分身語法後再整合。

### T5 文件與工程整理

- 把 gh-pages `docs/` 和套件 `docs/` 裡的舊計畫，在索引中標示「歷史參考，現行主線見 game-quality-plan.md」。不刪除，也不改寫內容。
- lint 只要求新改的檔案零錯誤；讓 CI 恢復跑 browser smoke。
- **完成紀錄（2026-11-10 Codex）**：在套件 `README.md` 新增文件入口，明確指定 `docs/history/game-quality-plan.md` 為現行作品品質主線，並將套件內既有改善計畫列為歷史參考；在根目錄 `packages/scratch-ai-bridge/docs/history/bridge-ai-tasks/README.md` 加上同樣的歷史導覽標記，指回套件主線。未刪除或改寫任何舊計畫內容。另修正 browser smoke 對預覽生命週期中 `scratch-render`／`scratch-svg-renderer` bundle 的可預期 `net::ERR_ABORTED` 誤報：只忽略帶有正確檔名模式的這類取消，其他網路失敗仍會使 smoke 失敗。文件與程式變更通過 Prettier、ESLint、`git diff --check`；`npm run test:browser` 連續兩次通過。尚未 push／部署。

## 7. 交接紀錄（新的寫在最上面）

- **2026-11-19 Claude Code（V2-12 準備）**：新增 `calibrate prepare <作品資料夾> --rubric … --out … [--teachers T1,T2] --playtest`：匿名複製作品、每位老師一份空白評分表、依 rubric 產生 `評分說明.md`，系統分數另放 `auto-report/`，老師拿到的資料夾不含任何自動分（真正盲評）。`calibrate` 可合併多份評分表（逗號分隔）、只填各項得分時自動換算 100 分制；系統分數仍 pending 的作品改為只比對已自動判定的項目（`partialScope`）。**更正**：先前的 `calibrate` CLI 因 `--teachers` 不在參數白名單而無法使用，只測過核心函式；已修正並補 CLI 測試。vitest 111 檔／866 項通過。下一步只剩真人：準備 30 件匿名學生作品與兩位老師。

- **2026-11-19 Claude Code（V2-0／V2-7）**：依使用者授權，以 `~/bin/omlx-key classroom` 取用 oMLX 子金鑰（只在指令內使用，規則記在 oMLX 手冊與 Claude 記憶），用 `Cyber-Tiel-Coder-35B` 跑三輪同模型對照。r1 暴露轉譯器問題（模型先宣告角色再用 `// ===` 註解分段、`if…then…else`、`wait secs`、中文積木、按鍵名），補齊後未支援行數約 400→214；修正輪改成只送失敗段落；benchmark 改用「需求意圖」統一計分。r2 a-b-c 退步到 0.24，根因是後段 `(replace)` 刪掉前面已驗證的功能，新增段落間回歸防護（重做一次、仍破壞就退回）。r3：a-b-c 0.72／建置 9／done 3，spec 0.38、a-b 0.27；spec 程式未變卻在 0.38～0.65 擺動，表示輪間變異大。結論與數字見 `research/project-quality-benchmark/runs/2026-11-19-cybertiel35b-v2.md`。vitest 110 檔／864 項通過。**後續建議**：縮小 C 階段上下文（後段只帶構想摘要與相關角色大綱）、加大每題取樣數以降低變異、待真人時補 `ratings.csv` 與 V2-12 盲評。

- **2026-11-19 Claude Code（補充）**：使用者決定 V2-12 的真人盲評先跳過（狀態改為 ⏸️）。V2-0／V2-7 的 oMLX 金鑰：使用者指示從共同大腦（AI 系管師／AI 總導演）找，但兩處都記載舊金鑰已於 2026-11-17 撤銷、新金鑰刻意不寫入文件、改由環境變數注入；依第 3 節規定未翻設定檔或鑰匙圈。下一步需要使用者把金鑰存成權限 600 的檔案並告知路徑，或自行執行 benchmark 命令。

- **2026-11-19 Claude Code**：實作第 0 節主線 v2。**評分**：新增 `src/core/grading/`（rubric 格式／驗證／hash／核准、證據與自動檢查、10 種 projectType 通用評量表、formal-grade 核心、班內相對校準、教師校準、報表）、預覽頁 runtime 事件記錄（`installScratchOpcodeCounter`＋`playtest-events`，實際執行的聲音／造型／背景／對白／碰觸／分身／變數）、CLI `grade`／`rubric draft|validate|approve`／`calibrate`、MCP 五個評分工具（限 output/）、本機 JSON API（`npm run grading-api`）、教師網頁編輯器 `src/ui/teacher-rubric.html`、`docs/guide/grading.md`。**生成**：新增 `src/core/creative/`（A 自由創作提示、意圖錨點、按需能力卡、分段計畫、片段合併／回滾、A→B／A→B→C pipeline）、多角色 scratchblocks 轉譯 `parseScratchblocksProject`、CLI `create`、`docs/guide/creative-pipeline.md`、benchmark `npm run benchmark:creative` 與 10 題跨類型題目。**門檻**：`completion()` 對沒試玩的作品一律 `done=false`（V2-5）。**驗證**：`vitest` 110 檔／860 項全過；`npm run build` 與 bundle budget 通過；`test:browser`（Chromium）通過；改動檔案 tsc／eslint／prettier 全過。真實試玩實測：4 件既有作品 `grade --playtest` 正確抓到碰觸、按鍵、變數事件，缺教師判定的 2 件停在 pending；`create --mode a-b-c` 以手寫離線回覆在真實建置＋試玩下 `done=true`，單次提示最長 890 字（舊單段 5.9K～12.5K），並用評分主線評到可自動判定的 80／80。**尚未完成**：V2-0／V2-7 要真實模型（oMLX 端點回 401，需使用者提供 API key）；V2-12 要 ≥30 件匿名作品與 ≥2 位教師盲評；未 commit、未 push、未部署（工作樹另有 Codex 未提交的計畫文件修改）。**下一步命令**：`cd packages/scratch-ai-bridge && BENCH_BASE_URL=http://127.0.0.1:8000/v1 BENCH_API_KEY=<使用者提供> npm run benchmark:creative -- run --run ../../output/bench/2026-11-xx-<模型>-v2 --playtest`，再請老師填 `ratings.csv` 後 `report`；教師盲評後跑 `npm run --silent bridge -- calibrate <報告> --teachers <教師評分.csv>`。

- **2026-11-19 Codex**：新增教師自訂 rubric 主線。老師可自行設定評量項目、配分、binary／partial／components 判分方式、測試草案和證據來源；新增「大魚吃小魚動畫」30／30／40 範例，明確規定班內校準只能作用在 rubric 完成後的總 raw score，不得改寫老師的分項得分。新增 V2-15／V2-16，尚未實作 rubric 編輯器、驗證器或評分程式。

- **2026-11-19 Codex**：將現行主線由遊戲擴充為通用 Scratch 專案生成與評量。檔名保留歷史相容，但第 0 節現在涵蓋遊戲、動畫、故事、互動藝術、音樂、問答、模擬、教學與混合作品；新增 `projectType` profiles，依作品類型套用適用的執行情境與 rubric。尚未實作分類、profile 或評分程式。

- **2026-11-19 Codex**：補上 30 人班級的相對校準規劃。正式成績保留 `rawScore`，同一「年級／班級／作業／rubric」才計算 `cohortScore`，預設有效作品範圍 80～100、眾數目標約 90；未完成或低信心作品不得被排名灌分，並新增 V2-13／V2-14 驗證分布與跨年級限制。尚未實作或校準公式。

- **2026-11-19 Codex**：完成評分機制研究與規劃。確認現行 `sb3-static-v3` 只適合靜態診斷，不能直接當正式成績；新增 `static-diagnostic`／`runtime-assessment`／`formal-grade` 三層、正式 100 分 rubric、簡單作品防虛高／大型作品防低估規則、CLI／API／MCP 共用評量核心、教師批次 CSV／複核佇列與 V2-8～V2-12 任務。尚未修改評分程式、尚未完成教師校準、尚未部署。

- **2026-11-19 Codex**：建立兩階段生成主線 v2。確立「A 自由創作、B 專案轉譯、C 分段實作、D 執行修正」的責任邊界，第一階段不要求 JSON／opcode／Scratch 規格，並新增 V2-0～V2-7 任務序列。當時先以遊戲為基準；後續第 0 節已擴充為所有 Scratch 專案，尚未修改生成程式、尚未部署。

- **2026-11-10 Codex**：完成 T5 文件與工程整理。兩個索引入口現在都明確區分「現行 `game-quality-plan.md`」與歷史計畫／任務卡，舊文件內容完整保留；同時修正 browser smoke 對可預期 renderer bundle 取消的誤報，Chromium smoke 連續兩次通過；尚未 push／部署。

- **2026-11-10 Codex**：完成 T4 首頁精簡。主操作按鈕由 7 個降至 2 個，次要流程改為選用折疊區；補上桌面／窄版截圖與初始按鈕數 smoke assertion。build、學生流程與改檔 lint／格式檢查通過；完整 Chromium smoke 仍受既有 renderer `ERR_ABORTED` 非固定載入失敗影響，尚未 push／部署。

- **2026-11-10 Codex**：完成 T2b scratchblocks 文字格式實驗。新增獨立 scratchblocks-style subset parser、benchmark prepare／compare 腳本與 2 個 parser 測試；同一 Qwen 80B／同一 10 題經既有 pipeline，平均 check pass rate 由 JSON T2a 8% 提升至 61%，build 1/10 → 10/10，平均模型回覆 17,282 → 757 字，parser warnings 0。結論採用後續受控整合方向，但暫不接 UI；先補動畫、多角色與更多感測／分身語法。`npm test` 76/76 檔、618/618 測試，build／bundle budget／改檔 lint 通過；尚未 push／部署。

- **2026-11-10 Codex**：完成 T1c。新增完成作品的官方素材縮圖與「換一個並下載新版」介面，替換只改素材欄位、不改積木，並可用既有「回到上一個可用作品」復原；首頁補上官方素材下載／作品不上傳的隱私說明。`createScratchAssetFetcher` 以 Cache Storage 保存並驗證官方素材，加入暖快取離線訊息與冷離線 fallback。Chromium smoke 驗證線上下載、Apple raw-byte MD5、換成 Cat、復原、暖／冷離線、CSP 0 違規；`npm test` 75/75、616/616，build 與 bundle budget 通過；尚未 push／部署。下一步可進入 T2b scratchblocks 實驗或 T3 自動試玩回饋。

- **2026-11-10 Codex**：完成 T2a。新增可編譯的官方素材接蘋果範例，學生提示改成 ≤6K、常用 opcode 與 `features` envelope；`npm test` 75/75 檔、616/616 測試，build、改檔 ESLint／Prettier 全通過。用同一 Qwen 80B 本地模型重跑三輪，最終 `t2a-r3` 10 題平均 8%，builds 1/10、runs 1/1、plays-sound 1/1、animated-sprite 1/1；尚未 push／部署。下一步依主線可做 T1c，或針對廣播 input 穩定性進入 T2b。

- **2026-11-10 Codex**：完成 T0b 本機 baseline。依 AI 系管師／Hermes 私有 provider 使用 `qwen3-coder-next-80b-local`（`http://172.22.35.142:8091/v1`）生成 10 題；10/10 回覆成功，但 0/10 通過 Bridge pipeline：8 題是 `requirementCoverage` evidence pointer 錯誤，2 題是 JSON 語法錯誤。這是目前 Qwen 80B 的品質基線，不是瀏覽器執行失敗；下一步依序進入 T2a，或先修正 requirementCoverage 輸出契約後重跑對照。
- **2026-11-10 Codex**：完成 T1b。新增 `scripts/smoke/asset-library-browser-smoke.mjs` 與 `test:asset-library-browser`，以真實 Chromium 驗證官方 Apple 素材下載、CSP、斷網 fallback；發現並修正 VM 編譯後官方 SVG raw-byte MD5 被正規化的缺陷，保留官方 `3826a4091a33e4d26f87a2fac7cf796b`。`vitest` 74/613、build、`test:browser`、`test:student-flow` 均通過；未 push、未部署。下一步仍是 T0b，需向使用者取得模型端點／金鑰或 10 份模型回覆。
- **2026-11-10 Claude Code**：完成診斷（第 1 節），完成 0a 和 1a，commit `b78adb48f1`，未 push、未部署。下一步請先做 T1b，再向使用者取得模型端點做 T0b。使用者已明確表示：Scratch 內建素材完全沒有發揮用途，AI 也畫不出像樣的 SVG。所以 AI 不得繪圖、一律使用官方素材，這是本主線的設計前提。
