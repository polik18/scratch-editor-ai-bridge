# Scratch AI Bridge：給 AI 的使用入口

**先在 repo 第一層執行：**

```sh
npm run --silent bridge -- start
```

它會印出目前版本的所有指令、做得到和做不到的功能、規則，以及「什麼時候算完成」。內容由程式產生，
永遠和程式一致；這份文件只放不會變的部分。

## 不會變的規則

1. **不要自己寫 `project.json`、`.sb3` 或 Scratch 積木 JSON。** 一律交給工具產生。
2. **照報告 `feedback` 每一行「→」後面的建議修改，再呼叫一次。** 不要換別的方法繞過。
3. **報告的 `done` 是 `true` 才算完成**；`false` 時看 `notDone`。有題目時加 `--request <題目檔或文字>`。
4. **做出來的東西一律在第一層的 `output/`**；不要在套件資料夾裡新增檔案，不要覆蓋別人的作品。
5. **遇到權限錯誤（`Operation not permitted`、`EPERM`）就停下來，向使用者回報。** 不要用 `sudo` 或換路徑繞過。

## 檔案放哪裡

```text
scratch-editor-ai-bridge/             ← repo 第一層：指令都在這裡執行
├── output/                           做出來的作品（不進 git）
│   ├── games/<名稱>/                 <名稱>.sb3、<名稱>.spec.json、_過程/（報告、模型回覆、舊版）
│   ├── reports/<名稱>/               batch 分析結果
│   ├── bench/  cache/assets/  tmp/   benchmark、官方素材快取、暫存
└── packages/scratch-ai-bridge/       ← 程式本身
    ├── AGENTS.md  README.md          入口文件
    ├── bin/  src/  tests/  scripts/  指令入口、程式碼、測試、build／smoke／bench 腳本
    ├── docs/                         guide/ 使用說明、design/ 設計規格、history/ 開發紀錄
    ├── examples/                     範例程式
    └── research/                     值得留下的研究資料
```

- 開發過程的文件（計畫、交接）只寫在 `docs/history/`；一次性實驗放 `output/tmp/`。
- 修改 Bridge 本身的程式碼：讀 `README.md` 和根目錄 `AGENTS.md`。新增或改變指令、行為、限制時，更新
  `src/cli/agent-guide.ts`（`start` 的內容），`tests/cli/agent-guide.test.ts` 會檢查它和程式一致。

## 只有出錯時才需要安裝

套件通常已經安裝好，**不要主動執行 `npm ci` 或重新 build**。

- 指令回報找不到模組：執行 `npm ci`，再執行 `npm run build:ai-bridge-deps`。
- `--playtest` 回報找不到 `dist/preview.html`：執行 `npm run build --workspace=@scratch/scratch-ai-bridge`。
