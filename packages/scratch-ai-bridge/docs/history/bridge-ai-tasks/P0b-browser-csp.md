# P0b：CSP 與預覽輸入

前置：P0a 的測試能力。總體計畫定位：P0 §4。

**讀取入口**：`packages/scratch-ai-bridge/index.html`、`student-help.html`、`src/preview/main.ts` 和既有 browser smoke。

**此卡要做**：以具體測試重現 Chromium 拒絕的 IPv6 CSP source；修正時保留來源限制。重現 Paper Minecraft 按鈕輸入，先用自製簡單作品區分座標、按下時間和作品狀態，不猜根因。

**驗證**：測 localhost／IPv4／預期 IPv6、非允許來源拒絕及 preview 輸入；跑 Chromium smoke 與 build。

**完成與交接**：CSP 結果、完整 smoke 與遊戲點擊狀態分列；未重現或樣本不可用標 not-run。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
