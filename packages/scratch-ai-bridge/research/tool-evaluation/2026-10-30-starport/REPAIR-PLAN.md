# Scratch AI Bridge 工具修繕計畫

日期：2026-10-30。範圍依本次 `星港守衛：裂隙遠征` 實作實測；repo 原有未提交修改保持原狀。計畫後附實作狀態及驗證結果。

## P0：建立唯一、可用的遊戲產生入口

1. 在主 `scratch-ai-bridge` CLI 註冊正式 `generate <design>` 命令，或明確將 generator export 為受支援 API；讓 `--help`、README、package bin 與實際入口一致。現有 `npm run cli -- --help` 僅列 `inspect` / `batch`，沒有 generate；`scratch-session` 接受 `newGame`，但文件式 `new-game` 回報 Unknown command。
2. `newGame` 和 generator 共用一套解析、Canonical compile 與成功訊號；移除會把不完整輸出印成功的旁路。輸出路徑採暫存檔、全部 gate 通過後才原子寫入。
3. generator 成功報告列出 schema、semantic、archive/assets、VM load/save/reload、行為及 renderer 各 gate，沒有執行的 gate 顯示 `not-run`，不得只用 `success: true` 表示完成。
4. Node 入口建立或注入必要的 Scratch renderer/bitmap adapter；不能靠使用者自行猜測必須先執行 workspace build。缺 renderer 時應明確失敗或只標記 compiler/archive 階段成功，不能在成功輸出中混入角色素材無法載入的警告。

驗收：乾淨 checkout 下直接用公開 CLI 產生作品；不需先手動 build workspace；錯誤命令可用 help 查到；缺 renderer 或其他 gate 失敗時不留下 final SB3。

## P1：修正設計轉換及輸入契約

1. `designToCanonicalIR()` 遞迴轉換 nested `SUBSTACK` 裡的 blocks、inputs、fields，不把原始設計 block array 直接塞進 Canonical stack。
2. 為 GameDesign JSON 加 schema/runtime validation，檢查未知欄位、opcode、變數/廣播引用、target、costumes、script 結構；Markdown 若只解析 frontmatter，應標示不支援完整遊戲或拒收正文規格。
3. 遊戲規格可直接以 Canonical IR 為主格式；舊 GameDesign adapter 未覆蓋欄位必須拒絕或列出 loss report。
4. 提供複雜巢狀遊戲 fixture，覆蓋迴圈、條件、reporter、menu、broadcast、variables、lists 和多角色互動。

本次 GameDesign 樣本在 `newGame` 於 Canonical validation 失敗，主要診斷集中在 SUBSTACK 陣列內的數值 input 未轉為 LiteralInput。Canonical IR 路徑則要求 menu 由對應 literal input 表達；誤用 reporter/field 會得到語意錯誤。

驗收：同一份規格經 JSON→Canonical→SB3 後，target/script/block/data 數量與規格一致；所有 unsupported 欄位在寫檔前以 JSON Pointer 報錯。

## P1：補足完整產物與品質證據

1. 將 `archive-audit`、block graph validator 與 asset MD5 驗證接入正式 generator，不只留在手動檢查。
2. 統一 inspect 的 block count 定義，明確區分所有 archive entries、可執行積木、shadow/menu blocks；本次實數 48、inspect 顯示 45，需定位少計的 3 個 block。
3. 加入 Scratch VM round-trip 與重新載入後 target/script/variable/list/costume/hash 等價檢查。
4. 以受限 renderer/VM preview 做初始畫面和 deterministic 行為 smoke；分開回報 VM load、腳本執行、實際畫面和 Scratch 網站匯入結果。
5. 遊戲 smoke 至少覆蓋左右移動、射擊、命中加分、敵機碰撞扣盾、重開/reset。當前遊戲規格中護盾歸零結束條件未實作，需補上後再聲稱玩法完整。

