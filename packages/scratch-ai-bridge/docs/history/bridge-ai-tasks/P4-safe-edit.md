# P4：安全修改與行為驗證

前置：P0–P2。總體計畫定位：P4 §8。

**讀取入口**：`src/core/archive/`、`src/core/graph/preservation-edit.ts`、`src/core/ai/raw-tool-core.ts`、`src/preview/main.ts`。

**此卡要做**：依 revision 完成定位、差異、使用者確認、局部 patch、驗證與另存；先以簡單 fixture 實測變數／積木改動的可觀察效果。

**驗證**：測取消、歧義、stale revision、壞 graph、原始 JSON／素材保留、VM reload 及 before/after 行為；未跑 scenario 標 not-run。

**完成與交接**：Paper 原檔只讀，樣本不存在不阻斷合成測試；實際修改效果需可重播斷言。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
