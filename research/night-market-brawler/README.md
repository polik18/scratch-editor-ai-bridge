# 夜市狂戰夜 · Night Market Mayhem — 企劃書

> 一款以臺灣夜市為舞台的單人街機式快打（single-player street fighter）。
> 用 `scratch-editor-ai-bridge` 的 `build-night-market.py` 產生 Canonical IR，再經 CLI `generate` 編成可玩的 `.sb3`。

## 1. 一句話概念
你是穿梭在鬧夜市的送餐小哥，用街機式的連擊與必殺，一路打穿四間被「美食大帝」控制的攤位，吃到终极美食。

## 2. 類型與平台
- 類型：單人清版/格鬥快打（beat-'em-up / street fighter 精神），2.5D 頂棚視角。
- 平台：Scratch 3.0（`.sb3`），可於 scratch.mit.edu 或桌面編輯器開啟。
- 單機單人，Green Flag 重試。

## 3. 核心玩法循環（fun loop）
打敵 → 疊「食力」滿槽 → 放必殺 → 清波前進 → 擊敗攤販 BOSS → 下一波難度遞增。
打擊感靠三招：**命中停格（hit-stop）＋擊退（knockback）＋被擊閃光**，不靠美術精緻度。

## 4. 操作（_KEYBOARD_）
| 按鍵 | 動作 |
|---|---|
| 左/右方向鍵（或 A/D）| 左右移動 |
| 上方向鍵（或 W）| 跳躍 |
| F 或 Z | 普通攻擊（可連段）|
| Space 或 X | 必殺（食力滿 100 才可用，耗 60）|
| Green Flag | 重開始 |

## 5. 角色與敵人（波次 = 不同攤販）
- **玩家「夜市小哥」**：藍色系送餐員，可跳躍、連擊、必殺。
- **敵人（每波一個，外觀重塗）**：
  | 波次 | 攤販 | 血量 | 速度 | 傷害 | 攻擊距離 |
  |---|---|---|---|---|---|
  | 1 | 臭豆腐大叔 | 60 | 2.0 | 8 | 50 |
  | 2 | 蚵煎阿伯 | 80 | 2.5 | 10 | 50 |
  | 3 | 珍珠奶茶姐 | 100 | 3.0 | 12 | 55 |
  | 4（Boss）| 终极美食大帝 | 150 | 3.5 | 15 | 60 |

## 6. 系統機制
- **血量**：玩家 100；敵人依波次。歸零即當波清關／玩家敗北。
- **食力（必殺槽）**：普通攻擊 +8、必殺攻擊 +12；滿 100 可放必殺（耗 60，傷害 35、距離 70）。
- **波次**：清一波換一攤販外觀與數值；清完第 4 波出勝利。
- **跳躍**：僅作走位與打擊節奏（攻擊仍以水平距離判定，降低碰撞複雜度）。

## 7. 關卡與進度
單關卡、4 波。每波開始由「導演」Sprite 重置敵人血量/速度/距離並重塗外觀；玩家偵測敵人血量≤0 時廣播 `enemyDefeated` 推進波次。

## 8. 視覺與音訊
- 場景：夜市背景（紅燈籠、攤位遮棚、夜市招牌）。
- HUD：四獨立即面——玩家血條、敵人道血條、食力條、波次/攤販名。
- 打擊回饋：擊退＋被擊閃光＋`HIT!` 彈字＋命中停格。
- 音訊：v1 先用視覺回饋；音效為後續增強項目（需嵌入 wav 資產與 MD5 校驗）。

## 9. 技術實現（本專案工具鏈）
1. `research/night-market-brawler/build-night-market.py` 產生 `canonical.json`（Canonical IR v1）。
2. `npm run cli --workspace=@scratch/scratch-ai-bridge -- generate canonical.json --out night-market.sb3 --report report.json`。
3. 過閘：`canonical-schema-validation`、`scratch-vm-load/save/reload`、`project-json-validation`、`asset-presence-and-md5`。
4. `--preview stage.png` 確認場景渲染。
5. 最終 `.sb3` 輸出至工作區以外路徑（遵循「資產與產出檔不混在專案內」原則）。

## 10. 範圍與里程碑
- M1（本交付）： combat（連擊/必殺）＋ AI 敵人＋4 波＋HUD＋跳躍＋基本打擊感。
- M2（待辦）：音效、多敵人同屏、通關後關卡選擇、高分榜。

## 11. 已知限制（生成器合約）
- 角色由固定 SVG 參數化生成；`generate-costume.py` 的本機 oMLX 僅支援 circle/ellipse/rect，不保證高品質插畫。
- 碰撞依固定水平座標與高度計算，非任意地圖碰撞引擎。
- 本產出為結構/VM 閘通過的靜態驗證；實際手感需人工實測。
