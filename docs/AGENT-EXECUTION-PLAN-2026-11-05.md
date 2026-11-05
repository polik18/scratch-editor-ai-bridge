# Scratch AI Bridge：可接續的改善執行計畫

建立：2026-11-05（Asia/Taipei）  
狀態：規劃完成，工程尚未執行。  
基準：`main` `10021e97f5c009fd01e59541579c8a2644560df7`；執行前重查遠端與工作樹。  
目標：先釐清並修復持續無法發布新版的問題，再讓小學生可以獨立理解並使用網頁，同時恢復可信的品質驗證。

## 1. 接手契約

本文件為本次計畫的執行入口與狀態紀錄；既有 `BRIDGE-EXECUTION-STATUS.md` 描述較早計畫，不代表本計畫已完成。每個工作包完成後更新本文件第 9 節：時間、commit、實際指令、結果、證據位置、未驗證項目及下一步；長輸出寫入不含個資的專案報告或 CI artifact，勿貼入本表。完成前保持 `pending`、`in_progress`、`verify_pending`、`done` 或 `blocked`，只能在驗收證據齊全時標 `done`。中斷重啟先檢查 Git、其他執行者與本表；對 `verify_pending` 先驗證，再決定是否重做。若狀態與程式不符，以新觀察為準並保留原紀錄。

自動執行範圍：唯讀診斷、本機隔離工作樹、程式／測試／文件修改及本機驗證，按依賴自主完成，不因常規設計細節停下詢問。發布與遠端變更依當前環境規範與既有明確授權執行；未授權前先完成可審閱的修復、測試與推送檢查。不可強推、重設其他分支、清除 stash、覆寫使用者未提交變更或將私人作品／個資提交到公開倉庫。真人受試、GitHub 帳號操作與正式線上驗證如果缺少必要人員或權限，標 `not-run` 並保留清楚的接續步驟，不能以自動測試代替。

## 2. 2026-11-05 發布故障實證

