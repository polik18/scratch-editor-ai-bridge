# SB3 遊戲產生端到端改善計畫

更新：2026-10-28  
狀態：研究完成；尚未實作本計畫。

## 目的與範圍

讓 `scratch-session` 及設計檔遊戲產生流程，輸出的 `.sb3` 能被 Scratch VM 載入、保存、重新載入，且保留宣告的角色、素材、變數、清單和腳本。遊戲邏輯另以規格化場景測試確認；「ZIP 成功寫出」不再算遊戲產生成功。

本計畫聚焦 `packages/scratch-ai-bridge/src/cli/`、`ScratchSession`、Canonical IR 編譯器、設計檔解析、SB3 封裝與相應測試。正式網站的 Canonical IR 流程是可重用的編譯基礎，但網站與 CLI 的入口、使用情境及驗收證據必須分開記錄。

## 研究結論

下列是依目前工作樹源碼和使用者提供的 `game-01-space-shooter.sb3` 靜態檢查所得，沒有執行測試或 Scratch 網站匯入。

### 已確認的阻斷問題

1. **遊戲生成命令直接寫 ZIP，繞過 VM 編譯。** `game-cli.ts` 以 `session.saveSb3()` 輸出；新建 Session 沒有 ZIP 素材 entry，`saveSb3()` 因而只放入 `project.json`。產物宣告了造型，卻沒有對應 SVG。
2. **`compile` 指令有兩種不同語意。** `session-cli.ts` 有輸出路徑時呼叫 `saveSb3()`，無輸出路徑才呼叫 `sess.compile()`。相同命令依參數有時是直接封裝、有時才經 Canonical／VM 路徑，而且兩者都會顯示成功。
3. **`newGame` 只消費部分設計欄位。** 目前實際生成只建立角色和變數；`scripts`、`lists`、角色的 `costumes`、設計宣告的 `sprites`／`blocks` 數量均未實作或驗收。示例 JSON 宣告 8 sprites、120 blocks，實際 SB3 是 6 targets、每個角色只有佔位 procedure block，沒有遊戲腳本。
4. **變數記錄格式不一致。** `newGame` 寫 `{name, value, persistent}`；`ScratchSession.addVariable()` 又以變數名稱當 map key、將 ID 放在 tuple 第一格。Scratch project JSON 與本專案編譯器使用的結構是以 ID 為 key、`[name, value]` 為值。Canonical 轉換器只解碼符合 tuple 的值，因此變數可能被忽略或名稱／ID 對調。`addList()` 有相同 key/value 顛倒風險。
5. **Session 的 VM 編譯路徑不保留已載入作品素材。** `loadSb3()` 讀出 project JSON 和 ZIP entries，但 `compile()` 只把 JSON 傳給 `projectJsonToCanonical()`；該轉換只保留 costume/sound metadata，沒有從 `zipEntries` 補回素材 bytes。編譯器對沒有素材資料的 Canonical costume 會產生自動視覺素材，故用它編譯既有作品有丟失原圖／音效的風險。`compile()` 適合新 IR 專案的判斷，不能直接推廣為既有 SB3 的無損編輯路徑。
6. **`ScratchSession` 低階 block 操作無法保證連線互反。** `addBlock()` 可建立指向父 block 的欄位，但不會同步更新父層 `next`／`inputs`；自動建立的 reporter/shadow 一開始仍是 `parent: null`、`topLevel: true`。`attachBlockToHat()` 只改 hat 的 `next`，不回填 body 的 `parent`。此 API 可產生不完整 graph。
7. **成功訊號沒有端到端驗收。** `newGame` 印成功後再以 ZIP parser 載入／保存，沒有確認資產存在、hash 一致、腳本數量、VM round-trip 或遊戲行為。自製 `validateSB3()` 和 `scripts/validate-sb3.mjs` 皆不等同完整的官方 VM 匯入驗證；後者主要檢查 project JSON 與有限 block 欄位，沒有 archive asset/hash 或完整 graph reciprocity gate。

