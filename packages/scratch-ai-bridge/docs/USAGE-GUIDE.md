# Scratch AI Bridge 使用教學

## 什麼是 Scratch AI Bridge？

Scratch AI Bridge 是一個讓 AI 模型 (如 Gemini) 能與 Scratch 專案互動的工具。它能：

- 將 AI 生成的 Scratch 專案轉換為標準的 `.sb3` 檔案
- 驗證專案是否符合 Scratch VM 的格式要求
- 在本地預覽生成的專案
- 提供錯誤診斷與修正提示

## 工具功能

### 1. 編譯器 (`compiler`)
- 將 Scratch 專案 JSON 轉換為 Canonical 中間格式
- 將 Canonical 格式編譯為 `.sb3` 檔案
- 驗證資產完整性與圖形結構

### 2. 解編譯器 (`decompiler`)
- 將 `.sb3` 檔案解壓縮為 Scratch project JSON
- 將 Scratch project JSON 轉換為 Canonical 格式
- 提供診斷報告

### 3. CLI 工具 (`session-cli`)
- `new`: 建立新專案
- `load`: 載入 `.sb3` 檔案
- `save`: 儲存為 `.sb3` 檔案
- `info`: 顯示專案資訊
- `inspect`: 靜態分析專案 (語法、語意)
- `ls`: 列出專案內容 (sprites, variables, etc.)
- `sprite`: 新增 sprite
- `block`: 新增積木指令
- `var`: 新增變數
- `list`: 新增列表
- `attach`: 附加資產 (圖片、聲音)
- `compile`: 編譯為 `.sb3` 檔案
- `preview`: 預覽專案

## 使用方式

### 方式一：CLI 工具 (開發者)

```bash
# 建立新專案
npx scratch-session-cli new --output my-project.sb3

# 載入現有專案
npx scratch-session-cli load --input existing.sb3

# 靜態分析 (診斷問題)
npx scratch-session-cli inspect --input my-project.sb3

# 編譯 (從 JSON 到 SB3)
npx scratch-session-cli compile --input my-project.json --output my-project.sb3

# 預覽
npx scratch-session-cli preview --input my-project.sb3
```

### 方式二：Web 界面 (一般使用者)

1. 開啟 [Scratch AI Bridge 網站](https://your-site.pages.dev)
2. 輸入 AI 生成的 Scratch 專案 JSON 或 Markdown
3. 點擊「檢查」按鈕
4. 查看診斷結果與修正建議
5. 點擊「編譯」按鈕
6. 下載 `.sb3` 檔案

## 範例

### 範例一：生成簡單平台遊戲

```json
{
  "format": "scratch-ai-bridge/canonical-ir",
  "version": 1,
  "project": {
    "stage": {
      "name": "Stage",
      "variables": {
        "score": 0
      },
      "costumes": [
        {
          "name": "backdrop1",
          "md5": "f9a1b2c3",
          "rotationCenterX": 480,
          "rotationCenterY": 360
        }
      ]
    },
    "sprites": [
      {
        "name": "Player",
        "variables": {},
        "costumes": [
          {
            "name": "costume1",
            "md5": "d4e5f6g7",
            "rotationCenterX": 48,
            "rotationCenterY": 48
          }
        ],
        "currentCostumeIndex": 0,
        "visible": true,
        "x": 0,
        "y": -50,
        "size": 100,
        "rotation": 90,
        "direction": 90,
        "draggable": false,
        "rotationStyle": "all around",
        "scripts": [
          {
            "blockId": "start",
            "opcode": "event_whenflagclicked",
            "next": "move",
            "parent": null,
            "inputs": {},
            "fields": {}
          },
          {
            "blockId": "move",
            "opcode": "motion_movesteps",
            "next": null,
            "parent": "start",
            "inputs": {
              "STEPS": ["4", "10"]
            },
            "fields": {}
          }
        ]
      }
    ]
  }
}
```

### 範例二：診斷與修正

**問題**：AI 生成的專案缺少必要欄位

**診斷結果**：
```
error_code: MISSING_REQUIRED_FIELDS
error_message: 缺少必要欄位 (stage.variables, stage.costumes, sprites[].x, sprites[].y)
error_location: /stage, /sprites/0
```

**修正提示**：補上 `stage.variables`, `stage.costumes`, `sprites[].x`, `sprites[].y`

## 常見錯誤

| 錯誤碼 | 說明 | 修正提示 |
|--------|------|----------|
| `MISSING_REQUIRED_FIELDS` | 缺少必要欄位 | 補上 stage.variables, stage.costumes, sprites[].x, sprites[].y |
| `MARKDOWN_WRAPPED_JSON` | AI 回覆包含 Markdown code fence | 移除 Markdown code fence，直接輸出純 JSON |
| `TRUNCATED_OUTPUT` | AI 回覆因 token 限制被截斷 | 增加 token 限制或使用多輪對話分段輸出 |
| `UNSUPPORTED_BLOCKS` | 包含未支援的積木 | 替換為 Scratch 3.0 積木或移除功能 |
| `UNDEFINED_VARIABLE` | 變數未宣告即使用 | 在 stage 或 sprites[].variables 中新增變數 |
| `MISSING_ASSETS` | 資產檔案不存在 | 新增對應的 md5 的 costume 或 sound 檔案 |
| `BROKEN_GRAPH` | Block graph 連結中斷 | 修正 next 與 parent 指向 |
| `SIZE_LIMIT_EXCEEDED` | 專案过大 | 拆分為多個小專案或使用 web 界面 |

## 技術細節

### Canonical 格式

Canonical 是 Scratch 專案的中間表示格式，確保：

- 所有必要欄位都有值
- 資產檔案可透過 md5 查找
- Block graph 的 next 與 parent 連結正確
- 變數、列表、積木皆已宣告

### VM Round-Trip

編譯流程：

1. Scratch JSON → Canonical (decompile)
2. Canonical → VM loadProject (compile)
3. VM saveProjectSb3 → SB3

確保：
- 資產完整性
- 圖形結構 reciprocity
- Scratch 3.0 相容性

## 開發者文件

- [SB3 生成可靠性改善計畫](../sb3-generation-reliability-plan.md)
- [CLI 使用手冊](../SESSION-CLI-ONBOARDING.md)
- [API 文件](./api/)

## 支援

如有問題，請開啟 GitHub Issue 或查閱文件。