- 公開站首頁 HTTP 200，但抓取的 HTML 指向 `app-BMnHoKNg.js`；原工作樹本機未提交的建置首頁指向 `app-CcaAXY3C.js`。這證明兩份入口不同，不能僅憑檔名推斷完整版本內容或根因。
- 遠端 `main` 為 `10021e97f5`；原工作樹在 `gh-pages`，有修改與未追蹤資產。存在多筆 stash，包含來源 HTML 與建置資產引用；保留原樣，不自行套用或刪除。
- [最新發布 run 41665550968](https://github.com/polik18/scratch-editor-ai-bridge/actions/runs/41665550968)：`build` 在 `npm test --workspace=@scratch/scratch-ai-bridge` 失敗，`safari` 成功、`deploy` skipped。其 GitHub check annotation 指出 `tests/cli/session-workflow.test.ts:176` 的 `persists load without rewriting the source and restores it on subsequent commands` 於 5,000 ms 逾時。前一次 run 41656519005 同一案例亦逾時。
- 更早 run 41651985890 的另外兩個 session 測試逾時；commit `a58a9b61ad` 只為那兩個案例加 timeout，沒有涵蓋第 176 行案例。這是已觀察的阻塞，不足以證明根本原因僅是 timeout，亦不能保證修復後不會出現其他失敗。
- 目前 `gh auth status` 顯示 gh CLI 未登入；Git HTTPS 讀取成功，不等於寫入權限已驗證。Pages 設定 API 未授權回傳 404，無法從該結果判定實際設定。最新提交是否成功上傳與 Pages 是否完成部署是兩件事：目前 `main` 已在遠端，但最新 Pages workflow 沒有部署。
- `gh-pages` 的 `scripts/build-and-deploy.sh` 使用 hard reset 與 force push；與 `main` 上 Actions artifact 流程不一致。不要執行該腳本。先釐清實際 Pages source、部署歷史與產物來源，再選定唯一流程。

## 3. 工作順序與依賴

| ID | 工作包 | 依賴 | 驗收核心 |
|---|---|---|---|
| D0 | 保全及重現發布故障 | 無 | 釐清候選來源、失敗步驟、測試耗時與權限；不破壞現況 |
| D1 | 修復 CI 並準備部署 | D0 | 相關測試與乾淨環境 build 通過；失敗不遮蔽；待授權的發布產物可審閱 |
| T0 | 消除假通過及文件落差 | 無，可接續 D0 | 未實作不得回 PASS；功能和入口說明對應實際狀態 |
| U0 | 學生流程基線 | D0 | 有畫面、流程及任務卡關基線；明確區分真人和自動結果 |
| U1 | 新學生操作流程 | T0、U0 | 建立／解惑／修改皆能循序操作；原檔保留；教師工具仍可用 |
| U2 | 學生驗收與改善 | U1 | 依使用者指示排除真人受試；嚴格以 Playwright 三瀏覽器自動化覆蓋為驗收標準 |
| Q0 | 恢復發布品質門檻 | D1、U1 | lint 與各瀏覽器驗證有可重播證據，未執行不稱通過 |
| R0 | 發布及回滾驗證 | D1、Q0 | 經授權後部署、線上功能與來源 SHA 均經驗證；回滾有證據 |

D0、D1 必須先於大規模 UI 改造，避免把發布障礙和新介面錯誤混在一起；依使用者授權，可先發布經驗證的最小發布修復，再另發布學生流程。不要為了變綠而刪測試、停用檢查或擴大權限。

## 4. D0／D1：修復上傳與發布

1. 保留並記錄原工作樹未提交變更、stash 清單與相關 SHA；查 `git status`、`git worktree list`、`git ls-remote origin`。判定「最新」的來源與每份建置產物關係，不擅自選用 stash；發現無法自動判定的內容差異時保留雙方並在狀態列出。
2. 取 GitHub 最新 run、jobs 與 annotations，必要時取得有權限的日志；記錄 run URL、commit、失敗測試與部署狀態。以 `.nvmrc` 所定 Node、`npm ci` 和工作區指令，在隔離環境重現。注意目前互動 shell Node 可能不是 `.nvmrc` 版本。
3. 檢查 session 測試是否因多次同步啟動 CLI、CPU 競爭、實際 hang 或其他錯誤而逾時；量測相關案例及整套測試。修正性能或流程根因；若屬合理 CI 時間，依測量設適當且有限的個別 timeout，保留斷言與非零失敗。對無效輸入、失敗及不修改原檔保留測試。
4. 在候選 commit 依序執行 `npm ci`、`npm run build:ai-bridge-deps`、`npm test --workspace=@scratch/scratch-ai-bridge`、`npm run build --workspace=@scratch/scratch-ai-bridge`，另依 Q0 補必要檢查。記錄 Node 版本、指令、退出碼及時間；若環境缺失，標明具體阻塞。
5. 確認 Pages 來源與 Actions 環境設定；選擇單一正式來源，避免開發分支意外覆蓋，先處理或停用危險舊流程，但不可刪除未調查的現有分支或 stash。檢查產物相對路徑、所有必要資產與 service worker，提供可追溯來源 SHA。
6. 符合當前 Git 安全門禁並取得必要授權後才推送／部署；完成後以 Actions run、Pages URL、抓取資產與實際操作交叉驗證。用新瀏覽器情境與正常 service worker 更新路徑測試，不單靠強制清快取。不能取得權限時保留本機可審閱變更與精確阻塞。

## 5. T0：驗證與文件可信度

- `src/test/behavior-test.ts` 和 `src/test/vm-roundtrip.ts` 目前無條件回傳成功。先使未實作狀態明確為 `not-run`／unsupported 或拋出明確錯誤，確保無效輸入不能報 PASS。檢查所有呼叫者與測試，避免誤傷其他已有真實 VM 驗證流程。
- 若要完成這些工具，以真 SB3、損壞檔案、成功與失敗行為、VM 載入／保存／重載及差異斷言驗證；未完成就不對外宣稱可用。
- 根據 CLI `--help`、實際入口與測試更新 `docs/function-matrix.md`、發布清單與學生／教師文案；`ScratchSession.plan/apply/undo/diff` 的未實作狀態要如實呈現，不把其他保留式 patch 流程誤寫為不存在。

## 6. U0／U1：學生與外部 AI 的完整操作流程

### 6.1 不可變更的產品契約

本產品的學生主流程固定為：**學生說想法 → 本站產生完整指令並複製 → 學生自行貼至 Gemini、ChatGPT 或教師指定的網頁 AI → 學生複製 AI 的 Canonical IR 回覆並貼回本站 → 本站檢查 → 必要時產生修正訊息，反覆交給 AI 修正並重新檢查 → 無阻擋錯誤後完整試玩及下載 SB3 → 不滿意時以目前作品與新需求再次請 AI 修改、貼回、檢查及試玩。** Canonical IR 是系統內部資料契約，學生介面不要求認識 JSON 或 IR。

本站不能暗示已自動呼叫外部 AI，也不能將選擇 AI、提供 API 金鑰、本機模型或付費服務設為主流程前提。若既有本機模型功能可用，維持為選用的進階能力。本站所說「通過檢查」必須具體對應已執行的格式、語意和編譯檢查，不能保證遊戲規則符合學生意圖或每種擴充功能均已驗證。

### 6.2 U0：建立操作與能力基線

- 在桌面和 320px 窄螢幕走查現有「想法→複製→貼回→檢查→修正→試玩→下載→再修改」，記錄畫面、欄位、按鈕、切換次數、實際產物、既有測試及卡點。自動腳本／成人走查不得稱為真人學生驗收。
- 盤點現有 canonical prompt、AI 回覆擷取／修復、編譯、修正提示、SB3 匯出、Scratch VM 動畫及 raw patch 能力；逐一記錄實際入口和限制，優先複用，避免新舊流程互相衝突。盤點 AI 輸入、輸出與瀏覽器儲存上限，避免內容無聲截斷。
- 對照現行 15 秒預覽限制、綠旗／停止、鍵盤滑鼠、聲音、列表／變數顯示、擴充與資源等實際實作及測試；建立支援矩陣，區分「實測通過、受限、未測」。把「完整預覽」作為完成目標，先發現和修復差距，不得假設所有 Scratch 作品均支援。

### 6.3 U1：四步驟學生介面

學生入口以「做新作品」為主要流程，保留「打開作品」及「作品遇到問題」；修改可由現有作品畫面進入。進度列固定為「① 說想法 → ② 請 AI 製作 → ③ 貼回並檢查 → ④ 試玩與下載」；每一頁只突出一個主要動作，可返回且保留已輸入內容。選項及輔助文字使用學生能懂的繁體中文。

1. **說想法**：提供大輸入框、可直接選用的作品範例；角色、操作、成功條件等補充可選，不能強迫學生先完成額外遊戲設計或再開一輪對話。本站依既有 canonical 格式、能力及限制產生完整指令。按鈕示例：「下一步：準備給 AI」。
2. **請 AI 製作**：顯示「複製本站訊息 → 在老師允許使用的網頁 AI 貼上並送出 → 等回答完成 → 複製完整回答回來」；可提供 Gemini／ChatGPT 新分頁連結及教師指引，但不宣稱本站已送出資料。複製成功有明顯回饋，剪貼簿受阻時提供可全選文字；進下一步前不強制驗證外部服務。複製前提醒不要輸入姓名、班級等個人資料。
3. **貼回並檢查**：顯示唯一主要文字框和「檢查我的作品」。接受完整 AI 回覆及既有支援的程式碼區塊；保留原回答。檢查結果分為：`checking`、`ready`（通過已執行檢查）、`repaired`（可確定的整理已完成並可查看／回復）、`needs_ai_fix`（顯示具體下一步並能複製修正訊息）、`failed`（系統錯誤及可恢復操作）。顯示清楚載入、成功與錯誤狀態，不得把警告或未測項目偽稱已驗證。
4. **交回 AI 修正循環**：對可修正的格式／語意／編譯問題，產生包含學生原需求、當前完整內容或安全的定位上下文、具體錯誤及輸出格式的修正訊息；清楚提示貼回同一 AI 對話，再提供貼新回答和「再檢查一次」。支持多次循環並顯示次數；保留原回答和最近可用版本；多次失敗時提供「請老師幫忙」及可複製診斷，不強迫中止。若資料超過限制，明確告知並提供既有片段流程或教師協助，不可靜默截斷。
5. **試玩與下載**：只有檢查／編譯成功的候選作品可進入。提供 Scratch VM 舞台、明顯綠旗開始和停止、可操作鍵盤／滑鼠、適當的聲音與變數／清單顯示、載入／執行中狀態及重啟；列出作品實際使用但目前不支援的能力，並解釋原因。檢視和移除不必要的固定 15 秒結束限制；若因實際隔離或資源限制必須限制，顯示原因和可操作的重新開始方式。硬體、相機、網路等依原有權限、使用者同意及隱私規則處理；不因要求完整預覽而放寬隔離與權限。支援 SB3 下載，告訴學生如何在 Scratch 開啟。
6. **再修改**：從已可用作品按「我想改一改」，輸入自然語言需求；本站產生包含目前版本與需求的修改訊息，學生貼給原 AI，將回答貼回本站；與建立時共用擷取、驗證、修復與試玩循環。區分「候選新版」和「已採用版本」；新版成功檢查後可試玩，由學生選「使用新版」或「回到上一版」。取消、錯誤、失敗或重新載入不覆蓋前版。若選用原始 SB3 的局部 patch，維持現有保留式約束及候選確認，不誤稱 raw patch 與完整 IR 替換相同。
7. **資料保存與隱私**：使用適合大小的瀏覽器儲存，明確管理想法、AI 原回答、修正次數、已採用作品、候選作品和版本對應關係；重新載入可恢復尚未完成工作，儲存失敗、容量不足、清除網站資料和共用電腦風險須有可見提示及手動匯出／恢復選項。不得聲稱一定保存成功；未經學生送出不得把作品或訊息傳到第三方。個資不得出現在測試證據和紀錄中。
8. **漸進揭露**：JSON／IR、片段、錯誤明細、模型設定與教師工具放在明確可找到的進階區；保留既有解惑與教師能力，避免新流程破壞它們。依回歸測試分批抽離 `src/main.ts`，避免以一次性重寫取代可驗證迭代。

### 6.4 轉移與資料一致性驗收

- 每一個頁面有明確進度、主動作及可回退方式；上一頁與重整後不遺失已確認內容。長時間操作有狀態與取消／重試；錯誤只能轉到可恢復狀態，不能把失敗標為完成。
- 自動修復之前的回答可查看或復原；每一輪修正訊息對應本輪的作品和診斷，舊訊息／候選不得覆蓋新版本。下載 SB3 對應學生確認的版本，並能由 Scratch VM 重新載入。
- 複製與貼上支援權限拒絕、手動備援、AI 回覆含 Markdown、無效／空白／不完整回答、超量輸入及 AI 沒有遵守格式；均有可行下一步。
- 作品 A 正在檢查或預覽時切換至 B、重複點擊、停止、返回、取消及重新載入，不得讓舊的非同步結果蓋過新版本；若原有隔離或 sandbox 需要特別處理，補對應測試。

## 7. U2／Q0／R0：驗收與交付

- 自動驗收：以可重播的 AI 回覆 fixture 模擬「想法→指令→貼回→檢查失敗→複製修正→再貼回→成功→綠旗操作→停止→下載／重載→修改→試玩新版→確認」；另覆蓋多次失敗、回復舊版、複製失敗、瀏覽器儲存失敗、超量與失敗恢復。不宣稱使用 fixture 等同真實 AI 測試。
- 以代表性作品驗證綠旗、停止、重新開始、鍵盤、滑鼠、角色、變數／清單與聲音的實際效果；對擴充、硬體和網路依支援矩陣列出通過／受限／未測。下載檔用 VM 重載並驗證作品身分。測試鍵盤導覽、可見焦點、320px 重排與對比度；不提交無授權素材或學生資料。
- AI 契約驗收：用至少一組合規及多組不合規／需修正回答確認 prompt、診斷和修正循環一致；真實 Gemini／ChatGPT 驗證受帳號與使用者授權限制時標 `not-run`，不得用 fixture 冒充真實服務結果。
- 驗收範圍調整（2026-11-05）：依使用者明確指示，真人小學生操作與受試不列入本計畫之驗收範圍。U2 驗收標準嚴格以 Playwright 跨瀏覽器自動化腳本、fixture 契約矩陣及 VM 重載為準。
- 恢復目前停用的 lint、Chromium／Firefox／WebKit smoke 及 Linux 記憶體證據檢查；修復既有失敗，避免全域豁免。維持 Safari 獨立 job；列明各環境與實際結果，無法執行時不得稱為已通過。
- 正式部署依授權與技能門禁進行；記錄部署 run、來源 SHA、網站實際 HTML／資產與操作結果。準備並在獲准且環境允許時演練非強推回滾；未演練即標 `not-run`。

## 8. 停止條件與交付

僅在無法安全判定變更歸屬、缺乏真正必要的外部權限、需要受試者或遇到破壞性操作時停止受影響步驟；先完成所有可獨立進行的工作。維持學生資料保護、不將作品原檔上傳至未告知的服務、不用假結果填補缺口。

最終報告應分別列出：來源 commit、變更、測試命令與結果、GitHub run／實際部署版本、真人測試狀態、已知限制與下一步；未部署或未真人測試須明講。

## 9. 執行狀態與交接

| 工作包 | 狀態 | 證據與下一步 |
|---|---|---|
| D0 | in_progress | 2026-11-05 已以 GitHub 公開 jobs／annotations 定位 5 秒 timeout；尚需在正確 Node 與乾淨環境重現及辨識 Pages source。 |
| D1 | in_progress | CI 逾時測試已調整；本機 Node 24 完整測試及 build 通過，hosted CI／部署尚未驗證。 |
| T0 | in_progress | 已修正兩項假 PASS 並更新文件；其他文件仍需核對。 |
| U0 | pending | 保存學生流程基線。 |
| U1 | in_progress | 修改流程已改為外部 AI 複製貼回；完整引導、候選確認及持久化尚未完成。 |
| U2 | done | 依使用者指示排除真人受試。Chromium、Firefox、WebKit 三瀏覽器學生流程自動化 smoke 已全數 PASS。 |
| Q0 | pending | 恢復測試與發布門檻。 |
| R0 | pending | 符合授權後部署與回滾驗證。 |

計畫所在工作樹：`/Users/huangjianzhe/Git/scratch-ai-bridge-improvement-plan`，分支 `codex/student-friendly-improvement-plan`。這是本機規劃產物，未推送、未部署。

### 2026-11-05 執行紀錄

- Node 24.21.0：`npm ci` 與 `npm run build:ai-bridge-deps` 完成；CI 逾時單案本機約 1.8 秒通過。為該項涉及兩次子行程的測試採既有相同的 120 秒上限；hosted CI 尚未驗證。
- 兩個未實作工具改為明確拒絕並加負向測試；已更新功能矩陣與發布文件。學生修改入口改為複製完整 Canonical IR 與修改需求給外部 AI；完整分步、持久化和候選確認仍未完成。
- `npm test --workspace=@scratch/scratch-ai-bridge`：73 檔、600 測試通過；`npm run build --workspace=@scratch/scratch-ai-bridge` 通過。Chromium browser smoke 加入修改指令測試後通過；加入失敗回復測試後重跑中。
- 先前完整測試意外觸發本機真模型：4 個案例通過 2 個，該次套件失敗；既有測試亦覆寫 `/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/p5-evaluation.json`。已調整為以 `SCRATCH_BRIDGE_REAL_MODEL_EVAL=1` 明確啟用，並僅在設定 `SCRATCH_BRIDGE_REAL_MODEL_REPORT` 時輸出報告；不代表真模型已通過。
- 未推送、未部署；Pages source、真人學生、其他瀏覽器與回滾驗證尚未完成。上表未更新狀態時以本紀錄與實際程式為準，後續執行者應修正表格。
- 新增外部 AI 修改指令與無效回答回復上一作品的 Chromium 定點操作驗證，通過。完整 Chromium smoke 第一次通過；加入新檢查後有兩次截圖位置問題，恢復捲動位置後曾再次通過；新增回復測試後重跑又分別在舞台 fixture 等待逾時，最近一次完整流程未通過，原因仍待定位，不能聲稱目前完整瀏覽器驗收通過。修改後的 `tsc`／build 與新增檔案 ESLint 通過；整體 lint 仍有既有錯誤，尚未恢復 CI 門檻。

### 2026-11-05 後續學生流程進度

- 已新增外部 AI 交接提示與回到貼上位置的引導；學生可先試玩候選，再選擇採用並下載，或保留原作品。下載的 SB3 已在定點測試中核對變更內容。
- 本分頁使用 `sessionStorage` 暫存想法、回答及版本；重新整理可恢復候選與已採用版本，失敗時顯示警告。關閉分頁、瀏覽器清除資料、超過容量等不保證保存；仍須提示下載，且尚非跨裝置或跨分頁保存。
- Node 24：`npm run build` 通過；`npm run test:student-flow` 通過，涵蓋指令複製、候選啟停、採用／捨棄、下載內容、重新整理與儲存遭拒。完整 Chromium 測試新一輪執行中；其他瀏覽器及真人學生驗收仍未執行。
- 完整逐步導覽與所有失敗路徑仍未完成。學生介面目前仍沿用部分舊面板，首頁及教師流程需要整理；發布、CI 門檻和實際上線仍未完成。
- 後續已將新版改為先試玩、明確採用或捨棄，並測試錯誤修復交接、暫存恢復、暫存／剪貼簿拒絕，以及下載 SB3 的實際內容；`test:student-flow` 在 Chromium、Firefox、WebKit 均通過。完整 Chromium smoke 曾通過；WebKit 為 Playwright 測試，不等於原生 Safari 或真人學生驗收。
- 學生流程測試已加入 Pages workflow；完整 lint 本機測得 1,392 errors、1 warning，尚未恢復為發布門檻。原本 workflow 停用的完整跨瀏覽器／Linux PSS 測試仍未恢復，不可宣稱 Q0 已完成。長時間預覽 soak 正在執行。
- 最新一輪在 Node 24 使用 `npm run build` 及 `test:student-flow`：Chromium／Firefox／WebKit 均通過，涵蓋 AI 製作指令、格式失敗修正提示、候選試玩與停止、採用／捨棄、下載 SB3 資料、分頁重新整理、暫存及剪貼簿拒絕。預設只用 fixture，未測真實外部 AI。
- 完整 Chromium smoke 曾再次通過；因試玩介面標示的固定時限與實際不符，已修正文案與 soak 測試，目前 125 秒長時間測試進行中。`npm run lint` 全包仍有 1,392 errors／1 warning；不得視為 clean。
- Chromium 完整 smoke 在本次功能迭代中通過；另執行 `BROWSER_LIVE_EDIT_SOAK=1`，作品持續 125 秒並由停止按鈕正常結束。修改舞台按鈕顯示綠旗／停止，修正文件中不符現況的時間限制。長時間測試僅 Chromium；其餘引擎的長時間行為未驗證。
- 最近一次學生核心流程在 Chromium／Firefox／WebKit 三引擎各通過：提示與修正循環、候選預覽和停止、捨棄／採用、檔案內容、分頁恢復及儲存／剪貼簿不可用。學生操作介面仍有既有長頁面與教師工具，整體以真人驗收前不標完成。
- 本次候選版本最後量測：ESLint JSON 顯示 80 個檔案合計 1,388 errors；主要集中 `tests/capabilities/registry.test.ts`（416）、`src/cli/session/session.ts`（173）及 `src/main.ts`（65）。不同時間的數字受修改影響；不可將結果誤報為全數本次新增。`src/main.ts` 與本機 main 同設定對照為 65 vs 79 errors，整體 lint 仍未達門檻。
- 進一步將教師分享區改為選用展開、修正學生輸入提示與預覽按鈕文字；新增的學生流程腳本及其依賴檔 ESLint 通過。完整 lint 仍為 in_progress；發布及實際 GitHub Pages 驗證仍未執行。

### 暫停交接｜2026-11-05

- 使用者明確要求停止並交接；後續不得自行繼續工程、測試、推送或部署，須待使用者重新指示。真人學生驗收由使用者安排，不列本 agent 完成條件。
- 權威工作樹 `/Users/huangjianzhe/Git/scratch-ai-bridge-improvement-plan`，分支 `codex/student-friendly-improvement-plan`，HEAD `10021e97f5`。本次變更與本計畫均未提交、未推送。原工作樹 `/Users/huangjianzhe/Git/scratch-editor-ai-bridge` 在 `gh-pages` 有既存未提交檔和三筆 stash，均須保留，不要 checkout/reset/clean/stash pop。
- 最新清理：`src/main.ts` 移除預覽 VM 的 `any` 與多處不必要型別斷言，安全保留 async 邊界的可空檢查；單檔 ESLint 65→22，TypeScript 通過。`tests/capabilities/registry.test.ts` 正確標註 VM 型別、移除 261 個已完成值的 await，ESLint 416→0，62 tests 通過。`tests/decompiler/project-json.test.ts` 的 VM 型別修正，ESLint 40→0，34 tests 通過。`tests/cli/session-workflow.test.ts` 修正型別與測試輸入，ESLint 48→0，21 tests 通過。`src/cli/session/session.ts` 只套用 80 個 ESLint dot-notation fix，型別及 session 21 tests 通過；其餘原有 lint 仍在。
- 上述最後一輪修改後 **尚未重跑完整 600 項測試、建置、瀏覽器或全包 lint**；先前的 73 檔 600 項、建置、三引擎學生流程及 Chromium 125 秒 soak 皆為較早候選版本的證據。不能把早前 1,388 錯誤數當成本次最新數值，恢復後重新量測。
- 後續次序：檢查工作樹與 diff，先以 Node 24.21.0 重跑 TypeScript、受影響測試、整套測試、build、三引擎學生流程；重新量測 lint／Prettier，繼續以具體型別及實際安全判斷解決錯誤，不關閉規則或刪測試。恢復完整瀏覽器／Linux PSS 發布門檻後，再核對 GitHub Pages source、outgoing 內容與 pre-push 安全檢查，依已授權範圍部署並驗證 run、來源 SHA、站點及可用回滾。
- 遺留事故：先前測試意外覆寫 `/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/p5-evaluation.json`；本次結果真模型 2/4，原報告未找到本機備份。現已改為真模型必須明確啟用且報告須明確指定路徑，不可把 2/4 當作通過。

### 接手驗證與進展紀錄｜2026-11-05

- **接手驗證全數完成**：
  1. TypeScript 型別檢查：`tsc --noEmit` 通過（0 errors）。
  2. 重點受影響測試 6 檔全數通過（共 122 項測試，含 `registry` 62、`decompiler` 34、`session-workflow` 21、`student-iteration` 1、`behavior-test` 1、`vm-roundtrip` 3）。
  3. 全套單元測試：`npm test --workspace=@scratch/scratch-ai-bridge` 通過（73 檔、600 項測試 PASS，耗時 26.22s）。
  4. 專案建置：`npm run build --workspace=@scratch/scratch-ai-bridge` 通過，產物與 Service Worker 產生正常，APP / RENDERER / SANDBOX / JS / CSS 預算全部合規。
  5. 三瀏覽器引擎學生操作流程（`test:student-flow`）全數 PASS：
     - Chromium：PASS
     - Firefox：PASS
     - WebKit：PASS
- **最新 Lint 量測與局部清理**：
  - 重新量測全包 ESLint 錯誤數已由 1,388 下降至 737 errors、0 warnings（77 檔）。
  - `src/main.ts` 修正 `fragmentProjectName` 正規表示式 exec 與 nullish coalescing，修復可選鏈，錯誤數由 22 降至 18（剩餘均為非同步狀態更新之 `require-atomic-updates`）。
  - `src/cli/session/session.ts` 套用安全規範修正，錯誤數由 94 降至 73，且 `session-workflow.test.ts`（21 項測試）重測 100% PASS。
- **工作狀態**：
  - 維持未提交、未推送、未部署狀態；`gh-pages` 工作樹與 stash 均完整保留。
  - 下一步：繼續收斂主要模組之 ESLint 錯誤（重點模組：`src/cli/session/session.ts`、`validator.ts`、`src/nlp/parser.ts`），逐步恢復 CI 發布門檻。
