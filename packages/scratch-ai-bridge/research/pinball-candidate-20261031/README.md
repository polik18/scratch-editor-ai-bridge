# 彈珠台候選稿（未驗收）

此目錄保存 2026-10-31 的候選稿，沒有覆蓋原有 `PinballGame.sb3` 或 session。`pinball-draft.json` 是 Canonical IR，`pinball-draft.sb3` 由 generator 產生，`create-draft.py` 是產生 JSON 的實驗腳本，輸出到 `/tmp/pinball-draft.json`。

SB3 通過 generator 的結構、素材 MD5、VM 載入與重新儲存檢查，並不代表遊戲已完成。GUI 匯入後停在 Loading Project；移除所有積木、補上 layerOrder、替換舞台為已知可載入的 PNG 後，候選副本仍未完成載入。比較用的 `draggable.sb3` 使用相同 `open-camofox` 路徑可載入。GUI 錯誤事件未提供原因，尚須繼續縮小素材、target 與 VM／GUI 差異；不得稱候選稿可玩或將其用作驗收產物。

候選 SB3 SHA-256：`e3bb2fe4a3b85ed44c41bc49c95a3bc5b020368dc6bee7b1f06875779f524be6`。鍵盤、碰撞、分數、生命與遊戲結束仍未經實際行為測試。

## 後續縮小範圍及改良版

已知有效的 Scratch fixture 只換成球形 SVG（缺少 `viewBox`）時也卡住；同一 SVG 加入 `viewBox="0 0 22 22"` 後即能載入。原 webpack 開發伺服器對跨來源資源設定了 `Cross-Origin-Resource-Policy: same-origin`；缺少 viewBox 時會啟動 opaque iframe 測量路徑。針對此開發伺服器的修正已測試，跨瀏覽器驗證尚未完成。

後續已在隔離的 8602 開發服務修正並驗證此 fixture 能載入；原本執行中的 8601 未重啟，詳見 [後續執行紀錄](followup-report.md)。更新版 `PinballRefined.sb3` 修正同一碰撞物持續接觸會重複計分的問題，原 `PinballImproved.sb3` 保留。

`pinball-improved.json` 和 `create-improved.py` 是加上 viewBox、畫面和計分顯示的新版本來源；SB3 位於 `packages/scratch-ai-bridge/PinballImproved.sb3`，SHA-256 為 `69774e34c08ef9ecf39bddd842137f3c14d7c7445ab5b787cad9e2eeb4202000`。使用 `open-camofox --caller codex` 已載入並按綠旗；觀察到球位置變化、分數由 0 增加、生命由 3 減為 2。前一版相同彈板腳本以模擬鍵盤事件測得左彈板方向 60、右彈板方向 120。`camofox-stage.png` 為改良版畫面。

此作品是可供體驗的初版，尚未完成真實 Hermes caller、實體鍵盤、每種碰撞及完整遊戲結束後重新開始的系統性驗收；彈板以座標及按鍵狀態判斷反彈，並非物理引擎。

VM 自動測試另已驗證球移動、左右按鍵驅動彈板、三次落球至生命歸零，以及綠旗重新開始時生命與分數重設。測試不含真實鍵盤或有渲染器的碰撞判斷。

Hermes 可使用獨立暫存工作目錄開啟，避免覆蓋既有 `.scratch-session.json`：

```sh
scratch_pinball_dir=$(mktemp -d /tmp/scratch-pinball-session-XXXXXX)
cd "$scratch_pinball_dir"
node /Users/huangjianzhe/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge/bin/scratch-session.mjs load /Users/huangjianzhe/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge/PinballRefined.sb3
node /Users/huangjianzhe/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge/bin/scratch-session.mjs open-camofox --caller hermes --url http://127.0.0.1:8602/
```

Scratch GUI 與 Camoufox 必須先啟動；8602 是本次臨時測試服務，若已停止，需在 `packages/scratch-gui` 執行 `npm run start -- --host 127.0.0.1 --port 8602`。命令輸出的 task 名稱供後續 Camoufox 操作使用；再操作時重新依規則檢查狀態並取得同一 task 的 lease。綠旗開始，左右方向鍵操作彈板。GUI 修改不會自動寫回 SB3；另存再重新載入的整個流程仍待驗證。
