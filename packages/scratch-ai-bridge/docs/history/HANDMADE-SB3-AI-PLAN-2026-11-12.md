# 讓 AI 看懂並修改真人做的 Scratch：改善計畫

2026-11-12。對象是**不是 Bridge 做出來的 .sb3**：學生在 Scratch 編輯器裡一塊一塊拖出來的作品。
目標有三個：

1. **打開作品很容易。** 在主頁就能選檔或直接拖進來，或貼上 Scratch 網址，打開後馬上能預覽、請 AI 修改。
2. **AI 真的看得懂。** AI 拿到的內容要像學生在 Scratch 看到的一樣，包括程式和畫面上的樣子。
   AI 要知道「藍色的魚」是哪個角色，改的時候也不能弄壞作品裡 AI 看不懂的部分。
3. **和 Scratch 網站接起來。** 從網站找到作品、連同作者寫的操作說明一起讀懂，改好後（經使用者同意）放回網站。

## 0. 接手須知（任何 agent 先讀這節）

**這份文件是這個工作的唯一交接點。** 做完一項就更新本節的任務表和第 10 節的紀錄，再 commit。
不要另外開新的計畫檔；細節寫在對應的章節。

### 0.1 一句話

讓 AI 看懂並修改**真人做的** Scratch 作品。這類作品名字常常沒有意義（Sprite1、costume2），而且做的人是靠畫面在做。
現在的瓶頸有三個：
- AI 一次只能讀 10 個原始積木 JSON，最多查 8 次。
- AI 看不到畫面。
- ~~Bridge 的積木圖檢查比 Scratch 嚴格，會把整個角色鎖住，不讓 AI 改。~~ 已解決（B0a、B0b）：樣本 73 件現在全部可以改。

### 0.2 任務表

狀態：✅ 完成、🟡 進行中、⬜ 未開始、— 不納入本次範圍。開工前把狀態改成 🟡，並在「誰」寫上自己（例如 `claude`、`codex`）。

| ID | 任務 | 狀態 | 誰 | 驗收 | 主要檔案 |
| --- | --- | --- | --- | --- | --- |
| A | 主頁打開作品、整窗拖曳、白話錯誤 | ✅ | claude | `npm run test:open-project-browser` | `src/open-project.ts`、`src/main.ts` |
| B0a | 自製積木預設值數量不符不再鎖角色 | ✅ | claude | `tests/graph/block-graph.test.ts`（argument defaults 那一則） | `src/core/graph/block-graph.ts` |
| B0b | 其他「Scratch 能跑、Bridge 判錯」的積木圖問題（見 0.4） | ✅ | claude | `tests/graph/block-graph.test.ts`、`tests/ai/raw-tool-core.test.ts`；樣本 `lockedSprites` 全空 | `src/core/graph/block-graph.ts`、`src/core/ai/raw-tool-core.ts` |
| 0 | 樣本＋現況量測（含理解測試題目） | ✅ | codex | 16/16 件基線結果檔；2 件合法回答、14 件模型／工具協定錯誤；合法回答操作分 2/2 通過（100% of measured） | `scripts/tools/`、`output/handmade-corpus/`、`output/tmp/understanding/2026-11-12/` |
| B1–B2 | 作品讀本（只讀）＋E3 作者說明，取代網頁 raw 路徑的原始 JSON | ✅ | codex | 73/73 讀本 ≤ 24,000 字、內建積木可讀 100%，作者說明可由 CLI fetch 帶入 | 新增 `src/core/reader/` |
| C1 | 造型、位置翻成文字 | ✅ | codex | 官方素材、尺寸、九宮格、SVG 顏色與瀏覽器 PNG 主要顏色取樣已加入；reader 可接收 visual hints | `src/core/reader/`、`src/main.ts` |
| C2 | 點舞台指定角色、AI 不確定時先問 | ✅ | codex | 靜態預覽可點選角色；Canonical、raw 與 MCP 都能轉送 `ask_student`，並有選項對話框 | `src/main.ts`、`src/mcp/tools.ts` |
| B3a | 行號操作修改 | ✅ | codex | `set/replace/insert_after/delete` 已接到 raw patch，保留 ID、revision 和 VM 驗證；單元測試通過 | `src/core/ai/line-patch.ts`、`raw-tool-core.ts` |
| B4 | 讀本→解析→積木圖來回 | ✅ | codex | 73/73 作品、2,397/2,397 段程式全量通過；未知積木原樣保留、可辨識葉積木可修改，0 失敗 | `src/core/reader/`、`src/core/ai/line-patch.ts`、`scripts/tools/check-reader-roundtrip.ts` |
| D＋E4 | CLI `fetch`／MCP／文件、`skill-scratch-site` | ✅ | codex | `start` 列出 fetch/ai-reader；MCP 有 read_script/find；skill validator 因環境缺 PyYAML 尚未執行 | `src/cli/`、`~/ObsidianVault/skills/` |
| C3 | 看得懂圖的模型附截圖 | ✅ | codex | Vision 勾選會送舞台截圖與造型拼貼；複製路線可下載兩張 PNG | `src/main.ts`、`src/core/ai/openai-compatible.ts` |
| E2 | 網址讀取公開作品 | ✅ | codex | 已依 CORS 驗收規格完成：瀏覽器受限時清楚引導下載後拖入，CLI／skill 可由網址下載 metadata、SB3 與作者說明 | `src/scratch/public-project.ts`、`src/main.ts`、`scripts/tools/fetch-scratch.mjs` |
| B3b | 整段程式文字修改 | ✅ | codex | `script` change 會依 `script:<rootId>` 解析完整 zh-tw 文字、保留圖節點 ID、產生 raw graph patch 並要求 VM 驗證 | `src/core/ai/line-patch.ts`、`raw-tool-core.ts` |
| C4 | 自動跑動觀察 | ✅ | codex | 學生預覽已可自動執行、擷取角色位置／造型／變數與測試回饋 | `src/main.ts` |
| E5 | 放回 Scratch 網站 | — | | 使用者確認本次目標不需要登入／上傳；Bridge 以本地讀取、修改與下載 `.sb3` 為邊界 | — |

### 0.3 怎麼開始

```sh
cd ~/Git/scratch-editor-ai-bridge
npm run --silent bridge -- start                      # Bridge 目前能做什麼
cd packages/scratch-ai-bridge
npx vitest run && npm run --silent lint               # 單元測試、lint（應全過）
npm run build && npx vite preview --port 5178 --strictPort --host 127.0.0.1   # 另開一個終端機
npm run --silent test:open-project-browser            # 瀏覽器測試都需要上面的 preview
node scripts/smoke/raw-property-browser-smoke.mjs     # 原始 SB3 修改流程
npx tsx scripts/tools/measure-corpus.ts ../../output/handmade-corpus/leejoneshane   # 量樣本
node scripts/tools/fetch-scratch.mjs ../../output/handmade-corpus/<名稱> --user <Scratch 使用者>   # 下載更多樣本
```

- `npm run dev` 目前是壞的：scratch-vm 是 CJS，dev 模式沒有 default export。測網頁一律用 build＋preview。
- 預覽 iframe 的 origin 是 null，`vite.config.ts` 已經加上 `Access-Control-Allow-Origin`。

