# SB3 端到端改善計畫 - 詳細執行計畫

**更新：** 2026-10-28  
**版本：** 1.0  
**狀態：** 已研究完成；本文件是實作計畫，所列功能均未驗收。

---

## 文件概述

本文件是 `sb3-end-to-end-improvement-plan.md` 的詳細執行版本，針對計畫中每一階段提供：

1. **目標重述**：明確的可驗收成果
2. **執行步驟**：分解為具體技術行動
3. **檔案修改清單**：需修改或新增的檔案路徑
4. **測試案例**：驗收所需的測試案例
5. **阻斷條件**：哪些問題必須先解決才能繼續

---

## P0：阻斷問題修正與 False Success 防止

### 1. 啟動 gate：靜態分析儀器建立

**目標：** 在 CLI 或 Web 任何「成功」訊號之前，先建立可靠的靜態驗證層。

**執行步驟：**

1. 建立專用 ZIP 檢查器 `src/cli/archive-validator.ts`
   - 檢查 ZIP 結構完整性
   - 驗證 `project.json` 唯一且位置正確
   - 驗證 Scratch project schema (可選：載入官方 JSON Schema)
   - 驗證每一 costume/sound 的 `md5ext` entry 存在
   - 驗證 asset bytes 的 MD5／format 相符

2. 建立 Graph Validator `src/cli/graph-validator.ts`
   - 驗證 target 範圍內 block IDs 唯一
   - 驗證 opcode 與必要資料存在
   - 驗證 `next`／input references 存在且互反
   - 驗證 parent 正確、topLevel 與 parent 一致
   - 驗證變數／清單／broadcast references 已宣告

3. 修改 CLI `src/cli/session-cli.ts`
   - 新增 `inspect` 子命令的 `--detail archive` 模式
   - 新增 `inspect --detail graph` 模式
   - 修改 `compile` 命令，新增 `--strict` 模式強制執行靜態驗證
   - 任何驗證失敗時 exit code = 1 且輸出 JSON diagnostic report

**需修改檔案：**
- `src/cli/archive-validator.ts` (新建)
- `src/cli/graph-validator.ts` (新建)
- `src/cli/session-cli.ts` (修改)

**測試案例：**
- `cyber-duel.sb3`：驗證缺少素材 entry
- `star-collector.sb3`：驗證缺少素材 entry
- `space-shooter.sb3`：驗證腳本未建立
- 自製 SB3：缺少 `project.json`、重複 entry、壞 MD5 hash

**阻斷條件：**
- 無法建立 archive validator 前，不得宣稱「完整 SB3」
- 無法建立 graph validator 前，不得驗證 block graph 正確性

---

### 2. 修復 `newGame` 設計欄位消耗問題

**目標：** `newGame` 必須完整消費設計檔中的所有宣告欄位，包括 scripts、lists、costumes、sprites 等。

**執行步驟：**

1. 檢查 `src/cli/game-cli.ts` 的 `generateGameFromDesign()` 函數
   - 目前只建立 sprites 與 variables
   - 需補足：scripts、lists、costumes、sprites 定義、blocks 數量

2. 建立設計檔轉 Canonical IR 的轉換器
   ```typescript
   // src/cli/design-to-ir.ts
   export function designToCanonicalIR(design: GameDesign): CanonicalProject
   ```
   - 將 spritesDef 轉為 Canonical sprites
   - 將 variables 轉為 Canonical variables (正確 ID key 格式)
   - 將 lists 轉為 Canonical lists
   - 將 scripts 轉為 Canonical scripts (正確 block graph)

3. 修改 `newGame` 流程
   - 從 design → Canonical IR → compile → SB3
   - 確保設計宣告的 blocks 數量與實際 SB3 一致
   - 確保 scripts、lists、costumes 被正確建立

4. 建立設計檔 Schema
   - 建立 `docs/game-design-schema.json`
   - 驗證 design JSON 檔案格式
   - 提供最小範例與錯誤診斷

**需修改檔案：**
- `src/cli/game-cli.ts` (修改)
- `src/cli/design-to-ir.ts` (新建)
- `src/cli/session/session.ts` (可能修改 addSprite/addVariable)
- `docs/game-design-schema.json` (新建)
- `docs/game-design-example.json` (新建)

