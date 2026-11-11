> **2026-11-02 更新**：本檔以下為原始交接快照。生成器已修正至可編譯，並產生通過結構與 VM 載入檢查的實驗 SB3（`/Users/huangjianzhe/Projects/night-market-brawler-output/`）；玩法未經 VM 情境或人工驗收。使用者已指定主要目標為 Bridge 專案維護，遊戲僅為實驗。最新診斷見 `packages/scratch-ai-bridge/docs/history/DIAGNOSIS-2026-11-02.md`。

# 夜市狂戰夜 · Night Market Mayhem — 技術交接計畫

> 單一權威交接檔。承接「企劃街頭快打遊戲 → 用 `scratch-editor-ai-bridge` 做出可玩 Scratch 遊戲」此一請求。
> 設計細節見同目錄 `README.md`（企劃書）；本檔聚焦**工程狀態、工具鏈知識、已知問題、交接下一步**。

---

## 0. 檔案位置與目前狀態

| 檔案 | 狀態 |
|---|---|
| `packages/scratch-ai-bridge/research/night-market-brawler/README.md` | ✅ 已完成。完整企劃書（概念、玩法、波次、機制、技術實現）。 |
| `research/night-market-brawler/build-night-market.py` | ⚠️ **未完成**。生成器程式碼已寫完（約 360 行），但**未通過編譯**，從未成功產出任何 `.sb3`。 |
| `research/night-market-brawler/canonical.json` | ❌ 不存在。生成器沒跑成功過。 |
| `research/night-market-brawler/night-market.sb3` | ❌ 不存在。從未產出。 |

**結論**：遊戲的「企劃」與「生成器程式碼」都已完成初稿，但**工具鏈最後一哩路（生成器編譯通過 → 產生 .sb3 → 過閘）尚未完成**。這是交接時最需要優先處理的。

---

## 1. 整體計畫（Game Design Summary）

**一句話**：玩家是穿梭夜市的送餐小哥，用街機式連擊與必殺，打穿四間被「美食大帝」控制的攤位。

- **類型**：單人清版 / 格鬥快打（beat-'em-up / street-fighter 精神），2.5D 頂棚視角。
- **平台**：Scratch 3.0（`.sb3`），可在 scratch.mit.edu 或桌面編輯器開啟。單機單人，Green Flag 重試。
- **fun loop**：打敵 → 疊「食力」滿槽 → 放必殺 → 清波前進 → 擊敗攤販 BOSS → 下一波難度遞增。
- **打擊感三招**：命中停格（hit-stop）＋擊退（knockback）＋被擊閃光 —— 靠機制不靠美術精緻度。
- **操作**：左右/WASD 移動、上/W 跳躍、F/Z 普通攻擊連段、Space/X 必殺（食力滿 100 耗 60）、Green Flag 重開始。
- **敵人 4 波**：臭豆腐大叔(HP60)、蚵煎阿伯(HP80)、珍珠奶茶姐(HP100)、終极美食大帝 Boss(HP150)。
- **系統**：血量、食力必殺槽、波次、跳躍、HUD（玩家血條/敵人道血條/食力條/波次攤販名）。

設計已完整寫在 `README.md`，交接時不需重做設計，只需把生成器跑通。

---

## 2. 工具鏈與已驗證的 opcode 映射（重點知識）

本專案的 `scratch-vm` 用**非標準** Scratch opcode 命名，直接照官方文檔會錯。以下為已驗證（verified）的項目：

### 已驗證 opcode（專案實際命名）
| 用途 | 專案 opcode | 備註 |
|---|---|---|
| 比較/算術 | `operator_gt`、`operator_lt`、`operator_add`、`operator_subtract`、`operator_round`、`operator_divide`、`operator_not`、`operator_and`、`operator_or` | 注意是 `gt/lt` 而非 `eq` |
| 移動 | `motion_xposition`、`motion_yposition`、`motion_changeyby`（input `DY`）、`motion_sety`（input `Y`）、`motion_move`（input **`motion_movesteps`**）、`motion_changexby`（input `DX`）、`motion_pointtowards`（input `TOWARDS`） | `motion_move` 的步數 input 是 `motion_movesteps` |
| 外觀 | `looks_switchcostumeto`（input `COSTUME`）、`looks_hide`、`looks_show`、`looks_changeeffectby`（**field `EFFECT`** + **input `CHANGE`**） | ghost 閃光用 `EFFECT=ghost`, `CHANGE=±40` |
| 感應 | `sensing_keypressed`（**field `KEY_OPTION`**）、`sensing_distanceto`（input `DISTANCETOMENU`） | 按鍵要設 `KEY_OPTION` field |
| 廣播 | `event_broadcast`（input `BROADCAST_INPUT`）、`event_whenbroadcastreceived`（**field `BROADCAST_OPTION`**） | 接收要設 field |
| 變數 | `data_setvariableto`（input `VALUE`）、`data_changevariableby`（**field `VARIABLE`** + input `VALUE`） | 改數要設 `VARIABLE` field |
| 控制 | `control_if`（`CONDITION`/`SUBSTACK`）、`control_if_else`（`SUBSTACK2`）、`control_forever`（`SUBSTACK`）、`control_wait`（`DURATION`） |

### IR 格式（Canonical IR v1）
- `project['blocks']` 為 dict（block id → block 定義），`project['scripts']` 為「頂塊 id 清單」。
- 變數讀取用 `var(name)`；compiler 會把高層 `var()` 轉成 `data_getvalue` tuple。
- 每個 `scripts` 項目需配 `position: {x, y}`。

