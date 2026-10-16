# 擴充積木與自製積木分析改善計畫

更新：2026-10-16。本文記錄的實作完成度與驗收限制依各階段紀錄；教師人工校準與實際學生使用尚未完成。

## 目標

學生上傳 SB3 後，Bridge 能說清楚：哪些積木資料已保留、哪些積木已辨認、從積木結構能推知什麼、哪些功能可在目前環境執行，以及哪些內容仍需原 Scratch/裝置確認。任何未知擴充不得被誤判成學生程式錯誤，也不得因分析器不認得就遺失原始資料。

## 現況與邊界

- 匯入保留 raw block graph；Canonical IR 只投影受支援範圍，兩者不可混為一談。
- Project Map 目前以 `knownOpcodes` 計算已識別/opaque 數量；未知積木只能得到通用限制描述，細節和學生可讀名稱有限。
- 專案能從 opcode 前綴與 SB3 宣告偵測 extension，並區分本機 runtime、未驗證、停用或缺少 runtime；CLI 明確不載入/執行 extensions。
- `procedures_*`、`argument_*` 是 Scratch 自製積木核心機制，不是 extension。舊式 procedure prototype、argument ID/defaults 不一致等要走核心格式相容路徑。
- arbitrary third-party extension 的 opcode 名稱不足以證明其語意。只在取得可信 block metadata/實作或教師提供的明確描述後才可解讀；任何 extension 程式碼不得由 SB3 中的 URL 自動下載或執行。

## 狀態模型

每個 extension/block 均分開記錄以下欄位，不用單一 `partial` 代表全部問題：

1. `preservation`: `preserved` / `missing` / `corrupt`
2. `recognition`: `core-known` / `extension-known` / `metadata-only` / `unknown`
3. `semanticAnalysis`: `understood` / `partially-understood` / `opaque` / `malformed`
4. `runtime`: `core` / `bundled-tested` / `bundled-untested` / `hardware-required` / `external-service` / `unavailable` / `disabled`
5. `roundTrip`: `passed` / `failed` / `not-run`

專案、target、script、block 層級各自計數。`partial` 只作整體摘要，並附上造成 partial 的分類與數量。

## 執行階段

### Phase 0 — 基準盤點與重現

- 以固定版本 Scratch VM/Scratch Blocks 為基準，抽取內建 extension `getInfo()` metadata、opcode、block type、arguments、menu、預設值與 runtime handler 對照表。
- 對四份本機樣本及合成匿名 fixture 建立逐項盤點：opcode、extension 宣告、raw graph 是否完整、Canonical 投影結果、opaque 原因、runtime 狀態、procedure mutation 狀態。原始學生作品不得加入公開 repo。
- 分離三類案例：官方 extension、第三方 extension、核心自製積木/legacy procedure。確認當前 opaque 計數是否因 shadow/menu/definition/argument reporter 重複計算。

**驗收**：同一份 fixture 重跑能得到一致的分層狀態；所有 opaque 都有 block ID、opcode、target、保存狀態及原因類別；沒有把「不可執行」誤報成「不能辨認」。

**2026-10-16 首輪盤點**

