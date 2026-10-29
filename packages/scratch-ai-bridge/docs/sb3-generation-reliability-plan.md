# SB3 產生成功率改善計畫

更新：2026-10-28  
狀態：P0 與 P1 完成；P2 基線建立；P3 流程定義。

## 目標

讓網站與 CLI 產生的 `.sb3` 都能通過 Scratch VM 載入、重新保存及再次載入；讓使用者能看懂 Gemini 回覆在哪個階段失敗，並能用明確診斷修正。以端到端有效作品比例衡量改善，不把「ZIP 可解壓」或「JSON 可解析」當作成功。

## 盤點結論

### 兩個失敗樣本

`cyber-duel.sb3` 與 `star-collector.sb3` 均是 ZIP 結構可讀、CRC 檢查通過，且 `project.json` 可解析；但 ZIP 內只有 `project.json`。每份專案有 6 個 costume 宣告，全部引用 `cd21514d0531fdffb22204e0ec5ed84a.svg`，ZIP 中沒有該資產，因此它們不是完整的 Scratch 專案封裝。

| 檢查項目 | Cyber Duel | Star Collector |
| --- | ---: | ---: |
| Targets | 6 | 6 |
| 專案 JSON block records | 63 | 61 |
| 有效的 `next` 連線數 | 0 | 0 |
| 子積木有 `parent`、但父層沒有相應連線 | 27 | 23 |
| 非 Scratch tuple 的 typed 欄位值 | 8 | 12 |
| `inputs` 中仍是 AI／應用層 wrapper | 3 | 6 |
| 缺少的 costume 資產引用 | 6 個引用／1 個唯一檔案 | 6 個引用／1 個唯一檔案 |

兩份作品都沒有由 `next` 或 input edge 串成的事件腳本。變數積木將 `{type:"variable", value:...}`、`{type:"literal", value:...}` 放在 `fields`；多個 reporter/control input 也直接寫入 `{type, value}` wrapper。這些是 Canonical／AI draft 層概念，不是可直接存進 SB3 `project.json` 的序列化 block 欄位。

專案內 `scratch-ai-bridge inspect` 對兩份檔案皆回報 `partial`；Star Collector 列出 31 項 block graph 問題，Cyber Duel 列出 24 項。此 CLI 是靜態分析器，報告本身不表示 Scratch VM 已載入檔案。

### 生成入口混淆

專案目前有兩條不同的生成路徑：

1. **正式網站路徑**：網站產生給 Gemini 的 Canonical IR 指示詞；使用者貼回回覆後，依序做 response 擷取／格式正規化、Canonical schema、語意驗證，再交給官方 Scratch VM `loadProject()` / `saveProjectSb3()` 編譯。此路徑有修復提示與固定 Gemini 回覆 fixture，但缺少真實使用者工作階段的分階段成功率資料。
2. **`scratch-session` / `ScratchSession` 路徑**：自行建立 Scratch project JSON，`compile()` 以 JSZip 只封裝 `project.json`，不把新專案宣告的空白 SVG 資產放入 archive，也不經 Scratch VM round-trip。其自製 `validateSB3()` 未依官方 serialized block schema 驗證 fields、資產存在性或 graph reciprocity，所以樣本被宣告成功。`addBlock()` 的型別宣告與腳本實際傳入的 field/input wrapper 也不一致；生成腳本以 `parent` 指標代替 `next`／input 連線，造成積木彼此脫節。

網站 `src/ui/App.tsx`／`scratch-session` 的實驗流程和正式首頁的 Canonical IR compiler 也並存；使用者看到相似的「生成／下載」文字時，無法知道實際走的是哪條路。`src/nlp/parser.ts` 是關鍵字樣板解析器，不是 Gemini API；文件中把它稱為 AI 生成能力會造成預期落差。

### Gemini 回覆失敗率

