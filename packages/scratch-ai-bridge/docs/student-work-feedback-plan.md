# 學生 Scratch 作品理解與有價值回饋改善計畫

日期：2026-10-15
狀態：核心實作第一版已完成，正進行真實作品誤報修正與外部品質驗收。2026-10-16 完成事件帽積木辨識、合法 EFFECT 大小寫容錯、未知擴充入口降級為資訊提示、具體積木證據定位，以及學生 AI 提示詞修訂；Bridge 全套 442 項測試、lint/Prettier、production build/bundle budget 和 Chromium/Firefox/WebKit browser smoke 通過。SB3-only 100 分規準尚未經教師校準，學生可用性測試與原生 Safari 新增定位互動驗收仍未完成，因此不能宣稱正式評分品質或全案發布門檻已通過。

2026-10-16 補充：`sb3-static-v2` 開始把沒有使用的資料/互動面向標為 N/A，不再視為滿分；總分按適用面向換算，無足夠 evidence 時不顯示。評分 UI/CLI/Gemini 提示已統一稱為 SB3 結構參考分。此為工程第一輪，不代表 rubric 已完成教師校準；詳見 `docs/teacher-review-improvement-plan.md`。

## 1. 產品目標

學生上傳 `.sb3` 後，Bridge 應能：

1. **說清楚作品目前做了什麼**：用學生看得懂的語言摘要角色、事件、主要行為、變數/清單、廣播與自訂積木之間的關係。
2. **指出依據與限制**：每個重要觀察可回到角色、腳本、積木或素材；對不支援積木、缺少 runtime、或未執行驗證的部分明確標示。
3. **給出可採取的下一步**：回饋有具體證據、解釋可能影響、提供一個可由學生選擇的檢查/改進步驟，而不是只列警告或替學生完成作品。
4. **保護作品與學生資料**：原始 SB3 保持可下載；預設在瀏覽器本機分析。只有學生/教師主動複製提示給外部 AI 時才傳出內容，且不附素材 data URL、姓名等不必要資料。

Bridge 的分數只代表 SB3 檔案可見的作品完成度與程式結構品質，不代表學生能力、創意或學習歷程。不得依積木數或程式長度直接推斷作品好壞，也不得把靜態猜測說成已驗證的 bug。回饋採形成性方式：觀察、證據、可能影響、下一步或反思問題。

### Phase G — SB3 檔案限定的 100 分規準與 Gemini 回饋提示

本模式不要求老師另交作品需求、不要求學生填問卷或提供測試紀錄。評分輸入只有上傳的 `.sb3`；分數對象是檔案裡看得到的程式作品，不是學生本人。採一般 Scratch 專案均可使用的通用規準，不能把特定遊戲功能、積木種類或美術風格列為必備。

| 評分面向               |    配分 | 只從 SB3 檢視的內容                                                                                                         |
| ---------------------- | ------: | --------------------------------------------------------------------------------------------------------------------------- |
| 作品結構與可辨識的行為 |      25 | 是否有可辨認的起始/互動腳本，角色、事件與指令是否形成可理解的作品行為；以實際內容為準，動畫、故事、遊戲、藝術作品均適用。   |
| 程式邏輯與流程         |      25 | 指令順序、事件、迴圈、條件與等待等控制流程是否前後合理；只評實際用到的結構，不要求每種積木都出現。                          |
| 變數、清單與狀態運用   |      15 | 若作品使用狀態或資料，初始化、讀寫及跨腳本用途是否一致；作品不需要資料時，依其餘可見程式證據評分，不因沒有變數/清單扣分。   |
| 角色互動與回饋設計     |      15 | 可見的鍵盤/滑鼠/碰撞/廣播等互動，及造型、訊息、音效或位置變化是否支持作品行為；依作品類型評，不以特定互動方式作門檻。       |
| 靜態完整性與錯誤風險   |      15 | SB3 結構是否完整，腳本連接/引用是否有效；只計可由檔案結構或已校準規則確認的問題。無法由靜態檔案驗證的執行結果不得假稱已測。 |
| 腳本可讀性與組織       |       5 | 腳本分工、重複/堆疊及命名是否有助理解；不按角色或積木數量計分。                                                             |
| **合計**               | **100** |                                                                                                                             |

每一面向依四級描述給分：充分且一致地呈現該面向（該項滿分）、大致成立但有明確缺口（約 75%）、只有部分證據或多處不一致（約 50%）、檔案中有足夠可讀證據證明該面向未成立（0–25%）。每個分數都需列出 SB3 內可定位的證據；不得因「沒看到」就推論不存在，也不得把 Bridge 不支援的 opcode 當成學生錯誤。若 SB3 結構損壞或大量內容無法讀取，仍呈現各項證據與暫定總分，同時醒目標示讀取覆蓋率及「分數可信度有限」，而非捏造確定結論。