- 四份匿名化標記樣本 S0001–S0004 的原始 SB3 均能讀取；non-shadow raw blocks 為 1,262／484／320／1,373。S0004 有 3 個非 block 資料項被 graph analyzer 跳過；其餘三份為 0。
- S0001 宣告 `text2speech`、`videoSensing`，實際各有 7、18 個相關積木；另有 13 組 procedure definition/prototype、32 個呼叫和 6 個 argument reporter。`開場_台灣石虎` 的 prototype 有 1 個 argument ID、2 個 defaults，屬核心自製積木資料不一致，不是 extension。
- S0002 使用 `faceSensing`、`text2speech`、`videoSensing`，各有 3、50、2 個 extension blocks；另有 4 組 procedure definitions/prototypes 和 4 個呼叫。
- S0003 沒有 extension 或自製積木，raw graph 320 blocks 全被目前 coverage 認列。
- S0004 使用第三方 `facemesh2scratch`（4 blocks）、`handpose2scratch`（10 blocks）及官方 `music`（13 blocks）；另有 10 組 procedures、23 個呼叫、27 個 argument reporters。其 3 個無效 graph entries 需當結構異常分開追查。
- 舊 CLI opaque 數為 89／67／0／78。已確認一個誤分類根因：coverage 與 `raw-block-graph-unmodeled-opcodes` 只把 `CANONICAL_OPCODES` 當成可識別集合；核心 procedure graph opcode 由 `CanonicalProcedure` 建模，卻被算成 opaque/AI 編輯未涵蓋。首輪程式修正將 procedure graph opcode 加入結構辨識集合，並補上 `procedures_prototype`。這只修正分類，不代表 procedure payload 或 extension semantics 已完整支援。
- 剩餘 extension 優先順序依樣本頻率為 text-to-speech、video sensing、face sensing、music；第三方 pose/mesh extensions 保持 metadata-only/opaque，待可信來源 metadata 後再決定支援範圍。CLI 仍不載入或執行任何 extension。

**2026-10-16 初始 Catalog 切片**

- 新增 `src/core/extensions/catalog.ts`，以 repo 鎖定的 Scratch VM 15.2.0 `getInfo()` block text 為來源，先登錄四份樣本實際用到的 10 個官方 extension opcodes：Face Sensing 1、Music 3、Text to Speech 3、Video Sensing 3。
- Project Map 現可為這些 opcode 提供白話積木名稱與證據，並將它們從 opaque 數量中分開；這只表示積木意圖已辨識，不表示其輸入值已解讀或擴充 runtime 已執行。
- Catalog 目前是依樣本建立的初始子集，尚未涵蓋這四個官方 extension 的全部 opcodes，也未加入完整 arguments/menu/default schema 或自動對照 VM source 的 regression gate。第三方 `facemesh2scratch`、`handpose2scratch` 仍保持未知/opaque。
- 未跑測試、CLI 回歸或 runtime smoke；catalog 與 Project Map 接線待驗證。這不代表 Phase 1/2 完成。

**2026-10-16 Catalog 欄位補充**

- 上述 10 筆 opcode 已補上 command/reporter 類型、argument 名稱與類型、menu 名稱、VM 預設值，以及依賴執行期語系的動態預設標記；來源檔明確對應 repo 鎖定的 Scratch VM 15.2.0。
- 保留官方 metadata 的差異：Video Sensing 的 menu arguments 在 VM metadata 中宣告為 NUMBER，但 menu 序列化值為字串；catalog 分別記錄 argument type 與預設 menu value，沒有把 menu 值強制轉成數字。Face Sensing 的 PART 預設值為原始值 `"2"`。
- 此次仍只覆蓋四份樣本出現的 10 種積木；menu 選項清單、輸入值逐 block 擷取、第三方 extension 描述和 runtime 行為尚未完成。尚未跑測試、CLI 重分析或 runtime smoke。

### Phase 1 — 建立版本化 Extension Catalog

- 新增由鎖定 VM 產生或核對的 catalog，至少包含 extension ID、顯示名稱、opcode、block type、文字模板、argument 欄位/型別、menu/default、值域、回饋標籤、執行需求與隱私/外部傳輸屬性。
- catalog 每筆記錄 VM 版本、來源檔/版本、審核狀態及 fixture。避免手工猜 opcode 前綴代表的行為。
- 分類 `fully-understood`、`metadata-only`、`preserved-only`、`runtime-unavailable`、`disabled-for-safety`、`malformed`。Registry 需能在 build/CI 檢查重複 opcode、缺 argument、錯誤 runtime 狀態。

**驗收**：catalog 與鎖定 Scratch VM 的官方 extension `getInfo()` 一致；未知第三方 opcode 仍安全降級；catalog 不會要求載入遠端程式。

