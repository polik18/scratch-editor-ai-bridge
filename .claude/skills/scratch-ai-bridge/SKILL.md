---
name: scratch-ai-bridge
description: 用 Scratch AI Bridge 做 Scratch 遊戲（.sb3）、寫 Game Spec、修改 Bridge 網頁中開著的作品、分析學生的 .sb3。使用者說「做一個 Scratch 遊戲」「做成 sb3」「分析這個 sb3」時使用。
---

# Scratch AI Bridge

完整入口：`packages/scratch-ai-bridge/AGENTS.md`。以下是最短的用法，指令都在 `packages/scratch-ai-bridge` 執行。

- **不要自己寫 `project.json`、`.sb3` 或積木 JSON。**
- 工具失敗時，照 `feedback` 中「→」後面的建議修改，再執行一次。
- 做出來的東西都在 `output/`；不要在套件最上層新增檔案。

## 做新遊戲

如果你自己可以寫 JSON（建議）：

1. `npm run --silent cli -- guide`：讀格式。
2. 依需求寫一個 Game Spec，存成 `output/games/<名稱>/<名稱>.spec.json`。
3. `npm run --silent cli -- spec output/games/<名稱>/<名稱>.spec.json --playtest`
4. 報告的 `status` 是 `success`，而且 `playtestStatus` 不是 `fail`，就完成了，`.sb3` 在同一個資料夾。
   否則照 `feedback` 修改 JSON，在第 3 步的指令加上 `--force` 重建。

如果要交給本機模型寫：

```sh
npm run --silent cli -- make "<一句話需求>" --playtest
```

有連上 MCP 的話，也可以直接呼叫 `make_game` 工具，參數 `spec` 放 Game Spec JSON。

## 其他用途

- **修改網頁中開著的作品**：MCP `inspect_project` → `propose_live_patch`，由使用者在網頁上確認。
- **分析作品**：`npm run --silent cli -- inspect <檔案.sb3> --format student-markdown`
- **清掉做遊戲的過程檔**：`npm run --silent cli -- clean`