此分數不評實際執行穩定性、測試/debug 過程、作者理解程度、合作歷程、創意或美感，因為單靠 SB3 無法可靠判斷。也不以「沒有測試證據」扣分。`script/block count` 只能描述作品規模或定位，不可當成品質代理指標。此處總分是六面向加權後的檔案分數，不是正規化的學生能力分數。

分數由 Bridge 的固定規則計算；Gemini 只負責把已計算的各項分數與證據改寫成學生易懂的回饋，不可更動分數、補造執行結果或新增檔案以外的事實。複製給 Gemini 的提示需包含規準、各面向得分/配分、證據與分析覆蓋限制。模型輸出格式為：一個具體優點（帶證據）、一個最值得嘗試的小改進、一個簡短引導問題；若證據不足，直接說無法判斷。複製動作由學生主動觸發。

**Phase G 驗收條件**

- 同一 SB3 在相同 analyzer/rubric 版本下得到可重現的六項分數與總分。
- 每個非滿分項列出可定位的 SB3 證據及對應扣分理由；每個滿分項也指出支持判斷的證據。
- 以故事、動畫、遊戲、藝術及不同複雜度作品檢查規準，不因沒有變數、廣播、迴圈或多角色而自動扣分。
- unsupported/opaque blocks、匯入缺損和不完整 archive 顯示覆蓋限制；Bridge 無法解析的內容不直接判成作品缺陷。
- Gemini 提示明確禁止更改分數、虛構執行/測試、以積木數量作評語或評斷學生能力；模型回覆必須連回證據 ID。
- 由教師以匿名代表作品校準四級描述與權重；校準完成前，UI 清楚標示「依 SB3 靜態結構產生的暫定作品分數」。

**2026-10-15 首版執行紀錄**

- 新增 `createProjectScore()`，輸出固定 rubric 版本、六項配分、總分、分析覆蓋率、限制及證據 ID；目前由本機規則計算，Gemini 不參與計分。
- 匯入分析畫面新增分數明細和可跳轉證據；unknown/opaque 積木只影響覆蓋率/信心提示，不直接列為學生錯誤。
- 新增可複製 Gemini 提示，只帶評分、匿名角色序號、opcode 與有依據的作品觀察，不帶素材、原角色名稱或 SB3 原始資料。
- 首版公式屬明確可重現的靜態規則，雖已通過後續程式建置與定向測試，仍未經教師校準。須以匿名多類型作品人工 review 後才能作正式評量使用。

## 2. 現況與證據

目前 Bridge 已有安全 ZIP/Raw Archive、Raw Block Graph、有限範圍 Canonical IR、Scratch VM/renderer 預覽、Analysis IR、規則診斷，以及學生/教師兩種外部 AI 提示。`AnalysisIR` 目前著重計數、script opcode/變數讀寫、程序/廣播/監視器/素材/extension 依賴；UI 主要呈現計數、診斷文字、角色與腳本數。提示會帶入完整 Analysis IR 和 Canonical IR。它還沒有把作品說成一段可驗證的自然語言解讀、逐項證據定位、回饋品質驗收或教師評估流程。

2026-10-15 的真實樣本測試顯示：三份作品都成功匯入與分析，但只有一份能 Canonical 回編並由 Scratch VM 載入；另兩份因 text-to-speech、video/face sensing 等不支援 opcode，及一份舊式自訂程序資料而回編失敗。Breakout 生成樣本另暴露 EFFECT 欄位大小寫、缺少 reporter input 等問題。**回編失敗不等於看不懂全部作品**；改善後須把匯入、理解覆蓋率、runtime 可用性、回編分開回報。

Gemini 2D Platformer 修正循環已找到具體的提示合約衝突候選：Canonical block schema `additionalProperties: false`，沒有 `shape` 屬性；但產生指令、`condition-not-boolean` / `boolean-input-type` 建議使用「shape=boolean 的 reporter」，Repair Prompt 又把同一能力指引重新放回提示。Gemini 產出的 IR 因而把 `"shape":"boolean"` 序列化在 block 上，schema 要求刪除，修正指引卻又可能誘發它加回。這是程式碼層已確認的矛盾；實際失敗回合的 Repair Report 與修正版未取得，因此後續錯誤仍需完整重現。

同一作品需求還列出 dynamic jump、coyote time、jump buffering、corner correction、dash/wall slide、Nintendo 四階段關卡設計及 60 FPS 目標。現有列出的 Scratch capability 可實作部分基礎移動與 coyote-time 近似，但沒有列出其餘完整機制；原提示准許簡化，故產物可以降級後仍為有效作品。當前流程卻只判斷 Canonical/VM 可接受與否，沒有把「需求完成度」獨立呈現，學生無法知道哪些目標被省略。

