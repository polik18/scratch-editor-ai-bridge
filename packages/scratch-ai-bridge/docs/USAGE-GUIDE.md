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

### 3. Scratch Session CLI（實驗性）

這個工具在目前工作目錄以 `.scratch-session.json` 記錄一個工作階段。從套件目錄執行：

```bash
npm run session -- new 我的遊戲
npm run session -- add-sprite Ball
npm run session -- add-block Ball event_whenflagclicked
npm run session -- info
npm run session -- save ./my-game.sb3
npm run session -- compile ./validated-game.sb3
npm run session -- preview ./stage.png
npm run session -- open --url http://localhost:8601/
```

載入既有作品使用 `npm run session -- load ./game.sb3`；載入本身不改動檔案。之後對已載入作品執行新增或修改命令會儲存回該作品，若要保留原始檔，先 `save ./copy.sb3` 再修改。`save` 儲存編輯中的草稿，允許未完成的積木；`compile` 驗證素材存在、基本專案結構、積木連結及 Scratch VM 載入，輸出相同封裝，並不保證遊戲好玩或每一種積木行為正確。若有診斷，請先修正後重試。

新產生的 ID 是 shell 安全字元。從既有 SB3 匯入的 ID 可能含特殊字元，傳入 CLI 時請使用單引號，例如 `--parent 'JlQGmYeb.LFk{)IyAB(])'`。舊 session 會在下次寫入時升級；若指向的檔案移動或 state 損壞，CLI 會提示，請恢復檔案或重新執行 `load`，不會默默建立空白作品。

`preview` 使用真正的 Scratch renderer 擷取初始舞台，需先完成本套件 build 並安裝 Playwright Chromium，預設不覆寫既有圖片。`open` 會啟動**新的瀏覽器視窗**，將作品載入指定的本機 Scratch GUI 或 Bridge 頁面並按綠旗；關閉視窗後命令結束。它不會接管已開啟的瀏覽器分頁。若 Bridge 位於其他埠，改用 `--url http://localhost:5178/`。兩者都需要對應的本機網頁服務先啟動；可用 `open --headless --screenshot stage.png` 做自動化檢查。`plan`、`apply`、`undo` 和 `diff` 尚未實作，請勿依賴它們修改作品。

## 使用方式

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

| 錯誤碼                    | 說明                            | 修正提示                                                       |
| ------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `MISSING_REQUIRED_FIELDS` | 缺少必要欄位                    | 補上 stage.variables, stage.costumes, sprites[].x, sprites[].y |
| `MARKDOWN_WRAPPED_JSON`   | AI 回覆包含 Markdown code fence | 移除 Markdown code fence，直接輸出純 JSON                      |
| `TRUNCATED_OUTPUT`        | AI 回覆因 token 限制被截斷      | 增加 token 限制或使用多輪對話分段輸出                          |
| `UNSUPPORTED_BLOCKS`      | 包含未支援的積木                | 替換為 Scratch 3.0 積木或移除功能                              |
| `UNDEFINED_VARIABLE`      | 變數未宣告即使用                | 在 stage 或 sprites[].variables 中新增變數                     |
| `MISSING_ASSETS`          | 資產檔案不存在                  | 新增對應的 md5 的 costume 或 sound 檔案                        |
| `BROKEN_GRAPH`            | Block graph 連結中斷            | 修正 next 與 parent 指向                                       |
| `SIZE_LIMIT_EXCEEDED`     | 專案过大                        | 拆分為多個小專案或使用 web 界面                                |

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
