# T4a：教學工程整合驗收

## 輸入與前置條件
依賴：T2c,T3b。先讀入口 SKILL.md、狀態摘要及本卡；原計畫只按需讀相應段落。確認 source HEAD、dirty 與寫入範圍；未通過依賴不得開工。

## 工作
在 source 執行對應單元測試、student flow、browser smoke、package tests、build、lint；記錄環境、exit code 和 baseline。

## 驗收與輸出
每項 pass／fail／not-run（原因）；修復本次新增錯誤，不能把歷史測試當本次通過。
記錄具體命令、退出碼、檔案與客觀證據；尚未執行項標 not-run。先寫交接證據，再將狀態設為 done。

## 失敗與恢復
保留其他人的修改；中斷或結果不明先查證再繼續。禁止覆寫原始作品、部署、對外發布或操作帳號。完整限制見入口與原計畫。
