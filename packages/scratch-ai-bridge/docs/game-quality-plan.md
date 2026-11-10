# 作品品質改善計畫（交接檔）

> 本檔是「學生一句話 → 拿到的 Scratch 遊戲好不好」這條主線的**唯一執行檔**。接手者先讀完本檔，再依「6. 任務卡」挑第一個未完成項目做；完成或中斷都要回寫「2. 進度表」與「7. 交接紀錄」。
>
> 建立：2026-11-10（Claude Code）。分支 `feat/bridge-asset-library-benchmark`，工作樹 `/Users/huangjianzhe/Git/scratch-ai-bridge-improvement-plan`。

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

| 步驟 | 內容                                       | 狀態                      | 證據／備註                                                |
| ---- | ------------------------------------------ | ------------------------- | --------------------------------------------------------- |
| 0a   | 品質基準工具：10 題＋無頭試玩評分          | ✅ 完成                   | commit `b78adb48f1`；兩份手寫回覆試跑 78%（不是真實基準） |
| 0b   | **用真實模型跑出 baseline 分數**           | ✅ 完成（本機 baseline，0/10 編譯） | Qwen 80B local；10 題已生成，build 0/10；見 T0b |
| 1a   | 官方素材庫接入生成（提示、下載、補齊）     | ✅ 完成（Node 驗證）      | 611/611 測試、build 與打包預算通過                        |
| 1b   | 在真實瀏覽器驗證素材下載與 CSP             | ✅ 完成                   | Playwright Chromium 線上／斷網 smoke；官方 Apple MD5、CSP、fallback 均通過 |
| 1c   | 學生「換一個素材」介面、離線備援、隱私說明 | ✅ 完成                   | Chromium 線上／暖快取離線／冷離線、換素材重編譯與復原均通過 |
| 2a   | 精簡製作指令並附完整範例（目標 ≤ 6K 字元） | ✅ 完成（同模型平均 8%） | 10 題提示 5,878–5,939 字；最終重跑 `t2a-r3`，builds 1/10、plays-sound 1/1、animated-sprite 1/1 |
| 2b   | scratchblocks 文字格式可行性實驗           | ✅ 完成（採用後續受控整合方向） | 同模型／同 10 題：平均 61%、build 10/10；見 T2b 證據 |
| 3    | 網頁內自動試玩，玩法錯誤回饋給學生         | ⏳ 待做                   | 見 T3                                                     |
| 4    | 首頁精簡成單一路線                         | ⏳ 待做                   | 見 T4                                                     |
| 5    | 文件與工程整理                             | ⏳ 待做                   | 見 T5                                                     |

建議順序：**1b → 0b → 2a → 3 → 1c → 4 → 2b → 5**。1b 只要幾分鐘，卻決定上線後素材功能能不能用；0b 是之後所有改動的比較基準。

## 3. 位置與環境

| 項目         | 位置                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始碼工作樹 | `/Users/huangjianzhe/Git/scratch-ai-bridge-improvement-plan`（本分支 `feat/bridge-asset-library-benchmark`，從 `main` `aa094128a0` 分出，**未 push**）                                                                              |
| 套件         | `packages/scratch-ai-bridge`（TypeScript + Vite + Vitest）                                                                                                                                                                          |
| 部署工作樹   | `/Users/huangjianzhe/Git/scratch-editor-ai-bridge`（`gh-pages`，網站產物；舊計畫文件在其 `docs/`）。**不要在這裡開發**                                                                                                              |
| 另一工作樹   | `/Users/huangjianzhe/Git/scratch-bridge-paper-feedback`（`codex/paper-feedback-calibration`），有他人**未提交**的修改，含 `src/main.ts`、analyzer、CLI inspect。**不要碰、不要合併**；本分支改 `main.ts` 約 40 行，日後合併可能衝突 |
| 線上網址     | https://polik18.github.io/scratch-editor-ai-bridge/（仍是舊版，本分支未部署）                                                                                                                                                       |
| 本機模型     | oMLX 在 `127.0.0.1:8000`，需要 API key。**不要自行翻設定檔找金鑰**（會被權限擋下），請向使用者索取                                                                                                                                  |

## 4. 已完成內容（commit `b78adb48f1`）

### 4.1 官方素材庫接入（步驟 1a）

