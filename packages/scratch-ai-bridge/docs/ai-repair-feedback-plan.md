# AI 錯誤回饋與修復循環計畫

目前狀態：A + B 第一版已實作；preservation-edit 現可對指定 block 使用 `removeProperties` 刪除頂層欄位，並以 JSON Pointer `setPaths`/`removePaths` 局部修改既有巢狀物件欄位而保留旁支；三瀏覽器下載後重讀 smoke 與 SB3 round-trip 已通過；C 已從 capability registry 為缺少的 input／field 與無效 enum field 產生局部期望值，並為 Canonical schema 現有的 required/type/const/enum/additionalProperties、字串/陣列長度、數值上下界及 oneOf/anyOf 分支錯誤產生修復資訊。inclusive/exclusive 數值下界範例也經完整 Canonical revalidation。所有 semantic validator codes 均有非泛用修復建議。D 的瀏覽器 smoke 已涵蓋失敗、複製提示／報告、貼回完整有效回覆、驗證、VM 編譯下載、重新匯入分析。Validation report v2 另外標示編譯失敗階段；SVG、raster 與 audio preflight 失敗會把 Scratch VM compile 記為 skipped，並保留素材 JSON Pointer。Repair Report 現依 SVG／raster／audio preflight、archive generation、Scratch VM load/save 與 unknown failure 分別提供 expected、修復建議及實際 stage；固定 schema shape 與 `compile-failed` code 未變。Chromium、Firefox、WebKit smoke 均下載並驗證三種 media-preflight 報告。三引擎覆蓋 Canonical schema `name` 型別錯誤、額外未定義欄位、enum 不合法值、const 不符及巢狀 union 必填欄位缺漏：複製包含精確 JSON Pointer 和可用補值／修正的提示，貼回完整有效 Canonical 專案，再下載 SB3 並重新匯入確認修復值。巢狀 `oneOf` required 範例先前漏產生；schema 選擇現在依輸入 discriminator 選取分支，同時保留 `oneOf` 分支錯誤的替代值產生。`/name` 的 minLength 修正建議為可直接使用的 `Scratch Project`，並遵守 schema 的最大長度。注意 SB3 不儲存 Canonical 專案名稱；重新匯入時名稱由上傳檔名推導。語意修復流程覆蓋 `current-costume-out-of-range`、`unknown-sprite`、`unknown-variable`、`unknown-broadcast`、`unknown-list`、`unknown-procedure` 與 `unknown-procedure-argument`；各流程檢查錯誤路徑與值、複製修復提示、回覆完整 Canonical 專案、下載 SB3 並重新匯入確認修復資料保留。十三條非編譯修復流程通過 Chromium、Firefox、WebKit：六種 schema 錯誤加上七種語意錯誤。未知角色流程確認 `Platform` 碰撞目標；未知廣播、清單、程序、多餘程序參數、額外 schema 欄位及 minLength／enum／const／required 修正流程均確認下載後的修復結果。其他語意/schema/VM 失敗類型、Safari 與易用性驗證仍待完成。

## 目標

當 AI 回覆無法通過擷取、Schema、語意或 Scratch VM 編譯時，使用者不需要手動整理錯誤。介面應產生一份可直接
複製回 Gemini／其他模型的修復提示，要求模型保留原本遊戲意圖並回傳一個完整 Canonical IR JSON。

此功能不會把內容送到任何伺服器；報告與剪貼簿文字全部在瀏覽器本機產生。

## 使用流程

```text
貼上 AI 回覆
→ 擷取／結構修復
→ Schema validation
→ Semantic validation
→ Scratch VM compile
→ 成功：下載 .sb3
  失敗：顯示人類摘要＋「複製給 AI 修正」
             ↓
      將修復提示貼回 Gemini
             ↓
      把完整新回覆貼回 Bridge
```

錯誤區提供三個操作：

1. `複製給 AI 修正`：包含必要上下文與目前完整 JSON，適合直接貼入 Gemini。
2. `複製錯誤報告`：只複製機器可讀 Repair Report，適合除錯或 issue。
3. `下載報告.json`：當剪貼簿受瀏覽器權限限制或報告很大時使用。

## Repair Report v1

```json
{
  "format": "scratch-ai-bridge/repair-report",
  "version": 1,
  "canonicalVersion": 1,
  "projectName": "Super Mario Platformer",
  "summary": {
    "autoRepaired": 106,
    "errors": 0,
    "warnings": 3
  },
  "issues": [
    {
      "severity": "warning",
      "phase": "semantic",
      "code": "condition-not-boolean",
      "path": "/sprites/0/scripts/0/blocks/6/inputs/SUBSTACK/blocks/2/inputs/CONDITION",
      "opcode": "control_if",
      "actual": { "type": "variable", "name": "lives" },
      "expected": "shape=boolean reporter",
      "suggestion": "使用 operator_equals/operator_gt/operator_lt 建立明確條件",
      "example": {
        "type": "block",
        "block": {
          "opcode": "operator_equals",
          "inputs": {
            "OPERAND1": { "type": "variable", "name": "lives" },
            "OPERAND2": { "type": "literal", "value": 0 }
          }
        }
      }
    }
  ]
}
```

### 三種處理狀態

- `auto-repaired`：Bridge 已安全修正格式，列入紀錄但不要求 AI 重做。
- `must-fix`：未知 opcode、缺少必要 input/field、符號不存在、VM 拒絕等；禁止下載。
- `review`：數值當布林條件、可能相反的 game-over 條件等；允許匯出但清楚警告。

