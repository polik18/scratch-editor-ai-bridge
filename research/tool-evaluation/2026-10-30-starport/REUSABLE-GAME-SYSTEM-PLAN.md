# Scratch AI Bridge 通用遊戲生成系統計畫

日期：2026-10-30
目標：提升系統可表達與可驗證的遊戲設計範圍，避免生成品質被單一遊戲樣板或不透明的能力限制綁住。Starport 是回歸案例之一，不是系統目標。

## 現況與問題

目前 opcode 能力資料分散在數個地方：

- `src/core/capabilities/registry.ts` 定義生成、target/input 驗證、prompt 可用積木和 extension id。
- `src/core/extensions/catalog.ts` 另存教師白話說明和部分官方 extension opcode。
- `src/scratch/extensions.ts` 管理 VM 可載入 extension、已測 runtime、安全禁用項及硬體清單。
- 測試又分散在 capability、extension、compatibility 和 game suites，無單一表格能看出一項能力目前究竟可生成、可編譯、可載入，或已做行為驗證。

這種重複登錄容易造成 prompt 說可用但 compiler 不認、compiler 接受但沒有 extension 宣告，或 VM 能載入但 camera/network/hardware 尚未可用。當 AI 遇到能力缺口時，現行提示也偏向「產生簡化示範」，可能讓需求在沒有明確說明下消失。

## 使用者補充的核心目標

目標是讓 AI 能創作精采、多樣、可玩的遊戲。現在即使 AI 盡力，作品仍常退化成簡單玩法；因此單純增加 opcode 數量不足以改善成品。系統要同時解決創作工具、上下文成本、設計引導及玩法驗證。

1. **創作能力/工具面**：目前是一次複製大型 Canonical IR 指令、再貼回完整 JSON 的流程。core opcode 雖已有廣泛覆蓋，仍須檢查能力缺口；素材以內建 SVG presets 為主，程式流程和視覺/音效資產都缺少足夠的高階創作工具。
2. **上下文面**：`createAuthoringInstruction()` 將完整 opcode contract 和大量固定規則放進每次 prompt；一次輸出整個專案也會耗掉 AI 的輸出額度。要量測 prompt / output 長度及 truncation，而不是靠感覺刪規則。
3. **設計流程面**：目前已有兩階段學生提示，但它只是一段可複製文字，不能確保外部 AI 真的先做玩法設計或等使用者選擇；進入 JSON 生成後，模型容易把「做一個好玩的遊戲」解讀成最小可行範例。
4. **玩法迭代面**：結構可編譯與「好玩」不同。一般生成尚無一致的輸入情境、核心互動、難度/節奏、失敗恢復測試，也沒有普遍適用的自動 playtest→截圖/事件觀察→局部修改迴圈。

還需追查的成品品質因素：角色動畫/背景/音效素材太泛用；AI 一次輸出大型 JSON 容易截斷或重複/漏建 target；現有預覽只證明畫面能 render，未判斷視覺層次、碰撞手感、玩法節奏；repair prompt 可能重貼過多 IR，搶掉設計上下文；沒有高階可重用機制（例如平台移動、波次、對話/任務、道具/升級）時，單靠低階 opcode 會令模型把 token 花在接線而不是玩法；「有趣」缺少分齡/無障礙與人工 playtest 指標。

因此成功標準不是「可以輸出 JSON」或「積木更多」，而是原始玩家意圖有保留、有值得玩的核心循環/回饋/進展、有合適表現素材、作品能運行且可反覆修正；未驗證的品質不得冒稱已通過。

## 設計原則

