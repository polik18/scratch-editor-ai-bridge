# P2b：可定位的分頁查詢

前置：P2a。總體計畫定位：P2 §6。

**讀取入口**：`src/core/ai/raw-tool-core.ts`、`src/mcp/tools.ts`、`src/core/ai/openai-compatible.ts`、`src/main.ts`。

**此卡要做**：依現有協定增加目標／積木／事件／自製積木查詢，明示 total、cursor、截斷和 revision；處理重名、限制、過期結果及輸出預算。

**驗證**：fake provider、raw tool 與 MCP 測試；可用時以 Paper 定位 Tiles 廣播與 Generator。

**完成與交接**：必要時分多次實作；記錄既有協定變動與呼叫端兼容，不一次貼入全部作品。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