**測試案例：**
- 最小設計 (1 sprite, 1 script, 1 variable)
- 平台遊戲設計 (多 sprites, 多 scripts, 多 variables)
- 設計宣告 8 sprites, 120 blocks → 驗證 SB3 有相同數量

**阻斷條件：**
- 無法正確轉換 design → Canonical IR 前，不得建立完整遊戲
- 變數格式不正確會導致後續 Canonical IR validation 失敗

---

### 3. 修復 Session 編譯路徑素材保留問題

**目標：** `loadSb3()` → `compile()` → `saveSb3()` 路徑必須保留既有作品素材 bytes。

**執行步驟：**

1. 修改 `src/cli/session/session.ts`
   - `loadSb3()` 必須保留 ZIP entries bytes (Raw Archive IR)
   - `compile()` 必須從 Raw Archive IR 取回素材 bytes，不只 metadata
   - `saveSb3()` 必須封裝完整 archive with all entries

2. 建立 Raw Archive IR 格式
   - 建立 `src/core/ir/raw-archive.ts` 定義 Raw Archive IR type
   - 包含：project.json、所有 ZIP entries、comment、warnings

3. 修改 Canonical → Scratch JSON 轉換器
   - `src/core/compiler/project-json.ts` 必須接受 Raw Archive IR 來源
   - 對於已有素材的 costumes/sounds，使用原始 bytes 而非自動生成
   - 對於缺少素材的 costumes/sounds，產生警告並自動生成

4. 建立素材對應表
   - `src/core/ir/assets.ts` 提供 asset ID → bytes 對應
   - 支援從 Raw Archive IR 取回素材 bytes

**需修改檔案：**
- `src/cli/session/session.ts` (修改 loadSb3/compile/saveSb3)
- `src/core/ir/raw-archive.ts` (新建)
- `src/core/compiler/project-json.ts` (修改)
- `src/core/ir/assets.ts` (新建)

**測試案例：**
- 載入含 PNG/SVG/WAV/MP3 的 SB3 → 編譯 → 保存 → 重新載入
- 驗證所有素材 bytes SHA-256 不變
- 驗證素材 md5ext 不變
- 驗證素材引用不變

**阻斷條件：**
- 無法保留素材 bytes 前，不得使用 session CLI 編輯既有 SB3
- 自動生成素材會導致作品失真

---

### 4. 修復 Session Block API graph reciprocity

**目標：** `addBlock()`、`attachBlockToHat()` 等低階 API 必須確保 block graph 的 next/parent/input 互反關係。

**執行步驟：**

1. 分析 `src/cli/session/session.ts` 的 block 相關 API
   - `addBlock()`：建立 block 時未同步更新 parent/next/input
   - `attachBlockToHat()`：只改 hat 的 next，不回填 body 的 parent

2. 建立 Block Graph Validator `src/cli/graph-validator.ts`
   - 驗證所有 block 的 next/parent/input 互反
   - 驗證 top-level block 的 parent = null
   - 驗證非 top-level block 的 parent ≠ null
   - 驗證所有 reference 的 block ID 存在

3. 修復 Block API
   - `addBlock()`：建立時檢查 parent/next/input 是否正確設定
   - `attachBlockToHat()`：同時更新 hat 的 next 與 body 的 parent
   - `addReporterToHat()`：同時更新 hat 的 inputs 與 reporter 的 parent
   - `removeBlock()`：遞迴更新所有相關 block 的 next/parent/input

4. 建立 Block Graph Patch API
   - `reconnectBlock(fromBlockId, toBlockId)`：設定 next 連線
   - `attachInput(blockId, inputName, targetBlockId)`：設定 input 連線
   - `moveBlockToParent(blockId, parentId, nextId?)`：設定 parent 與 next

**需修改檔案：**
- `src/cli/session/session.ts` (修改 addBlock/attachBlockToHat/removeBlock)
- `src/cli/graph-validator.ts` (修改：增加 graph validation functions)
- `src/cli/session/graph-api.ts` (新建：block graph patch API)

