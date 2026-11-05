---
name: scratch-tutor-workflow
description: 將 Scratch Bridge 的教學與文字生成改善計畫分卡執行、驗證及中斷恢復。
---
# Scratch Bridge 改善工作入口

## Trigger / 使用時機
依使用者授權執行或接續本計畫；只讀研究時不要自行啟動實作。

## Input / 輸入
指定本目錄為計畫工作樹；程式 source 位於 `/Users/huangjianzhe/Git/scratch-ai-bridge-improvement-plan`，開始前重新核對。狀態檔固定為本目錄的 `state.json`；證據放本目錄 `evidence/` 或可存取的專案外路徑。

## Preconditions / 前置條件
先讀適用 AGENTS.md、檢查 `git status --short --branch` 與其他工作樹狀態；[原計畫](references/original-plan.md)只按需讀相關章節。此狀態工具不提供跨程序鎖；**同時僅一名執行者**，不明 owner／同檔競寫先停止。保留未提交資料、學生原檔；不部署、發布或操作帳號。

## Procedure / 步驟
1. 在本目錄執行 `python3 scripts/state.py next`，先處理 `verify`／`recover`；`running` 中斷時查 Git、檔案及證據，勿盲目重做。
2. 只讀 `tasks/<item>.md`。核對依賴、卡片範圍與實際程式；`python3 scripts/state.py start <item>` 後執行。
3. 將 HEAD、dirty、修改、命令、退出碼、證據及未測項寫入證據檔，再執行 `python3 scripts/state.py done <item> --evidence <絕對路徑>`。工具只驗證檔案存在，執行者須核實內容及驗收。
4. 可選項只依卡片決策以 `python3 scripts/state.py skip <item> --evidence <決策檔絕對路徑>` 結案。暫停時以 `block <item> --reason <原因>` 記錄。`summary` 查全局；持續依序處理就緒項。

## Verification / 驗證
卡片所有驗收通過才標 done；無法執行的子檢查記 `not-run`。完成後核對相依項、各項證據與原計畫；模型、真人、瀏覽器及部署的未測項不可冒充 pass。

## Output / 輸出
每次交接寫 item、狀態、證據位置、未測項與下一個精確動作。狀態檔是執行紀錄，原計畫是需求參考。

## Failure / 失敗與重試
結果不明用 `uncertain <item> --reason <原因>`，恢復時優先查證；確認成功後 `done`，確認未執行才 `retry`。暫態錯誤最多重試兩次；權限拒絕、目標不明或衝突先 block。

## Side Effects / 停止條件
工具採原子替換，但非鎖或交易系統；不覆寫狀態、不並行寫入。遇衝突或無法驗證即停止該項。原計畫未授權自動登入、傳送作品或外部發布。
