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
→ Scratch VM loadProject()
→ Scratch VM toJSON()
→ Canonical IR
→ Analysis IR
→ AI prompt
```

學生版流程先讓使用者用中文描述作品，再產生一份可貼到 Gemini 或其他 AI 的完整訊息。取得 AI 回覆後可整段貼回網站，
按一次「檢查並製作 Scratch」便會自動擷取、修復、驗證、編譯及下載；不必理解 JSON、Validate 或 Compile。
工具會選出最完整的 Canonical IR，並修復常見簡寫（例如裸 script 陣列、純量 input、字串 broadcast、field wrapper，
或省略角色與 costume 必要欄位）。修復器不會猜測遊戲規則；Validate 會再檢查未宣告的變數／清單／廣播、
缺少必要 input、錯置的事件帽，以及非布林條件等語意問題。

若仍有格式或語意問題，頁面會用中文說明下一步。按「複製修正訊息給 AI」即可取得包含原始作品需求、目前專案、完整診斷與
Canonical IR 規則的提示詞，直接貼回 Gemini；也可只複製／下載報告。剪貼簿權限被拒絕時會顯示可手動全選的內容，
自動修復後則可一鍵復原修復前的原始回覆。JSON、Repair Report 與分離式檢查／編譯操作均保留在教師／進階工具。

目前 strict authoring registry 支援 26 個積木，包括鍵盤事件、X/Y 移動、角色碰撞、比較／布林 reporter、造型切換、
控制流程、變數與廣播。網站內建的 `Platformer Core Controls` 範例示範左右移動、跳躍速度、重力及平台碰撞；
AI 指令的 opcode、必要 input、field、積木形狀與 stage/sprite 限制均由同一份 capability registry 產生。

缺少圖像資料的作品不再使用純白舞台與透明 `1×1` 角色。編譯器會依作品主題及角色名稱，自動嵌入安全的 SVG 背景，
並為玩家、敵人、金幣、平台、終點、貓、球、飛船或一般角色選擇可見造型。AI 也可直接使用提示詞列出的內建造型名稱；
所有自動圖像都會包進下載的 `.sb3`，不需要 Scratch CDN 或開啟作品時的網路連線。

See `docs/status.md` and `docs/vm-write-path.md` for exact phase status and design decisions.
The full L1/L2/L3 completeness definition and staged implementation plan is in `docs/completeness-roadmap.md`.
The staged one-click AI error feedback loop and remaining precision work are tracked in `docs/ai-repair-feedback-plan.md`.

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
```

Use the exact Node version in the repository `.nvmrc`. The dependency build is required after a clean install because
the official Scratch workspaces resolve several packages through their generated `dist/` entry points.

## GitHub Pages

The Pages workflow validates pull requests and deploys pushes to `main` or `develop`. The public repository is
[`polik18/scratch-editor-ai-bridge`](https://github.com/polik18/scratch-editor-ai-bridge), with GitHub Actions selected
as its Pages source. See `docs/deployment.md` for the release checklist and current limitations.