### 0.4 已知狀況（接手前要知道）

- **樣本**：
  - `output/handmade-corpus/leejoneshane/`：73 件。每件都有 `.json`，裡面是 Instructions、Notes、作者和授權。
  - `output/handmade-corpus/` 第一層：使用者給的 7 件。真正手做的只有 Untitled-20 和 METRO；acorn 和狂暴大猩星是 Bridge 做的。
- **積木圖檢查（B0 的結果）**：
  - 規則：AI 的修改**不可以增加新問題**，作品原本就有、Scratch 能執行的殘留可以保留。
  - 可容忍的問題：`missing-parent`、`invalid-argument-reporter`、`invalid-procedure-call-arguments`、`unresolved-procedure-call`，
    以及只發生在 shadow 積木上的 `parent-mismatch`。
  - 判斷函式：`isToleratedGraphIssue`（`src/core/graph/block-graph.ts`）。
  - 循環、缺積木、子積木被共用，以及一般積木的 `parent-mismatch`，仍然會鎖住角色。
  - `sensing_current` 的選項（例如 HOUR）不分大小寫，因為 Scratch 讀取時會先轉成小寫。
  - 檢查哪些角色仍被鎖：`npx tsx scripts/tools/measure-corpus.ts <資料夾>` 的 `lockedSprites` 欄（空白表示可以改）。
- **本機模型**：oMLX `http://127.0.0.1:8000/v1`，模型 `Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e`。API key 只由使用者在網頁輸入，agent 不讀、不存、不印。
- **畫圖政策**：本機模型只從候選清單挑素材，不畫圖。

### 0.5 規則

- 和使用者一律用繁體中文溝通。
- Commit 要符合 Conventional Commits，結尾加 `Co-Authored-By`。修 bug 先寫會失敗的測試。
- **推送前**：先跑 `~/ObsidianVault/skills/skill-git-github-operations/scripts/pre_push_check.py`，並取得使用者明確同意。
- **樣本和學生作品不進 git**：只放在 `output/`，那裡本來就被 git 忽略（Air-Gap）。
- 對 Scratch 網站：放慢下載速度；要登入的動作每次都先問使用者（見 E5）。
- **開發 Bridge 和使用 Bridge 是兩回事。** `packages/scratch-ai-bridge/AGENTS.md` 有兩條規則：「不要在套件資料夾裡新增檔案」「不要主動重新 build」。
  這兩條是給**使用** Bridge 做作品的 agent 看的。照這份計畫**開發** Bridge 時，可以在 `src/`、`tests/`、`scripts/` 新增檔案；
  瀏覽器測試前也要先 `npm run build`。
- 一次性實驗放 `output/tmp/`。`output/tmp/b1/` 是 2026-11-11 官方素材實驗留下的遊戲，和本計畫的 B1 無關。
- **身分**：任務表「誰」欄寫的是 agent 名稱（`claude`、`codex`…）。commit 的作者是這台電腦的 git 設定（Hermes Agent），
  這是正常的，看 `Co-Authored-By` 就知道是哪個 agent。
- **推送**：本機 commit 是否推上 GitHub，由使用者決定；推之前照上面的規則先檢查。
- 根目錄 `AGENTS.md` 的表格說只有 task-herder 用 Prettier，這已經過時：本套件的 `npm run lint` 也會跑 `prettier --check`。

### 0.6 下一步從這裡開始

**下一步 1：寫理解測試題目（任務 0 的最後一步，小）。**

1. **題目**：`output/handmade-corpus/leejoneshane/*.json` 裡 `instructions` 不是空的作品有 **16 件**。這 16 件就是理解測試的題目。
2. **標準答案檔**：放在同一個資料夾，命名為 `<同名>.answer.json`。只根據作者寫的 Instructions 和 Notes，看不出來的不要猜：
   ```json
   {
     "controls": [
       { "input": "左右方向鍵", "action": "移動平板" },
       { "input": "滑鼠點擊", "action": "發射" }
     ],
     "goal": "用平板反彈球把磚塊打完，共三關",
     "keywords": ["磚塊", "反彈", "三關"]
   }
   ```
   - `input` 統一寫成這幾種：`左右方向鍵`、`上下方向鍵`、`方向鍵`、`空白鍵`、`滑鼠移動`、`滑鼠點擊`、`<字母>鍵`、`綠旗`。
   - `keywords` 寫 2～5 個，玩法裡一定會提到的詞。
3. **問 AI 的方式**：只給 AI 作品內容，不給 Instructions 和 Notes，請它用同樣的 JSON 格式回答：
   「這個作品要怎麼操作（`controls`）、目標是什麼（`goal`）」。
4. **檔名規則**：一件作品的「名稱」是 `.sb3` 去掉副檔名後的字串，照原樣比對，全形字也一樣，例如 `1027475006-brickbreaker（進階版）`。
   - 作品資訊（下載時產生）：`<名稱>.json`
   - 標準答案：`<名稱>.answer.json`（和作品放同一個資料夾）
   - AI 回答：`output/tmp/understanding/<YYYY-MM-DD>/<名稱>.reply.json`
5. **輸入的正規化**：標準答案和 AI 回答**兩邊都要**先正規化，再比較。對照表寫在評分腳本裡，下面沒列到的寫法照這個邏輯補，並在評分腳本的註解寫明：

   | 原文例子 | 正規化成 |
   | --- | --- |
   | ←→、左右鍵、左/右方向鍵、A/D 鍵 | `左右方向鍵` |
   | ↑↓、上下鍵、W/S 鍵 | `上下方向鍵` |
   | 方向鍵、上下左右、WASD | `方向鍵` |
   | space、空白、空白鍵 | `空白鍵` |
   | 滑鼠移動、移動滑鼠、跟著滑鼠 | `滑鼠移動` |
   | 點擊、點選、按滑鼠、滑鼠左鍵、滑鼠拖曳 | `滑鼠點擊` |
   | 單一字母或數字鍵，例如「R 鍵」「r」「數字 1」 | `R鍵`、`1鍵`（大寫、不留空白） |
   | Enter、回車 | `Enter鍵` |
   | 綠旗、按綠旗開始 | `綠旗` |

   比較時，`方向鍵` 涵蓋 `左右方向鍵` 和 `上下方向鍵`：標準答案是 `方向鍵`，AI 說了其中任一個就算對；反過來也算對。
6. **評分腳本**：`scripts/tools/score-understanding.ts`。
   - 執行方式：`npx tsx scripts/tools/score-understanding.ts <標準答案資料夾> <AI 回答資料夾>`
   - **操作分**：標準答案裡的每個 `input`，AI 有沒有說到（正規化後比較）。分數是說到的比例。
   - **目標分**：AI 的 `goal` 含有幾成 `keywords`。
   - **通過**：操作分 ≥ 0.8。
   - **特殊情況**：
     - 標準答案的 `controls` 是空的（作者沒寫怎麼操作）：這件不列入「操作」統計，只算目標分。
     - AI 回答不是合法 JSON，或缺少欄位：這件記 0 分，不重試；在輸出中列出來。
   - 輸出每件的分數，以及整體通過率。第 7 節「說對操作方式 ≥ 80%」指列入統計的作品中，至少 80% 通過。