目前可確認網站已有 Canonical IR 指示詞、AI response envelope、部分 shorthand normalizer、schema／語意 gate、VM 編譯 gate、錯誤回饋提示與固定回覆測試。這能指出個別回覆失敗原因，但沒有記錄使用者實際嘗試的分母、各 gate 失敗數與修復後成功數。因此「成功率太低」目前是重要的使用者觀察，尚無足夠資料精算比率或斷定主因是模型、prompt、UI、特定回覆格式或作品複雜度。

## 改善階段

### P0 — 停止錯誤成功訊號並統一 CLI 編譯路徑

- 將 `scratch-session` SB3 輸出標為實驗性／不可用，直到通過 VM round-trip gate；避免輸出成功訊息或讓不合格檔案看似已完成。
- CLI 改用現有 Canonical IR compiler / 官方 Scratch VM adapter。新建專案與新增角色必須以 compiler 所需的資產 bytes 封裝空白／自動造型；不得只寫 costume metadata。
- 若短期需保留低階 session API，輸出前使用能力 registry 檢查 opcode、field/input 名稱與型別、連接形狀、變數 ID、parent/next/input reciprocity 及 target 限制。遇到未支援結構應以路徑明確失敗，不可寬鬆接受。
- CLI 的「成功」須等同：SB3 archive 完整 → 官方 Scratch VM 載入成功 → VM 保存 → 保存結果重新載入成功。

**驗收門檻：** 兩個提供的失敗樣本成為固定回歸案例；修正後 ZIP 內所有資產引用均存在且 hash 相符，事件腳本能由 VM 還原，VM round-trip 後再次載入成功。舊錯誤輸出必須在修正前被拒絕，而非以 exit code 0 結束。

### P1 — 讓 Gemini 回覆更容易達到可驗證格式

- 網站指示詞由唯一的 Canonical IR schema 與 authoring capability registry 產生；每次只提供本次可用的積木能力、必要 inputs／fields、完整最小範例和禁止項目，避免 schema、prompt 文件、UI 指引各自漂移。
- 指示 Gemini 一次只回傳指定版本的完整 JSON envelope；回覆中每個必要功能須對應到實際 block JSON Pointer。模型自述的需求覆蓋只當待驗證線索，不作為執行成功證據。
- 提供小型、已知可編譯的範例做格式示範；將需求拆成角色、事件腳本與互動規則，但最後仍輸出單一完整專案，避免部分 JSON 拼接造成 references 不一致。
- 保持目前安全正規化邊界：只修復無歧義的包裝／簡寫；不得自動猜測遊戲規則、碰撞條件或未知 opcode。格式及語意 gate 未通過時保留原始回覆，顯示首要錯誤和精確位置。
- 研究 Gemini 官方 structured output／JSON schema 能力，若網站未呼叫 Gemini API，將其列為使用者手動貼回流程的未控制變因；不要把提示詞宣稱為模型端的 schema enforcement。

**驗收門檻：** 固定的真實 Gemini 回覆 corpus 能重現目前常見格式差異；每個樣本均記錄 parse、normalize、schema、semantic、VM compile、reload 各 gate 結果。新增 prompt 或 normalizer 後，舊樣本不得退步；unsupported／不完整輸出有明確修復指引。

### P2 — 量化端到端成功率並改善修復閉環（進行中）

- ✅ 建立去識別化的本機回覆 corpus：`research/sb3-failure-corpus/`
- ✅ 定義階段：parse → normalize → schema → semantic → VM load/save → reload → preview
- ✅ 建立 9 種常見失敗樣本 (f-001 至 f-009)：
  - f-001: Gemini 平台遊戲短格式 (缺少必要欄位)
  - f-002: Markdown 包裝 (需移除 code fence)
  - f-003: 截斷輸出 (需補全括號)
  - f-004: 簡寫 fields/inputs (缺少必要欄位)
  - f-005: 未知積木 (需替換為 Scratch 3.0 積木)
  - f-006: 未宣告變數 (需新增變數)
  - f-007: 缺少 assets (需附加檔案)
  - f-008: 錯誤 parent/next graph (需修正連結)
  - f-009: 大型多角色遊戲 (需拆分或用 web)