驗收：每個已交付 SB3 都附 machine-readable manifest；所有未跑 gate 都明確標示，不以靜態 inspect 的 100% coverage 當遊玩成功。

## P2：完善可重複使用的工具體驗

- Node/瀏覽器編譯路徑使用同一套明確環境 adapter 與 smoke fixtures。
- 設計 `generate --out ... --report ...` 機器介面，stdout 僅輸出 JSON、診斷送 stderr、使用 stable exit code。
- 補作品範例、設計 schema、menu/block/stack 範例和乾淨環境 quick start。
- 將工作樹髒檔當既有 owner 內容處理；修繕前拆小 checkpoint，避免本次已有未提交程式修改被覆蓋。

## 實作結果（2026-10-30）

### 已完成

- **P0 公開產生入口**：主 CLI 已提供 `generate <design.json> --out <new-file.sb3> [--report <report.json>] [--force]`，help 與文件同步；`scratch-session new-game` 與既有 `newGame` 共用處理器，package bin wrapper 可直接執行。輸出 stdout 僅含 JSON，Scratch VM 診斷送 stderr，錯誤使用非零 exit code。
- **P0 成功訊號與寫檔安全**：設計輸入、Canonical schema/semantic、VM compile/save、archive、project JSON、block graph、asset MD5、VM load/save/reload 均分列 gates。所有可驗證 gate 通過後才以暫存檔原子寫入；預設拒絕覆寫，`--force` 才取代。
- **P0 Node VM 相容**：`BitmapAdapter` 支援 Scratch renderer 的 named/default export；VM 初始化不再因 CommonJS/ESM 互通形式而報 constructor 錯誤。生成流程仍需 workspace 的 Scratch 相依套件已建置。
- **P1 設計轉換**：GameDesign adapter 遞迴處理巢狀 stacks/reporter inputs，保留變數、清單作用域和廣播；檢查未知欄位、名稱重複、sprite 引用及設計 metadata 數量。unsupported 格式會在寫檔前拒絕並附階段診斷。
- **P1 產物檢查與 inspect**：archive validator 依 `md5ext` 引用確認根目錄資產與檔案存在；另驗 MD5。`inspect.summary.blocks` 現在表示 archive 中全部 block entries，並新增 analyzed/shadow 分項。
- **P2 文件與回歸測試**：README、CLI reference、generator contract 已更新；新增 adapter、archive、CLI 入口及生成回歸測試。

### 驗證結果

- `npx tsc --noEmit --pretty false`：通過。
- 專項 Vitest：4 個測試檔、13 個測試通過。
- `npm run build --workspace=@scratch/scratch-ai-bridge`：通過 bundle budget。Build 仍印出 Node-only session imports externalized、runtime `new URL()` 及大型 renderer/VM chunks 警告。
- `npm test --workspace=@scratch/scratch-ai-bridge`：全套未通過，43 個測試檔中 2 檔失敗、60 項失敗/405 項通過。主要錯誤在既有未提交的 capability registry 測試以不相容 storage adapter 呼叫 Scratch VM；fixture 測試則要求編譯帶缺失來源資產的 costume/sound。這些未由本次生成入口修繕，應另立修復工作；不要將全套測試描述為通過。
- 以 `starport-rift-expedition.canonical.json` 實際走 CLI 產生 `/tmp/starport-final-check.sb3`：exit 0、stdout 可直接解析為純 JSON，archive 有 5 個引用素材且 MD5 全數符合，VM load/save/reload gates 通過。stderr 有 Scratch VM 對無渲染器載入素材的警告。
- 專案內可重現產物：`starport-rift-expedition.repaired.sb3` 與 `starport-rift-expedition.generation.json`；報告記錄 4 sprites、9 scripts、48 blocks、4 variables、1 list、5 costumes，archive 5/5 資產雜湊通過。
- **仍未完成的品質證據**：`runtime-behavior`、`renderer-preview` 明確為 `not-run`。目前生成成功代表結構、資產及 VM round-trip 驗證通過，不代表遊戲玩法或初始畫面已驗收。原計畫的 deterministic 遊戲 smoke、實際 renderer 預覽，以及護盾歸零結束條件仍待後續完成。