**測試案例：**
- 建立 stack of 3 blocks → 驗證 next/parent 互反
- 建立 reporter with parent → 驗證 parent = reporter
- 建立 if-reporter → 驗證 input 連線正確
- 移除 middle block → 驗證 next/parent 重新連線

**阻斷條件：**
- 無法確保 graph reciprocity 前，session CLI 產生的 SB3 不可靠

---

### 5. 統一 CLI 編譯路徑與成功訊號

**目標：** 任何「成功」訊號必須經過完整的端到端驗證：archive → graph → VM load → VM save → VM reload。

**執行步驟：**

1. 定義「成功」的門檻
   - Archive 完整：所有引用的素材 entry 存在且 hash 正確
   - Graph 有效：所有 block 連線互反、references 存在
   - VM load 成功：Scratch VM 可載入 SB3
   - VM save 成功：Scratch VM 可保存 SB3
   - VM reload 成功：重新載入 SB3 後語意一致

2. 修改 CLI `compile` 命令
   - 新增 `--verify` 選項強制執行所有 gate
   - 無論是否有輸出路徑，都執行相同驗證流程
   - 失敗時輸出 JSON diagnostic report

3. 建立 Verification Result 格式
   - `src/cli/verification.ts` 定義 VerificationResult type
   - 包含：archiveCheck、graphCheck、vmLoad、vmSave、vmReload
   - 每個 gate 記錄：status (pass/failed/skipped)、error messages、diagnostics

4. 修改 `session-cli.ts` 命令
   - `compile`：有輸出路徑時先驗證再寫入
   - `preview`：改名為 `validate-json` 直到真正 VM preview 完成
   - 新增 `verify` 命令：只驗證不輸出

**需修改檔案：**
- `src/cli/verification.ts` (新建)
- `src/cli/session-cli.ts` (修改 compile/preview 命令)
- `src/cli/session/session.ts` (修改 compile 方法)

**測試案例：**
- 驗證有效 SB3：所有 gate pass
- 驗證缺少素材 SB3：archive check fail
- 驗證壞 graph SB3：graph check fail
- 驗證 VM reject SB3：VM load fail

**阻斷條件：**
- 無法定義「成功」門檻前，CLI 會繼續產生 false-success

---

## P1：設計資料完整映射與 Session 結構修正

### 6. 設計資料完整映射

**目標：** Design JSON → Canonical IR 的轉換必須完整保留所有設計資訊。

**執行步驟：**

1. 完善 Design Schema
   - 確保 design.json 包含所有必要欄位：
     - `spritesDef`：包含 costumes、x/y/direction/visible
     - `variables`：包含 sprite reference
     - `lists`：包含 sprite reference、初始值
     - `scripts`：包含 blocks array
   - 建立 schema validator

2. 建立 Design → Canonical IR 轉換器
   - `src/cli/design-to-ir.ts` 提供 `designToCanonicalIR()`
   - 轉換 spritesDef → Canonical sprites
   - 轉換 variables → Canonical variables (正確 ID key 格式)
   - 轉換 lists → Canonical lists
   - 轉換 scripts → Canonical scripts
   - 轉換 blocks → Canonical blocks (正確 next/parent/input)

3. 建立測試案例
   - 最小設計 (1 sprite, 1 script, 1 variable)
   - 平台遊戲設計 (多 sprites, 多 scripts, 多 variables)
   - 確保轉換後的 Canonical IR 可編譯為有效 SB3

**需修改檔案：**
- `src/cli/design-to-ir.ts` (新建)
- `docs/game-design-schema.json` (修改)
- `docs/game-design-example.json` (新建)

**測試案例：**
- 設計 → Canonical IR → compile → SB3 → load → 驗證語意等價
- 比對設計檔與 SB3 的 sprites/scripts/variables 數量

**阻斷條件：**
- 無法完整轉換設計資料前，新遊戲會缺少功能

---

### 7. Session 結構正確性修正

**目標：** `ScratchSession` 的內部結構必須符合 Scratch project JSON 與 Canonical IR 的格式要求。

**執行步驟：**

1. 分析 `src/cli/session/session.ts`
   - 檢查 target structure：variables/lists/costumes/sounds
   - 檢查 variable format：ID key vs name key
   - 檢查 list format：ID key vs name key
   - 檢查 block format：next/parent/input 格式

