# P1a：修正合法 SB3 primitive 誤判

前置：無；建議先完成 P0a。總體計畫定位：P1 §5。

**讀取入口**：`src/core/graph/block-graph.ts`、`src/core/archive/sb3-archive.ts`；參照 `packages/scratch-vm/src/serialization/sb3.js`。路徑相對 `packages/scratch-ai-bridge`，最後一項相對 repo root。

**此卡要做**：先以自製資料重現 `[12,...]` 與 `[13,...]` 頂層 primitive 被誤判；同時涵蓋畸形 tuple、object block 和無關 patch。只接受 VM 有依據的格式，保留原始 ID／座標／tuple。

**驗證**：於套件目錄執行 `npx vitest run tests/graph/block-graph.test.ts tests/archive/sb3-archive.test.ts tests/cli/inspect.test.ts tests/ai/raw-tool-core.test.ts`。驗證 export、VM reload、JSON 差異及非 project.json 資產雜湊。

**完成與交接**：必要時本機 Paper Minecraft 重跑；未知參數錯誤不要順便標為已修。

共同規則見 [小上下文執行入口](README.md) 和 [執行狀態](../BRIDGE-EXECUTION-STATUS.md)。先檢查工作樹及權威內容；每次只讀相關程式與測試，完成後記錄命令、退出碼、限制與下一步。