| 檔案                                       | 作用                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/generate-asset-library-index.mjs` | 從 `packages/scratch-gui/src/lib/libraries/{sprites,backdrops,sounds}.json` 產生精簡索引。指令 `npm run generate:asset-library`                                                          |
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
| `benchmarks/game-quality/cases.json` | 10 題：catch-apples、space-dodge、space-shooter、mouse-maze、jump-collect、pop-balloons、two-player-pong、deep-sea-rescue、car-racing、whack-a-mole。每題定義按鍵與預期移動軸向，以及是否預期自己動、狀態變化 |
| `benchmarks/game-quality/README.md`  | 用法與各檢查項定義                                                                                                                                                                                            |
| `scripts/game-benchmark.ts`          | `npm run benchmark:games -- prompts                                                                                                                                                                           | generate | score --run <dir> [--cases a,b] [--force]` |
| `src/cli/playtest.ts`                | `PlaytestRunner`：以 vite preview 開 `dist/preview.html`，用 headless Chromium 送鍵盤和點擊，透過現有的 `capture-game-progress` 訊息讀取角色和變數狀態，再比對截圖像素                                        |

評分項目：builds、runs、moves-on-its-own、key（每個按鍵一項）、state-changes-in-play、library-art、plays-sound、animated-sprite。分數 = 通過數 ÷ 項目數。

### 4.3 驗證紀錄（2026-11-10）

- `vitest run`：74 個測試檔、613 個測試全部通過。
- `npm run build`：通過；APP 打包 1.51 MiB gzip，上限 1.75 MiB。
- `npm run test:browser`：Chromium 完整回歸 smoke 通過，含修復／重匯入迴圈、學生操作、離線 reload、CSP、官方 SB3 預覽與品質量測。
- `npm run test:student-flow`：學生候選預覽、捨棄、採用、重新載入與儲存失敗流程通過。
- `npm run test:asset-library-browser`：Chromium 線上下載官方 Apple 素材，SB3 內原始位元組 MD5 為 `3826a4091a33e4d26f87a2fac7cf796b`，狀態列顯示官方造型／音效且 CSP 違規為 0；斷網時退回簡單圖形並顯示下載失敗，CSP 違規仍為 0。
- T0b 本機 baseline：使用 `qwen3-coder-next-80b-local`（`http://172.22.35.142:8091/v1`），10/10 題回覆生成完成；pipeline build 0/10，parse 2/10、normalize 8/10，runtime／素材／音效／動畫檢查皆未執行。最常見失敗為 `requirementCoverage` evidence pointer 不存在或指向非 block（8 題），另有 2 題 JSON 語法不完整。證據：`benchmarks/game-quality/runs/2026-11-10-local-qwen3-coder-next-80b-local/report.{json,md}` 與 10 份 prompt／response。
- T2a 最終本機對照：同一 `qwen3-coder-next-80b-local`、同一 10 題，學生提示由原本約 13K 壓到 5,878–5,939 字；最終 `t2a-r3` 平均 check pass rate 8%，`builds` 1/10、`runs` 1/1、`plays-sound` 1/1、`animated-sprite` 1/1，`two-player-pong` 單題 82%。`t2a`／`t2a-r2` 是提示詞迭代證據：前者 0/10（語意錯誤），後者 0/10（模型輸出 JSON 語法錯誤）。證據：`benchmarks/game-quality/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2a-r3/`。
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
- **做法**：`npm run build` 後用 `vite preview` 開主站，貼上一份手寫回覆，裡面有造型 `{"name":"Apple","dataFormat":"svg"}`（結構可參考 `tests/visuals/library.test.ts`），按「檢查並製作 Scratch」。可以參考 `scripts/student-flow-smoke.mjs`，把它寫成 Playwright smoke。
- **驗收**：
  - 下載的 SB3 裡 Apple 造型的 MD5 是 `3826a4091a33e4d26f87a2fac7cf796b`；
  - 狀態列顯示「已放入 N 個 Scratch 官方造型」；
  - 瀏覽器 console 沒有 CSP 違規；
  - 斷網時退回簡單圖形，並顯示「下載失敗」說明。
- **注意**：service worker 只攔截同源請求（`scripts/generate-service-worker.mjs`），不會擋下素材下載。

### T0b 真實模型基準（約 1 小時，需要使用者協助）

- **目的**：取得改動前後可以比較的分數，之後每一步都對照這份基準。
- **做法**：
  1. 向使用者取得 `BENCH_BASE_URL`、`BENCH_MODEL`、`BENCH_API_KEY`；或請使用者把 `prompts` 產生的 10 份訊息貼到 Gemini 或 ChatGPT，回覆存成 `<id>.response.txt`。
  2. 執行目錄放在 `benchmarks/game-quality/runs/<日期>-<模型>/`。PNG 已被 gitignore；report.md、report.json 和回覆要提交，當作基準。
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

### T2b scratchblocks 文字格式實驗（視 T2a 結果決定）