2. 修正變數格式
   - Scratch project JSON：`{id: "var_xxx", name: "score", value: 0, isPersistent: false}`
   - Canonical IR：`{id: string, name: string, value: any, isPersistent: boolean}`
   - Session：確保內部使用正確格式

3. 修正列表格式
   - 同變數格式要求

4. 建立 Session Validator
   - `src/cli/session-validator.ts` 提供 `validateSession()`
   - 檢查所有 target 結構正確
   - 檢查所有 variables/lists 格式正確
   - 檢查所有 blocks graph 正確

**需修改檔案：**
- `src/cli/session.ts` (修改 target/variable/list format)
- `src/cli/session-validator.ts` (新建)

**測試案例：**
- 建立 Session → addSprite → addVariable → addList
- 驗證 Session → JSON 轉換格式正確
- 驗證 Session → Canonical IR → compile → SB3 成功

**阻斷條件：**
- Session 格式錯誤會導致後續所有轉換失敗

---

### 8. Session 素材保留與自動生成

**目標：** Session CLI 必須支援素材 bytes 的保留與自動生成。

**執行步驕：**

1. 建立 Asset Store `src/cli/asset-store.ts`
   - 提供 `addAsset(bytes: Uint8Array, format: string): Asset`
   - 提供 `getAsset(md5: string): Asset | null`
   - 提供 `getAssetBytes(md5: string): Uint8Array | null`

2. 修改 Session API
   - `addSprite(name, options)`：支援 `costumes: Asset[]`
   - `addSound(name, asset: Asset)`：支援音效 Asset
   - `setCostume(asset: Asset)`：設定 costume Asset

3. 建立自動素材生成
   - `src/cli/auto-asset.ts` 提供 `generateDefaultCostume(size: number): Asset`
   - `src/cli/auto-asset.ts` 提供 `generateDefaultSound(duration: number): Asset`

4. 建立 Asset Validator
   - `src/cli/asset-validator.ts` 提供 `validateAsset(asset: Asset)`
   - 檢查 SVG/PNG/WAV/MP3 格式
   - 檢查 MD5 hash

**需修改檔案：**
- `src/cli/asset-store.ts` (新建)
- `src/cli/auto-asset.ts` (新建)
- `src/cli/asset-validator.ts` (新建)
- `src/cli/session.ts` (修改 addSprite/addSound/setCostume)

**測試案例：**
- 新增 Sprite with custom SVG costume
- 新增 Sprite with default auto-generated costume
- 新增 Sound with custom WAV file
- 新增 Sound with default auto-generated sound
- 驗證 SB3 包含正確素材 bytes

**阻斷條件：**
- 無法支援素材時，遊戲會缺少視覺與音效

---

## P2：Canonical IR 編譯與 VM Round-Trip

### 9. Canonical IR 編譯器改善

**目標：** `compileCanonicalProject()` 必須產生可由 Scratch VM 載入的完整 SB3。

**執行步驟：**

1. 檢查 `src/core/compiler/compiler.ts`
   - 確認 SVG/PNG/WAV/MP3 預檢通過
   - 確認資產 bytes 已包含在 project JSON
   - 確認 VM load/save/reload 可完整保留語意

2. 建立 Compiler Diagnostic Report
   - `src/core/compiler/diagnostics.ts` 定義 Diagnostic type
   - 包含：stage、error、suggestion、location
   - 提供人類可讀診斷訊息

3. 建立 Compiler Test Corpus
   - `research/compiler-corpus/` 包含：
     - 最小遊戲 (1 sprite, 1 script)
     - 平台遊戲 (多 sprites, 多 scripts)
     - 數學遊戲 (reporters, operators)
     - 角色扮演遊戲 (variables, conditions)
   - 每個測試：design → Canonical IR → compile → SB3 → VM round-trip

**需修改檔案：**
- `src/core/compiler/diagnostics.ts` (新建)
- `research/compiler-corpus/` (新建)

**測試案例：**
- 每個 corpus 項目必須通過完整編譯與 VM round-trip
- 驗證 SB3 可由 Scratch 網站匯入