樣本為本機教師提供的三份作品及 Breakout 測試作品，repo 不存放原始 `.sb3`、姓名、素材或未匿名 Canonical dump。建立自動 fixture 前須匿名化、取得可用授權，或重製成等價合成案例。

## 3. 設計規則

- **先保留，再投影**：未知 opcode/extension/mutation 繼續留在 Raw Block Graph；可解讀者做語意投影，不讓 Canonical allowlist 決定是否能看到整個專案。
- **區分四個狀態**：資料已保留、積木已識別、行為可模擬/執行、回編已通過。每個 target/script 都可有不同覆蓋率。
- **回饋必須有證據**：診斷至少有 target identity 和 block ID；若是推論，標為「可能」並說出推論鏈。不要只靠 target/script 順序索引定位。
- **把靜態事實和執行事實分開**：未跑 VM 的建議標為靜態檢查；runtime/extension 未啟用時，不下行為結論。使用 VM 驗證時記錄 VM 版本、限制與測試輸入。
- **呈現作品意圖，不替作品定價值**：可以摘要可觀察到的玩法/互動；創意、美感、難度、作者是否理解等無法單從 SB3 確定的事項要詢問學生或教師。
- **規則警告需校準**：先證明觸發條件、負例與實際影響，再顯示為警告；低信心觀察不得與確定錯誤同級。
- **分層回饋**：學生模式先肯定一個具體設計，再給一個反思問題及一個小步驟；教師模式提供證據、可能概念/除錯目標與未觀察到的面向。不得只用命令句要求重寫。
- **瀏覽器靜態部署保持可行**：本機理解不依賴 API key。外部 AI 是明確選用的第二步；提示採最小必要、無素材內容的證據包。

## 4. 執行階段

### Phase 0 — 修正 Gemini Canonical IR 修正循環（P0）

**根因**：`src/core/ir/schema.json` 的 block 定義禁止未列欄位；`CanonicalBlock` 沒有 `shape`。但 `src/core/capabilities/registry.ts` 的產生指令使用「shape=boolean reporter」，`src/core/repair/report.ts` 的兩種布林修正建議重複這個說法；`main.ts` 複製修正提示時，還會再次附上原本產生器指引。這使「刪除 schema 不允許的 `shape`」和「使用 shape=boolean reporter」同時出現在同一個修正回合。

**工作**

- 統一用語：明確說「block 的 command/reporter/boolean/hat shape 由 `opcode` 對應的 capability 決定；Canonical JSON 的 block 物件不得輸出 `shape` 欄位」。替換產生指令、所有語意建議、Repair Prompt 與文件中會被模型當成 JSON 欄位的說法。
- 設定唯一能力規格來源。authoring prompt 和 repair prompt 都從同一份 Canonical contract 生成，並在修正提示末尾明確寫出 schema 合約優先於原作品需求文字。
- 在 `normalizeAiDraft()` 增加**限縮於 block 節點**的相容處理：移除冗餘 `shape` 並記為 Bridge 已做的 normalization，而非要求 Gemini 再修。已知 opcode 時比對 registry shape；不一致時同時記錄非阻擋資訊，且執行語意仍以 opcode registry 為準。不可增加「任意刪除所有未知欄位」的寬鬆處理。
- Repair Report 對 `additionalProperties` 保留精確 JSON Pointer、屬性名稱、實際值和 `removeProperty` 範例；同一問題重現時顯示「仍未修好」及前後 issue fingerprint，避免重複貼同一句建議。
- 對輸入 IR、正規化後 IR、schema/semantic 結果、compiler 結果建立一次完整的可下載驗證報告，精確指出是哪一階段拒絕；只保存 hash/issue，不把原始 Gemini 對話寫入產品資料庫。

**回歸驗收**

- 測試 prompt builder：生成指令、一般修正提示、含原始需求的修正提示都明確禁止把 `shape` 當 JSON 欄位，且不含自相矛盾的用語。
- 對本次 Platformer 的匿名最小 fixture，所有匹配的 `shape` metadata 經一次 normalization 後移除、報告留下紀錄，Canonical schema 與 semantic validation 通過；其餘積木/輸入/原始意圖完全不變。
- 加入 shape 與 opcode 衝突、unknown opcode、巢狀 Boolean reporter、重複錯誤與混合其他 schema 錯誤案例。只正規化 block 上的 shape，不影響 Canonical metadata、fields 或其他物件。
- 端到端回歸：原始 IR → Repair Report → Gemini 式修正版（含多個 shape 標籤）→ normalization → schema → semantic → Scratch VM compile/load。流程一輪完成，沒有同一 issue 原地重複。
- 這一階段獨立完成後再處理作品功能覆蓋率；編譯成功只代表輸出可接受，不代表需求全部完成。

