# Paper Minecraft 真實作品相容性測試

日期：2026-11-02。Bridge commit `73ea966d87`。原檔使用者指定於桌面；SHA-256 `06280f5b0591da2e58f3aaed0be58e93dd8bc7848632a7327378d261357d1638`。測試產物另存 `/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/`，未覆蓋原作品；不將作品素材加入 repo。

## 規模與理解

CLI `inspect --format json` 成功讀取：Stage + 29 sprites、17,285 block entries、224 scripts、291 procedures、415 variables、47 lists、47 broadcasts、748 costumes、90 sounds。原始檔 746 ZIP entries。名稱和廣播可辨識地形生成（Generator、_Level、spawn chunk from seed）、處理器（Processor）、角色（Steve）、物品欄（_Inv、update inventory）、怪物（Mob）、存檔（Save Game、save game）等線索；這是根據結構與名稱的有限推斷，不證明理解細部遊戲規則。

CLI 分析狀態 `partial`，runtimeVerified false；輸出回報 8 項結構疑點，100% coverage 是該分析的計算口徑，不能等同玩法理解。報告有 2,663 條 evidence 因限制未輸出。完整機器報告見測試輸出目錄的 `inspect.json`，學生版為 `student-feedback.md`。

實際呼叫 raw AI 的 `inspectRawProjectForAi`：失敗，回報「作品摘要過大，請改用手動修改」。`src/core/ai/raw-tool-core.ts` 建立完整摘要後硬設 24,000 bytes 上限；此原始作品的 AI 摘要入口不可用。`inspectRawTargets`、`inspectRawVariables` 和部分 `inspectRawBlocks` 可分頁讀取；未呼叫真實模型、未驗證真實 MCP host 或完整網頁 AI 往返，不能聲稱 AI 已讀懂全部作品或能自主完成修改。

## 檢視與執行

原始 SB3 經 `loadSb3` 載入成功（此 Node VM 不附 renderer/audio，故不代表視覺、音效通過）。Bridge 的 Chromium `captureRendererPreview` 載入、啟動 VM 並實際繪製 480×360 遊戲主選單，截圖 `original-stage.png`。另在同一 preview iframe 單次快速點擊 New Game 後等 4 秒，畫面仍是主選單；無法據此判定是點擊時序、座標、作品或 Bridge 原因，需後續受控重試。沒有完整遊玩或驗證改動後的行為效果。

## 修改與保留

1. 以 `proposeRawLivePatch` 修改 `Steve.size` 220.00000000000003 → 90，匯出 `paper-minecraft-size-test.sb3`。重新使用 VM 載入成功；獨立比對 ZIP 內 745 個非 project.json entry 的解壓內容 SHA-256 全相同，project.json 僅該欄位不同。此設定可能被作品初始化腳本覆寫，不能宣稱實際角色尺寸生效。
2. 同 API 修改 `Tiles` 中 `go` 廣播處理流程的 `control_wait`，0.5 → 0.75 秒；`paper-minecraft-wait-test.sb3` 可被 VM 載入，745 個非 project.json entry 內容相同，project.json 僅一個等待值不同；提案正確標示 requiresVmValidation。此為可逆的技術測試，不宣稱已觀察到預期行為變化。
3. `inspectRawBlocks` 可讀取 Processor、Steve Legs2、Tiles、Cursor；Generator、Steve、Save Game 因既有 graph issue 被拒絕，不能在該入口進行積木提案。保護機制因此限制了修改範圍，不表示所有告警都是真實損壞。

## 具體缺陷與優先事項