**目前狀態**：四份樣本共用的 10 個 opcode 已逐項對照 Scratch VM 15.2.0 原始碼，記錄 command/reporter、argument 型別、menu/default 及來源檔。catalog schema 具可擴充的版本邊界；並非四個 extension 的完整 opcode inventory，因此本階段完成「樣本範圍」，全官方擴充清單仍不宣稱支援。

### Phase 2 — 語意解析與靜態 Project Map

- 以 extension-specific adapters 讀取 raw node 的 opcode、fields、inputs、mutation、shadow/menu 連線；不要求先轉成 Canonical IR 才能分析。
- 對每種已支援積木建立中文名稱和簡短可驗證語意，例：「按下鋼琴鍵時播放音符」、「用筆畫線」。只描述積木結構能支持的事實，不聲稱硬體反應或遊戲結果已發生。
- 擴充 evidence 直達原始 block ID；把未知積木按 extension/opcode 合併計數，報告顯示一個清楚限制與代表位置，教師層可展開完整清單。
- 對沒有可信 metadata 的第三方積木，學生用語顯示「這個積木來自額外擴充，Bridge 暫時看不懂它的作用」，不要暴露 opcode 路徑或當成錯誤。

**驗收**：opaque 不會造成事實摘要虛構；每條 extension 觀察能定位原始積木；已理解與未理解積木的數量可逐一對回 raw graph。

**目前狀態**：已支援 opcode 的 raw input 值會轉成白話摘要，數字/安全選單值可見，自由文字遮蔽。Project Map、CLI JSON、CLI Markdown、Web coverage 與 AI evidence packet 都呈現分層狀態；AI packet 移除 opcode、raw block ID 和 JSON path。未知 extension 只按數量提供限制，不推測行為。

### Phase 3 — 修復核心自製積木/舊版相容

- 獨立盤點 `procedures_definition`、`procedures_prototype`、`procedures_call`、`argument_reporter_string_number`、`argument_reporter_boolean` 的 mutation、argument ID、defaults、warp 旗標和 procedure code。
- 建立 legacy 正規化 adapter：只修正已確認的舊格式差異；保存原始 mutation，將自製積木名稱/參數/呼叫關係投影到 Project Map。
- 格式缺損時保留 raw graph，呈現具體不一致欄位；不得把 procedure 缺損統稱為 extension unsupported。

**驗收**：匿名化守護者樣本中自製積木可辨識名稱、參數與呼叫位置；合理舊資料匯入不丟資料；刻意缺損 fixture 有精準診斷且不崩潰。

**目前狀態**：有效與 legacy shadow-prototype 正規化已有 codec/decompiler 路徑；錯誤 argument ID/name/default 數量現在回報實際筆數，raw graph 仍保留，學生 evidence 不顯示 block ID。樣本中 1 ID/1 name/2 defaults 現能被定位。完整 legacy 多變體校準仍受實際缺損樣本與教師核對範圍限制。

### Phase 4 — 分級 runtime 與安全預覽

- CLI 維持靜態分析，不啟動裝置、相機、網路服務或 extension code；結果列出需要原 Scratch/裝置確認的功能。
- 瀏覽器預覽只允許 repo 已內建、審核過的 extension adapter；每個 adapter 有資源、資料外傳、權限和測試邊界。
- Pen/Music 等低外部依賴項目先做 runtime regression；硬體 extensions 要以 Scratch Link/實機另做可選 smoke，無裝置時標示 `hardware-required`，不能算失敗或已驗證。
- 攝影機、語音、翻譯等外部資源逐項採明確同意與資料最小化；停用項不因匯入作品而自動初始化。

**驗收**：CLI 無 extension side effect；預覽只載入 allowlist；每個 runtime 狀態與實際 adapter/測試相符；安全停用不會破壞 SB3 原檔與 raw analysis。

**目前狀態**：現有 runtime allowlist、extension egress consent 與 Face/Video 不自動啟動路徑保留；現有回歸確認攝影機未啟用、未知 extension 不載入。Music adapter 有 runtime 測試。CLI 仍只靜態分析；硬體/相機實機及外部語音服務未測，矩陣明列限制。