1. **以能力為單位管理**：opcode 描述、輸入/欄位、target、extension、來源與測試證據集中登錄；prompt、semantic validator、repair example、compiler extension inference 和能力報告由登錄資料取得。
2. **明確區分支援層級**：`authoring`、`compile`、`vm-load`、`runtime-tested`、`environment-required`、`preserve-only`。載入成功不代表功能可用；硬體、網路和 camera 要標出裝置/權限/外部服務條件。
3. **安全政策獨立且封閉**：從作品 JSON 讀到的未知 extension 不得因此載入任意程式；未知 opcode 可以保留、檢視和往返，但不因此變成可生成或可執行能力。
4. **需求不可靜默遺失**：生成回覆列出每項玩法需求的實作證據或明確狀態（近似、環境受限、未支援），不得把靜態結構說成 runtime 驗證。
5. **跨遊戲驗收**：能力以多類玩法組合驗證，不以單一大型範例的 block 數量作為彈性指標。

## 分階段計畫

### P0 — 建立能力盤點與可追溯狀態

**工作**

- 盤點 Scratch VM 15.2.0 的 core primitives、官方 extension opcode、Bridge capability registry、teacher catalog、VM allow/deny list 及現有測試。
- 建立矩陣：opcode / extension id / shape / target / inputs / fields / compiler status / VM loader status / environment needs / test evidence / source path。
- 為現有能力分類：完整可 author、結構可保存但不可執行、受環境條件限制、刻意禁用或尚未盤點。
- 將目前 registry 約 130 個 core capability 與新增 Pen/Music 16 個 opcode 作為首批對照樣本；數量以實際盤點和測試結果為準。

**驗收**

- 每一筆現有 capability 都能追到 Scratch VM source 或明確的 Bridge 行為規格。
- registry、teacher catalog 和 runtime policy 中的重複/矛盾項目有差異報告，不先刪除來源資訊。
- 不把 VM 可載入清單當成可供 AI 生成清單。

### P1 — 建立單一資料驅動能力註冊機制

**工作**

- 抽出 core 與 extension descriptors，再由一個聚合入口提供 `getBlockCapability()`、authorable opcode list、prompt 描述和 extension dependency。
- Extension descriptor 包含官方 source/version、opcode、輸入/欄位/enum、目標、語意說明、extension id、支援層級、環境需求、禁用理由和驗收測試識別碼。
- 將 `core/extensions/catalog.ts` 的教學文字改為引用同一 opcode descriptor，或讓教學資料成為 descriptor 的可選欄位，不再另行複製 opcode/input 定義。
- Runtime allowlist/denylist 改為讀 extension-level policy；保留明確安全邊界與使用者權限需求，未知 extension 一律 preserve-only。
- Semantic validation、repair suggestions、prompt、compiler extension inference 和能力清單都由聚合 registry 讀取。
- 加一致性測試：prompt 中列出的 opcode 必須可驗證；有 extensionId 的 block 編譯後一定宣告 extension；已禁用 extension 不得被 VM bootstrap 載入。

**驗收**

- 新增一項 extension block 時，只需登錄 descriptor 與 runtime/fixture test，不需在多個互不相連的 opcode 表中手動複製。
- 既有 core、Pen、Music 的 prompt、validator、repair example、SB3 輸出與 VM 行為不退化。
- extension runtime status 可以是 `load-only` 或 `environment-required`，不必為了讓 AI 看見它而假稱可以執行。

### P1 — 擴充官方 extension 範圍並保留環境邊界

**候選順序**

1. **Pen / Music**：補完整 opcode/input/menu 定義及執行行為覆蓋；現有重點測試已可用作起點。
2. **Text to Speech / Translate**：先確認網路請求、語音引擎、可離線替代方案；可分成 authorable、VM-load 與 network/runtime 狀態。
3. **Video Sensing / Face Sensing**：保留能力描述及可選 authoring；預覽預設不啟用相機/模型，只有明確權限與安全流程後才討論 runtime。
4. **硬體 extensions**（micro:bit、LEGO 等）：保留 opcode 和裝置需求資訊；本機 Stage preview 不宣稱可執行，裝置連線功能另列產品範圍。

每一批 extension 先做 block/menu contract 和官方 VM fixture 的保存/載入測試，再挑選可在現有 Bridge runtime 安全執行的積木加 behavior test。第三方 extension 的原始碼載入不屬於此階段。