**2026-10-15 執行紀錄**

- authoring 與 repair 提示已改為說明 `shape` 只描述 registry 中的積木類型，Canonical block JSON 禁止序列化 `shape`。
- `normalizeAiDraft()` 僅在實際 block 節點移除 `shape`，並留下 JSON Pointer 與 normalization repair；其他物件（含根層 `meta.shape`）不受影響。
- 回歸涵蓋 hat/reporter 節點、shape/opcode 不一致、Gemini-style platformer 編譯；schema、semantic validation 與 SB3 compiler 均通過。
- Repair Report 現在可比對前次/本次相同問題 fingerprint，修正提示會列出持續存在的問題，並有 shape 矛盾回歸測試。真實 Gemini 複製/貼回仍需人工模型會話驗收。原先記錄的 420 項是該次歷史結果，最新數字見本計畫末尾。

### Phase A — 建立基準作品集與回饋規格

**工作**

- 將目前三個實例匿名為 Sample A/B/C，另以 Breakout 作為對照；補入官方 VM fixture 與合成邊界案例，涵蓋基本動畫、遊戲、敘事/對話、廣播、多角色、變數/清單、procedure、extension、缺損素材及畸形舊資料。
- 為每案建立人類可核對的標註：可見玩法摘要、關鍵 target/script/block ID、確定事實、合理推論、不得推斷事項、可接受提示、錯誤警告負例。由至少一位 Scratch 教師 review；涉及評量面向時由第二位教師覆核。
- 建立回饋語氣/安全規格：不羞辱、不排名、不把缺少特定積木當成缺陷；標出 SB3 無法觀察的創作/協作/反思過程。
- 量測目前 `AnalysisIR` 與 prompt 對輸入大小、素材 data URL、外部複製內容的影響；記錄但不把學生原文/素材放進 CI log。

**驗收**

- 每案有可重現的 fixture ID、來源/授權狀態、期待解讀與負例；公開 repo 不含可識別學生資料。
- 兩位覆核者能分辨「直接觀察」「推論」「未知/不可觀察」；爭議項留在標註，不假裝有客觀答案。

### Phase B — 建立可追溯的作品理解模型

**主要模組**：`src/core/analyzer/`、`src/core/graph/`、`src/core/decompiler/`、`src/core/extensions/`、`src/core/capabilities/`。

**工作**

- 為每個 target/script 建立穩定識別與 block evidence path；分析結果以 block ID 為主，索引只用於顯示。新 Analysis IR 版本須提供明確 migration/舊版相容策略。
- 建立 project/story map：角色用途線索、帽子事件、主要指令序列、控制結構、狀態變數/清單、procedure 呼叫、broadcast sender/receiver、碰撞/輸入/造型/音效關係。每項保留來源積木 ID。
- 增加 per-script 語意 coverage：已識別 opcode、保留為 opaque 的 opcode、無法解析的結構、extension runtime 狀態。以 coverage 限制摘要可作的陳述。
- 盤點鎖定版 Scratch VM 真實 opcode 定義/欄位/輸入型別，使用 registry/adapter 描述支援範圍；不靠猜 opcode 名稱填 schema。對官方 extension、教師常用 extension、第三方 extension 分類為 fully-understood、preserved-only、runtime-unavailable、malformed。
- 修正真實樣本暴露的匯入投影問題：legacy procedure 空名稱/argument reporter 映射、EFFECT enum 大小寫正規化（僅限已確認欄位）、缺輸入 reporter 的 default/shadow 語意；未知原值仍需在 raw graph 保存。
- 同一份作品允許部分解讀與原始下載；Canonical 編譯錯誤不可抹掉已成功的 raw analysis。

**驗收**

- Sample A/B/C、Breakout 和官方 fixtures 全部能產生結構化 project map；raw graph block count 與 opaque opcode 數可核對。
- 任何 unsupported block 都能在報告找到 target、block ID/opcode、payload 保留狀態與 runtime 限制。
- 每句 project map 中的可驗證事實都能展開到具體積木；不同格式下重匯入不因陣列順序改變 evidence identity。
- 匯入/分析成功率、回編成功率分開統計；不以放寬驗證或丟積木提高數字。

### Phase C — 實作規則型「理解摘要與回饋」引擎

**主要模組**：`src/core/analyzer/` 新增 `project-map`/`feedback` 類型與版本化測試；UI 先接摘要而非直接暴露 JSON。

**工作**

