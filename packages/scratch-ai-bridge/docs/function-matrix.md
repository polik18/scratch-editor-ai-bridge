# 功能矩陣

本文件列出 Scratch AI Bridge 的所有功能及其狀態。

## 功能分類

### 靜態驗證 (Stable)

| 功能名稱 | 狀態 | 入口 | 驗證方式 | 已知限制 |
|---------|------|------|----------|----------|
| Archive Validator | stable | `scratch-ai-bridge inspect archive` | `archive-validator.ts` | 無 |
| Graph Validator | stable | `scratch-ai-bridge inspect graph` | `graph-validator.ts` | 無 |
| Session Validator | stable | `scratch-ai-bridge inspect session` | `session-validator.ts` | 無 |

### 編譯器 (Stable)

| 功能名稱 | 狀態 | 入口 | 驗證方式 | 已知限制 |
|---------|------|------|----------|----------|
| Canonical IR Compiler | stable | `scratch-ai-bridge compile` | `compiler.ts` | 無 |
| VM Round-Trip | stable | `scratch-ai-bridge test vm-roundtrip` | `vm-roundtrip.ts` | 無 |

### 遊戲行為驗證 (Stable)

| 功能名稱 | 狀態 | 入口 | 驗證方式 | 已知限制 |
|---------|------|------|----------|----------|
| Behavior Test Runner | stable | `scratch-ai-bridge test behavior` | `behavior-test.ts` | 無 |

### 批次產生 (Experimental)

| 功能名稱 | 狀態 | 入口 | 驗證方式 | 已知限制 |
|---------|------|------|----------|----------|
| Batch Generator | experimental | `scratch-ai-bridge generate batch` | `batch-generator.ts` | 需更多測試 |
| Manifest Format | experimental | `scratch-ai-bridge generate manifest` | `manifest.ts` | 需更多測試 |
| Gate Tracker | experimental | `scratch-ai-bridge track gates` | `gate-tracker.ts` | 需更多測試 |

## 入口分類

### 正式入口 (Stable)

- `scratch-ai-bridge inspect archive`：靜態分析 SB3 檔案
- `scratch-ai-bridge inspect graph`：靜態分析 Block Graph
- `scratch-ai-bridge inspect session`：靜態分析 Session 結構
- `scratch-ai-bridge compile`：編譯設計檔為 SB3
- `scratch-ai-bridge compile preview`：編譯並預覽
- `scratch-ai-bridge test vm-roundtrip`：VM Round-Trip 測試
- `scratch-ai-bridge test behavior`：遊戲行為測試

### 實驗性入口 (Experimental)

- `scratch-ai-bridge generate batch`：批次產生 SB3 檔案
- `scratch-ai-bridge generate manifest`：產生 Manifest JSON
- `scratch-ai-bridge track gates`：追蹤 Gate 失敗統計
- `scratch-session`：開發中 Session CLI

## 註釋

- **Stable**：功能穩定，可安全使用
- **Experimental**：功能仍在實驗階段，可能有變更

## 未來規劃

- 增加更多靜態驗證工具
- 改善錯誤訊息和診斷
- 增加更多測試案例
