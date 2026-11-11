# Scratch AI Bridge 改善計畫：執行狀態

最後更新：2026-11-02；狀態為**全數工作包驗收完成（含 fake provider 4/4 與本機真實模型 `Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e` 5/5 通過；真人學生驗收按規定單列 `not-run`）**。  
執行計畫：[BRIDGE-IMPROVEMENT-PLAN-2026-11-02.md](BRIDGE-IMPROVEMENT-PLAN-2026-11-02.md)。  
小上下文 AI 入口：[任務卡索引](bridge-ai-tasks/README.md)；所有工程切片（`P0a`、`P0b`、`U0`、`P1a`、`P1b`、`P2a`、`P2b`、`P3`、`P4`、`U1`、`U2`、`A0`、`A1`、`P5` fake provider＋本機真實模型）均已完成並通過驗證。  
目前負責者：無；若有其他執行者，先核對實際工作樹與交接，不依此欄自行認定獨占權。

| 工作包 | 狀態 | 依據／下一步 |
|---|---|---|
| P0 | 通過 | P0a 選擇器已修、Chromium browser smoke 全綠（exit 0）；CSP 移除 Chrome 忽略的無效 IPv6 來源；Paper 350ms 長按已進入世界；Firefox／WebKit 與 IPv6 實際連線單列 `not-run` |
| U0 | 通過 | Paper Minecraft 5 次冷／暖基準（`browser-baseline-v2.json`）已完成（冷中位數 `8,437 ms`、暖中位數 `8,388 ms`，各 8 個 longTask、最長 `4,321 ms`、DOM `2,838` 節點）；定位 `decodeProcedures` 逐程序深拷貝積木圖、`decompileSb3WithBlockGraphs` 重複轉換與 `renderAnalysis` 逐腳本掃描 evidence 為三大熱點 |
| P1 | 通過 | P1a 合法頂層 `[12,...]`／`[13,...]` tuple 保留且不誤報（Paper 結構疑點 `8→5`）；P1b 五項 argument reporter 父鏈全數驗明為畫布未連接孤立片段，已補齊定義內／未宣告／孤立片段回歸測試（`tests/graph/block-graph.test.ts`） |
| P2 | 通過 | P2a 24 KB 預算摘要（Paper `23,882 bytes`）；P2b `inspectRawTargets` 與 `inspectRawBlocks` 支援 `blockId`、`opcode`、`query` 篩選（含重名角色與廣播／自製積木定位），通過單元與 MCP 測試 |
| P3 | 通過 | `src/core/analyzer/feedback.ts` 與 `src/cli/inspect.ts` 合併同角色多段 `detached-script`（Paper `59→18` 筆依角色彙整項目，保留全部腳本數與 evidence IDs）並釐清畫布孤立參數積木文案；新增標註 corpus 測試 `tests/analyzer/feedback-corpus.test.ts`（48 項分析與 CLI 測試全過） |
| P4 | 通過 | `proposeRawLivePatch` 與 `src/main.ts` 偵測初始屬性／變數被腳本積木（如 `motion_setx`、`data_setvariableto`）覆寫並於候選 diff 顯示 `warnings`；`tests/archive/raw-property-patch.test.ts` 新增確定性 VM 前後行為測試；Paper Minecraft `Stage Sprite`（`targetIndex: 28`）選單態綠旗初始化 before/after 實測通過（`p4-scenario-result.json`） |
| U1 | 通過 | 主站 `src/main.ts` 與學生解惑頁 `src/student-help.ts` 完整驗證開啟作品、理解、試玩、提問、候選修改確認／捨棄、原檔保留、鍵盤導覽、对比度（≥4.5:1）與 320px 窄螢幕重排（`npm run test:browser` exit 0）；真人學生測試依既有豁免標示未驗證（工程流程已驗證） |
| U2 | 通過 | 消除 `decodeProcedures` 逐程序 `copyImportedBlockGraph`（$O(P \times B) \to O(B)$）、`decompileSb3WithBlockGraphs` 重複 `projectJsonToCanonical` 與 `renderAnalysis` 逐腳本線性過濾 evidence；Paper 5 次冷／暖複測（`browser-after-u2.json`）冷快取中位數由 `8,437 ms` 降至 **`2,812 ms`**（**-66.7%**）、最長 longTask 由 `4,321 ms` 降至 **`809 ms`**（**-81.3%**），暖快取中位數由 `8,388 ms` 降至 **`3,129 ms`**（**-62.7%**）、最長 longTask 由 `4,297 ms` 降至 **`900 ms`**（**-79.1%**） |
| A0 | 通過 | 本機 Scratch GUI 四大 catalog（343 角色、915 造型、85 背景、354 音效）結構與 `catalogRevision` 已盤點（`packages/scratch-ai-bridge/docs/history/SCRATCH-ASSET-LIBRARY-AUDIT-2026-11-02.md`）；官方條款頁取證不足故不主張遠端鏡像授權 |
| A1 | 通過 | 新增 `src/core/visuals/catalog.ts` 與 `tests/visuals/catalog.test.ts`：支援類別／關鍵字／標籤／ID 分頁檢索、重名拒絕模糊選取、多造型角色（`Abby` 4 造型）／背景（`Arctic`）／音效（`Pop`）bytes 取得與 MD5 驗證、網路失敗不靜默降級、離線 VM 重載，以及 Paper Minecraft 素材 provenance 盤點（748 造型參照：0 catalog 精確匹配、748 內嵌非 catalog；90 音效參照：25 官方 catalog 精確匹配、65 內嵌非 catalog） |
| P5 | 通過（fake provider 4/4 ＋ 本機真實模型 5/5） | `tests/ai/p5-evaluation.test.ts` 覆蓋 32KB 輸入上限、8 次工具上限、AbortSignal 取消、未確認不套用，以及 fake provider 4 類代表作品（4/4 通過）與本機真實模型 `Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e`（`http://127.0.0.1:8000/v1`，沿用 repo 既有 `~/.omlx/settings.json` 本機設定慣例）5 個案例（含 Paper Minecraft `Tiles` 等待時間修改，5/5 全數通過且 `repairRounds: 0`、VM 執行後狀態相符，報告見 `p5-evaluation.json`） |

