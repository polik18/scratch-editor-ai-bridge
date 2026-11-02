# A0：Scratch 素材來源盤點

前置：U0、P1。總體計畫定位：A0 §9D。

**讀取入口**：`packages/scratch-gui/src/lib/libraries/*.json`、GUI storage、Bridge compiler 與素材匯入。

**此卡要做**：分清 catalog 和 bytes；核對版本、角色多造型、音效 metadata、來源、授權、CORS、網路及離線。設計精確 ID 與來源契約，不自動下載全庫。

**驗證**：建立可散布的自製 fixture 和可重現來源報告；不可用的網路／授權分別標未驗證。

**完成與交接**：名稱相同不是 bytes 相同；不要宣稱已授權再散布或未聯網已驗證。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
