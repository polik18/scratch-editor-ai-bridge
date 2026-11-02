# P2a：大型作品 AI 摘要

前置：P1a。總體計畫定位：P2 §6。

**讀取入口**：`src/core/ai/raw-tool-core.ts`、`tests/ai/raw-tool-core.test.ts`。

**此卡要做**：先重現大作品摘要超過 24 KB 失敗；改為有 byte 預算的摘要，保留 revision、角色總覽、截斷／查詢提示；避免輸出雲端變數、原始素材及無關資料。

**驗證**：套件目錄執行 `npx vitest run tests/ai/raw-tool-core.test.ts`；涵蓋大文字、多角色、隱私和舊 revision。

**完成與交接**：保留分頁／容量界限；Paper 可用時實測，不以合成案例宣稱真實作品通過。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
