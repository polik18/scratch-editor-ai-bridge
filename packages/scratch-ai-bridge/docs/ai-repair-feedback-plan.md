# AI 錯誤回饋與修復循環計畫

目前狀態：A + B 第一版已實作；C 的 capability 精準範例與 D 的完整 AI 修正版往返仍待完成。

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

驗收：所有現有 semantic code 都有說明；建議範例本身通過局部 capability 驗證；不把猜測標成自動修復。

### D. 修復循環回歸測試

- Gemini Notebook 混合回覆：自動擷取後不應產生 parse error。
- Gemini 舊式簡寫：106 項結構修復及 3 項 review 警告必須穩定。
- field wrapper、缺少 costume `dataFormat`、字串 broadcasts、裸 script arrays。
- 無效 key、未知 sprite、未知變數、錯誤 target、未知 opcode、VM compile rejection。
- 瀏覽器 smoke 實際點擊複製，解析其中 Repair Report，貼回修正版後完成 `.sb3` 往返。

驗收：CI 驗證「失敗 → 複製提示 → 修正版 → Validate → Compile → Re-import」完整路徑；複製內容不依賴畫面截斷文字。

## 建議交付順序

1. A + B：先讓所有錯誤都能可靠複製，立即改善使用體驗。
2. C：再增加針對 capability 的精準建議，避免第一版過度猜測。
3. D：用真實 Gemini 回覆固定修復循環，成為 Pages 部署門禁。

完成 A + B 後即可發布第一版；C + D 完成後才宣稱 AI repair loop 成熟。