- **問題**：讓 AI 輸出 scratchblocks 文字，再由 Bridge 轉成 IR，是否比 JSON 更準？
- **做法**：新增獨立 `src/core/scratchblocks/parser.ts` 與 `scripts/scratchblocks-benchmark.ts`，先支援基準 10 題實際出現的帽子、控制、移動、感測、資料、音效、廣播與分身等積木；同一 `qwen3-coder-next-80b-local`、同一 10 題送入文字格式，再轉 Canonical IR，沿用既有素材／編譯／無頭試玩 pipeline。
- **驗收**：證據目錄 `benchmarks/game-quality/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2b-scratchblocks/`，比較報告 `comparison.md`：JSON T2a 平均 8%、build 1/10、平均回覆 17,282 字；scratchblocks prototype 平均 61%、build 10/10、run 10/10、平均回覆 757 字、parser warnings 0。結論：**採用 scratchblocks-style 作為後續受控整合方向，但暫不直接接入 UI**；尚須補齊動畫、多角色、多感測／分身語法後再整合。

### T5 文件與工程整理

- 把 gh-pages `docs/` 和套件 `docs/` 裡的舊計畫，在索引中標示「歷史參考，現行主線見 game-quality-plan.md」。不刪除，也不改寫內容。
- lint 只要求新改的檔案零錯誤；讓 CI 恢復跑 browser smoke。

## 7. 交接紀錄（新的寫在最上面）

- **2026-11-10 Codex**：完成 T2b scratchblocks 文字格式實驗。新增獨立 scratchblocks-style subset parser、benchmark prepare／compare 腳本與 2 個 parser 測試；同一 Qwen 80B／同一 10 題經既有 pipeline，平均 check pass rate 由 JSON T2a 8% 提升至 61%，build 1/10 → 10/10，平均模型回覆 17,282 → 757 字，parser warnings 0。結論採用後續受控整合方向，但暫不接 UI；先補動畫、多角色與更多感測／分身語法。`npm test` 76/76 檔、618/618 測試，build／bundle budget／改檔 lint 通過；尚未 push／部署。

- **2026-11-10 Codex**：完成 T1c。新增完成作品的官方素材縮圖與「換一個並下載新版」介面，替換只改素材欄位、不改積木，並可用既有「回到上一個可用作品」復原；首頁補上官方素材下載／作品不上傳的隱私說明。`createScratchAssetFetcher` 以 Cache Storage 保存並驗證官方素材，加入暖快取離線訊息與冷離線 fallback。Chromium smoke 驗證線上下載、Apple raw-byte MD5、換成 Cat、復原、暖／冷離線、CSP 0 違規；`npm test` 75/75、616/616，build 與 bundle budget 通過；尚未 push／部署。下一步可進入 T2b scratchblocks 實驗或 T3 自動試玩回饋。

- **2026-11-10 Codex**：完成 T2a。新增可編譯的官方素材接蘋果範例，學生提示改成 ≤6K、常用 opcode 與 `features` envelope；`npm test` 75/75 檔、616/616 測試，build、改檔 ESLint／Prettier 全通過。用同一 Qwen 80B 本地模型重跑三輪，最終 `t2a-r3` 10 題平均 8%，builds 1/10、runs 1/1、plays-sound 1/1、animated-sprite 1/1；尚未 push／部署。下一步依主線可做 T1c，或針對廣播 input 穩定性進入 T2b。

- **2026-11-10 Codex**：完成 T0b 本機 baseline。依 AI 系管師／Hermes 私有 provider 使用 `qwen3-coder-next-80b-local`（`http://172.22.35.142:8091/v1`）生成 10 題；10/10 回覆成功，但 0/10 通過 Bridge pipeline：8 題是 `requirementCoverage` evidence pointer 錯誤，2 題是 JSON 語法錯誤。這是目前 Qwen 80B 的品質基線，不是瀏覽器執行失敗；下一步依序進入 T2a，或先修正 requirementCoverage 輸出契約後重跑對照。
- **2026-11-10 Codex**：完成 T1b。新增 `scripts/asset-library-browser-smoke.mjs` 與 `test:asset-library-browser`，以真實 Chromium 驗證官方 Apple 素材下載、CSP、斷網 fallback；發現並修正 VM 編譯後官方 SVG raw-byte MD5 被正規化的缺陷，保留官方 `3826a4091a33e4d26f87a2fac7cf796b`。`vitest` 74/613、build、`test:browser`、`test:student-flow` 均通過；未 push、未部署。下一步仍是 T0b，需向使用者取得模型端點／金鑰或 10 份模型回覆。
- **2026-11-10 Claude Code**：完成診斷（第 1 節），完成 0a 和 1a，commit `b78adb48f1`，未 push、未部署。下一步請先做 T1b，再向使用者取得模型端點做 T0b。使用者已明確表示：Scratch 內建素材完全沒有發揮用途，AI 也畫不出像樣的 SVG。所以 AI 不得繪圖、一律使用官方素材，這是本主線的設計前提。