**驗收**

- AI 能知道可用的積木和前置條件；作品報告會列出哪些需求需要 camera、網路、音訊或硬體。
- blocked/unavailable 能力不會讓整個合法專案失敗，也不會被錯誤報告為已實作。
- 外部程式碼、硬體服務、camera/model 和網路行為不會在載入檔案時自動啟動。

### P2 — 建立多玩法系統 fixture 與端到端 benchmark

**首批 fixture**

| 玩法類型 | 代表需求 | 關鍵能力 |
| --- | --- | --- |
| 平台跳躍 | 重力、跳躍、落地、敵人、關卡切換 | 多角色狀態、碰撞、broadcast、背景 |
| 射擊/閃避 | 移動、連續發射、命中、生命與 reset | clone 或替代生成策略、巢狀控制、清單/變數 |
| 解謎/冒險 | 多場景、物品背包、對話、條件解鎖 | Stage scripts、清單、broadcast、造型/背景切換 |
| 節奏/聲音 | 節拍、音符/鼓、成功判定 | Music extension、等待/計時、輸入事件 |
| 繪圖/互動藝術 | 筆跡、顏色/粗細、滑鼠互動、清除 | Pen extension、mouse sensing、Stage 背景 |
| 模擬/管理 | 多個同名角色狀態、資源列表、時間推進 | target-local data、lists、broadcast、平行腳本 |

**測試層次**

- 每類至少有一個人工維護的 Canonical golden fixture、一個 GameDesign adapter fixture，以及一個刻意含 unsupported/environment-limited 需求的 fixture。
- 結構層：JSON/schema、semantic、target/scope、broadcast/list/variable reference、block graph。
- 編譯層：SB3 compile、archive/asset hash、extension declarations、Canonical→SB3→Canonical invariants。
- 執行層：VM load；每款遊戲最少 2 到 4 個 deterministic 行為斷言（啟動、核心互動、成功/失敗或 reset）。
- 生成層：以固定需求 prompt 對可配置模型做多次樣本測試；保留原始需求清單與 requirement coverage，AI 回覆不視為唯一真值。

**品質指標**

- 必要玩法需求結構涵蓋率及 runtime 可驗證率分開報告。
- 未支援需求的明確揭露率、靜默遺漏率、schema/semantic 首次通過率、人工修復次數。
- 核心行為 pass rate、reset 後狀態一致性、造型/背景是否可見；美術風格品質另由人工盲評，不併入程式正確率。
- 以各 genre 分項呈現，避免平均分掩蓋某類玩法完全失效。

**驗收門檻**

- 所有人工 golden fixtures 可穩定 compile、archive validate 和 VM load。
- 每個 fixture 的核心行為斷言通過；不具 deterministic test 條件的效果標 `not-verifiable` 並說明原因。
- AI benchmark 無靜默需求遺失；runtime/environment 限制會出現在產物 manifest 和最終回覆。
- 新增任何 capability 都至少增加一個 descriptor contract test；有 runtime 支援宣稱者必須提供行為測試。

### P3 — 提升 AI 協作生成品質

**工作**

- 將大遊戲拆為規格→target/資料/事件骨架→核心互動→畫面/音效→逐項修復的可恢復流程；每輪保留有效 Canonical project，修正失敗不重做已通過部分。
- AI 先讀 capability + environment manifest，規劃需求映射；缺口以正式 coverage status 回報，避免提示它直接縮成無關 demo。
- 使用 validator 報告做局部 repair，記錄每輪修改的 JSON Pointer 與 gate 結果。
- 不綁定特定模型供應商；可針對模型輸出格式加 adapter，但 Canonical IR 與 benchmark 共用。

**完成條件**

- 至少 4 種 genre 的模型生成結果能被同一條 generate/validate/preview 流程處理。
- 生成 manifest 可列出模型、prompt 版本、fixture 版本、每個需求狀態、所有驗證 gate 和尚未驗證的部分。
- 失敗可依明確診斷局部修復，並能從 manifest 重現，不把一次成功當通用能力保證。

