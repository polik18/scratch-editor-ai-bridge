# P1b：釐清自製積木參數

前置：P1a。總體計畫定位：P1 §5。

**讀取入口**：`src/core/graph/block-graph.ts`、decompiler／procedure 測試；由實際父鏈找定義。

**此卡要做**：逐個分析五項 Paper Minecraft argument reporter 告警：重建 parent、prototype、參數名稱與呼叫關係；先建自製合法／錯誤／孤立案例。

**驗證**：對已證實誤判及真實無效輸入各有回歸；記錄五項的結論或未判定。

**完成與交接**：不把作品警告視為真實錯誤，也不為了通過而放寬 graph 安全檢查。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