- 從 project map 產生短摘要，例如「按綠旗後，角色 A 初始化分數並廣播開始；角色 B 收到訊息後開始移動」。只在資料依賴能證明時寫出因果；parallel scripts 說成同時啟動，不虛構順序。
- 診斷分為 `confirmed-structure`、`likely-behavior`、`design-question`、`unsupported-feature`。每項有 severity/confidence、evidence IDs、可能影響、建議的確認方法與修正提示；修正不是唯一答案。
- 將規則做成帶證據與反例的 registry。先處理高價值項：缺失廣播接收端/送出端、未宣告變數/清單/角色、procedure metadata 異常、可能不可達腳本、確定無效素材、事件依賴。對 `forever-reinitialize`、detached stack 等易誤報項先以 corpus 校準，低信心改成「觀察到」或不顯示。
- 新增正向、具體觀察（例：有兩種事件控制同一角色、用變數追蹤分數）；禁止用腳本數、積木數或 extension 數當成品質評分。
- 將使用者原始需求拆成 requirement coverage map：每項標記完整做到、簡化近似、未做到或無法由 SB3 驗證，並附積木證據/缺少能力。需求要求降級時，仍可接受可執行作品，但不可讓學生誤以為 dash、wall slide、jump buffer 等全都已完成。
- 如規則需要執行才能確定，產生受限驗證步驟：VM/renderer sandbox、固定 ticks/timeouts、隔離 extension/hardware，沒有可用 runtime 就停在假設並請人確認。

**驗收**

- 高嚴重度/確定型規則的人工標註 precision ≥95%；每個警告都帶可定位 evidence；低信心項不當作 bug。
- 作品摘要的角色/事件/變數/廣播事實在 fixture 上 100% 對應來源證據。無證據的玩法描述必須標成推論或問題。
- Breakout 不再把正常碰撞反彈/計分寫成「應搬離 forever」；守護者樣本的 unsupported extension 不生成虛構感測結果。

### Phase D — 有證據的 AI 學習助教流程

**主要模組**：`src/core/prompt/prompt.ts`、prompt tests、Analysis IR serialization 與回饋 UI。

**工作**

- 由整份 IR 改為版本化「evidence packet」：作品摘要、已確認事實、具 block ID 的證據片段、diagnostics/信心、unsupported 限制、學生問題。預設不含 asset base64、原始姓名、無關腳本或整包 project JSON。
- 要求 AI 每個事實附 evidence ID；分欄輸出觀察、推論、建議/提問和未知事項。無法從證據回答時明確回答「無法判斷」，禁止補造積木或執行結果。
- 學生模式採提示階梯：先定位與提問，學生要求後才展開下一層；教師模式顯示完整依據、替代解釋與未驗證假設。教師可設定課堂目標，但目標外的技巧不是錯誤。
- 提供本機規則回饋，不連外也有可用結果。外部 Gemini/其他 AI 仍是使用者明確複製證據包後使用，GitHub Pages 不保存 API key、不自動上傳 SB3。
- 建立 Gemini/模型輸出 fixture，測 hallucination、錯引用、忽略 unsupported、資產/個資外洩及過度完成答案。
- 增加版本化 AI response envelope，與 Canonical project 分開承載需求追蹤：`project` 為完整 Canonical IR；`requirementCoverage` 將每項原始需求拆成可審核項目，標示 `implemented-structure`、`approximated`、`not-implemented`、`runtime-unavailable` 或 `not-verifiable-from-ir`，並附 project JSON Pointer/evidence。保留現有裸 Canonical IR v1 輸入，舊回覆的需求覆蓋顯示為「未提供」，不把新 envelope 混進 Canonical project 或 SB3。
- client 驗證 envelope 內 project 的既有 schema/semantic/VM gates；另驗證 evidence pointer 是否存在、opcode 是否符合、能力是否支援。AI 自稱「完成」不能取代執行證據；無法在 SB3 靜態判定的 60 FPS、手感、角落修正等標示不可由 IR 驗證。
- 把使用者原始需求保留在目前頁面工作階段，與 envelope requirement ID 逐項對照；可編譯的簡化作品仍可下載，但明確顯示未完成/近似項，不以需求覆蓋不全阻擋可執行作品。
- 對齊產生提示、schema、語意回饋與修正提示的同一份 Canonical IR 詞彙；`shape` 是 capability 描述、不是 block JSON 欄位。修正提示不得再次要求 AI 輸出 schema 禁止的屬性；對可安全去除的冗餘欄位須有明確 normalize-and-log 測試。

**驗收**

- 固定模型輸出與對抗案例中，所有事實性主張均有存在的 evidence ID；無證據主張率為 0。若外部模型不守約，UI 將該文字標為未驗證 AI 回答，不當成 Bridge 的事實診斷。
- 原始需求中的每個原子要求均顯示 coverage status；每個 `implemented-structure` 至少有可定位 evidence，每個 `verified-runtime` 必須附 VM/browser 測試情境和結果。AI 不得將未測的靜態結構標成 runtime verified。
- 裸 Canonical IR v1 仍能編譯；沒有 response envelope 時以「未做需求符合度判定」顯示，不誤報需求已完整達成。
- 複製包不含 data URL/素材 bytes；同一份作品最小問題提示不超過設定大小上限，必要時只附相關腳本。
- 外部 AI 關閉時，學生仍可看到摘要、確定問題和本機下一步。