**阻斷條件：**
- 無法編譯為有效 SB3 前，所有 AI 生成的遊戲都無法使用

---

### 10. VM Round-Trip 驗證

**目標：** 任何編譯後的 SB3 必須能通過 Scratch VM 的 load → save → reload 回圈。

**執行步驟：**

1. 建立 VM Round-Trip Test Utility
   - `src/test/vm-roundtrip.ts` 提供 `vmRoundTrip(sb3: Blob): Promise<VerificationResult>`
   - 驗證 VM load 成功
   - 驗證 VM save 成功
   - 驗證 reload 後語意一致 (targets、scripts、variables、costumes、sounds)

2. 建立 VM Round-Trip Test Suite
   - `tests/vm-roundtrip.spec.ts`
   - 測試最小遊戲
   - 測試平台遊戲
   - 測試含外部素材的遊戲
   - 測試含 extension 的遊戲

3. 建立 VM Round-Trip Failure Corpus
   - `research/vm-failure-corpus/` 包含失敗案例
   - 每個失敗案例：SB3、錯誤訊息、診斷

**需修改檔案：**
- `src/test/vm-roundtrip.ts` (新建)
- `tests/vm-roundtrip.spec.ts` (新建)
- `research/vm-failure-corpus/` (新建)

**測試案例：**
- 每個 corpus 項目必須通過 VM round-trip
- 驗證語意等價 (targets、scripts、variables、costumes、sounds 數量與內容)

**阻斷條件：**
- 無法通過 VM round-trip 的 SB3 不可靠

---

## P3：端到端遊戲行為與使用者入口驗收

### 11. 遊戲行為規格與 Deterministic Smoke

**目標：** 每款範例遊戲必須有明確的行為規格與可重現的 smoke scenario。

**執行步驟：**

1. 建立 Game Behavior Spec Format
   - `docs/game-behavior-spec.md` 定義 spec 格式
   - 包含：input、expected outputs、edge cases、failure scenarios

2. 建立 Behavior Spec for Each Game
   - `space-shooter-spec.md`：玩家移動、射擊、敵人生成、碰撞、得分、生命、結束條件
   - `platform-game-spec.md`：跳躍、移動、平台碰撞、得分
   - `puzzle-game-spec.md`：方塊移動、拼圖規則、勝利條件

3. 建立 Behavior Test Runner
   - `src/test/behavior-test.ts` 提供 `runBehaviorTest(spec: BehaviorSpec): Promise<TestResult>`
   - 使用 Scratch VM 執行腳本
   - 檢查變數／角色座標等可觀察結果
   - 比對預期與實際行為

4. 建立 Behavior Test Corpus
   - `research/behavior-test-corpus/` 包含：
     - 最小遊戲的行為測試
     - 含外部素材的遊戲行為測試
     - 失敗案例 (game-over、error handling)

**需修改檔案：**
- `docs/game-behavior-spec.md` (新建)
- `src/test/behavior-test.ts` (新建)
- `research/behavior-test-corpus/` (新建)

**測試案例：**
- space-shooter：玩家移動、射擊、敵人生成／移動、命中、得分、生命及結束條件都有可重現的測試
- platform-game：跳躍、移動、平台碰撞、得分
- puzzle-game：方塊移動、拼圖規則、勝利條件

**阻斷條件：**
- 無法驗證遊戲行為前，不能宣稱遊戲功能正確

---

### 12. 使用者入口與實驗性功能標記

**目標：** 清楚分離正式功能與實驗性功能，避免使用者混淆。

**執行步驟：**

1. 文件化所有入口
   - `scratch-ai-bridge inspect/batch`：靜態分析入口
   - `scratch-ai-bridge compile/preview`：正式編譯入口
   - `scratch-session` (開發樹)：實驗性 session CLI
   - `game-cli.ts`：設計檔產生器

2. 標記實驗性功能
   - CLI help 明確標示實驗性命令
   - Web 界面明確標示實驗性功能
   - 文件明確標示實驗性功能與支援範圍

3. 建立功能矩陣
   - `docs/function-matrix.md` 列出：
     - 功能名稱
     - 狀態 (stable/experimental)
     - 入口
     - 驗證方式
     - 已知限制