7. **量「現在」的分數（決定：重現目前的 raw 路徑，只把最後的要求換成「說明作品」）**：
   - **為什麼不直接重用 `requestOpenAiCompatiblePatch`**：它和 `inspectRawProjectForAi` 的指示都要求模型「提交修改」，不適合拿來問「這個作品怎麼玩」。
   - **先拆函式（小改動，要有單元測試）**：把 `src/core/ai/raw-tool-core.ts` 的 `inspectRawProjectForAi` 拆成兩個。
     - `rawProjectInventory(project)`：只回傳清單，最多 30 個角色、每個最多 30 個變數。
     - 原本的修改指示：照舊組合清單和指示，網頁行為不變。
   - **評量腳本** `scripts/tools/ask-local-model.ts`：
     - 系統訊息 = 「說明作品」指示（照第 3 點，要求回傳 `{controls, goal}`）＋ `rawProjectInventory`。
     - 工具 = `inspect_raw_blocks`、`inspect_raw_targets`、`inspect_raw_variables`，直接呼叫 core 的 `inspectRawBlocks`、`inspectRawTargets`、`inspectRawVariables`。
       網頁的工具接線在 `src/main.ts`（約 2682、2864 行），可以參考，但不用搬到 core。
     - 限制和網頁一樣：一頁 10 個積木、最多查 8 次。這樣量到的才是「現在」的程度。
     - 只對有標準答案的作品執行，把回答寫進第 4 點的檔名。
   - **使用者怎麼執行**：在自己的終端機（不是 Claude Code 的 `!`）執行
     ```sh
     cd ~/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge
     OMLX_API_KEY=<你的 key> npx tsx scripts/tools/ask-local-model.ts ../../output/handmade-corpus/leejoneshane \
       --base-url http://127.0.0.1:8000/v1 --model Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e
     ```
     agent 寫好腳本後，把這段指令交給使用者，等使用者說跑完，再執行評分腳本。
8. **樣本數**：任務 0 用這 16 件就夠了。第 7 節「20～30 件」是長期目標，之後可以用 `fetch-scratch.mjs` 補充，但不擋任務 0。
9. **本次範圍**：不做 E5 的 Scratch 登入／上傳；Bridge 產生可下載的修改後 `.sb3` 即完成交付，不把帳號 mutation 當作驗收門檻。

**下一步 2：B1 作品讀本（主要工作，中）。**
- 新增 `src/core/reader/`，主函式是 `readProjectForAi`，規格見第 4 節。
- **積木的中文文字**：用 `node_modules/scratch-l10n/locales/blocks-msgs.js` 的 `zh-tw`，共 290 條，例如 `MOTION_MOVESTEPS` 是「移動 %1 點」。
- **opcode 怎麼對到文字、參數順序**：`node_modules/scratch-blocks/dist/main.mjs` 裡每個積木都有 `jsonInit({ message0: Ie.<訊息鍵>, args0: [{ name: 'STEPS' }…] })`。
  寫一個建置腳本（放 `scripts/build/`），抽出「opcode → 訊息鍵、參數名稱」，產生一個 JSON 檔放進 `src/core/reader/`。
  不要在網頁執行時載入 scratch-blocks。
- **擴充積木**（畫筆、音樂）的文字在 `scratch-l10n/locales/extensions-msgs.js`。
- **已有的零件**：
  - `extractProjectBlockGraphs`：積木圖
  - `src/core/capabilities/registry.ts`：每個 opcode 的欄位和輸入
  - `src/core/scratchblocks/parser.ts`：文字轉積木，B3 會用到
- **驗收**：
  - 在 `measure-corpus.ts` 加一欄 `readerChars`（讀本的字數）。讀本 ≤ **24,000 字**的作品要 ≥ 90%。
  - 內建積木 100% 有文字，沒有出現 `⟦未知⟧`。
  - 為 `src/core/reader/` 寫單元測試。
- **做完後**：網頁 raw 路徑（`src/core/ai/raw-tool-core.ts` 的 `inspectRawProjectForAi`）的第一則訊息改成讀本；
  `inspect_raw_blocks` 保留，給大作品分段時用。

## 1. 原則

1. **跟 Scratch 編輯器說同一種話。** 積木文字直接用 Scratch 官方的繁體中文（`scratch-l10n` 的 `zh-tw`，共 290 條，
   例如「移動 %1 點」「如果 %1 那麼」「碰到 %1？」），學生、老師和 AI 看到的字一模一樣。
2. **給 AI 整份讀本，不讓它一直查。** 大部分作品一次就能整份給 AI。只有大作品才需要分段，分段時每次查詢也回傳整段可讀的程式，
   不再回傳原始 JSON。
3. **畫面要翻成文字。** AI 不一定看得懂圖，尤其是本機模型。所以要用文字寫出每個角色長什麼樣子、在舞台哪裡、哪個是官方素材。
   看得懂圖的模型另外附截圖。
4. **看不懂的部分原封不動。** 不認得的積木、擴充功能、素材和註解，要照原樣保留在讀本和存檔裡。AI 只能改它看得懂、也有被標示的部分。
5. **一個核心，所有路徑共用。** 網頁、CLI、MCP 都呼叫同一個「作品讀本」模組。
6. **作品不離開學生的電腦。** 作品只在瀏覽器裡讀取。只有學生選擇送出時，讀本才會傳給學生選的 AI。
   學生的作品樣本只放本機，不推上 GitHub（Air-Gap）。

## 2. 現況（2026-11-12 實際檢查）

| 項目 | 現況 | 問題 |
| --- | --- | --- |
| 打開自己的 .sb3 | 只在第二個分頁「進階：檢查已有作品」裡。要選檔，再按「預覽匯入作品」，才會跳回主頁出現「用 AI 修改這個作品」 | 學生找不到；要跳兩頁；主頁不能拖曳 |
| 拖曳 | 只有分頁 2 的 `#dropzone` 支援（`src/main.ts` 約 7237 行） | 主頁、預覽舞台、整個視窗都不能拖 |
| AI 讀作品（網頁 raw 路徑） | `inspectRawProjectForAi` 給出角色清單（位置、大小、方向、造型編號）和變數清單；`inspect_raw_blocks` 一次給 10 個 Scratch 原始積木 JSON，最多查 8 次 | 原始 JSON 靠亂碼 ID 串接 parent／next，很費 token；中型作品 8 次查不完，本機小模型容易迷路 |
| 分析報告（`inspect`） | 列出每個積木的中文說明，例如「定位到 x：-180、y：-100」「如果條件成立，就執行裡面的積木」 | 名稱被隱藏成「角色 1／V1／M1」；條件內容沒寫出來；是逐條清單，不是能讀的程式；不能拿來修改 |
| 畫面資訊 | 只有造型名稱和編號 | AI 不知道造型長什麼樣子、什麼顏色、是不是官方素材，也不知道舞台上誰在哪裡 |
| 註解 | 沒有提供給 AI | 學生的註解往往寫著他想做什麼，是很有用的線索 |
| 現成零件 | `scratch-l10n` 的 zh-tw 積木文字；`library-index.json` 有官方素材的 MD5；`parseScratchblocks`（文字→Canonical）；`extractProjectBlockGraphs`；`createEvidencePacket`；`hideTargetNames`；raw graph patch 與復原 | 還缺「積木→可讀文字」和「畫面→文字」 |

