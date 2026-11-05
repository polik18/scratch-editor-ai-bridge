# 計畫拆分與驗證紀錄

- 日期：2026-11-05；方法：Longtask Architect v2；此為專案內工作流程，未安裝或覆寫全域技能。
- 原計畫：18,113 bytes、7,941 字元，按架構工具粗估約 6,231 tokens；原文備份為 `references/original-plan.md`，SHA-256 `582778dc2ed54e9eda73b9da408858f8b31a0ff8197335d326bc54828c189755`。
- 改寫後：計畫入口 743 bytes、粗估 227 tokens；工作流程入口 2,562 bytes、粗估 811 tokens；另有 20 張按需讀取的卡片。估算依技能驗證器公式，非實際模型 tokenizer。
- 映射：T0–T4、G0–G2 全保留於 `tasks/`；完整需求保留原計畫。G2 與 T3 為有條件工作，G1b 無缺口可跳過。進度獨立於卡片的 `state.json`，所有項目初始 pending，下一項 T0a；不宣稱任何工程已完成。
- 確認：`validate_architecture.py ... --orchestrator --json` PASS，0 errors、0 warnings；`python3 scripts/test_state.py` PASS：覆蓋重複初始化、依賴、running 中斷恢復、verify_pending 優先、證據、skip、block 和 retry。測試使用暫存狀態，不修改正式狀態。
- 限制：狀態工具使用 Python 3 標準庫與原子置換，但**不提供跨程序鎖**、不核實證據內容、不自動判斷可選決策、也不連到其他工作樹的 checkpoint。執行者須維持單一寫入者、先讀各卡判斷條件並核實證據。狀態檔位於 `gh-pages` 工作樹，不會自動出現在 `main` 工作樹或部署網站；跨工作樹接手必須沿用同一路徑，不得新建第二份進度。
- 回復：保留現有狀態及其他工作樹後，可將 `references/original-plan.md` 複製回上一層 `SCRATCH-TUTOR-IMPROVEMENT-PLAN-2026-11-05.md`；不要刪除任何後續產生的進度與證據。
