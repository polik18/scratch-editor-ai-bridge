# Scratch 作品回饋人工校準工作表

## 使用方式

這份資料只包含合成案例，尚未由教師評閱。可執行 `npm run feedback:corpus:generate --workspace=@scratch/scratch-ai-bridge` 重建 fixtures。20 份作品是 Canonical IR JSON，不是 SB3 封裝；可在 Bridge 貼入 JSON 檢視，也可用測試確認 IR 結構有效。教師先看作品與執行結果，再閱讀本機摘要；不要先看系統預期答案。每案獨立評分，至少 5 案由兩位教師分別評閱。

`tests/fixtures/feedback-corpus/cases.json` 登錄案例 ID 與預期/禁止主張，`projects/` 放對應 Canonical IR，`raw-graphs/` 放供特定觀察情境使用的合成 Scratch block graph。自動測試會逐一驗證作品 IR；這不代表作品已在 Scratch 執行或完成人工盲評。來源作品、學生姓名與素材不放入 corpus。每次教師評估以 case ID、回饋 ID、評分與文字建議記錄；不要匯出 `.sb3`、原始對話或學生資料。將符合範本的 JSON 匯入時會核對 corpus ID 並拒絕重複 reviewer record。

## 每項回饋評分

| 欄位                         | 評分              |
| ---------------------------- | ----------------- |
| 結構描述準確                 | 1–5               |
| 能回到提供的積木證據         | 1–5               |
| 對學生有幫助且可採取         | 1–5               |
| 語氣尊重、不像評分           | 1–5               |
| 是否有誤報                   | 是／否，附回饋 ID |
| 是否漏掉重要面向             | 是／否，附面向    |
| SB3 無法觀察之處有無明確標示 | 是／否            |

另請學生先說明作品目標與已測試情境。這些是外部提供的學習證據，不可從 SB3 推測。

## 發布門檻

- 至少 20 個合成/匿名案例；至少 5 案有雙人獨立評閱。
- 確定型錯誤回饋 precision 至少 95%，證據定位 100%。
- 「有根據且可採取」平均至少 4/5，並保留各評閱者分數與分歧。
- 高影響錯誤或沒有來源證據的確定陳述為 0；尚未達標時不宣稱完成教師校準或學生適用性驗收。

## 評估結果

尚未評閱。此檔是可執行的審查表，不是教師通過證明。使用 `npm run feedback:review --workspace=@scratch/scratch-ai-bridge -- tests/fixtures/feedback-corpus/reviews-template.json` 可確認 gate 會保持關閉；要正式評估，需由教師建立盲評記錄並達成上述門檻。`npm run feedback:corpus:generate --workspace=@scratch/scratch-ai-bridge` 可重建作品與索引；自動測試涵蓋 20 份 Canonical IR 結構。