- ✅ 每個樣本提供最短可執行修正提示
- ✅ 建立使用者教學文件：`docs/USAGE-GUIDE.md`

**驗收門檻：** 每次發版附 corpus 版本、總樣本數、端到端通過比例、各 gate 失敗數、相較基線變化及未覆蓋類型。比例必須同時列分子與分母，樣本不足時標示尚無穩定估計。

### P3 — 消除使用者看到的雙重入口與能力落差（進行中）

- 主網站只保留一個可辨認的「AI 回覆 → 檢查 → VM 編譯 → 下載」流程；實驗性 `src/ui/App.tsx` 若仍保留，須明確標示用途與限制，或改為使用同一 Canonical IR compiler。
- 文件將 `scratch-ai-bridge inspect`（靜態分析）、`scratch-session`（stateful authoring）及正式網站生成流程分開說明，移除「preview」「compiled」「success」等超出實際驗證階段的用詞。
- 首次失敗畫面顯示目前停在哪一關、最關鍵的錯誤路徑、下一個可操作步驟，以及修正後重新驗證狀態；不要只顯示「載入失敗」或泛用 JSON 錯誤。

**驗收門檻：** 新手依網站和 CLI 文件各自完成一個最小範例；每個「成功」狀態都有相應的 VM／archive gate 證據，文件指向的入口可實際執行。

## 建議順序與交付

1. 先完成 P0，因現有 CLI 可確定產出結構不完整且無法靠 prompt 改善。
2. 以失敗樣本和真實 Gemini 回覆 corpus 建立 P1/P2 基線，並同步修正 prompt、結構正規化與修復訊息。
3. 完成 P3 收斂入口，讓使用者不再誤把實驗性 CLI 與正式網站當成同一條管線。
4. 每階段由 `scratch-session`、正式網頁、VM round-trip、Scratch app/web editor 匯入四種結果分開驗收；VM 可載入不等於畫面正確或遊戲邏輯符合需求。

## 研究資料與限制

- 本機官方 Scratch VM adapter：[vm.ts](../src/scratch/vm.ts)、[compiler.ts](../src/core/compiler/compiler.ts)；目前正式 Canonical compiler 已採 VM load/save 路徑。
- 低階 session 產生器：[session.ts](../src/cli/session/session.ts)、[session validator](../src/cli/session/validator.ts)；遊戲樣本來源：[create-platform-game.mjs](../scripts/create-platform-game.mjs)、[create-fighting-game.mjs](../scripts/create-fighting-game.mjs)。
- AI 回覆流程：[網站入口](../src/main.ts)、[AI draft normalizer](../src/core/normalizer/ai-draft.ts)、[能力與指示詞](../src/core/capabilities/registry.ts)、[既有修復循環計畫](ai-repair-feedback-plan.md)。
- 既有 CLI 全面改善路線：[CLI agent 編輯與視覺驗證計畫](cli-agent-editing-plan.md)。本文件把其無損 archive、官方 VM round-trip、強驗證與 visual preview 議題聚焦到這次確認的生成失敗。
- 網路研究 manifest／安全記錄保存在 `research/sb3-failure-2026-10-28/`。本次明確查詢[Scratch project schema](https://scratch.mit.edu/project3_schema.json)、[Scratch sprite schema](https://scratch.mit.edu/sprite3_schema.json)、[Scratch VM SB3 serializer](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/serialization/sb3.js)、[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)及[Gemini prompting strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)。Scratch schema URL 回 404；GitHub 原始碼頁回 HTTP 200，但安全擷取器辨識為挑戰頁後停止；Gemini 文件 URL 回 302 並只回傳 redirect stub，未取得正文。因此本計畫不把這些未讀取頁面的內容當成結論。主要技術判斷來自本機 Scratch VM 整合程式、repo schema／validator、生成源碼與兩個使用者提供的 SB3 實物。

**本次範圍：** 完成靜態程式、文件、樣本與有限網路來源盤點；未修改生成程式、未修補或覆寫下載資料夾中的 `.sb3`，亦未執行測試套件。