## 風險與界線

- Registry 結構變更可能影響多處 validator/prompt/analysis；先建立差異快照，再分階段遷移，避免一次合併造成支援範圍不明。
- Scratch VM 15.2.0 內建 extension 不代表瀏覽器、音訊、相機或硬體裝置在每個執行環境都可用；產品 UI 和 manifest 必須顯示條件。
- AI 生成的 requirement coverage 是待驗證聲明，不能取代行為 smoke 或人工遊玩測試。
- 已知 5 個 registry 測試案例（sprite-click target、drag 非同步、SAY/THINK runtime API）另列測試維護工作；不作為新增 extension 支援的成功證據。
- 本計畫只處理 Scratch/Bridge 內的受控能力，不載入任意第三方程式碼，也不啟動硬體、camera 或外部網路服務來完成離線預覽。

## 執行順序與產出

以下執行順序依使用者最新目標重排；前文 P0–P3 是能力工程分項，不代表優先順序只能從 registry 開始：

1. **P0 品質基線與根因量測**：固定 6 種 genre + 3 個模糊需求（如「幫我做一個好玩的遊戲」）；記錄完整複製指令字元數/估算 token、輸出截斷與重試、project size、編譯/VM/preview 行為 gate、需求覆蓋及視覺素材來源。建立人工可重播的基線結果。不同模型 tokenization 不同，保留實際 tokenizer 或標示估算值。
2. **P1 先設計再製作的工作流程**：讓模糊需求先進入遊戲設計簡報階段；以短問答讓使用者選擇玩法支柱（核心動作、挑戰/阻礙、成長/驚喜、勝敗/重玩），可選擇「交給 AI 決定」。先展示並確認一頁式 game brief 和需求映射，再生成專案骨架；禁止無聲地把未完成需求刪掉。清楚保留直接生成捷徑給已熟悉的使用者。
3. **P1 降低 token 負擔、保留完整能力**：把固定協定/安全規則、簡短設計 brief、genre playbook、目前使用的 block contract 分層。先提供小型 capability map，需要特定 opcode 時再取用其欄位/menu 細節；以 generation session/局部 patch 逐 target 或 script 編寫與修復，不每輪重送整份專案。對輸出長度、上下文預算及 repair token 設硬性量測與 truncation recovery。
4. **P2 擴展真正影響成品的工具**：先完成前述 descriptor 計畫，接著驗證缺失 Scratch block 與 extension；增加高階可重用的遊戲機制/行為模板，但保持可檢視及可編輯為普通 Scratch blocks。並規劃可換/可生成角色多造型、背景、動畫、音效的素材工作流；每一資產可重現、可授權、可打包，失敗可安全退回可見素材而非靜音/空白假成功。
5. **P2 Playtest→迭代**：把已存在的 preview 擴成受控 playtest：提供可重播鍵盤/滑鼠情境、遊戲狀態斷言、截圖/事件證據；AI 能依失敗結果局部修正後重跑。將 VM 行為結果、renderer 畫面及人工可玩性分開，不能以畫面載入 pass 代表玩法好玩。
6. **P3 多 genre 評估與品質校準**：使用前述六類 golden fixtures，加模糊需求與不同年齡/偏好測試；同一 prompt、模型版本和重試預算進行前後比較。用需求保留率、核心循環完整度、首次可運行率、局部修復數、token 成本、playtest pass 和人工趣味/美感盲評分項報告，不合成單一「好玩分數」。

### 第一個實作切片（依最新目標）

先完成 **P0 品質基線 + P1 設計流程/上下文原型**，並行做 descriptor 盤點但暫不一次遷移所有能力。原型要能接受一句模糊需求，提出幾種具體玩法組合與少量選擇題；使用者確認後產生短 game brief、需求追蹤表，再進入分段生成/局部修復。比較新舊流程的 prompt token、JSON 截斷率、原需求保留率及 playable gates，確認 token 減少沒有讓系統能力或安全規則縮水，再決定後續擴充。