### 其他高風險問題

- Markdown parser 只讀 frontmatter 的少數純量欄位，正文中的角色、造型、積木／腳本不會解析；目前宣稱接受 Markdown 設計容易產生空專案。
- JSON 設計直接 `JSON.parse() as GameDesign`，缺少 schema、必要欄位、引用、重名、輸出路徑和能力檢查。欄位拼錯或未支援資料可被靜默忽略。
- 角色的空白 costume 使用固定 Scratch blank asset ID，但新專案的 `saveSb3()` 不帶該 asset bytes。
- `newGame` 產檔後會再 `loadSb3()`／`saveSession()` 一次；這只再次封裝，不增加有效性證據，也可能讓使用者誤以為已經驗證。
- batch generator 以 CLI exit code 當遊戲成功；命令本身會在無效輸出時回報 exit 0。它也依賴執行時的工作目錄解析相對設計檔，沒有把每個作品的驗收結果做成獨立 manifest。
- 目前未找到 `newGame`／`generateGameFromDesign` 的專屬測試。現有 CLI batch 測試驗證 Canonical 編譯，不涵蓋此產生入口、CLI 參數分支或 `ScratchSession` CRUD 格式。
- 文件狀態不一致：改善摘要將 VM compile 標為完成，但實際 `newGame` 仍走 `saveSb3()`，且 `compile <output>` 也走 `saveSb3()`。舊改善計畫已記錄部分缺陷，但不能替代新入口的整合驗收。

## 架構決策

1. **Canonical IR 是新作品的唯一建構模型。** 設計檔應正規化為完整、具版本的遊戲規格，再轉成 Canonical Project，經現有 schema／semantic gate、asset preflight、Scratch VM load/save 編譯。
2. **既有 SB3 無損編輯必須保留 archive bytes。** 對既有專案要採用含原始 ZIP entries 的工作區／Raw Archive adapter，或在轉 Canonical IR 時明確匯入並追蹤所有素材 bytes、hash 與來源 entry。不可僅靠 project JSON 重建再宣稱無損。
3. **新建和編輯分開驗收。** 新建可由 Canonical IR 建立自動造型或附帶素材；既有檔案編輯則要證明原始 bytes、未知 entries 和未改動 target 都保留。
4. **未支援欄位明確失敗。** 在 parser/validator 標示不支援、缺失素材或不合法 graph，不可以略過欄位後仍印成功。
5. **低階 Session API 必須二選一：** 改成 Canonical IR facade，或標成 raw/experimental API，加入完整 Scratch schema、asset 和 graph 驗證。不得讓 direct JSON ZIP serializer 看起來等同 compiler。

## 分階段實作

### P0 — 統一輸出命令與停止錯誤成功訊號

**工作項目**

- 將 `newGame`、`compile <path>`、`compile` 無參數、`preview` 及適用的 `save` 指令逐一盤點，定義明確契約：哪個命令編譯、哪個命令保留原始 archive、哪個命令只存編輯狀態。
- 修正 `compile <path>` 仍呼叫 `saveSb3()` 的分支；所有 compile 選項都使用同一編譯函式並有一致結果。
- 在 P1/P2 的設計轉換與素材模型完成前，將 `newGame` 標成 draft/experimental，或暫時拒絕輸出 final `.sb3`；不可把目前只建立角色／變數的結果報成完整遊戲。完整 generator 完成後才接入 Canonical Project 驗證及 VM compile。
- VM 編譯失敗時不得留下看似成功的 `.sb3`。先輸出暫存檔，所有 gate 通過後再原子移至指定路徑。
- `preview` 目前只執行 compile、沒有 screenshot；改名為 `validate` 或實作真正 preview，避免「預覽成功」誤解。
- CLI 成功輸出列出通過的 gate；錯誤以非零 exit code、階段名稱及設計檔路徑回報。

