# 星港守衛：裂隙遠征

以 `@scratch/scratch-ai-bridge` Canonical IR compiler 建立的 Scratch 3 射擊遊戲原型。可下載作品：[starport-rift-expedition.sb3](./starport-rift-expedition.sb3)。遊戲規格在 [Canonical IR 輸入](./starport-rift-expedition.canonical.json)；另一份較高階的 GameDesign 設計檔保留在 [starport-rift-expedition.json](./starport-rift-expedition.json)，用來重現 `newGame` 設計轉換的子堆疊問題。

## 遊戲玩法

- 綠旗啟動作戰、初始化玩家位置及遊戲狀態。
- 左／右方向鍵移動巡防艇，空白鍵廣播發射脈衝。
- 脈衝彈上升，碰到掠奪者時廣播命中並隱藏；命中增加 10 分。
- 掠奪者持續橫向巡航，到達舞台邊界後折返並下降；接觸玩家時扣除護盾並重設敵機位置。
- 星核旋轉作為場景裝飾；舞台顯示分數、護盾、關卡及遊戲狀態變數，另有任務紀錄清單。

## 本次驗收

- Canonical IR semantic/schema validation：PASS（由 generator 編譯流程執行）。
- SB3 ZIP 可讀、`project.json` 存在：PASS。
- 初始專案內容：5 targets（Stage + 4 sprites）、9 scripts、48 個 archive block entries、4 variables、1 list、3 broadcasts、5 costumes。完成失敗/重開功能後的修訂版為 11 scripts、58 blocks。
- Costume archive entries 存在且 asset ID/MD5 一致：5/5 PASS。
- Bridge 靜態 inspect：status `ok`、coverage 100%、runtimeVerified `false`；摘要顯示 45 blocks。
- ZIP 實際 block entries 為 48；inspect 少 3。推測統計口徑排除了某些 shadow/menu blocks，但尚未定位或確認，列為待查缺陷。
- 尚未驗證 Scratch 網站匯入、VM 中實際按鍵遊玩、碰撞/計分時序，或玩家／敵機的畫面品質。VM 編譯曾輸出「No rendering module present; cannot load costume」警告，因此不宣稱視覺與玩法驗收完成。

## 工具呼叫摘要

在完成 repo 文件要求的 `npm run build:ai-bridge-deps` 後，以 `generateGame()` 匯入 Canonical IR 並產出 SB3。Node 首次呼叫在 `BitmapAdapter is not a constructor` 失敗；建置 workspace 相依套件後再次執行成功，但 VM 載入階段仍警告沒有 rendering module。generator 回傳成功並不包含 runtimeVerified gate。本目錄的 [archive audit](./archive-audit.json) 與 [inspect output](./inspect.json) 保存機器結果。