之後進入 P1 descriptor prototype（core + Pen + Music），並依安全狀態擴展其他官方 extension。不可為減少上下文而刪除功能；採取的是按需載入 schema 細節、重用既有 project state 和分段產生。

## 執行紀錄（2026-10-30）

### 已完成的第一個垂直切片

- 新增精簡的玩法討論 prompt，不載入 JSON schema 或 opcode catalog。要求 AI 提案不同玩法、少量詢問，最後產生含核心循環、挑戰/進展、獎勵、勝敗/重玩、操作、視聽氣氛與第一分鐘體驗的 brief。
- 學生頁新增 genre 選擇、brief 貼回欄位、「先和 AI 討論」、「使用確認 brief 製作」及「讓 AI 自行設計並製作」三種操作。製作提示可在新 AI 對話使用，攜帶原始需求、確認 brief、類型偏好和完整 Canonical/tool contract。
- 製作 prompt 明確禁止靜默刪玩法；要求保留核心循環、操作、挑戰、回饋、進展和勝敗/重玩架構，必要降級列入 requirementCoverage。
- UI 顯示字元數和混合語言粗估 token 數；新增可重跑的 `scripts/measure-game-prompt-budget.ts` 和樣本 JSON `PROMPT-BUDGET-BASELINE.json`。六種 genre 共用完整能力合同，不因選類型而刪除 opcode。
- 更新 Chromium browser smoke，回歸檢查短討論 prompt 不含 full block catalog、製作 prompt 合併原始需求與 brief 並含完整 authoring contract。

### 基線與驗證

樣本「幫我做一個好玩的遊戲，主角是住在深海的小魚」：精簡討論 prompt 585 字元，粗估 469 tokens；加入已確認 brief 後的完整製作 prompt 約 12.4k 字元，粗估 4.0k tokens。這只是本機估算，未呼叫模型 provider tokenizer。討論階段的提示負擔降低約一個數量級；最終製作提示仍包含完整 contract，沒有以砍能力換取短提示。開新對話可避免設計討論歷史佔用製作階段上下文。

- Prompt/GameDesign/compiler 定向測試 23/23 通過；`npx tsc --noEmit` 通過。
- `npm run build` 通過 bundle budget；仍有 repository 原有 Node-only import externalized、`new URL()` 及大 VM/renderer chunk 警告。
- `BROWSER=chromium npm run test:browser` 通過；更新後驗證兩階段 prompt 和剪貼簿流程。
- 一次 smoke 初跑使用舊 `#copy-instruction` selector 失敗；browser smoke 已更新到新流程，重跑完整 Chromium suite 通過。

### 尚未完成

- 尚未支援多回合 target/script fragment 合併，因此最終回覆仍可能因大型 JSON 輸出上限而截斷。
- 尚未將 genre profile 轉成高階 mechanics library，也未完成分段生成和 repair token 量測；目前依舊以完整 capability contract 保證可用積木資訊。
- 未建立六類遊戲 golden fixtures/模型比較，未量測實際模型輸出截斷率或首輪 playable rate。
- 素材生成/動畫/音效 workflow、通用輸入 playtest 和 AI 根據 playtest 證據局部迭代仍待實作。

下一個工程切片：加入可重跑的真實 provider tokenizer/截斷率對照（需明確配置模型及 API 授權）；完成 merge undo、片段匯入匯出與跨裝置恢復；之後以多 genre fixtures 比較單包 JSON 與分段生成的完整度。

### Project fragment/session 原型（2026-10-30）