以桌面的「狂暴大猩星」（4 個角色、60 個積木、5 段程式）為例，現在的分析報告只看得出「有 4 個『如果條件成立』」，
看不出條件是「碰到誰」，也看不出 4 個角色各是什麼。

## 3. 階段 A：打開作品（介面＋拖曳）

### A1. 主頁的入口

- 「用 AI 做 Scratch」頁最上方的選項並排三個：**做新遊戲／做新動畫／打開我的作品**。
- 「打開我的作品」是一個大的拖曳區，有「選擇檔案」按鈕，下面寫一行「檔案只在你的電腦裡讀取，不會上傳」。
- 預覽區已經開著作品時，舞台上方也放一個小按鈕「換一個作品」。

### A2. 拖曳

- **整個視窗都能放。** 拖檔案進視窗時，畫面蓋上一層「放開就打開這個作品」。放在哪裡都可以，不必對準小框框。
- 拖到開著的預覽舞台上，就換成新作品。如果目前作品有還沒下載的修改，先問「目前的修改還沒下載，要換掉嗎？」。
- 一次拖了好幾個檔案時，只打開第一個 .sb3，並說明「一次打開一個作品」。
- 不是檔案的東西（文字、圖片、網址）不處理，畫面會說明原因。
- 鍵盤和讀螢幕軟體也能用：拖曳區本身就是按鈕，狀態用 `aria-live` 念出來。
- 分頁 2 改用同一個打開模組，不再各寫一套。

### A3. 打開時的檢查和說明（白話）

| 情況 | 顯示 |
| --- | --- |
| 副檔名是 .sb2／.sb | 「這是舊版 Scratch 2 的作品。請用 Scratch 3 打開，再『另存到你的電腦』成 .sb3。」 |
| 不是 zip，或找不到 project.json | 「這個檔案不是 Scratch 作品，或已經損壞。」 |
| 檔案太大（超過現有上限） | 寫出大小和上限，建議刪掉沒用的造型或聲音 |
| 有缺少的素材 | 照常打開，用示意圖代替，並寫出缺了幾個 |
| 有 Bridge 看不懂的擴充功能 | 照常打開，寫出「這些積木 AI 只能看，不能改」 |

### A4. 打開後直接可以用

- 打開後直接進入預覽，並出現「用 AI 修改這個作品」，中間不再有其他按鈕。
- 預覽上方放一張作品小卡：作品名稱、幾個角色、幾段程式、幾個積木，以及「AI 看得懂 96%（3 個擴充積木只能看）」。
- 最近打開的 5 個作品記在這台電腦的瀏覽器（IndexedDB），可以一鍵再打開，也可以清除。這項是選配，放在最後做。

### A 的驗收

- 瀏覽器測試涵蓋：從主頁選檔、拖到視窗任何地方、拖到舞台換作品（包括確認對話框），以及 .sb2、壞檔、非檔案拖入、多檔拖入。
  測試用 Playwright 送出含 `DataTransfer` 的 drop 事件。
- 從打開檔案到可以送出第一個 AI 修改要求，不超過 2 次點擊。

## 4. 階段 B：作品讀本（給 AI 讀的文字）

新模組 `src/core/reader/`。核心函式：

```ts
readProjectForAi(projectJson, assets, options): {
  text: string            // 整份讀本（Markdown）
  sections: ReaderSection[] // 給分段查詢用：overview / sprite:<名稱> / script:<ID>
  lineMap: Map<string, { targetIndex: number; blockId: string }> // 行號 → 原始積木
  coverage: { blocks: number; readable: number; opaque: number }
}
```

### B1. 讀本長這樣

```markdown
# 作品「狂暴大猩星」
舞台 480×360。背景：Stars（官方素材）。角色由上到下的圖層：猩猩、香蕉、隕石、角色4。

## 角色「猩猩」
- 樣子：官方素材 Monkey 的 monkey-a；約 80×95；棕色。開始時在左下（x -180, y -100），面向右，看得到。
- 變數：分數 = 0（全部角色共用）
- 註解：「按空白鍵跳」

### 程式 S1
L1  當綠旗被點擊
L2    變數 [分數] 設為 (0)
L3    定位到 x: (-180) y: (-100)
L4    重複無限次
L5      如果 <按下 [空白] 鍵？> 那麼
L6        y 改變 (10)
L7      如果 <碰到 [隕石]？> 那麼
L8        廣播訊息 [遊戲結束]
```

- 積木文字用 `scratch-l10n` 的 zh-tw，名稱照實寫，不隱藏，因為學生是在改自己的作品。
  複製給外部 AI（Gemini／ChatGPT）時，提供「把名字換成代號」選項，沿用 `hideTargetNames`。
- 自製積木寫成「定義 跳 (高度)」，並寫出哪些程式呼叫了它。
- 看不懂的積木寫成「⟦擴充：xxx 積木，只能看⟧」，所在的行會標成不能改。
- 沒接在事件下面的積木，放在「散落的積木（不會執行）」。
- 每行有行號（`L5`），讀本和積木 ID 的對照放在 `lineMap`，AI 只需要寫行號。

### B2. 長度控制

- 一般作品（約 500 個積木以下）整份給 AI。上限是 **24,000 字**，和 `EVIDENCE_PACKET_MAX_CHARS` 一樣。
- 大作品先給「概覽＋每段程式的開頭事件和前 5 行」，AI 再用工具讀需要的段落：
  - `read_sprite(名稱)`
  - `read_script(S3)`
  - `find(文字)`：例如找「碰到 隕石」出現在哪裡
- 每次查詢回傳可讀文字。查詢上限從 8 次改成依作品大小調整，同時保留「快用完時提醒先提出修改」的機制。

### B3. AI 怎麼提出修改

分兩步。先做穩定、小模型也做得到的版本：

1. **行號操作（先做）。** 用 `propose_live_patch` 送出這些操作：
   - `{ op: 'set', line: 'L6', slot: 1, value: 15 }`：改數字或文字
   - `{ op: 'replace', line: 'L7', text: '如果 <碰到 [邊緣]？> 那麼' }`
   - `{ op: 'insert_after', line: 'L6', text: '播放音效 [Pop]' }`
   - `{ op: 'delete', line: 'L8' }`

   `text` 用讀本的格式寫，由解析器轉成積木。工具把操作換成現有的 raw graph patch，
   沒動到的積木保留原本的 ID。原本的確認、套用、復原流程不變。
2. **改整段。** AI 回傳修改後的整段程式文字，工具以 `script:<根積木 ID>` 鎖定單一程式，解析後比對可達圖節點，再轉成 graph patch。給大模型用；不支援的行或無事件帽會拒絕，不會半套用。

