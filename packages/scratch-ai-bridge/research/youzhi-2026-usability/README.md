# 游智盃 30 題實作紀錄（2026-11-11）

用第八屆廣達游智盃「與我『河』關？」的 30 個提示詞（15 部動畫、15 個遊戲）實際測試 Scratch AI Bridge 的原始資料。
分析與改善清單見 `docs/history/YOUZHI-USABILITY-REPORT-2026-11-11.md`。

- `prompts.md`：30 個提示詞原文。
- `friction/group-1.md`～`group-6.md`：6 個大模型子代理各做 5 件，每件的結果、與提示詞的差距、不好用的地方、
  小模型可能卡住的地方和改善建議。
- `small-model/summary.json`：本地小模型（Cyber-Tiel-Coder-35B，關閉思考）用 `make`／`make --story`，
  最多修正 2 輪的結果。
- `small-model/attempts.json`：小模型每一輪的 feedback。

作品本身（`.sb3` 和描述檔）放在不進 git 的 `output/游智盃/games/`（大模型版）和 `output/游智盃-小模型/games/`（小模型版）。