- 新增 `scratch-ai-bridge/project-fragment` v1 envelope 和純函式 session merger：Stage 必須先加入；Sprite 可新增，也可用新 fragmentId 為既有 Sprite 追加 scripts；廣播、擴充、meta 可跨片段合併；同名宣告衝突、重複 ID、作品名不符、Stage/Sprite 名稱衝突會拒絕，拒絕不修改原 session。
- 學生頁新增可收合的單 target 提示/JSON 貼入工作區；target-specific prompt 只列該 target 可用 opcode；組裝後完整 Canonical project 寫回原作品欄，沿用既有 validation/compiler/build 流程。session 存於 `sessionStorage`，重新載入可恢復；明確清除動作會同時清空組合與作品欄。
- 多片段生成可選「沿用同一 AI 對話已載入能力規格」以避免重複貼 opcode catalog；此模式提示使用者必須待在同一對話；取消勾選則每份片段指令都帶完整能力清單。兩模式都保留全部可用 opcodes，並明列背景/造型 presets、keyboard/touching 選項和安全限制。
- 驗證：fragment 單元測試 3 組通過；Prompt/GameDesign 定向測試此前 23 tests 通過；TS check、production build/bundle budget、Chromium browser smoke、`git diff --check` 通過。Browser smoke 首次指出新 textarea 未標示，已補 aria-label；第二次發現 selector 假設不存在的 id，已修正並重跑成功。最後另驗 fragment 3 tests、TS check、production build 及 diff check。
- 限制：這是可供人手逐片貼回的原型；尚無直接模型 API/工具呼叫、逐 script 局部修復/undo、匯出匯入片段 session、真實 provider token/truncation benchmark，也未測真人不同遊戲的生成品質。

### Fragment 結構大小基線（2026-10-30）

- 新增 `scripts/measure-project-fragment-budget.ts` 及 `npm run measure:fragment-budget`，以 Starport 五個 targets 比較既有完整製作 prompt、分段 prompt、整包 Canonical JSON 與 fragment envelope；輸出 artifact `research/tool-evaluation/2026-10-30-starport/FRAGMENT-BUDGET-BASELINE.json`。
- 完整製作 prompt 12,431 chars / 約 3,960 粗估 tokens。每片段都帶完整 opcode catalog 的獨立 prompt 模式：最大單次 prompt 10,067 chars（相對完整 prompt 字串降約 19%），五份提示總長約 47,852 chars（增約 284.9%）。同一對話重用規格模式：首個 Stage 帶完整能力清單、後續片段只引用前文，最大單次新增 prompt 7,598 chars（相對完整 prompt 字串降約 38.9%；不含同對話歷史），五份提示總長 13,848 chars（增約 11.4%）。完整 Canonical JSON 6,779 UTF-8 bytes；最大 fragment envelope 2,529 bytes（尖峰輸出約降 62.7%），所有片段合計 7,332 bytes（總輸出約增 8.2%）。
- 此為結構大小/粗估 token 比較，不是 provider tokenizer、模型輸出、上下文累積、截斷率或作品品質測試；同對話實際 context 還包含歷次指令、模型輸出與逐步累積的片段，尚未納入最大上下文估值。結果支持降低單次生成尖峰，但不代表總 API token 一定變少。後續要做有模型/授權配置的 provider 對照及跨 genre 結果。

### 即時互動修改子計畫

- 使用者詢問可否在遊戲即時預覽期間互動修改。現況確認：animated preview 已在隔離 iframe 載入 Scratch VM，有 token-protected start/stop/input/hardware/consent 訊息；VM adapter 對外僅讀取 variable/target/blocks，尚無 patch command 或 runtime setter。外部 AI 亦未直接連入 Bridge。
- 新增 `LIVE-EDITING-PLAN.md`：先做受限 live patch 調整已存在變數/target properties，加入差異、undo 和 preview `postMessage` protocol；再做 Canonical structural patch、完整驗證/編譯後 reload/rollback；scenario-based AI playtest repair 與 provider tool integration 後置。禁止任意 JavaScript/opcode/extension/network；保留 token/source/revision checks、原子套用、cloud variable 禁止、歷史/重設明示和現有 watchdog 資源界限。
- 本輪完成即時修改的架構盤點和分階段計畫。後續實作進度與驗收狀態見本計畫底下的 `LIVE-EDITING-PLAN.md`。
