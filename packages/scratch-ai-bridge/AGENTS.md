# Scratch AI Bridge：給 AI 的使用入口

先讀這一份就夠了。照下表挑一條路，只在需要時才讀表中「再讀」的那一份。

## 四條規則

1. **不要自己寫 `project.json`、`.sb3` 或 Scratch 積木 JSON。** 一律交給下面的工具產生。
2. **工具回報失敗時，照 `feedback` 每一行「→」後面的建議修改，再呼叫一次。** 不要換別的方法繞過。
3. **不要讀 `docs/` 裡的計畫、狀態報告與歷史文件**（`*-plan*.md`、`*-status*.md`、`IMPROVEMENT-*`、`HANDOFF_*` 等）。
   它們是開發紀錄，不是使用說明。
4. **遇到權限錯誤（`Operation not permitted`、`EPERM`）就停下來，向使用者回報。** 不要用 `sudo`、改屬性或換路徑去繞過。

## 你想做什麼？

| 想做的事                             | 用什麼                                              | 再讀                            |
| ------------------------------------ | --------------------------------------------------- | ------------------------------- |
| 用一句話做新遊戲，讓本機模型寫       | `make` 指令                                         | 不用                            |
| 你自己就是寫遊戲的 AI                | `guide` → 寫 Game Spec → `spec`，或 MCP `make_game` | 不用，`guide` 已經包含全部格式  |
| 修改使用者在 Bridge 網頁中開著的作品 | MCP `inspect_project` → `propose_live_patch`        | `docs/AI-PROVIDER-MCP.md`       |
| 分析學生交的 `.sb3`                  | `inspect`／`batch` 指令                             | `docs/CLI-REFERENCE.md`         |
| 修改 Bridge 本身的程式碼             | 開發流程                                            | `README.md`、根目錄 `AGENTS.md` |

以下指令都要先 `cd packages/scratch-ai-bridge`（本目錄）再執行。套件通常已經安裝好，直接執行就好。
`--silent` 讓輸出只剩 JSON 報告。

### 1. 用一句話做新遊戲：`make`

```sh
npm run --silent cli -- make "做一個貓咪接蘋果的遊戲，用左右鍵移動貓咪，蘋果從天上掉下來，接到加分，漏接扣生命" \
  --out ./scratch-games/apples.sb3 --playtest
```

- 指令會自己呼叫本機模型寫作品描述、建置 `.sb3`、自動試玩。失敗時會把問題回饋給模型，再修一輪（`--rounds 0-3`，預設 1）。
- **直接執行就好，不用先檢查環境變數或模型設定**；連不上模型時，報告的 `feedback` 會說明原因。
- 模型設定（通常已設好）來自環境變數：
  - `SCRATCH_BRIDGE_MODEL_URL`：預設 `http://127.0.0.1:8000/v1`。
  - `SCRATCH_BRIDGE_MODEL`：預設使用 `/models` 列出的第一個模型。
  - `SCRATCH_BRIDGE_API_KEY`：也可用 `OMLX_ENDPOINT`、`OMLX_API_KEY`。
- 輸出的 JSON 報告欄位：
  - `status`：`success` 或 `failed`。
  - `playtestStatus`：試玩結果。
  - `output`：`.sb3` 的路徑。
  - `specFile`：模型寫的作品描述，可以手動修改後用 `spec` 重建。
  - `unsupported`：模型說做不到的部分。

需求要寫清楚：誰是玩家、用什麼鍵、其他東西怎麼動、怎麼得分或扣命、怎麼結束。

### 2. 你自己寫 Game Spec

```sh
npm run --silent cli -- guide                                     # 印出完整格式（約 850 token）
npm run --silent cli -- spec ./scratch-games/my-game.json --out ./scratch-games/my-game.sb3 --playtest
```

- 描述檔放在 `./scratch-games/`。
- 先看報告最前面的 `status`、`playtestStatus` 和 `feedback`。照 `feedback` 修改描述後，**加 `--force`** 重建同一個 `.sb3`。
- 不需要刪檔，也不要用 `grep` 過濾報告，否則會漏掉建議。

也可以用 MCP 的 `make_game` 工具做同一件事：參數 `spec` 放 JSON，工具說明裡已有完整格式。它的輸出會寫進 `--games-dir`，預設是 `./scratch-games`，不會覆蓋舊檔。

可以參考的完整範例在 `src/spec/examples/`：

| 檔案              | 遊戲類型 |
| ----------------- | -------- |
| `platformer.json` | 平台跳躍 |
| `maze.json`       | 迷宮     |
| `catch.json`      | 接東西   |
| `shooter.json`    | 射擊     |
| `whack.json`      | 打地鼠   |

做得到的玩法由行為組合而成：

- **玩家移動**：平台移動、俯視移動。
- **其他角色**：巡邏、收集品、危險物、終點、掉落物、子彈、可射中、點擊目標、冒出。
- **規則**：「條件 → 動作」，例如計時、計分、自訂計數器。

需求裡做不到的部分（例如雙人、反彈球）寫進 `做不到`，不要假裝做到。

### 3. 修改網頁中開著的作品（MCP）

啟動 MCP（stdio）：

```sh
node scripts/scratch-ai-bridge-mcp.mjs [--games-dir <資料夾>]
```

使用者要先開啟 Bridge 網頁並連線。順序是：

1. `inspect_project`：取得 revision。
2. 需要細節時，用 `inspect_raw_*`。
3. `propose_live_patch`：產生候選修改。只會變成待審候選，由使用者在網頁上確認後才套用。

### 4. 分析 `.sb3`

```sh
npm run --silent cli -- inspect ./作品.sb3 --format student-markdown   # 給學生看的提醒
npm run --silent cli -- inspect ./作品.sb3 --format markdown           # 給老師的完整報告：分數、各面向、證據
npm run --silent cli -- batch ./班級作品 --out ./班級分析結果
```

**`inspect` 的輸出就是分析結果**：直接用它整理回覆，需要更多細節就改用 `--format markdown`。

不要自己解壓 `.sb3`、讀 `project.json` 或翻原始碼。報告裡的「內容已隱去」是刻意的隱私保護，不是錯誤。

## 只有出錯時才需要安裝

套件通常已經安裝好，**不要主動執行 `npm ci` 或重新 build**。只有在下面兩種情況才處理：

- 指令回報找不到模組：在 repo 根目錄執行 `npm ci`，再執行 `npm run build:ai-bridge-deps`。
- `--playtest` 回報找不到 `dist/preview.html`：在本目錄執行 `npm run build`。
