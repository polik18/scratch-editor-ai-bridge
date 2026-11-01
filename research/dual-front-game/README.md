# Dual Front 範例

`build-dual-front.py` 在此目錄產生 `dual-front-v2.canonical.json`；兩者均是可重產的雙人戰鬥範例。檔案建立後，使用 scratch-ai-bridge CLI `generate` 轉換為 SB3。玩法以 `packages/scratch-ai-bridge/tests/game/dual-front-behavior.test.ts` 的 Scratch VM 測試為準；GUI 操作與監視器呈現仍需另行驗證。

P1：A/D 移動、Q 切換、F 攻擊；P2：左右方向鍵移動、上切換、下攻擊。兩種模式只改外觀。生命值、勝負、重置與 0.35 秒冷卻由遊戲腳本處理。

## 產生客製版本

```sh
python3 research/dual-front-game/build-dual-front.py --out /tmp/custom-arena.json --name 'Custom Arena' --damage 20 --speed 8 --reach 65 --cooldown 0.2
npm run cli --workspace=@scratch/scratch-ai-bridge -- generate /tmp/custom-arena.json --out /tmp/custom-arena.sb3 --report /tmp/custom-arena.report.json
```

`--damage` 可為 10、20、25、50、100；`--speed` 為 1–30；`--reach` 為 10–150；`--cooldown` 為 0.1–3 秒。血條以傷害數值同步調整級距，保證由 100 扣至 0。產生器會覆寫 `--out` 所指的 JSON；請先選擇新路徑。未指定參數時使用原有 V2 設定。以上是雙人近距離格鬥模板；角色外觀與鍵位固定，不代表能由任意文字生成各種遊戲。

## 平台遊戲原型

`build-platformer.py` 產生 `platformer.canonical.json`，預設角色可用左右鍵移動、空白鍵跳躍，跨越缺口抵達旗幟。落入缺口會重生，綠旗重設。例：

```sh
python3 research/dual-front-game/build-platformer.py --out /tmp/sky-gap.json
npm run cli --workspace=@scratch/scratch-ai-bridge -- generate /tmp/sky-gap.json --out /tmp/sky-gap.sb3 --report /tmp/sky-gap.report.json
```

生成器可指定 `--speed`（4–12）及 `--jump`（10–18），它們控制不同遊戲平衡；跨越缺口的 VM 測試目前只覆蓋預設設定。地形碰撞是依固定水平座標與高度計算，並非一般任意地圖碰撞引擎。生成器會覆寫 `--out` 所指 JSON。GUI 操作尚待實測。

## 以本機 oMLX 產生角色

`generate-costume.py` 將描述送到固定的 `127.0.0.1:8000` oMLX，不呼叫外部付費服務。它請模型輸出有限幾何形狀的 JSON，再檢查形狀類型、數量、座標與顏色，最後由本機程式輸出不含腳本或外部資源的 SVG。需要已啟動的本機 oMLX 與認證；`--use-local-settings` 只在記憶體讀取 `~/.omlx/settings.json` 中的本機金鑰，也可透過 `OMLX_API_KEY` 環境變數提供。程式不顯示或保存金鑰。

```sh
python3 research/dual-front-game/generate-costume.py --description '藍色機器人戰士，圓眼睛，金色胸章' --use-local-settings --out /tmp/new-robot.svg --save-spec /tmp/new-robot.json
python3 research/dual-front-game/build-dual-front.py --out /tmp/new-game.json --p1-spec /tmp/new-robot.json
npm run cli --workspace=@scratch/scratch-ai-bridge -- generate /tmp/new-game.json --out /tmp/new-game.sb3 --preview /tmp/new-game.png
```

可指定 `--model`；預設採 oMLX 健康端點回報的預設模型。模型輸出不符合規格時會報錯而非假裝成功；請人工檢查造型。支援的幾何圖形僅 circle、ellipse、rect，無法保證理解所有描述或產生高品質插畫。`--spec` 可重現先前的 JSON，無須再次呼叫模型。戰鬥模板依同一規格建立明、暗與攻擊變體，以維持基本外形一致；模型不會自動設計專業動畫。範例 `robot-example.shapes.json` 為實際本機模型輸出，可直接重播。產生的 SVG 尺寸與旋轉中心固定為 100×110、(50,55)。