`parseScratchblocks` 需要擴充，讓它讀得懂讀本的 zh-tw 格式和 `[ ]`、`( )`、`< >` 的寫法。

### B4. 讓它可靠

- **來回測試。** `npx tsx scripts/tools/check-reader-roundtrip.ts ../../output/handmade-corpus/leejoneshane --json` 已逐段執行；73 件作品、2,397 段程式全部可安全接受。完全可辨識的程式走 canonical 解析；含未知積木的程式保留 opaque raw nodes，只對可辨識葉積木套用修改，結構性改動會拒絕。
- **涵蓋率。** 報告寫出看得懂的積木佔幾 %。Scratch 內建積木的目標是 100%；常見擴充（畫筆、音樂、文字轉語音、翻譯、影像偵測）也要涵蓋。

## 5. 階段 C：畫面翻成文字

### C1. 每個角色長什麼樣子（不需要會看圖的模型）

- **官方素材。** 造型的 MD5 和 `library-index.json` 比對，寫出「官方素材 Monkey 的 monkey-a」。
  學生作品大多用官方素材，這一步就能認出很多角色。
- **學生自己畫的造型。** 在瀏覽器把造型畫出來，算出大小（實際有顏色的範圍）和主要顏色（換成中文色名：藍、紅、深綠…），
  寫成「自己畫的；約 40×30；藍色」。
- **舞台位置。** 把舞台分成九區（左上、正中、右下…），寫出開始時每個角色在哪一區、誰和誰重疊或靠近。
- **背景。** 同樣寫出是不是官方素材、主要顏色。

### C2. 學生直接指給 AI 看

- 在預覽舞台上點一下角色，或在角色清單上點，要求欄就會加上一個標籤「我指的是：猩猩（棕色，左下）」。
  送出時，讀本裡會標示這是學生指定的角色。
- 舞台點擊用 renderer 的 `pick` 找出點到哪個角色，透過預覽 iframe 的 `postMessage` 傳回頁面。
- AI 不確定學生指的是哪個角色時，要先問，不要猜。畫面上用角色按鈕讓學生選。
  網頁版的 `propose_live_patch` 之外，再加一個 `ask_student` 回覆類型。

### C3. 看得懂圖的模型

- 連線設定加一個勾選「這個模型看得懂圖片」。勾了之後，第一則訊息附上舞台截圖和造型縮圖拼貼（PNG，OpenAI 相容格式的 `image_url`）。
- 複製貼上的路線（Gemini／ChatGPT）提供「下載舞台截圖」和「下載造型一覽圖」，讓學生一起貼上。

### C4. 跑起來的樣子

在預覽中自動跑幾秒，記錄每個角色的位置變化，寫成「綠旗後 3 秒：隕石從上往下掉；猩猩不動」。
這可以沿用 `src/core/playtest` 的做法。這一步讓 AI 知道「作品實際做了什麼」，不只是「程式寫了什麼」。

## 6. 階段 D：CLI、MCP 和文件

- CLI：`inspect <檔案.sb3> --format ai-reader` 輸出讀本。
- MCP：`inspect_project` 對學生上傳的作品回傳讀本，並新增 `read_script`、`find`。
  `propose_live_patch` 接受行號操作。
- `agent-guide.ts`（`start`）、`docs/guide/AI-PROVIDER-MCP.md`、`USAGE-GUIDE.md` 寫上新的流程。

## 6.5 階段 E：和 Scratch 網站接起來

真人的作品大多在 scratch.mit.edu 上。專案頁上的 **Instructions（操作說明）** 和 **Notes and Credits** 是作者自己寫的「這個作品是什麼、怎麼玩」，
這正好是 AI 讀懂作品的標準答案，也是學生想改作品時最重要的背景。
整條路是：**找到作品 → 打開 → 讀懂 → 修改 → 放回去。**

### E1. 讀取 Scratch 網站（不用登入）

- 用 Scratch 的公開資料介面（`api.scratch.mit.edu`、`projects.scratch.mit.edu`、`assets.scratch.mit.edu`）：
  - 搜尋作品
  - 列出某位使用者或工作室的作品
  - 下載成 .sb3，同時存下標題、Instructions、Notes and Credits、作者、授權（CC BY-SA 2.0）和網址
- 規則：
  - 慢慢抓，不要一次大量下載。
  - 標明作者和授權。
  - 下載的作品只存本機（`output/`），不進 git。
  - 對外請求不帶使用者的個人資料。
- 工具：`scripts/tools/fetch-scratch.mjs`（2026-11-12 用它下載了 leejoneshane 的作品）。

### E2. Bridge 用網址打開作品

- 主頁「打開我的作品」旁邊加「貼上 Scratch 作品網址」。
- 打開後，Instructions 和 Notes 顯示在預覽旁邊，也放進讀本開頭的「作者說明」。
- 先驗證瀏覽器能不能直接讀取 Scratch 的伺服器（CORS）。不能的話，網頁版就只支援下載後拖進來，網址打開只做在 CLI 和 skill。

### E3. 讀本加入作者說明

讀本開頭加上「作者說明（Instructions）」和「備註（Notes and Credits）」。
說明裡講到的操作，例如「方向鍵移動、空白鍵跳」，要和程式對照；說明和程式對不上時，在讀本中標示出來。

### E4. 給 Claude／Codex 的 skill（`skill-scratch-site`）

- 放在 `~/ObsidianVault/skills/skill-scratch-site/`，內容是 `SKILL.md`、`scripts/` 和 `references/`。
  ObsidianVault 是另一個 git repo，照共同大腦的維護流程修改和 commit（`skills/skill-shared-brain-maintenance/`）。
  `scripts/` 直接呼叫本 repo 的 `scripts/tools/fetch-scratch.mjs`，不要另外複製一份。
- 內容只寫「怎麼取得作品」。取得之後的讀懂、修改，交給 Bridge 的 `start` 指引，和 `skill-scratch-ai-bridge` 一樣不重複寫細節。
- Bridge CLI 加上 `fetch <Scratch 網址或編號>`：下載到 `output/`，並接著做 `inspect`。

### E5. 放回 Scratch 網站（要登入，最後才做）

- 包括：存到帳號、分享、更新作品、回覆留言、工作室和班級管理。
- 一律用共用 Camoufox（`camofox-cli --caller claude`）操作。這些是對外公開的動作，每次都要先取得使用者同意。
- 改作品要用使用者自己帳號的「改編（Remix）」或新作品，不覆蓋別人的作品。

## 7. 測試作品和評量

- **作品樣本。** 收集 20～30 件真實的學生手做作品，涵蓋小作品、大作品、自製積木、擴充、自己畫的造型和缺素材的檔案。
  必須取得同意，只放本機不進 git（放 `output/handmade-corpus/`；`output/` 本來就不進 git）。
  repo 裡的測試改用自己做的、或公開授權的樣本。
- **理解測試（用作者寫的 Instructions 當標準答案）。** 只給 AI 讀本（不給 Instructions），請它回答「這個作品是什麼、怎麼玩、有哪些角色」，
  再和作者的 Instructions 對照評分。這是「AI 真的看懂真人作品」最直接的指標。