### Phase E — 把回饋連回作品、角色與腳本

**主要模組**：`src/main.ts`、UI components/styles、`scratch-vm` block mapping 與 browser smoke。

**工作**

- 將目前純 JSON/泛化診斷展示改為三區：作品做了什麼、值得注意/尚不確定、下一個可試步驟。以學生用語為預設，教師細節可展開。
- 點選 evidence 能定位角色與腳本；在可行的 VM block ID mapping 下顯示對應積木/高亮，否則顯示積木摘要與明確定位路徑。
- 同屏顯示預覽、啟動方式與預覽限制；需要鍵盤/滑鼠的作品提供提示。只有實際執行且有紀錄才顯示「已測試」。
- 支援使用者回報「有幫助/不準確/不是我的目標」；回報不包含原始作品上傳，僅在明確同意後匯出匿名評估記錄。

**驗收**

- 三瀏覽器 smoke 覆蓋上傳、摘要、證據定位、學生/教師模式、unsupported 標示與本機無 AI 狀態。
- VoiceOver/鍵盤可讀出回饋類型、信心、來源與建議步驟；大量角色可搜尋/摺疊。

### Phase F — 教師評估、校準與發布門檻

**工作**

- 建立教師 review protocol：先讀作品預覽與用途，再看機器摘要/回饋；標記準確、有依據、有幫助、語氣合適、誤報與重要遺漏。保留「學生自己說明作品」步驟，不能從檔案猜學習歷程。
- 以至少 20 個匿名/合成代表案例做首輪評估，包含不同遊戲、故事、動畫、藝術、硬體/extension 和不完整作品；其中至少 5 案由兩位教師獨立評閱以檢查一致性。
- 按錯誤影響分級：資料損壞/錯誤確定結論阻擋發布；一般遺漏可列限制；措辭偏好由教師設定調整。每次修正都新增最小 regression fixture。
- 先以內部教師試用，再決定學生試用；若教師有系統性誤解或學生覺得像評分/批改，回到摘要和措辭設計重做。

**發布門檻**

- 上述 Phase B–E 驗收全部通過；所有核心 fixture 顯示匯入、語意覆蓋、runtime、回編四種狀態。
- 確定型錯誤回饋 precision ≥95%，證據定位 100%；教師對「有根據且可採取」評分平均至少 4/5，並報告分歧/未涵蓋類型，不只報單一平均值。
- 沒有可識別學生資料進入公開 repo、CI log 或外部 AI 提示預設內容；GitHub Pages 靜態部署無密鑰且可離線呈現本機規則結果。

## 5. 先後依賴與第一批 issue

1. **Phase 0（P0）修正 IR contract/shape 修正迴圈**：先讓平台遊戲 Canonical IR 一輪通過正規化、schema、semantic、VM compile/load。
2. **Phase A 建立匿名標註 corpus**：建立已知可編譯/部分可解讀/unsupported/legacy 案例。
3. **Phase B evidence 與 coverage model**：將已保留/已識別/runtime/回編能力拆開。
4. **Phase C project map 與規則回饋**：先做可用 block evidence 證明的事實，再加需求項目 coverage。
5. **Phase D response envelope 和精簡 AI packet**：支援裸 Canonical v1 相容；把需求完成度與輸出格式分開驗收。
6. **Phase E UI evidence navigation**：顯示結果狀態、來源積木、未完成需求和驗證限制。
7. **Phase F 教師校準與發布門檻**：先內部教師 review，通過後再做學生試用。

第一批可獨立 issue：

- `feedback-corpus`: 匿名 fixture manifest + 教師標註 schema + 隱私檢查。
- `analysis-evidence-v2`: stable target/block evidence IDs + backward-compatible Analysis IR v2。
- `import-coverage-report`: per-script recognized/preserved/unavailable/malformed counts，Canonical failure 與分析分離。
- `extension-catalog`: 由鎖定版 VM 建出 opcode/fields/input/default/runtime coverage matrix。
- `extension-analysis-plan.md`: 擴充與 legacy 自製積木的分階段改善、coverage/runtime 分層、安全界線及驗收條件。
- `project-map-v1`: events → scripts → variables/broadcasts/procedures 的可追溯摘要。
- `diagnostic-confidence`: rule registry + evidence + confidence + false-positive fixtures，重新校準 forever/detached warnings。
- `feedback-packet-v1`: 移除素材資料與無關 Canonical JSON 的最小提示格式。
- `teacher-review-gate`: 匿名人工評估表、回饋品質報表與 release gate。

