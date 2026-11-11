# CLI 參考手冊

本文件提供 Scratch AI Bridge CLI 的完整命令參考。

## 基本語法

```
scratch-ai-bridge <command> [options]
```

## 命令列表

### inspect

靜態分析命令。

```
scratch-ai-bridge inspect <type> <path>
```

**類型：**

- `archive`：分析 SB3 檔案
- `graph`：分析 Block Graph
- `session`：分析 Session 結構

**範例：**

```bash
scratch-ai-bridge inspect archive game.sb3
scratch-ai-bridge inspect graph game.json
scratch-ai-bridge inspect session game.json
```

### compile

編譯命令。

```
scratch-ai-bridge compile <input> [output]
```

**選項：**

- `--output, -o`：輸出 SB3 檔案路徑
- `--preview, -p`：編譯後預覽

**範例：**

```bash
scratch-ai-bridge compile game.json
scratch-ai-bridge compile game.json -o game.sb3
scratch-ai-bridge compile game.json -p
```

### test

測試命令。

```
scratch-ai-bridge test <type> [input]
```

**類型：**

- `vm-roundtrip`：VM Round-Trip 測試
- `behavior`：遊戲行為測試

**範例：**

```bash
scratch-ai-bridge test vm-roundtrip game.sb3
scratch-ai-bridge test behavior game.json
```

### generate

從 Canonical IR JSON 或受支援的 `spritesDef` GameDesign JSON 產生 SB3。輸出以暫存檔原子建立，既有路徑預設拒絕覆寫。

```
scratch-ai-bridge generate <design.json> --out <new-file.sb3> [--report <report.json>] [--preview <stage.png>] [--force]
```

CLI stdout 永遠輸出版本化 JSON。生成 gate 包括 Canonical schema/semantic validation、SB3 archive、project JSON、block graph、costume/sound entry 及 MD5、Scratch VM load/save/reload。傳入 `--preview <stage.png>` 會以官方瀏覽器 renderer 載入並截取舞台；未傳入時 `renderer-preview` 為 `not-run`。`runtime-behavior` 仍為 `not-run`，生成成功不代表玩法已驗收。

**範例：**

```bash
scratch-ai-bridge generate game.json --out output/game.sb3 --report output/game.report.json
scratch-ai-bridge generate game.json --out output/game.sb3 --force
```

`scratch-session new-game --design=<design.json> --output=<directory>` 是同一 generator 的相容入口；`new-game` 和舊拼法 `newGame` 都有效。

### track

追蹤命令 (實驗性)。

```
scratch-ai-bridge track <type> <input>
```

**類型：**

- `gates`：追蹤 Gate 失敗統計

**範例：**

```bash
scratch-ai-bridge track gates results.json
```

## 全域選項

- `--verbose, -v`：顯示詳細資訊
- `--quiet, -q`：靜默模式
- `--help, -h`：顯示說明

## 環境變數

- `SCRATCH_AI_BRIDGE_VERBOSE`：啟用詳細模式
- `SCRATCH_AI_BRIDGE_QUIET`：啟用靜默模式

## 輸出格式

### 成功訊息

```json
{
  "success": true,
  "message": "Operation completed successfully"
}
```

### 失敗訊息

```json
{
  "success": false,
  "error": "Error message",
  "diagnostic": {
    "type": "error",
    "stage": "unknown",
    "code": "ERR_CODE",
    "message": "Error message",
    "suggestion": "Suggested fix"
  }
}
```

### 警告訊息

```json
{
  "success": true,
  "warnings": [
    {
      "type": "warning",
      "stage": "unknown",
      "code": "WARN_CODE",
      "message": "Warning message",
      "suggestion": "Suggested fix"
    }
  ]
}
```