- **修改題目。** 每件作品寫 1～2 個學生口吻的要求，例如「讓藍色的魚游快一點」「碰到隕石要扣一條命，不要直接結束」。
- **指標**（本機模型 Cyber-Tiel 和一個大模型各跑一次）：

| 指標 | 現在（要先量） | 目標 |
| --- | --- | --- |
| 作品整份放得進一次讀本的比例 | — | ≥ 90% |
| 內建積木的可讀率 | — | 100% |
| 讀本來回測試完全相同 | — | 100% |
| AI 改對角色（沒改錯角色） | — | ≥ 95% |
| 本機模型一次就提出可套用修改 | — | ≥ 70% |
| 平均查詢次數 | — | ≤ 2 |
| 理解測試：說對操作方式（對照 Instructions） | — | ≥ 80% |
| 看不懂的積木被保留 | — | 100% |

- 第一步先用現在的版本跑一次同樣的題目，記下「現在」那一欄，之後每個階段都和它比。

## 8. 順序

| 順序 | 內容 | 預估 | 完成時可以做到 |
| --- | --- | --- | --- |
| 0 | 收集樣本（E1 下載＋Instructions）、寫題目、量現況（含理解測試） | 小 | 有數字可以比較 |
| 1 | A：主頁入口、整個視窗可拖曳、白話錯誤訊息 | 小 | 學生自己就能打開作品 |
| 2 | B1～B2＋E3：讀本（只讀，含作者說明），換掉網頁 raw 路徑給 AI 的原始 JSON | 中 | AI 看得懂程式，查詢次數大減 |
| 3 | C1：造型和位置翻成文字（官方素材比對、顏色、九宮格） | 中 | AI 知道「藍色的魚」是誰 |
| 4 | C2：點舞台指定角色、AI 不確定時先問 | 小～中 | 不再改錯角色 |
| 5 | B3 第 1 步：行號操作的修改 | 中 | 小模型也改得動 |
| 6 | D＋E4：CLI `fetch`／MCP／文件、`skill-scratch-site` | 小 | Claude／Codex 從網址到改好一條龍 |
| 7 | C3：看得懂圖的模型附截圖 | 小 | 大模型真的「看到」作品 |
| 8 | E2：網頁用網址打開（先驗證 CORS） | 小 | 學生貼網址就能改 |
| 9 | B3 第 2 步、C4、最近開過的作品 | 中 | 進階功能 |
| 10 | E5：放回 Scratch 網站（登入、每次確認） | 中 | 改好直接分享 |

每個階段做完：單元測試、lint、瀏覽器測試都要通過，跑一次第 7 節的評量並記錄結果，然後才進下一階段。

## 9. 風險

- **zh-tw 文字有些積木字一樣、意思不同**（例如「x 改變」和「改變特效」）。解析時要看前後文；
  行號操作只解析新增或取代的那一行，影響範圍小。
- **擴充積木的文字不在 `blocks-msgs`。** 改從 `extensions-msgs.js` 取；兩邊都沒有的，就標成「只能看」。
- **自己畫的造型，顏色和大小只是近似。** 讀本寫「約」，C2 的點選才是確定的方法。
- **大作品。** 分段讀取仍可能不夠，所以保留目前的 raw 路徑當後備，但不再是預設。
- **隱私。** 讀本含學生取的名字和註解。送出前畫面要寫清楚會送給哪個 AI；複製給外部 AI 時提供換成代號的選項。

## 10. 進度

- 2026-11-12 **階段 A 完成**（A4 的「作品小卡的 AI 看得懂 %」等 B 做完再補；「最近打開的作品」留到順序 8）。
  - 主頁「已經有作品了？」卡片＋「打開我的作品」按鈕；整個視窗可拖曳（只對檔案反應，蓋層擋住預覽 iframe）。
  - `src/open-project.ts`：.sb2／非 .sb3／過大／損壞的白話訊息，多檔只開第一個 .sb3 並說明。
  - 預覽中有沒下載的修改時，換作品前先問；下載檔名改為「原檔名-改過.sb3」。
  - 分頁 2 共用同一套打開流程（拖曳時顯示「放開就檢查這個作品」，只做分析）。
  - 測試：`tests/open-project.test.ts`、`npm run test:open-project-browser`（按鈕、整窗拖曳、錯誤、換作品前詢問）。
- 2026-11-12 **階段 0 開始：樣本與現況**（樣本在 `output/handmade-corpus/`，不進 git；量測工具後來搬到 `scripts/tools/measure-corpus.ts`）。

  | 作品 | 誰做的 | 角色 | 積木 | 程式 | 擴充 | 官方造型 | 原始積木 JSON | 10 個一頁要幾頁 | 積木圖問題 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Untitled-20（含改善版） | 學生手做 | 32 | 918 | 201 | 文字轉語音 1 | 0／84 | 202 KB | 92 | 0 |
  | [METRO] • [mania] | 手做（社群） | 1 | 1055 | 59 | 畫筆 62 | 0／53 | 197 KB | 106 | **39** |
  | acorn | Bridge 做的（`meta.agent`） | 7 | 224 | 14 | — | 0／11 | 46 KB | 23 | 0 |
  | 狂暴大猩星（3 版） | Bridge 做的、在 Scratch 存過 | 4 | 51～54 | 5 | — | 0／5 | 10 KB | 6 | 0 |

  發現：
  1. **大作品現在幾乎讀不到。** 8 次查詢 × 10 個積木＝最多 80 個，Untitled-20 只看得到 9%，METRO 不到 8%。
  2. **名字沒有意義。** Untitled-20 的角色是 Sprite1～Sprite32，造型是 costume1～5，而且全部是自己畫或匯入的（官方造型 0／84）。
     AI 只靠名字完全不知道誰是誰，C1（顏色、大小、位置）和 C2（點選）是必要的，不是加分。
  3. **Bridge 比 Scratch 嚴格，整個角色被鎖住。** METRO 有一個自製積木的「預設值數量」多一個（3 個預設值、2 個參數），
     Scratch 照常執行，但 Bridge 判成 `invalid-procedure-definition`，連帶 36 個呼叫變成 `unresolved-procedure-call`，
     整個角色 `graphEditable: false`，AI 什麼都不能改。→ 新增 **B0**：這類 Scratch 能容忍的不一致改成警告，不鎖整個角色。
  4. 樣本只有 2 件真正手做的作品，離 20～30 件還差很多；需要更多學生作品（小作品、有註解的、用官方素材的）。
- 2026-11-12 **B0 完成**：`validateScratchBlockGraph` 不再要求自製積木的預設值數量等於參數數量（Scratch 只在積木區建立新呼叫時用預設值）。
  METRO 的積木圖問題 39 → 0，角色可以讓 AI 修改。Canonical IR 的轉換仍會略過這種定義（`invalid-procedure-metadata`），
  只影響分析與 Canonical 路徑，不影響原始 SB3 修改。
