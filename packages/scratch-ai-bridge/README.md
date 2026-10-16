# Scratch AI Bridge

Scratch AI Bridge is a browser-only bridge between AI-authored structured JSON and Scratch projects. This package lives **inside the complete Scratch Editor monorepo** and uses the official `@scratch/scratch-vm` workspace.

Public beta: [https://polik18.github.io/scratch-editor-ai-bridge/](https://polik18.github.io/scratch-editor-ai-bridge/)

## Important repository layout

Nothing in the surrounding Scratch Editor was removed. The normal workspaces remain available, including `scratch-gui`, `scratch-vm`, `scratch-paint`, `scratch-render`, and `scratch-storage`.

A prebuilt experimental direct-use page is additionally available at repository root:

```text
ready-to-use/Scratch-AI-Bridge.html
```

That file is an additive convenience artifact. It does not replace this TypeScript package or the Scratch Editor source tree.

## Implemented source path

```text
Generate:
Canonical IR
→ validate
→ Scratch 3 project JSON + content-addressed assets
→ temporary SB3 archive
→ Scratch VM loadProject(archive)
→ Scratch VM saveProjectSb3()
→ .sb3

Analyze:
.sb3
├─ Scratch VM loadProject() → Scratch VM toJSON() → Canonical IR → Analysis IR → AI prompt
└─ Raw Archive IR → lossless export or target-scoped block graph patch → lossless SB3
```

學生版流程先讓使用者用中文描述作品，再產生一份可貼到 Gemini 或其他 AI 的完整訊息。取得 AI 回覆後可整段貼回網站，
按一次「檢查並製作 Scratch」便會自動擷取、修復、驗證、編譯及下載；不必理解 JSON、Validate 或 Compile。
工具會選出最完整的 Canonical IR，並修復常見簡寫（例如裸 script 陣列、純量 input、字串 broadcast、field wrapper，
或省略角色與 costume 必要欄位）。修復器不會猜測遊戲規則；Validate 會再檢查未宣告的變數／清單／廣播、
缺少必要 input、錯置的事件帽，以及非布林條件等語意問題。

若仍有格式或語意問題，頁面會用中文說明下一步。按「複製修正訊息給 AI」即可取得包含原始作品需求、目前專案、完整診斷與
Canonical IR 規則的提示詞，直接貼回 Gemini；也可只複製／下載報告。剪貼簿權限被拒絕時會顯示可手動全選的內容，
自動修復後則可一鍵復原修復前的原始回覆。JSON、Repair Report 與分離式檢查／編譯操作均保留在教師／進階工具。

目前 strict authoring registry 有 130 個可執行積木能力，涵蓋鍵盤事件、移動與造型、控制流程、清單、廣播、感測、運算與聲音。上游 no-op 的 `sensing_userid` 只保留舊專案資料，不列入 AI authoring。
全部能力可通過官方 parser 與 VM load/save/reload；runtime 測試涵蓋事件／算術／變數、迴圈／清單／文字與廣播代表流程。
這不代表每個 opcode 的執行行為或實際畫面都已逐一驗收。網站內建的 `Platformer Core Controls` 範例示範左右移動、跳躍速度、重力及平台碰撞；
AI 指令的 opcode、必要 input、field、積木形狀與 stage/sprite 限制均由同一份 capability registry 產生。

學生作品結果使用官方 Scratch VM 與 `scratch-render` 顯示初始舞台，也提供「執行作品」動畫預覽。動畫在只允許腳本執行的 opaque-origin iframe 中運作，支援方向鍵、空白鍵與舞台滑鼠輸入；使用者可手動停止，Runtime 最多執行 15 秒。Chromium、Firefox 與 WebKit smoke 覆蓋舞台回應及停止後恢復靜態預覽；官方 `monitors.sb3` 與 `pen-dolphin-3d.sb3` fixture 驗證選取造型、resolution-2 PNG 與混合 PNG/SVG 素材渲染。

SB3 專案在本機讀取、編譯與分析，不會整份上傳。若動畫執行到 Text to Speech 或 Translate 積木，預覽會先顯示該次文字並詢問是否傳送；Text to Speech 最多 128 字元，Translate 最多 1,024 字元，拒絕或超限都不會送出。獲准的文字只送到 Scratch 對應的合成／翻譯服務。相機相關 extensions 不會自動載入。WeDo 2.0、micro:bit、EV3、Boost 與 GDX for 預覽提供 Scratch Link 搜尋／配對控制；按下搜尋後會連線本機 Scratch Link，或嘗試 Scratch Device Manager 備援，裝置資料與積木控制指令會經該連線傳輸。實際裝置與積木行為尚未實機驗證。

上傳 SB3 後，教師／進階資料還提供保留式局部修改流程：使用者可以複製包含原始積木圖的 patch 指令給 AI，再貼回限定格式的 JSON patch。
Bridge 會在本機檢查 target 身分與 block graph 連結，只套用列出的積木修改，然後保留未修改的未知欄位與素材 bytes 匯出 SB3。
這條路徑不會把整份專案投影回 Canonical IR，也不會下載或執行 extension 程式碼。
分析完成後也可下載保留原始 `project.json`、所有 entry 內容 bytes 與 ZIP archive comment 的 SB3 副本；ZIP 容器會重新封裝，因此不承諾 ZIP 位元組與來源檔完全相同。
教師／進階工具另可選擇透過官方 Scratch VM 載入並重新保存 `.sb3`，同時下載 VM 正規化差異報告。報告逐項列出 `project.json` 的 JSON Pointer 變更、每個 archive entry 的來源／輸出 SHA-256，以及 archive comment 是否改變；原始值不會複製到報告，方便檢查 VM 正規化造成的資料變化。

SB3 匯入目前限制壓縮檔 64 MiB、解壓後所有 entries 合計 256 MiB、`project.json` 16 MiB 和 2,048 個 entries。素材解壓時同步驗證 CRC 與 SHA-256；支援時，≥1 MiB 的 DEFLATE entry 使用原生串流解壓，否則回退 JSZip。最新 Node 26.8.2/macOS arm64 Chromium、Firefox 155、WebKit 26.6 精確 256 MiB 匯入分別耗時 7.69/9.01/6.29 秒；三引擎都在解壓前拒絕 256 MiB + 1。macOS 40 ms process-tree RSS sum 樣本分別約 1.69/2.55/0.61 GB；稀疏樣本不是精確峰值，RSS sum 也可能重複計入共享頁面。Ubuntu PSS 必須由 Linux hosted workflow artifact 驗證，目前尚未取得。

缺少圖像資料的作品不再使用純白舞台與透明 `1×1` 角色。編譯器會依作品主題及角色名稱，自動嵌入安全的 SVG 背景，
並為玩家、敵人、金幣、平台、終點、貓、球、飛船或一般角色選擇可見造型。AI 也可直接使用提示詞列出的內建造型名稱；
所有自動圖像都會包進下載的 `.sb3`，不需要 Scratch CDN 或開啟作品時的網路連線。

See `docs/status.md` and `docs/vm-write-path.md` for exact phase status and design decisions.
The full L1/L2/L3 completeness definition and staged implementation plan is in `docs/completeness-roadmap.md`.
The staged one-click AI error feedback loop and remaining precision work are tracked in `docs/ai-repair-feedback-plan.md`.
Release gates and the documented Pages rollback procedure are in [`docs/release-checklist.md`](docs/release-checklist.md).

## Commands

From repository root:

```sh
npm ci
npm run build:ai-bridge-deps
npm run dev --workspace=@scratch/scratch-ai-bridge
npm test --workspace=@scratch/scratch-ai-bridge
npm run lint --workspace=@scratch/scratch-ai-bridge
npm run build --workspace=@scratch/scratch-ai-bridge
npm run test:browser --workspace=@scratch/scratch-ai-bridge
npm run cli --workspace=@scratch/scratch-ai-bridge -- --help
```

The local CLI has `inspect <file.sb3>` and `batch <directory> --out <new-directory>` commands. It reads SB3
structure only; it does not run project scripts, Scratch VM, hardware, or extensions. Batch output is written to a
new directory and uses anonymous student IDs unless a validated manifest is supplied. See
[`docs/cli-agent-plan.md`](docs/cli-agent-plan.md) for the output contract and current implementation status.

Examples:

```sh
npm run cli --workspace=@scratch/scratch-ai-bridge -- inspect ./作品.sb3 --format markdown
npm run cli --workspace=@scratch/scratch-ai-bridge -- batch ./班級作品 --out ./班級分析結果 --jobs 1
```

The batch report directory includes `PRIVATE-teacher-source-map.csv`, which maps anonymous IDs to input filenames.
Keep this file private; do not share it with student reports.

Use the exact Node version in the repository `.nvmrc`. The dependency build is required after a clean install because
the official Scratch workspaces resolve several packages through their generated `dist/` entry points.

## GitHub Pages

The Pages workflow validates pull requests and deploys pushes to `main` or `develop`. The public repository is
[`polik18/scratch-editor-ai-bridge`](https://github.com/polik18/scratch-editor-ai-bridge), with GitHub Actions selected
as its Pages source. See `docs/deployment.md` for the release checklist and current limitations.
After the first successful service-worker installation, the app shell and bundled assets can reload offline; speech,
translation, Scratch Cloud, and hardware features still need their respective network services or devices.
