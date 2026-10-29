# Release Report Template

本文件是發布報告的模板，包含端到端成功率和 Gate 失敗統計。

## 版本資訊

- Version: `{version}`
- Release Date: `{date}`
- Commit: `{commit}`

## 端到端成功率

| 指標 | 數值 |
|------|------|
| 成功數 | `{success}` |
| 失敗數 | `{fail}` |
| 總數 | `{total}` |
| 成功率 | `{successRate}%` |

## Gate 失敗統計

| Gate | 失敗數 | 比例 |
|------|--------|------|
| `{gateName}` | `{failCount}` | `{failPercentage}%` |
| ... | ... | ... |

## 未覆蓋類型

- `{uncoveredType}`: `{description}`
- ... | ... |

## 已知問題

- `{issue}`: `{description}`
- ... | ... |

## 測試案例

| 案例 | 類型 | 結果 |
|------|------|------|
| `{testCase}` | `{type}` | `{result}` |
| ... | ... | ... |

## 失敗案例

| ID | 標題 | Gate | 原因 |
|----|------|------|------|
| `{id}` | `{title}` | `{gate}` | `{reason}` |
| ... | ... | ... | ... |

## 修正行動

- `{action}`: `{description}`
- ... | ... |

## 下一步

- `{nextAction}`: `{description}`
- ... | ... |