- 2026-11-12 **改用 leejoneshane 的 73 件作品當主要樣本**（使用者指定；75 件中 2 件是 Scratch 2 格式）。
  量測工具搬進 repo：`scripts/tools/fetch-scratch.mjs`、`scripts/tools/measure-corpus.ts`。現況：
  - 積木數中位數 191（最少 19、最多 2609）。現在的 8 次 × 10 個只能完整讀完 12 件（≤ 80 個積木）；超過 500 個積木的有 16 件。
  - 16 件有積木圖問題（種類見 0.4），這些角色現在 AI 不能改。
  - 官方造型 181／2986，31 件至少用了一個官方造型。擴充只有畫筆和音樂。註解共 21 則，分布在 7 件。
  - 16 件有 Instructions，可以當理解測試的標準答案。
- 2026-11-12 **B0b 完成**。規則改成「修改不能增加新問題；原本就有、Scratch 能執行的殘留可以保留」，並修正 `sensing_current` 選項大小寫。
  - 73 件樣本中原本被鎖的 16 件全部可以改（問題最多的「光的反射」實際改過一次，也能存成 .sb3）。
  - 真的壞掉的情況仍會擋下：循環、缺積木、共用子積木、一般積木的 parent 不一致。
  - 驗證：800 個單元測試、lint、原始 SB3 修改和打開作品的瀏覽器測試都通過。
- 2026-11-12 **交接**：claude 停在這裡。下一步見 0.6。
- 2026-11-12 **codex 完成 B1–B2、B3a 和 D＋E4，並推進 C1/C2/C3**：
  - 新增 `src/core/reader/` 與建置期訊息抽取器；73 件 leejoneshane 樣本全部在 24,000 字上限內，讀本涵蓋 73/73 內建與畫筆／音樂積木，沒有 `⟦未知⟧` 標記。
  - raw AI 第一則訊息改用讀本；MCP 的 `inspect_project`、`read_script`、`find` 和原始積木分頁共用 revision。行號 patch 支援 `set`、`replace`、`insert_after`、`delete`，並以原始 graph patch 驗證後保留素材。
  - CLI 新增 `inspect --format ai-reader` 和公開作品 `fetch`；Bridge 靜態舞台可點角色，Canonical 本機 AI 可附舞台截圖；補上 `skill-scratch-site`、CLI/MCP 文件。理解測試 16 件的標準答案與評分器已寫好，尚未執行本機模型基線。
- 2026-11-12 **codex 完成 C1–C4 與 B3b，並完成 E2 的可行性驗證**：
  - PNG 造型在瀏覽器取樣主要顏色並寫回 reader visual hints；預覽新增舞台角色點選、`ask_student` 對話、造型拼貼、舞台／拼貼下載與多圖 Vision 請求。
  - 公開 Scratch URL 可解析、取得 metadata、作者說明與 SB3；但實測 `api.scratch.mit.edu` 只允許 `https://scratch.mit.edu` 的 CORS，GitHub Pages 不能直接讀 metadata，因此 UI 明確提供 CLI `fetch`／`skill-scratch-site` fallback。
  - `runAutoPlaytest` 已擷取執行後角色位置、造型、變數與測試鍵；完整 `script` patch 已加入 ID 保留、解析拒絕與 VM 驗證測試。
  - 驗證：100 個測試檔、810 個測試全過；`eslint src tests`、`tsc --noEmit`、production build、bundle budget、Chromium browser smoke 全過。
  - 尚待：使用者執行本機理解測試；E5 登入／上傳必須等使用者明確授權，不能由本次本地開發驗證代替。
- 2026-11-12 **B3b 稽核修正**：完整程式轉譯現在保留讀本行號後的巢狀縮排，並遞迴收集 `inputs` 內的可達積木 ID；新增 `forever → move` 回歸測試，確認 SUBSTACK、parent、next 與原始 ID 均正確。全套測試更新為 811 項全過；Bridge 修正 commit `7b1e0d8c3b`。
- 2026-11-12 **B4 全量驗收完成**：新增唯讀稽核工具 `scripts/tools/check-reader-roundtrip.ts`，逐件使用 `readProjectForAi` 的真實 script section 再送入完整程式 patch。73/73 作品、2,397/2,397 段程式通過、0 失敗；同時新增未知積木保留與重複 script ID target 消歧回歸測試。完整測試套件為 100 個檔案、813 個測試全過。
- 2026-11-12 **任務 0 本機模型 preflight**：`http://127.0.0.1:8000/v1/models` 可連線但回 `401 API key required`；目前環境未提供 `OMLX_API_KEY` 或替代變數，因此未送出理解測試請求。等待使用者在自己的終端設定金鑰並執行既定 `ask-local-model.ts` 指令。
- 2026-11-12 **任務 0 基線完成**：使用者提供本機模型金鑰後，16/16 件理解測試均產生結果檔並完成評分。2 件回覆為合法 JSON 且操作分 2/2 通過；14 件因查詢超過 8 次、錯誤 revision／頁面參數或空回覆而記 0 分。未人工補答、未重試單件錯誤。
- 2026-11-12 **範圍澄清**：使用者確認不需要把作品上傳回 Scratch；E5 改列為不納入本次範圍，Bridge 交付以本地修改與下載 `.sb3` 為準。
- 2026-11-12 **本次計畫完成**：納入範圍的 A、B0a/b、0、B1–B4、C1–C4、D＋E2/E3/E4 全部完成並驗證；E5 依使用者決定排除。最新 package 驗證為 100 個測試檔／813 測試、`npm run lint`、`npm run build` 通過。

## 11. 改善計畫 v2：網頁 AI 與複雜真人作品（2026-11-13）

### 11.1 目標與範圍

本階段不重新做已完成的本機讀本、SB3 解析與 Graph round-trip；專注於使用者實際要的流程：

**真人 `.sb3` → Bridge 讀本／預覽 → Gemini 或其他網頁 AI → 單一可驗證 patch → 預覽驗證 → 下載新版 `.sb3`**，以及：

**學生自然語句 → 網頁 AI 作品描述 → Bridge 產生可玩的作品，並誠實揭露未完成需求。**

明確不納入：登入 Scratch、把作品上傳回 Scratch、代替使用者進行公開分享或帳戶操作。

### 11.2 狀態與執行契約

每一階段都要保存以下狀態，讓工作可中斷後接續，不重做已驗證項目：

| 欄位 | 要求 |
| --- | --- |
| `phase` | 目前階段，例如 `web-evidence`、`creation-dsl`、`semantic-playtest` |
| `item` | 目前作品、案例或測試 ID |
| `status` | `pending`、`running`、`verify_pending`、`done`、`blocked` |
| `evidence` | 測試檔、回覆形式、revision、驗證結果與報告位置 |
| `next_action` | 中斷後唯一下一步，不寫模糊的「繼續測試」 |
| `source_revision` | 測試使用的 commit；未提交變更不得宣稱已部署 |

硬性門禁：原始 `.sb3` 不覆蓋、每次只允許一個 change、雲端變數不可修改、patch 必須檢查 revision 與 expected、未經使用者明確同意不 push。

### 11.3 P0：收斂目前未提交修正

**目的**：先讓已找到的修正進入可追蹤版本，避免線上 Pages 與本機實測結果不一致。

工作：