**驗收條件**

- `compile` 有／無輸出路徑走相同 VM 編譯；兩種用法產物都通過下一節 SB3 gate。
- 範例缺素材、壞 JSON、無效變數和斷裂 block graph 均回報非零，不產生新的 final `.sb3`，不輸出成功訊息。
- CLI 輸出階段可區分 `design-parse`、`canonical-schema`、`semantic`、`asset-preflight`、`vm-load`、`vm-save`、`reload`、`behavior-smoke`。

### P1 — 建立有版本的遊戲設計契約並完成 generator

**工作項目**

- 為 JSON 設計檔加入 JSON Schema／等價 runtime validator，至少驗證 `id`、`title`、targets、變數、清單、scripts、inputs/fields、assets 與 references。
- 明確拆開「宣告數量」與實際資料：移除或計算 `sprites`／`blocks` 摘要欄位，不能只列印宣告數字。
- 讓 generator 完整轉換 stage、sprites、位置／顯示屬性、costumes、sounds、variables、lists、broadcasts、scripts 和 procedures；每種資料都要映射至 Canonical IR 能力 registry。
- 若某種圖像／聲音格式、opcode 或 graph 形狀未支援，錯誤指出 JSON Pointer，不可靜默丟棄。
- Markdown 僅在有正式 schema/parser 時保留為輸入格式；否則暫時拒絕 Markdown，提示轉成 JSON。不能把只有 frontmatter 的解析器稱作完整遊戲設計解析器。
- 角色名稱重複、變數引用不明、缺少 asset bytes、未宣告 broadcast、未支援 opcode 都在產檔前攔截。

**驗收條件**

- space shooter 的規格與輸出逐項相符：宣告的角色數、變數、清單和腳本均一致；每個腳本具有預期事件帽與非空 stack。
- `scripts: []` 明確代表「沒有遊戲邏輯」，不能顯示完整遊戲成功；若規格宣告 block 數大於零但沒有相應 scripts，拒絕或列為未完成模板。
- Markdown 測試包含缺 frontmatter、巢狀結構、空 body、含冒號文字、無效 opcode 等案例；支援範圍由 schema 定義。

### P2 — 修正 Session 資料模型與既有專案素材保全

**工作項目**

- 修正 `addVariable()`／`addList()` 的 ID-keyed Scratch serialization；修正 `newGame` 避免自行寫入第三種變數格式。
- 變數／清單建立 API 回傳 ID，並以同一 ID 連結 reporter、target scope 及值；測試同名全域／角色區域變數及重名拒絕行為。
- 重構 `addBlock()`／`editBlock()`／`attachBlockToHat()`，每次編輯同時維持 `parent`、`next`、`inputs`、`topLevel`、shadow/block 引用互反；unsupported input 立即拒絕。
- 加入明確的素材 API，對每個 costume/sound 管理 bytes、format、assetId、md5ext、rotation center 和 target；匯出時核對 hash。
- 對既有 `.sb3` 的 Session 編輯保留原始 archive entries；若選擇 Canonical compile，先把 assets bytes 匯入 Canonical asset model，並保留未識別 entries 的政策與差異報告。
- 刪除無用的佔位 procedure block，或明確以合法的空 target 表示新角色。
- ID 產生器加入 collision check；ID 建立和引用在同一操作中原子完成。

**驗收條件**

- 新建專案及載入既有專案，變數／清單經 compile、VM save、reload 後名稱、scope、值完全一致。
- 新增/編輯一個有 reporter input 的 block 後，所有 parent/child edge 可互相往返；故意斷開任何一側時 validator 失敗。
- 載入含 SVG、PNG、WAV/MP3 的作品，只改一個 block 再保存；未改素材的 entry bytes 和 hash 完全一致，任何未知 entry 按政策保留或明確列出移除原因。
- 缺失或 checksum mismatch 的素材在寫出 final 檔案前失敗，不以自動視覺取代既有作品素材。