### 生成與驗證流程（已證實可走通）
```
python3 build-night-market.py --out canonical.json --name "Night Market Mayhem"
npm run cli --workspace=@scratch/scratch-ai-bridge -- generate canonical.json \
  --out night-market.sb3 --report report.json --preview stage.png
```
- **過閘判定**：`report.json` 的 `status` 為 `"success"`，且 `gates` 中 `canonical-schema-validation`、`scratch-vm-load/save/reload`、`project-json-validation`、`asset-presence-and-md5` 均為 `status: success`。
- **重要**：`build-dual-front.py`（同 research 目錄）已證實能完整走通這條流程並產生合法 `.sb3`，代表工具鏈本身沒問題，只是夜市的生成器還沒跑通。

---

## 3. 目前進度

- [x] 企劃書 `README.md`（概念到技術實現皆備）。
- [x] 生成器 `build-night-market.py` 初稿（含 Player / Enemy AI / HUD / 波次導演 / 場景 Sprite）。
- [x] 已驗證 toolchain 可交付（dual-front 模板走通）。
- [x] 已記錄專案非標準 opcode 命名與 IR 格式。
- [ ] 生成器編譯通過（**目前卡在此**）。
- [ ] 成功產出 `canonical.json`。
- [ ] 成功產出 `night-market.sb3` 並過閘。
- [ ] 實際手感人工實測（靜態閘通過不等於手感 OK）。

---

## 4. 已發現問題（Problems Encountered）

### P1（致命 · 當前阻塞）：生成器未編譯通過
`python3 -m py_compile build-night-market.py` 回報：
```
SyntaxError: invalid syntax  (line 182, col 5)
```
根因（已量化）：全檔 `(` 457 個、`)` 453 個（**差 4**）；`]` 110 個、`[` 109 個（**差 1**）；`{}` 平衡。
即「死亡偵測區塊」（約 187–190 行）等處的**括號配對錯誤**（多開/多閉）。`py_compile` 把錯誤點推到 line 182 是因為上一個陳述未閉的 paren 延伸到下一行才被偵測到。

### P2（首版已修 · 備忘）
首版生成器曾有多處錯誤，均已重寫修正（勿再犯）：
- 未定義常數 `le`、`ENEMY_*`。
- 用錯 opcode `operator_sign`（專案無此 opcode）。
- `motion_move` 方向計算、director 未完成。
> 現行版本已是重寫後的乾淨版，只剩 P1 的括號問題。

### P3（次要 · 非真正門檻）
`validate-sb3.mjs` 曾回報「target 缺 id」。經查證這是**較嚴的獨立靜態檢查**，並非真正載入門檻——`generate` 回傳 exit 0（VM gates 通過）即代表可交付。交接時若見此訊息，**可忽略**，以 `report.json` 的 `status: success` 為準。

### P4（已知限制 · 設計層）
- 角色由固定 SVG 參數化生成；`generate-costume.py` 本機 oMLX 僅支援 circle/ellipse/rect，不保證高品質插畫。
- 碰撞依固定水平座標與高度計算，非任意地圖碰撞引擎。
- 跳躍僅作走位與打擊節奏；攻擊仍以水平距離判定（已刻意降低碰撞複雜度）。
- 音訊（wav 資產 + MD5 校驗）列為 M2 增強項，v1 先不做。

---

## 5. 交接下一步（接手人照此執行）

1. **修 P1**：在 `build-night-market.py` 中找到括號配對錯誤（建議從 line 160 的必殺區塊、187–190 的死亡偵測區塊開始逐區檢查 `(`/`)` 與 `[`/`]` 配對），使 `python3 -m py_compile build-night-market.py` 回傳 exit 0。
2. **跑生成器**：
   ```
   python3 build-night-market.py --out canonical.json --name "Night Market Mayhem"
   ```
   確認產生 `canonical.json`（應含 stage + 7 sprites + director）。
3. **編 .sb3 + 出報告**：
   ```
   npm run cli --workspace=@scratch/scratch-ai-bridge -- generate canonical.json \
     --out night-market.sb3 --report report.json --preview stage.png
   ```
4. **過閘判定**：解析 `report.json`，確認 `status == "success"` 且上述 gates 全 `success`。見 P3 對 `validate-sb3.mjs` 的說明。
5. **交付**：將 `night-market.sb3` 移至工作區以外（遵循「資產與產出檔不混在專案內」原則）。
6. **人工實測**：於 Scratch 開啟實測手感（連擊、必殺、跳躍、波次推進、打擊感三招），據此再微調 `build-night-market.py` 的數值常數。

### 微調參數位置（生成器頂部）
`WAVES`、`PLAYER_HP`、`PLAYER_SPEED`、`PLAYER_REACH`、`PLAYER_DMG`、`PLAYER_COOLDOWN`、`SPECIAL_*`、`JUMP_POWER`、`GRAVITY`、`ENEMY_*` 皆集中於檔案頂部常數區，改手感只需改這裡。

---

## 6. 里程碑與範圍

- **M1（本請求）**：combat（連擊/必殺）＋ AI 敵人 ＋ 4 波 ＋ HUD ＋ 跳躍 ＋ 基本打擊感。← **剩生成器跑通未達。**
- **M2（待辦）**：音效（wav 資產 + MD5）、多敵人同屏、通關後關卡選擇、高分榜。

---

## 7. 給接手人的三句話

1. 設計已定（見 `README.md`），工具鏈已證實可行（dual-front 走通），**唯一障礙是生成器的括號語法錯誤（P1）**。
2. 改完括號後，照第 5 節流程即可產出合法 `.sb3`。
3. 靜态閘通過不等於手感 OK，最後一步務必人工實測再交付。