4. 建立使用者教學
   - `docs/USAGE-GUIDE.md` 更新
   - 明確標示哪些功能可安全使用
   - 提供範例與常見問題

**需修改檔案：**
- `docs/function-matrix.md` (新建)
- `docs/USAGE-GUIDE.md` (修改)
- `docs/cli-reference.md` (新建)
- `README.md` (修改)

**測試案例：**
- 新手能依文件找到正確入口
- 實驗性功能有明顯標記
- 功能矩陣完整且準確

**阻斷條件：**
- 無法清楚標記實驗性功能前，使用者可能誤用不穩定功能

---

## P4：維護性、批次產生與成功率量測

### 13. Generator/Contract 收斂

**目標：** 移除重複的 game-generator.ts，收斂成單一 generator/contract。

**執行步驟：**

1. 分析重複入口
   - `src/cli/game-cli.ts`
   - `src/cli/game-generator.ts`
   - `src/cli/session-cli.ts` (game subcommand)

2. 建立 Generator Contract
   - `docs/generator-contract.md` 定義：
     - 輸入格式 (design JSON/MD)
     - 輸出格式 (SB3/JSON)
     - 驗證要求 (archive/graph/VM)
     - 診斷格式

3. 重構 Generator
   - 將 game-cli.ts、game-generator.ts 收斂成 `src/cli/generator.ts`
   - 提供單一入口 `generateGame(designPath, options)`
   - 支援 JSON/MD 輸入
   - 支援 SB3/JSON 輸出

4. 建立 Generator Test Suite
   - `tests/generator.spec.ts`
   - 測試最小設計
   - 測試完整遊戲設計
   - 測試失敗案例

**需修改檔案：**
- `src/cli/generator.ts` (新建)
- `src/cli/game-cli.ts` (移除或標記為棄用)
- `src/cli/game-generator.ts` (移除或標記為棄用)
- `docs/generator-contract.md` (新建)
- `tests/generator.spec.ts` (新建)

**測試案例：**
- 每個設計檔案必須產生正確 SB3
- 驗證輸出格式符合 contract
- 驗證診斷格式一致

**阻斷條件：**
- 重複入口會導致維護困難與不一致

---

### 14. 批次產生與 Machine-Readable Manifest

**目標：** 批次產生時每個作品輸出 machine-readable manifest，包含各 gate 結果與失敗路徑。

**執行步驟：**

1. 建立 Manifest Format
   - `src/cli/manifest.ts` 定義 Manifest type
   - 包含：inputHash、toolVersion、gateResults、outputHash、failurePath

2. 建立 Batch Generator
   - `src/cli/batch-generator.ts` 提供 `generateBatch(designPaths, outputDir, options)`
   - 每個作品輸出 manifest JSON
   - 任一作品失敗時 batch 回傳非零 exit code
   - 支援繼續其他作品

3. 建立 Batch Test Suite
   - `tests/batch-generator.spec.ts`
   - 測試多個成功設計
   - 測試部分失敗設計
   - 測試所有失敗設計

4. 建立 Batch Result Aggregator
   - `src/cli/aggregate-batch-results.ts`
   - 計算成功率 (成功數 / 總數)
   - 按 gate 統計失敗數
   - 輸出機器可讀與人類可讀報告

**需修改檔案：**
- `src/cli/manifest.ts` (新建)
- `src/cli/batch-generator.ts` (新建)
- `src/cli/aggregate-batch-results.ts` (新建)
- `tests/batch-generator.spec.ts` (新建)

**測試案例：**
- 10 個成功設計 → 100% 成功率
- 10 個設計 (3 個失敗) → 70% 成功率 + 失敗診斷
- 10 個失敗設計 → 0% 成功率 + 各失敗診斷

**阻斷條件：**
- 無法量測成功率前，無法優化流程

---

### 15. 端到端成功率 Corpus 與 Gate 失敗統計

**目標：** 每次發版記錄端到端分子/分母與每 gate 失敗數。

**執行步驟：**

1. 建立 Failure Corpus Format
   - `docs/failure-corpus-format.md` 定義：
     - 每個失敗案例的結構
     - gate 分類 (parse/normalize/schema/semantic/vm-load/vm-save/reload)
     - 失敗原因分類 (missing-assets/bad-graph/unknown-opcode/...)