### Phase 5 — CLI/Web 報告與 AI 回饋

- 把 `partial` 拆成具體原因摘要，例如「已保留 4 個積木；辨認 3 個 Pen 積木；1 個自製積木格式不完整；硬體未執行」。
- CLI JSON 提供機器可讀 coverage matrix；Markdown/學生報告避免重複 opaque 行、opcode、block ID，只保留學生能採取的一個確認步驟。教師報告可展開詳細資訊。
- Evidence packet 只帶相關 extension 的安全中文積木名稱、觀察到的參數與限制；AI 不得自行解釋 metadata-only/unknown 積木，不可推稱裝置已動作。
- 調整分數：Bridge 未支援某 extension 不扣學生作品分；只有有證據的作品結構問題可進入相應 rubric，低 coverage 顯示「判讀有限」而非誤導性的高確定分數。

**驗收**：同份 SB3 的靜態 facts、unsupported limitations、runtime requirements 在 Web、CLI JSON、Markdown 一致；學生回饋不含未經證實的 extension 行為；不支援項目不直接扣分。

**目前狀態**：ProjectMap/CLI/Web/AI packet 已共享 extension coverage；CLI Markdown 不列 opcode；opaque/runtime unavailable 不納入扣分警告。Evidence packet 移除 opcode、block ID、JSON path，並遮蔽文字轉語音自由文字。未知 extension 的限制合併呈現。

### Phase 6 — 回歸、教師校準與發布

- 建立匿名合成 fixtures：每個優先 extension 的正常、缺欄位、未知 opcode、unknown menu、legacy graph、缺裝置案例；加上 procedure 舊格式及畸形對照。
- 以 raw block count、識別數、opaque 數、evidence 定位、runtime status、原檔 hash 與 round-trip status 做自動回歸。
- 邀請 Scratch 教師 review extension 名稱是否符合教材用語、學生建議是否具體；以原先四份本機作品人工複核，但只保存匿名結果/教師標註。
- 公布支援矩陣與版本；每次 Scratch VM 更新先比較 catalog，再決定需新增 adapter 或維持 metadata-only。

**發布門檻**：資料保留/不損壞 100%；已宣告官方 extension opcode catalog 覆蓋率可報告且無靜默丟棄；所有未知項有精確定位；AI 無證據語意主張為 0；extension 未支援不造成分數懲罰；CLI 不執行 extension code；支援矩陣、測試結果和剩餘限制一同發布。

**目前狀態**：支援矩陣已新增於 `docs/extension-support-matrix.md`；全套 Bridge tests、lint/build 與三引擎 browser smoke 均通過，四份匿名樣本已重跑 CLI。未完成條件：教師實際審閱 extension 白話名稱/回饋、學生可用性試用、相機/語音等外部 runtime smoke，以及正式 GitHub 發布。這些項目未取得實際證據前不得標示全案完成。

## 建議優先順序

1. **P0**：Phase 0 基準盤點；同步拆分 coverage/runtime 狀態，讓 partial 解釋準確。
2. **P1**：Phase 3 自製積木/legacy procedure，先修目前真實樣本已遇到的核心格式問題。
3. **P1**：Phase 1–2 建 Extension Catalog 與靜態語意 adapter；先支援 Pen、Music，再按實際學生作品分布選下一批。
4. **P2**：Phase 5 CLI/Web/AI 報告與評分去偏；消除大量重複 opaque 文案。
5. **P2**：Phase 4 選定 extensions 的瀏覽器 runtime 與硬體 smoke；不可把這項當成靜態分析的前置條件。
6. **P3**：Phase 6 教師校準、支援矩陣和發布門檻。

## 明確不做

- 不自動下載或執行 SB3/extension 提供的程式碼或 URL。
- 不從 opcode 名稱、AI 猜測或 extension 宣告推斷未驗證行為。
- 不要求所有 extension 都必須能在 GitHub Pages/CLI 執行，才算匯入成功。
- 不因 Bridge 不認得積木就判定學生作品錯誤或扣分。