## 交接紀錄

- 2026-11-02（Antigravity 完成 P3、P4、U1、U2、A1、P5 與全套驗收）：
  - **U2 網頁效能優化**：修改 `src/core/decompiler/project-json.ts`（將 `copyImportedBlockGraph(blocks)` 移出 `decodeProcedures` 迴圈）、`src/core/decompiler/decompiler.ts`（重用單次 `projectJsonToCanonicalWithBlockMappings` 輸出）、`src/main.ts`（以 `Map` 索引 `evidenceById` 與 `evidenceByScript`）。重新 build 後執行 `node packages/scratch-ai-bridge/scripts/bench/benchmark-external-sb3.mjs`（exit 0，產物 `/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/browser-after-u2.json`）：冷快取中位數 `8,437 ms → 2,812 ms`（-66.7%）、最長 longTask `4,321 ms → 809 ms`（-81.3%）；暖快取中位數 `8,388 ms → 3,129 ms`（-62.7%）、最長 longTask `4,297 ms → 900 ms`（-79.1%）。
  - **P3 回饋定位與去重**：修改 `src/core/analyzer/feedback.ts` 與 `src/cli/inspect.ts`，將同角色多段 `detached-script` 合併為單一角色級回饋項目並保留完整腳本數與 evidence IDs，同時區分畫布孤立參數積木與自製積木定義錯誤；新增 `tests/analyzer/feedback-corpus.test.ts`（`npx vitest run tests/analyzer/ tests/cli/inspect.test.ts` 4 檔 48 測試通過，exit 0）。
  - **P4 安全修改與真實行為驗證**：修改 `src/core/ai/raw-tool-core.ts` 與 `src/main.ts`，當屬性或變數修改可能被腳本內積木（如 `motion_setx`、`data_setvariableto`）於綠旗執行時覆寫，在候選 diff 回傳 `warnings`；於 `tests/archive/raw-property-patch.test.ts` 新增確定性 Scratch VM 執行前後驗證；並對 Paper Minecraft 執行選單態綠旗初始化 before/after 驗證（`/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/p4-scenario-result.json`）。
  - **A1 素材庫檢索與來源驗證**：新增 `src/core/visuals/catalog.ts` 與 `tests/visuals/catalog.test.ts`（`npx vitest run tests/visuals/catalog.test.ts` 4 項整合測試通過，exit 0），驗證 `Abby` 多造型角色、`Arctic` 背景、`Pop` 音效、重名防護、MD5 檢查、失敗重試、離線重載與 Paper Minecraft 748 造型／90 音效 provenance 比對。
  - **P5 端到端模型評估與 U1 瀏覽器驗收**：於 `src/core/ai/raw-tool-core.ts` 將 `inspectRawProjectForAi` 內嵌實際 `${revision}` 與 `query` 檢索說明並於 revision 不符時提示 expected revision，於 `src/core/ai/openai-compatible.ts` 將多輪工具迴圈上限由 4 輪提升至 6 輪（維持 8 次總工具呼叫上限）；執行 `npx vitest run tests/ai/p5-evaluation.test.ts`（exit 0，產物 `/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/p5-evaluation.json`），fake provider 4/4 通過，本機真實模型 `Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e` 5/5 案例（含 Paper Minecraft `Tiles` 等待時間修改）全數一次通過（`repairRounds: 0`、`runtimePassed: true`）。
  - **總體驗證指令與結果**：
    - `npm run build --workspace=@scratch/scratch-ai-bridge`：exit `0`
    - `npm test --workspace=@scratch/scratch-ai-bridge`：71 測試檔、600 項測試全數通過，exit `0`
    - `npm run test:browser --workspace=@scratch/scratch-ai-bridge`：Chromium smoke 全數通過（`browserImportAnalysisMs: 412`），exit `0`
    - 本次新增與修改之 19 個程式與測試檔 ESLint：**0 errors**（既有未修改行 baseline 44 errors 維持不變，新增錯誤 = 0）
    - Paper Minecraft 桌面原檔 SHA-256：`06280f5b0591da2e58f3aaed0be58e93dd8bc7848632a7327378d261357d1638`（完全未變動）

- 2026-11-02（Antigravity 接手 Codex `01a19979-5c6c-7c61-82f6-0659d5e2d8ad` 第一階段）：
  - 修復 `src/cli/generator.ts` 錯誤診斷排序（`diagnostics.unshift`），解決新增 `AUTOMATIC_ASSET` 警告後 `tests/generator.spec.ts` `atomic-output-write` 斷言失敗問題；修復 `scripts/bench/benchmark-external-sb3.mjs` 與 `tests/ai/raw-tool-core.test.ts` ESLint 錯誤。
  - 完成中斷的 `U0` Paper Minecraft 5 次冷／暖快取基準量測（`/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/browser-baseline-v2.json`）。
  - 完成 `P1b` 與 `P2b`。
