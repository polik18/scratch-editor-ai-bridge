# 功能矩陣

此表描述目前實際入口；結果應區分已執行的檢查與尚未驗證的行為。完整限制以各功能文件及測試為準。

| 功能                        | 狀態     | 實際入口與限制                                                                                                 |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| SB3 靜態分析                | 可用     | `scratch-ai-bridge inspect <file.sb3>`；不代表遊戲已執行                                                       |
| 批次分析                    | 可用     | `scratch-ai-bridge batch <directory> [--out <new-directory>]`（預設 `output/reports/<資料夾名稱>/`）           |
| 產生作品                    | 可用     | `scratch-ai-bridge generate <design.json> --out <new-file.sb3>`；生成報告將未執行的遊戲行為標為 `not-run`      |
| Scratch Session             | 部分可用 | `scratch-session --help` 列出入口；`plan`、`apply`、`undo` 和 `diff` 尚未實作。這不影響網頁的保留式 patch 流程 |
| 獨立行為測試工具            | 未實作   | `src/test/behavior-test.ts` 明確拒絕執行，不回報假 PASS                                                        |
| 獨立 VM round-trip 測試工具 | 未實作   | `src/test/vm-roundtrip.ts` 明確拒絕執行；其他編譯、驗證路徑的 VM 檢查依其各自報告                              |
| 定時遊戲預覽自動化          | 未實作   | `src/preview/automation.ts` 的 `previewRun` 明確拒絕執行；畫面截圖另有實作                                     |

以 `scratch-ai-bridge --help` 和 `scratch-session --help` 為實際命令依據。測試通過不代表所有瀏覽器、硬體或作品行為已驗收。

本機真實模型評估預設不執行；需要時以 `SCRATCH_BRIDGE_REAL_MODEL_EVAL=1 npm test --workspace=@scratch/scratch-ai-bridge -- tests/ai/p5-evaluation.test.ts` 明確啟用。模型或憑證不可用時會失敗；只有設定 `SCRATCH_BRIDGE_REAL_MODEL_REPORT` 才寫出評估報告。一般測試通過不代表真實模型通過。