- **合法積木格式誤報**：Generator 的 `99:s=?*y)HH/H;oYaEvm` 為 `[12,"seed",...,465,625]`，是 Scratch VM `src/serialization/sb3.js` 支援反序列化的頂層變數 primitive，Bridge `extractProjectBlockGraphs` 卻把所有非物件 entry 當成 `invalid-node-property`。另外兩個同類項目在 Steves Head、Save Game；使分析降為 partial 並阻擋整個 target 的積木修改。應補支援與真實 fixture 回歸，完整保留原始 tuple。
- **5 個 argument reporter 警告已逐一驗明（P1b）**：
  1. `Generator`（target 2）積木 `K.k8ww!U.q|?*|+`ljL2`（`argument_reporter_string_number`，`VALUE: "tileIdx"`）：父鏈為 `K.k8ww!U.q|?*|+`ljL2` → `JF{cTxN4*F]GQ0fQPAJ8`（`data_addtolist`，`topLevel: true`，`parent: null`），為畫布上未連接 `procedures_definition` 的孤立雙積木片段（同角色另有原型 `I7R@~iwU:`0BSO^bB9!c` 宣告 `tileIdx`）。
  2. `Generator`（target 2）積木 `uf?!oA^T!3Tdym[]^rO}`（`argument_reporter_string_number`，`VALUE: "waterLevel"`）：父鏈為 `uf?!oA^T!3Tdym[]^rO}` → `)mC_Tfag+fxP){|at[Al`（`operator_equals`）→ `}17rUyU,wGEB`]7iN{`E`（`operator_and`）→ `B`gpFC]S=AHlH4*A:03G`（`control_if_else`，`topLevel: true`，`parent: null`），為畫布上未連接定義的孤立條件片段。
  3. `Steve Arm`（target 4）積木 `t?7)[}a7Yg-Q4iZ=_T1K`（`argument_reporter_string_number`，`VALUE: "a"`）：`topLevel: true`、`parent: null` 的單一孤立參數積木，該角色無宣告 `"a"` 之自製積木定義。
  4. `Steve`（target 5）積木 `Y~32/rJ7Mc|58lIXr)^3`（`argument_reporter_boolean`，`VALUE: "or"`）：父鏈頂層為 `)xQQ^]upbA@2w,C1nEGZ`（`control_if`，`topLevel: true`，`parent: null`），為畫布上未接定義的孤立片段。
  5. `Steve`（target 5）積木 `y(?/!b7/6,doX1Om+v;+`（`argument_reporter_boolean`，`VALUE: "or"`）：父鏈頂層為 `gI^@4dR`!1nY=n/5x5};`（`control_if`，`topLevel: true`，`parent: null`），為畫布上未接定義的孤立片段。
  結論：五處皆為原作者留在角色畫布上的未連接草稿／孤立積木，並非 `procedures_definition` 解析錯誤。`validateScratchBlockGraph` 維持 `invalid-argument-reporter` 檢出以守住圖完整性，不為壓低警告數放寬檢查。
- **AI 摘要上限與分頁檢索已解決（P2a／P2b）**：`inspectRawProjectForAi` 已實作 24 KB 確定性預算截斷（Paper Minecraft 實測 `23,882 bytes`），搭配 `inspectRawTargets`、`inspectRawVariables`、`inspectRawBlocks` 之 `offset`／`limit`／`blockId`／`opcode`／`query` 篩選，可精準定位重名角色、廣播接收積木（如 `Tiles` targetIndex 8 之 `lj]*DFqPVaZX,,@-u6zl`）與自製積木定義。
- **回饋定位與去重已完成（P3）**：`createProjectFeedback` 已將同角色多段 `detached-script` 合併為每角色單一回饋項目並附上腳本數與完整 evidence IDs（Paper Minecraft 的 `detached-script` 回饋項目由 59 筆重複項目收斂為 18 筆依角色彙整項目），並明確區分畫布孤立參數積木與有效自製積木錯誤。
- **修改生命週期、覆寫警告與可重現行為已驗證（P4）**：`proposeRawLivePatch` 新增腳本覆寫偵測（當修改之初始屬性或變數在同角色／全域腳本中有 `motion_setx`、`data_setvariableto` 等覆寫積木時，於候選 diff 主動發出警告）。已針對 Paper Minecraft `Stage Sprite`（`targetIndex: 28`）建立固定選單態（`Splash-1b`）綠旗初始化之 before/after VM 實證（`/Users/huangjianzhe/Projects/paper-minecraft-bridge-audit/p4-scenario-result.json`）：`_MaxHarvest` 由 `10` 改為 `25`、`_Lighting?` 由 `1` 改為 `0` 後於 VM 執行生效，且桌面原檔 SHA-256 保持 `06280f5b0591da2e58f3aaed0be58e93dd8bc7848632a7327378d261357d1638` 不變。
- **瀏覽器匯入與分析效能大幅提升（U0／U2）**：消除 `decodeProcedures` 逐程序深拷貝積木圖（$O(P \times B) \to O(B)$）、`decompileSb3WithBlockGraphs` 重複呼叫 `projectJsonToCanonical`，以及 `renderAnalysis` 逐腳本線性掃描 evidence。Paper Minecraft 5 次冷／暖基準實測（`browser-baseline-v2.json` → `browser-after-u2.json`）：冷快取中位數由 `8,437 ms` 降至 `2,812 ms`（**-66.7%**），最長主執行緒 longTask 由 `4,321 ms` 降至 `809 ms`（**-81.3%**）；暖快取中位數由 `8,388 ms` 降至 `3,129 ms`（**-62.7%**），最長 longTask 由 `4,297 ms` 降至 `900 ms`（**-79.1%**）。
- **素材來源精確比對（A0／A1）**：新增 `src/core/visuals/catalog.ts` 對照同 repo Scratch GUI 角色／造型／背景／音效 catalog（343 角色、915 造型、85 背景、354 音效）。Paper Minecraft 盤點維持 748 個造型參照（0 個 catalog 精確匹配、748 個內嵌非 catalog 素材，0 缺檔）與 90 個音效參照（25 個 Scratch 官方 catalog 精確匹配、65 個內嵌非 catalog 音效，0 缺檔）。

## 結論

Paper Minecraft 原作品在 P0–P5、U0–U2、A0–A1 修復後：合法頂層變數／清單 tuple 不再誤報（結構疑點 8→5，剩餘 5 處全數驗明為原作者畫布孤立草稿積木），AI 摘要在 24 KB 預算內穩定輸出並支援關鍵字分頁檢索，回饋去重且具定位依據，候選修改具備腳本覆寫警告與 VM 前後行為實證，瀏覽器匯入分析耗時縮短超過 62%，且 fake provider（4/4）與本機真實模型 `Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e`（5/5，含 Paper Minecraft `Tiles` 角色積木檢索與修改提案）端到端驗證全數通過。