## 6. 研究依據

- Harvard Creative Computing Curriculum 將設計、創作、分享、批評/回饋與反思納入 Scratch 學習活動；本計畫據此把自我說明、同儕/教師回饋及可採取下一步納入產品，而不只看程式靜態正誤：[Creative Computing Curriculum](https://creativecomputing.gse.harvard.edu/guide/curriculum.html)。

## 7. 執行狀態與尚待外部驗收

本次已完成的程式工作：

- P0：`shape` 語意矛盾修正、block 節點安全正規化、Repair Report 重複問題 fingerprint 及修正提示。
- Phase A：建立 20 個合成案例索引、隱私/教師評閱規範與匿名回饋資料範本。真實學生作品未納入 corpus；案例目前全部是待評閱狀態。
- Phase B：新增 Project Map v1，列出可由 IR 看見的事件、動作、變數、廣播、opaque opcode、graph issue 和匯入覆蓋數；事實附原始 block ID/IR 路徑。round-trip 欄位明確維持 `not-run`。此版尚非完整 Scratch 行為語意模型，沒有把角色用途、遊戲玩法或因果關係當成已證實事實。
- Phase C：新增靜態形成性回饋，將 `forever-reinitialize` 降成設計問題；無 evidence 的警告不輸出為回饋項目。信心使用 high/limited 類別，不呈現未校準的百分比。發布 precision 門檻尚無人評數據。
- Phase D：新增 `scratch-ai-bridge/ai-response` v1 需求覆蓋 envelope、JSON Pointer 驗證及精簡 evidence packet。舊 Canonical IR v1 仍可使用；AI 覆蓋狀態在畫面標為「AI 自述」，不作 runtime 證明。packet 上限 24,000 字元、不帶素材 bytes、原始角色名稱或 Scratch block IDs；學生姓名/角色名以匿名序號輸出，原始使用者問題仍會由使用者主動複製。學生模式只帶入安全中文積木摘要和數值輸入，不包含 F/E 內部證據代碼，讓回答使用學生看得懂的位置與積木文字作為依據。
- Phase E：新增證據連結、原始未知積木定位、角色/腳本搜尋與摺疊、匿名回饋匯出。學生可見程式清單改用積木中文摘要，不顯示 opcode 或原始 block ID；學生提示限制為兩段、160 字內、一次一個可觀察步驟，要求引用畫面可見積木文字/數字並禁止無證據猜測，未知積木合併為白話限制。另新增獨立 `student-help.html` 分享入口，只提供 SB3 上傳、結構分析與學生提問提示；它不顯示成績、Scratch 生成器或首頁導覽。學生仍需將複製的匿名提示貼到老師允許使用的 AI；真實學生試用仍待進行。
- Phase F：新增嚴格評閱資料解析、品質門檻計算及 `npm run feedback:review -- <reviews.json> [report.json]`。範本會故意回報未達標；目前 20 案都未經教師評閱，門檻未通過。

**2026-10-16 執行紀錄**

- P0 誤報修正：Scratch 原始 block graph 的 `looks_changeeffectby`/`looks_seteffectto` 欄位接受 Scratch 實際使用的大寫 enum，同時保留來源值；事件帽由 capability registry 決定，不再漏判 `event_whentouchingobject`；未知擴充積木開頭改為資訊提示，不冒稱缺少事件帽。對確定的普通積木開頭腳本，回饋指出第一個積木並提供有條件的檢查步驟。
- P1 回饋定位：點選回饋證據會展開角色、腳本與積木線索，聚焦並高亮具體中文積木摘要；增加瀏覽器斷言。首次瀏覽器測試揭露父層 `<details>` 未展開，已修正為展開全部祖先並由 Chromium smoke 通過。
- 學生 AI 提示：從 90 字放寬至 160 字，要求明確指出角色/腳本位置、積木上的文字或數字、一步檢查及預期觀察；不足以判定時要求坦白未知；未知積木不得列 opcode、路徑或重複證據清單。
- 定向驗證：定向 57 項測試先行通過，完整 Bridge 套件 38 個測試檔、442 項全數通過；ESLint/Prettier、TypeScript 與 production build 通過；bundle budget 通過；Chromium、Firefox、Playwright WebKit browser smoke 全流程通過，包含 evidence 定位、高亮、SB3 匯入及 VM 預覽。原生 Safari smoke 未執行。Vite 仍提示 VM/render chunk 大於 500 kB，但總量低於 repo 設定預算。
- 四份真實 SB3 再分析（輸出留在本機桌面，未納入 repo）：1 份 `ok`、3 份 `partial`，無 `failed`；樣本平均分 92.25。大寫特效欄位誤報由 17 項降至 0；事件帽假警告亦消失。發現現行 integrity 分數按 warning 數逐項扣分會被大量低信心 detached 提示壓到 0，且修正 17 項誤報後總分仍因下限飽和沒有變化。評分公式先不在未經教師校準下任意改權重；列為下一個 P0/P4：分離「已確認結構錯誤」和「待確認提醒」，重新設計同類提示累積扣分、可信度呈現及低覆蓋作品的分數解讀，並用真實/合成案例做回歸。
- 尚未完成：原生 Safari 新增定位互動驗收、學生可用性研究、教師盲評與評分規準校準、真實 Gemini 問答/修正流程。程式 smoke 和合成測試不能代替這些外部驗收。

**2026-10-16 四份比賽作品再分析**

- 使用 CLI 對使用者重新提供的四份 `.sb3` 批次分析：1 `ok`、3 `partial`、0 `failed`；匿名代碼 S0001–S0004 對應姓名由本機 `PRIVATE-teacher-source-map.csv` 管理，不把姓名或作品放入 repo。原始作品均未修改。
- 逐案靜態結果：A 90/100、93% coverage、27 sprites/239 scripts；B 96/100、86% coverage、13 sprites/60 scripts；C 100/100、100% coverage、15 sprites/81 scripts；D 83/100、94% coverage、54 sprites/233 scripts。以上均是未經教師校準的 `sb3-static-v1` 暫定分數，不代表 Scratch 已執行或比賽成績。
- 根據原始 block graph 製作四份具名的本機回饋與教師索引，輸出在 Desktop `貓咪盃再分析_20261016/學生回饋/`，不放進公開 repo。例：B 的 `Sprite1` 第 6 段以定位積木開始且缺事件入口；C 的樂器廣播會觸發對應角色播放聲音；D 的「總導演」第 5 段是未接事件帽的頂層變數/廣播指令堆疊；A 的自製積木 prototype 有 1 個 argument ID 但 2 個 defaults。建議以條件語氣區分「可能未接」與「刻意草稿」，不把靜態提示當成已確認 runtime bug。
- CLI 預設 Markdown 仍不適合作學生回饋：60 項上限內混有大量重複 opaque-block/內部 evidence 文字，長作品省略數百項；部分回饋 evidence 只落在腳本第一塊而非實際問題位置。本次先以 CLI JSON 和原始 SB3 作 teacher analysis，再另行編寫短篇、具名、可採取下一步的學生版。後續 CLI 工作需增加 student report mode、manifest 顯示名、診斷去重/分組、限制優先排序、精確 block 定位及適齡驗收。
- 真人老師需先審閱姓名與作品配對、文字適齡及私用來源對照表後再分發。這次輸出不是盲評，沒有教師/學生校準；全案仍未完成。

外部驗收項目：真實 Gemini 修正往返、教師依 `docs/feedback-corpus-review.md` 盲評至少 20 案（其中 5 案雙人覆核）、達成精準度/證據/有用度門檻、Chromium/Firefox/WebKit/Safari 的新增 UI smoke、實際學生試用。上述工作需真實模型、教師或學生參與；程式建置或合成測試不能代替。

2026-10-15 本輪驗證：Bridge 單元測試 36 個檔案、432 項通過；ESLint/Prettier 與 production build/bundle budget 通過。Chromium、Firefox、Playwright WebKit 全流程 smoke 通過；包含 platformer 修正循環、匯入、離線 reload、evidence 點選定位。Native Safari smoke 因 Safari Remote Automation 尚未啟用而未執行。匿名教師 review CLI 對未完成範本回報 blockers；真正教師評閱、真實 Gemini 修正往返及學生試用仍待外部人員完成，因此 Phase A/F 與正式品質發布門檻未通過。

- Harvard 的 _Assessing Creativity in Computing Classrooms_ 使用多個面向，包括 testing/debugging、being iterative、reflection、loops、events、parallelism、project design；本計畫採多面向證據，不把單一積木數量當總分：[Assessment resource PDF](https://creativecomputing.gse.harvard.edu/assessment/ACCC_May2020.pdf)。SB3 本身看不到學生的測試/反思過程，因此這些需列為「待學生/教師提供」，不可從專案檔臆測。
- Scratch VM 把 extension opcode、block type、arguments 與 runtime implementation 綁在 extension `getInfo`/方法定義；因此 unknown opcode 只能標為未識別/保留，不能只以名字推斷其功能或假定 runtime 可執行：[Scratch VM extension development guide](https://github.com/scratchfoundation/scratch-vm/blob/develop/docs/extensions.md)。
- Scratch VM AST/target block 結構是本專案對照作品執行與積木圖的技術依據；版本需鎖定在 repo 實際相依 VM：[Scratch VM README](https://github.com/scratchfoundation/scratch-vm/blob/develop/README.md)。