## 行為與畫面驗證續作（2026-10-30）

- 遊戲 Canonical IR 增加 Stage 綠旗初始化；重開時分數歸零、護盾回到 3、狀態回到「作戰中」，脈衝彈隱藏。巡防艇受擊後護盾降為 0 時，狀態改為「任務失敗」、顯示結束提示並停止所有腳本。
- 修正脈衝彈的 `sensing_touchingobject` 原本指向玩家的錯誤，改為檢查敵機。新增 `tests/game/starport-behavior.test.ts`，透過 Scratch VM 及具座標條件的 renderer mock，實際跑左右移動、子彈命中加分、敵機碰撞扣盾、三次受擊結束、綠旗重置。
- 新增 `generate ... --preview <stage.png>`：以已建置的 production preview 頁、Playwright Chromium 及官方 Scratch renderer 載入 SB3，等待 preview ready 後擷取 480x360 canvas。缺少 `dist/preview.html` 時會要求先執行 workspace build。
- 專項 TS 檢查通過；5 個測試檔、14 項測試通過；production build 與 bundle budget 通過。已產出修訂版 11 scripts／58 blocks 的 SB3、PNG 預覽及新版 generation JSON。renderer gate pass；generation JSON 的 generic runtime gate仍為 not-run，遊戲專屬行為 smoke 已由 regression test 通過。

## 系統通用表達能力（2026-10-30）

使用者確認目標是讓 AI 能依不同玩法產生好作品，而非把工具綁定單一遊戲。本輪擴充通用 GameDesign/Canonical 管線：

- GameDesign 不再要求 id/type/difficulty/created/output paths 等非必要 metadata，也可接受零個 sprite 的 Stage-only 專案。
- 新增 Stage 背景、外觀狀態與 Stage scripts；允許 script target 指向 Stage 名稱，並檢查 Stage 與 sprite target 命名衝突。
- GameDesign 保留 sprite size、rotationStyle、costume、volume，及 cloud variable；列表也接受布林項目。
- 變數與清單依 Stage/sprite target 分別檢查名稱，允許不同角色各自使用同名的局部狀態與資料清單。
- Capability registry 加入 9 個 Pen、7 個 Music 官方積木；COLOR input 進入語意與修復例處理。
- 設計轉換及 Canonical compiler 會從巢狀積木自動推導 extension IDs，避免生成專案漏掉 `pen`/`music` 宣告；AI prompt 說明 Stage 腳本與已驗證擴充的使用方式。
- runtime capability coverage gate 現可從 VM extension 測試讀取 Music 覆蓋，補入 instrument 命令。

驗證：`npx tsc --noEmit` 通過；設計轉換、compiler 與 coverage gate 專項 20/20 通過；Music runtime 3/3、Pen renderer runtime 1/1 通過。整合回歸 80 pass／5 skipped（刻意略過 5 個已知舊 renderer sprite-click target API、drag 非同步 assertion、SAY/THINK runtime event/start API 不相容案例）。修正 registry VM 測試改用正式 `createVM()` storage bootstrap 後，先前 `scratchFetch` 問題消失。仍未支援所有 Scratch/第三方 extensions、硬體輸入及任意未知 opcode；擴充需逐項登錄、檢查安全性並以 VM runtime 驗證。

下一階段以系統通用能力為主，涵蓋資料驅動 capability descriptors、多層 extension 支援狀態、多 genre fixture/AI benchmark 和分階段生成修復流程，詳見 [`REUSABLE-GAME-SYSTEM-PLAN.md`](./REUSABLE-GAME-SYSTEM-PLAN.md)。