2. 扩充 Failure Corpus
   - `research/sb3-failure-corpus/` 現有 f-001 至 f-009
   - 增加更多失敗案例 (至少 20 個)
   - 每個案例包含：輸入、錯誤訊息、診斷、修正提示

3. 建立 Gate Failure Tracker
   - `src/cli/gate-tracker.ts` 提供 `trackGates(results: GateResult[]): GateStats`
   - 計算各 gate 失敗數
   - 計算成功率 (成功數 / 總數)
   - 輸出機器可讀與人類可讀報告

4. 建發版報告模板
   - `docs/release-template.md` 包含：
     - 端到端成功率 (分子/分母)
     - 各 gate 失敗數
     - 未覆蓋類型
     - 已知問題

**需修改檔案：**
- `docs/failure-corpus-format.md` (新建)
- `research/sb3-failure-corpus/` (擴充)
- `src/cli/gate-tracker.ts` (新建)
- `docs/release-template.md` (新建)

**測試案例：**
- 20 個失敗案例必須能正確分類與診斷
- 驗證成功率計算正確
- 驗證各 gate 失敗數統計正確

**阻斷條件：**
- 無法統計成功率前，無法評估改善成效

---

## 執行順序與停止條件

### 建議執行順序

1. **先完成 P0**：關閉 false-success，建立可靠的靜態驗證層
   - 建立 archive-validator、graph-validator
   - 修復 newGame 設計欄位消耗
   - 修復 Session 編譯路徑素材保留
   - 修復 Session Block API graph reciprocity
   - 統一 CLI 編譯路徑與成功訊號

2. **完成 P1**：確保設計資料完整映射與 Session 結構正確
   - 完善設計資料完整映射
   - 修正 Session 結構
   - 支援 Session 素材保留與自動生成

3. **完成 P2**：確保 Canonical IR 編譯與 VM round-trip 可靠
   - 改善 Canonical IR 編譯器
   - 驗證 VM round-trip

4. **完成 P3**：驗證實際遊戲行為與使用者入口
   - 遊戲行為規格與 deterministic smoke
   - 使用者入口與實驗性功能標記

5. **完成 P4**：批次量測與成功率統計
   - Generator/Contract 收斂
   - 批次產生與 machine-readable manifest
   - 端到端成功率 corpus 與 gate 失敗統計

### 發布阻擋條件

- 任一輸出入口仍能對缺素材、無效 graph 或未實作腳本回報「遊戲成功」。
- 新建與既有作品共用轉換，卻沒有素材保留或丟失報告。
- 設計檔欄位被靜默忽略，或命令宣稱的功能沒有對應驗收。
- 沒有 VM reload 證據；對外宣稱網站可開啟卻沒有 Scratch 網站 smoke。
- 任一成功訊號沒有完整的端到端驗證。

---

## 相關檔案與計畫

### 現有計畫
- `docs/sb3-end-to-end-improvement-plan.md`：原始計畫
- `docs/sb3-generation-reliability-plan.md`：SB3 產生成功率改善計畫
- `docs/cli-agent-editing-plan.md`：CLI agent 編輯與視覺驗證改善計畫
- `docs/ai-repair-feedback-plan.md`：AI 錯誤回饋與修復循環計畫

### 建議新建計畫
- `docs/vm-roundtrip-test-plan.md`：VM round-trip 測試計畫
- `docs/behavior-test-plan.md`：遊戲行為測試計畫
- `docs/batch-generation-plan.md`：批次產生與成功率統計計畫

---

## 總結

本文件是 `sb3-end-to-end-improvement-plan.md` 的詳細執行版本，提供：

1. **15 個執行項目**：從 P0 到 P4，涵蓋所有阻斷問題與改善目標
2. **具體技術行動**：每個項目分解為數個執行步驟
3. **檔案修改清單**：需修改或新增的檔案路徑
4. **測試案例**：驗收所需的測試案例
5. **阻斷條件**：哪些問題必須先解決才能繼續

建議依上述順序執行，並在每個階段完成後進行驗收測試。