### P3 — 建立 SB3 archive 與 VM round-trip 品質門

**工作項目**

- 加入專用 archive inspector：ZIP 完整性、唯一且正確位置的 `project.json`、Scratch project schema、每一個 costume/sound 的 `md5ext` entry 存在、asset bytes 的 MD5／format 相符。
- 加入 graph validator：target 範圍內 block IDs 唯一、opcode 與必要資料存在、`next`／input references 存在且互反、parent 正確、topLevel 與 parent 一致、變數／清單／broadcast references 已宣告。
- compile 後對實際產物重新 `loadSb3()`、再 `saveSb3()`、再載入第三次；檢查 target、scripts、variables、lists、costume/sound count 與 hash。
- 將靜態 archive 檢查、官方 VM 載入和執行行為分成不同 gate；VM 可載入不等於玩法正確。
- 保留錯誤診斷位置（target 名稱、block ID、設計 JSON Pointer 或 archive entry），不要只輸出泛用的「invalid SB3」。

**驗收條件**

- 每份「compiled」產物都有 archive + graph + VM load/save/reload 證據。
- 所有 metadata asset reference 對應到 ZIP entry，內容 hash 與 asset ID 相符；沒有 missing entry。
- reload 前後公開內容等價；新建作品的腳本、target 與變數數量不得因編譯被靜默刪除。
- 既有缺陷樣本（space shooter、`cyber-duel.sb3`、`star-collector.sb3`）納入 corpus；預期舊輸出在修正前被拒絕或標記 partial，不能算成功。

### P4 — 端到端遊戲行為與使用者入口驗收

**工作項目**

- 每款範例遊戲附上行為規格和 deterministic smoke scenario：輸入、預期角色移動、碰撞／得分／生命變化、結束條件。
- 以 Scratch VM 執行腳本並檢查變數／角色座標等可觀察結果；需要 renderer 的畫面驗收另外使用瀏覽器預覽，不能從 compile 推斷畫面正確。
- 把正式網站 Canonical IR 入口、`scratch-session` 的新建／編輯能力和設計檔 generator 分開命名與文件化，清楚標記實驗性功能和支援範圍。
- 實際 Scratch 網站匯入作為發布候選的人工 smoke gate，至少以最小遊戲及含外部素材遊戲各一份確認。記錄 Scratch 網站版本／日期與結果；不可把本機 VM PASS 當作網站驗收。

**驗收條件**

- space shooter 的玩家移動、射擊、敵人生成／移動、命中、得分、生命及結束條件都有可重現的測試；不接受只有 sprite/variable 的模板標成遊戲完成。
- 文件命令可在乾淨 checkout 從設計檔產生範例，指向實際支援的格式，輸出檔位置與 exit code 正確。
- Scratch 網站 smoke 未完成時，發布說明標記「VM 驗證完成、網站匯入未驗證」。

### P5 — 維護性、批次產生與成功率量測

**工作項目**

- 將新增的 `game-cli.ts`、重複的 `game-generator.ts` 和 CLI dispatcher 收斂成單一 generator/contract，移除或明確標記未使用入口。
- 批次產生使用絕對設計路徑或固定 `cwd`；每個作品輸出 machine-readable manifest，包含輸入 hash、工具版本、各 gate 結果、輸出 hash 和失敗路徑。
- 任一作品失敗時 batch 回傳非零；支援繼續其他作品但總結包含成功/失敗分子與分母，不能用命令執行成功代替遊戲通過。
- corpus 至少涵蓋合法最小遊戲、缺 assets、壞 hash、錯誤變數格式、缺 references、斷裂 graph、Markdown 不完整、未知 opcode、大型專案與 Unicode 檔名。
- 每次發版記錄端到端分子/分母與每 gate 失敗數；樣本不足時註明不能估計穩定成功率。

