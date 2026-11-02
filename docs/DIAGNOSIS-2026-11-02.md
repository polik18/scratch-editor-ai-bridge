# Scratch AI Bridge 診斷紀錄

日期：2026-11-02；檢查版本：`73ea966d87`。目標是維護 Bridge；夜市遊戲僅為實驗素材，沒有完成玩法驗收。

## 實測結果

- `npm run build --workspace=@scratch/scratch-ai-bridge`：成功；仍有 Node 模組 browser externalization、執行期 URL 與大型 chunk 警告，不能據此推論瀏覽器功能失敗。
- `npm test --workspace=@scratch/scratch-ai-bridge`：69 個測試檔、585 個測試通過。
- `npm run lint --workspace=@scratch/scratch-ai-bridge`：失敗，ESLint 回報 1,388 errors、1 warning，涉及約 80 個檔案；由於 `eslint . && prettier --check .` 短路，Prettier 未執行。大量為 unsafe 類型操作及其他規則；不能將全部視為實際執行缺陷。
- `npm run test:browser --workspace=@scratch/scratch-ai-bridge`：失敗。`scripts/browser-smoke.mjs:3088` 的 `.student-live-patch summary` 同時命中五個元素，Playwright strict mode 停止；後續路徑因此未完成。瀏覽器亦回報 CSP `http://[::1]:*` / `https://[::1]:*` 為無效來源，兩處設定分別在 `index.html` 與 `student-help.html`；IPv6 loopback 連線影響待單獨驗證。
- 夜市實驗：生成器初稿本身無法編譯，且還有未定義名稱、導演未納入、輸入與廣播宣告、玩法邏輯等問題；這些不能直接歸因 Bridge。修正後曾產出結構檢查通過的測試 SB3，但 `runtime-behavior: not-run`，未驗證可玩性。

## 產品缺口與文件風險

1. `src/cli/generator.ts` 的 `success` 證明指定的結構及 VM 載入／儲存檢查通過，並固定標記 `runtime-behavior: not-run`；既有報告可區別狀態，但不能當作遊戲功能驗收。需要明確的需求、可重播操作與狀態／畫面斷言。
2. 生成複雜作品仍仰賴呼叫者正確撰寫 Canonical IR、命名輸入及宣告廣播；語意檢查能攔截格式與未知輸入，無法推定玩法是否符合企劃。單一手寫範例成功不能證明自然語言到任意遊戲可行。
3. `ScratchSession` 的 `plan/apply/undo/diff` 明確回報不支援；不能與另外實作的 Canonical/raw SB3 live patch 能力混為一談。`previewScreenshot` 已非空白 placeholder，`previewRun` 仍未實作。
4. 文件互相矛盾且過期：`docs/PROJECT-STATUS.md`、`docs/HANDOFF-LOG.md`、`packages/scratch-ai-bridge/IMPROVEMENT-STATUS.md`、`packages/scratch-ai-bridge/docs/AI-AGENT-HANDOFF.md` 對建置、清理及 preview 的敘述不同，應以本次執行、現行程式及較新專案記錄為準，整理單一權威狀態。
5. 真實模型、跨實體裝置及完整操作流程尚不能依既有模擬測試宣稱驗收；細節見 `research/tool-evaluation/2026-10-30-starport/SB3-SAVE-REMOTE-PLAN.md` 的目前狀態。

## 建議次序

1. 修正 browser smoke 的精確選擇器與 CSP，加入針對問題的回歸驗證，重跑瀏覽器測試並處理後續暴露的失敗。
2. 建立可追蹤的 lint baseline，依風險分批修復，勿大量自動修改或放寬規則掩蓋問題。
3. 統一現行狀態與功能矩陣；清楚區分 Session 與 live patch、結構通過與行為通過。
4. 以少量不同類型的案例建立需求對照、VM 操作和結果斷言，再評估真實模型輸出；不要只靠單一遊戲或成功產檔。

本次未執行整個 monorepo 測試、跨瀏覽器測試、正式 Scratch 網站匯入或真人遊戲手感驗收。完整本機命令輸出暫存於 `/tmp/scratch-bridge-{build,test,lint,browser}-audit.log`。
