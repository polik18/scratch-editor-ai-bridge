# P0a：修正瀏覽器測試選擇器

前置：無。總體計畫定位：P0 §4。

**讀取入口**：`packages/scratch-ai-bridge/scripts/smoke/browser-smoke.mjs` 約 3088 行；`src/main.ts` 建立的面板。先以 rg 找到現行位置。

**此卡要做**：重現 `.student-live-patch summary` 命中五個元素；以穩定、唯一、具語意的定位選擇正確面板，保留其他面板。先增加或調整會在舊版失敗的測試。

**驗證**：執行 `npm run test:browser --workspace=@scratch/scratch-ai-bridge`，記錄精確定位的回歸與完整 smoke 結果；後續失敗不能宣告整體 pass。

**完成與交接**：只有選擇器回歸通過不代表 P0 完成；更新狀態並接 P0b。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