## 測試矩陣

| 層級 | 必要案例 | 通過證據 |
| --- | --- | --- |
| 設計 schema/parser | 欄位缺漏、型別錯誤、重名、未解析 references、JSON/Markdown 邊界 | 有路徑的診斷；錯誤設計不寫 final SB3 |
| Canonical 轉換 | variables/lists/sprites/scripts/costumes/sounds 完整往返 | 語意等價比較，不以 JSON 字串順序比較 |
| Block graph | stack、reporter、shadow、控制積木、hat body、procedure | graph validator 互反及 VM compile |
| Archive/assets | SVG/PNG、WAV/MP3、缺 entry、錯 hash、重複資產 | entry 完整、hash 正確、format 可解碼 |
| CLI 整合 | `new-game`、`compile` 有/無輸出路徑、`save`、`preview/validate`、batch | 命令退出碼、產物 gate、輸出訊息一致 |
| VM round-trip | compile → load → save → reload | target/block/variable/list/asset 語意一致 |
| 行為 smoke | 每款遊戲主要玩家流程與失敗流程 | deterministic state assertions |
| 網站匯入 | 最小作品、外部素材作品 | 人工 Scratch 網站匯入結果與日期 |

測試先補上能重現各項故障的失敗案例，再逐階段修正。此研究輪沒有執行測試；實作時依 repository 規範新增測試後執行 scratch-ai-bridge 的 Vitest、lint、TypeScript build 與相關 browser smoke。

## 建議執行次序與停止條件

1. **先完成 P0 containment**：關閉 false-success；在新設計轉換完成前，不批次重產或交付 `newGame` 輸出。
2. **完成 P1/P2**：確保設計資料完整映射、Session 結構正確且既有作品素材可保全。不可先把 `compile()` 無條件接到所有輸出路徑，否則可能修好新專案卻破壞既有素材。
3. **完成 P0 的新作品編譯接線，再完成 P3**：以 P1/P2 輸出的 Canonical Project 統一 VM 編譯，並使每條產生／保存路徑有同一套可讀證據。
4. **完成 P4**：驗證實際玩法和 Scratch 網站相容性；只通過 VM gate 時不可標示玩法或網站已驗收。
5. **完成 P5**：批次量測及收斂文件／入口；清理前先確認現有未提交內容由工作 owner 保留。

### 發布阻擋條件

- 任一輸出入口仍能對缺素材、無效 graph 或未實作腳本回報「遊戲成功」。
- 新建與既有作品共用轉換，卻沒有素材保留或丟失報告。
- 設計檔欄位被靜默忽略，或命令宣稱的功能沒有對應驗收。
- 沒有 VM reload 證據；對外宣稱網站可開啟卻沒有 Scratch 網站 smoke。

## 相關程式入口

- 遊戲設計產生器：`src/cli/game-cli.ts`
- Session CLI dispatch：`src/cli/session-cli.ts`
- Session JSON、素材與 block API：`src/cli/session/session.ts`
- Canonical→project JSON/ZIP：`src/core/compiler/project-json.ts`
- Canonical schema／semantic／VM compile：`src/core/compiler/compiler.ts`
- project JSON→Canonical 轉換：`src/core/decompiler/project-json.ts`
- Scratch VM archive adapter：`src/scratch/vm.ts`
- 舊低階 validator：`src/cli/session/validator.ts`
- 相關既有計畫：`docs/sb3-generation-reliability-plan.md`、`docs/cli-agent-editing-plan.md`

## 研究界線

本計畫依 source inspection 和提供的 Space Shooter SB3 得出。未執行 `newGame`、Vitest、build、lint、VM reload、renderer preview 或 Scratch 網站匯入；程式碼指出的資料遺失與 graph 風險應由 P0–P3 回歸案例實證。既有工作樹含多項未提交改動，本次只新增此計畫文件，沒有覆蓋或清理它們。