每個 issue 必須有穩定 `code`、JSON Pointer `path`、實際值與可執行建議。畫面可只顯示前 12 項，但複製／下載的
報告不可無聲截斷；超過上限時要附 `truncated` 與總數。

## 複製給 AI 的提示格式

```text
你正在修正 Scratch AI Bridge Canonical IR v1。
只回傳一個完整 JSON 根物件，不要 Markdown、Python、說明、patch 或多個候選版本。
保留目前角色、素材名稱與未被錯誤指出的遊戲邏輯；不要杜撰 capability registry 以外的 opcode。

修正規則：
1. 逐項處理 must-fix。
2. review 項目要依原遊戲意圖改成明確布林 reporter。
3. fields 值必須是純量；inputs 必須使用 Canonical input union。
4. 回傳完整專案，不可只回傳修改片段。

可用能力（只附本次相關 opcode 與參數）：
...

Repair Report:
{...}

Current Canonical IR:
{...}
```

若介面之後增加「原始遊戲需求」欄位，修復提示應一起附上；沒有該欄位時不可自行宣稱知道原始意圖。

## 實作階段

### A. 統一診斷模型

- 建立 `RepairReport`、`RepairIssue` TypeScript types 與 JSON Schema。
- 將 JSON parse/extraction、AJV、semantic validator、compiler/VM 錯誤映射成同一模型。
- 從 capability registry 取得 expected input/field、block shape、target 限制與最小範例。
- 保留原始錯誤供開發除錯，但不把堆疊或本機路徑放進複製文字。

驗收：相同錯誤每次產生穩定 code/path；報告本身通過 Schema；不含 stack trace、本機路徑或 HTML。

### B. 可複製 UI

- 錯誤區改為摘要卡片，按 phase 與 severity 分組。
- 新增 `複製給 AI 修正`、`複製錯誤報告`、`下載報告.json`。
- Clipboard API 失敗時顯示可選取 textarea fallback，不讓按鈕無聲失敗。
- 保留修復前文字與修復後 JSON 的一次 undo snapshot。

驗收：Chrome／Firefox／Safari 可複製或 fallback；鍵盤操作與狀態訊息可辨識；不會覆寫使用者尚未確認的內容。

### C. 建議與最小範例產生器

- Schema required/type/enum 錯誤產生局部正確形狀。
- semantic 錯誤由 capability registry 產生合法 reporter、field 或 menu 範例。
- 對 `condition-not-boolean` 僅列可選的比較方式，不擅自判定應為 `= 0` 或 `> 0`。
- unsupported opcode 提供目前最接近的已支援能力；沒有安全替代時明說無法自動轉換。

進度：Repair Report 現已依 registry 為 `missing-input`、`missing-field`、`invalid-field-value` 提供 expected 與局部 example；enum field 範例使用 registry 第一個允許值，不自行推測遊戲語意。Canonical schema required property 的合併修復例經 validator 驗證可通過；type/const/enum、additionalProperties 精確 pointer/removal、長度限制、inclusive/exclusive 數值上下界、最小清單項目 replacement，以及 oneOf/anyOf 分支替代值、maxLength/maxItems 截短操作均有 fixture 驗收；分支範例會重新驗證完整 Canonical project。所有 semantic validator codes 有專屬建議並有 coverage assertion；素材缺檔、checksum 不符與空／錯誤 Base64、Data URI 現於 VM compile 前回報精確素材路徑，建議回到來源專案還原素材，不產生佔位 bytes。schema 現有關鍵字皆有對應修復路徑或明確不產生範例，VM compile errors now receive stage-specific expected values and repair directions while retaining stable `compile-failed` code and existing report shape; `unknown` retains a generic fallback. Stage guidance is covered by unit tests and malformed SVG/raster/audio browser reports. Non-compile error types and end-to-end guidance usability remain open.

驗收：所有現有 semantic code 都有說明；建議範例本身通過局部 capability 驗證；不把猜測標成自動修復。

### D. 修復循環回歸測試

- Gemini Notebook 混合回覆：自動擷取後不應產生 parse error。
- Gemini 舊式簡寫：106 項結構修復及 3 項 review 警告必須穩定。
- field wrapper、缺少 costume `dataFormat`、字串 broadcasts、裸 script arrays。
- 無效 key、未知 sprite、未知變數、錯誤 target、未知 opcode、VM compile rejection。
- 瀏覽器 smoke 實際點擊複製，解析其中 Repair Report，貼回修正版後完成 `.sb3` 往返。

進度：Chromium、Firefox、WebKit smoke 現以未知 opcode 觸發 must-fix，實際複製提示與報告，再貼回完整有效 Canonical 回覆，經 validate、Scratch VM compile/download、SB3 re-import 和 analysis。Gemini 混合回覆與 106 項 shorthand repair 仍各有獨立 regression；另有 `schema-type`、`current-costume-out-of-range`、`unknown-sprite`、`unknown-variable`、`unknown-broadcast` 五種端到端修復案例。三引擎 JSON artifacts 保存回復結果，Pages release evidence gate 要求各案例下載成功且 re-import 核對成立；其他 semantic/schema/VM failure 類型及 Safari 尚未覆蓋。

驗收：CI 驗證「失敗 → 複製提示 → 修正版 → Validate → Compile → Re-import」完整路徑；複製內容不依賴畫面截斷文字。

## 建議交付順序

1. A + B：先讓所有錯誤都能可靠複製，立即改善使用體驗。
2. C：再增加針對 capability 的精準建議，避免第一版過度猜測。
3. D：用真實 Gemini 回覆固定修復循環，成為 Pages 部署門禁。

完成 A + B 後即可發布第一版；C + D 完成後才宣稱 AI repair loop 成熟。