1. 整理目前未提交檔案：舊 AI 回覆清理、Gemini stop 語法、空白鍵 action-key 試玩修正、回歸測試與真人測試報告。
2. 執行完整 `npm test`、`npm run lint`、`npm run build`、`npm run test:open-project-browser`、student-flow 與 raw property browser smoke。
3. 依 Conventional Commits 建立單一可回溯 commit。
4. 只有使用者明確同意後才執行 pre-push check、push 與 Pages workflow 驗收。

完成條件：工作樹乾淨、遠端 commit 與 Pages bundle 的 `headSha` 可對應、公開頁面包含最新 fallback 與 playtest 修正。

### 11.4 P1：大型作品的網頁 AI 證據包

**問題**：`1813166-超級瑪莉` 這類含廣播、自訂積木、清單、分身的作品，完整讀本可能截斷；Gemini 網頁版也不能真的呼叫 `inspect_raw_blocks`，因此只能安全拒絕，無法完成跨程式修改。

改善方向：

1. 將「本機／MCP 可呼叫工具提示」與「網頁 AI 複製提示」分開；網頁 AI 提示不得假設 Gemini 能呼叫 Bridge 工具。
2. 建立 `web evidence packet`：概覽、目標角色、相關變數、候選程式段落、必要行號與圖形限制，控制在明確字數上限內。
3. 讓使用者可在 Bridge 先選角色／程式，或輸入關鍵詞（例如「生命」「碰到敵人」「遊戲結束」），再只複製相關證據給網頁 AI。
4. 大作品提供「下一頁證據」流程；每次補充資料都保留同一個 revision，不讓 AI 猜測被省略的 block ID。
5. 若證據仍不足，UI 顯示「需要選擇角色或程式」的可操作指引，而不是只把工具名稱交給網頁 AI。

驗收：在 73 件 corpus 中抽測 16 件大型／複雜作品；至少完成 property、variable、lines、blocks 各一類，並分別記錄「成功 patch」「正確拒絕」「Bridge 驗證失敗」；不得把正確拒絕算成產品失敗。

### 11.5 P1：從零生成能力分層

**問題**：目前作品描述 DSL 能產生可玩的部分作品，但不能表達自訂廣播名稱、自訂積木、完整結束畫面與重新開始流程。Gemini 可以誠實列入 `做不到`，但使用者容易把「編譯成功」誤解為「需求全部完成」。

改善方向：

1. 建立能力矩陣，明確標記每項需求為 `已實作`、`部分實作`、`未實作`。
2. 生成結果顯示功能清單與 `做不到`，下載前再次提醒部分功能未完成。
3. 保留目前安全 DSL 模式；另設「進階完整 Scratch」模式，要求網頁 AI 回傳完整 canonical IR／受控 script JSON，而不是假設它能呼叫 MCP。
4. 進階模式仍必須經 graph validation、VM validation 與自動試玩，不得因輸出較長就放寬安全門禁。
5. 「太空採礦」作為固定回歸案例：方向鍵、空白鍵、分身、命中、計分、生命、倒數、廣播、結束畫面、自訂積木全部逐項報告。

完成條件：使用者能一眼看出作品做了什麼、沒做什麼；不再只顯示「格式與編譯通過」。

### 11.6 P1：語意化自動試玩

目前自動試玩主要驗證按鍵、座標、造型與變數；需要增加遊戲事件層級，並區分「未測到」與「確定失敗」。

新增情境：

- 方向鍵：角色是否向正確方向移動。
- 動作鍵：發射、跳躍、開始，不要求不相關的座標變化。
- 分身：是否產生、移動、碰撞後刪除或隱藏。
- 廣播：事件是否讓目標角色停止、切換畫面或更新狀態。
- 生命／遊戲結束：生命歸零後是否停止遊戲並顯示結果。
- 自訂積木：至少確認呼叫可執行，不因未知內容誤報完整語意成功。

報告格式改為：`通過`、`明確失敗`、`未觀察到／需要人工確認`。只有前兩者有充分證據時，才可給出強烈成功或修正建議。

### 11.7 P2：網頁 AI 交互與作品生命週期

1. 在複製提示詞與貼回 JSON 時加入本輪識別資訊，避免上一輪 prompt／response 混入。
2. 受控 textarea 仍以真實鍵盤輸入驗收；產品端增加貼回後的 JSON 類型、revision、目標與 summary 顯示。
3. 補齊換作品流程測試：有未下載修改時選「保留」、選「放棄」、取消換檔，以及換檔後舊 candidate 清空。
4. 補齊確認套用、不要修改、復原、重做、重新載入與下載新版 SB3 的瀏覽器 smoke。
5. 剪貼簿隔離是 Camoufox 測試環境限制；人工可見瀏覽器仍要做一次原生複製貼上驗收，不把自動化 fallback 當成產品貼上失敗。

### 11.8 P2：開發與驗證效率

1. 修復或明確重構 `npm run dev`，使開發者不必每次先 production build；若 scratch-vm CJS 相容性無法立即修復，提供穩定的 dev preview 命令與原因。
2. 將 full corpus、web AI、creation DSL、semantic playtest 分成可獨立執行的測試命令，避免每次只跑全套或只跑單元測試。
3. 為 Gemini skill 的 validator 提供不依賴 PyYAML 的最小檢查，或在開發環境補上明確的驗證依賴；不能把「validator 缺模組」當成 skill 已驗證。

### 11.9 階段順序與交付門禁

| 階段 | 內容 | 交付物 | 完成門禁 |
| --- | --- | --- | --- |
| P0 | 收斂未提交修正 | commit、測試報告、Pages headSha | full tests、lint、build、browser smoke |
| P1a | web evidence packet | 大型作品分頁提示與選擇器 | 16 件大型 corpus 測試 |
| P1b | creation capability matrix | 已實作／部分／未實作報告 | 太空採礦固定案例 |
| P1c | semantic playtest | 事件情境與三態結果 | 複雜遊戲手動＋自動驗收 |
| P2a | lifecycle／paste UX | 換檔、貼回、復原重做 smoke | 生命週期全通過 |
| P2b | dev／skill validation | dev 命令與 validator | 新人可依文件重現 |
| P3 | 指標與擴充 | corpus 報告、ChatGPT／其他網頁 AI 比較 | 沒有未解釋的回歸 |

每階段都要更新本節狀態、`WEB-AI-GEMINI-CORPUS-2026-11-12.md` 與 SharedBrain；若同一阻塞連續三次無法前進，標記 `blocked` 並保留證據，不以猜測繞過門禁。

### 11.10 本改善計畫的成功標準

- 網頁 AI 不需要知道 API、MCP 或本機模型細節，也能完成可驗證的複製貼上修改。
- 大型作品若資料不足會清楚要求補充；若資料足夠，能完成至少一個跨程式修改。
- 從零生成作品會明確區分已完成與未完成，不把 DSL 限制藏起來。
- 自動試玩不再把動作鍵誤判成移動，且對分身／廣播／生命／遊戲結束提供可追溯證據。
- 原始作品永遠保留，所有套用都可復原；版本、測試與 Pages 部署狀態可追蹤。
