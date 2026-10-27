# Scratch CLI Agent 編輯與視覺驗證改善計畫

更新：2026-10-27  
狀態：研究完成；本文件是實作計畫，所列功能除明確標示「現有」外均未驗收。

## 1. 目標

讓本機 AI CLI agent 能安全地讀取既有 `.sb3`、理解積木與素材、以可審查的方式新增／修改／刪除角色、造型、聲音、變數及積木，輸出可由 Scratch 開啟的 `.sb3`，並透過 Scratch VM 與 renderer 產生畫面／執行結果供 agent 迭代。整條流程不要求 agent 自行手寫 ZIP、猜 opcode schema 或把 Scratch 積木當一般 JSON 隨意改寫。

## 2. 研究結論與目前能力

Repository 有兩個不同入口，不能混為一談：

| 入口 | 現況 | 適用範圍 |
| --- | --- | --- |
| `scratch-ai-bridge inspect` / `batch` | 已實作且有 schema 化輸出；靜態讀取 archive、project JSON 與 raw block graph | 結構檢查、coverage、教學分析；不執行 Scratch VM，不產生視覺預覽 |
| `session-cli.ts` / `ScratchSession` | 新增的實驗性 stateful CLI；可讀寫 project JSON、做有限 metadata/block 操作、用 JSZip 封裝 | 概念驗證；不是可安全修改任意既有 SB3 的完整編輯器 |

已確認限制：

1. `session-cli` 不在 package `bin` 入口；`package.json` 的 `scratch-ai-bridge` 指向靜態 inspect/batch CLI。Session 指令需從開發樹以 `tsx` 執行，且其輸出訊息不是一致的 JSON agent protocol。
2. `loadSb3()` 只抽出 `project.json`，沒有保留 ZIP 中素材 bytes、entry metadata、未知 entry 或原 archive comment。`saveSb3()` 只寫回 `project.json`。載入含素材的作品再儲存可能產生缺少 costume/sound 檔案的 SB3；這是阻止目前 session CLI 用於真實作品編輯的 P0 缺口。
3. `preview` 目前只呼叫 `compile()`，不啟動 VM、不執行腳本、不截圖；目前命令名稱會讓 agent 誤以為已視覺驗證。
4. `addSprite()` 只建立 metadata 與空白造型引用；Session 沒有 add/remove/update costume/sound API，也沒有素材 byte store。
5. Block API 接受任意 opcode/fields/inputs，不檢查 Scratch opcode schema、input type、field enum、shadow、連結一致性、自製積木 procedure mutation 或 block graph 可達性。`removeBlock()` 的遞迴刪除／父子連結修補亦未形成原子、可驗證 patch 契約。
6. Session state 以目前工作目錄的 `.scratch-session.json` 隱式恢復；檔案可能包含完整 project JSON，狀態不綁定明確輸入專案／輸出路徑，也沒有來源雜湊、鎖定、rollback 或防止意外覆寫來源的協定。
7. `saveSb3()` / `compile` 直接寫目的路徑，沒有先驗證、暫存檔原子 rename、輸出回讀或 Scratch VM round-trip gate。
8. 既有 Canonical IR compiler 已有官方 Scratch VM load/save 路徑、素材 bytes、Raw Archive IR／局部 block graph patch、Browser preview 能力。應優先重用這些模組，而非讓 session-cli 另造一套 SB3 轉譯與序列化器。

## 3. UUID／資產 ID 判讀

本專案出現的識別碼至少有三種語意：

| 類型 | 來源 | 能回答什麼 | 不能回答什麼 |
| --- | --- | --- | --- |
| Scratch block/target/variable ID | `src/cli/session/uid.ts` 的 20 字元 soup ID；現用 `Math.random()` | 在 project JSON 中連結 block、target、symbol | 不表示素材；不包含語意；非標準 RFC UUID；不提供可依賴的密碼學唯一性保證 |
| SB3 asset ID / `md5ext` | 通常是資產 bytes 的 MD5 十六進位值及副檔名，如 `hash.svg` | 對應 archive entry；比對內容是否與 metadata 所述一致；同內容可去重 | 不可逆推出圖片內容、角色名稱、用途、外觀或聲音語意；MD5 不應被當成對抗惡意碰撞的安全簽章 |
| Bridge file/evidence ID | inspect 的 SB3 SHA-256／報告內 evidence index | 識別輸入檔 bytes 或報告內定位 | 不映射 Scratch 素材語意，也不是穩定跨版本的 Scratch block identity |

`src/scratch/csp-scratch-parser.ts` 會對可取出的素材 bytes 算 MD5 並正規化 `assetId`/`md5ext`；這是驗證／命名依據，不是圖像辨識。已知 Scratch library 的 asset ID 可透過對照官方/本機 library manifest 找到候選名稱，但只有 manifest 有該 ID 且版本匹配時才可標為 library match；不得對任意 MD5 猜名稱。任意使用者素材需實際讀取 bytes：SVG 可解析安全的向量結構並渲染縮圖，PNG/JPEG 需 bitmap decoder／renderer，聲音需 metadata 及可選波形；若需自然語言描述圖片，再用明確標示為推測的本機 vision model 或使用者輸入名稱。預設不呼叫雲端服務。

報告至少分開提供 `assetId`, `md5ext`, `archiveEntryPresent`, `bytesHashValid`, `dataFormat`, `declaredName`, `libraryMatch`（含 library/version/source/confidence）、`renderStatus` 與 `semanticDescription`（來源及信心）。不可把 hash match 說成「已認出資產」。

## 4. 目標架構

```text
Agent intent
  → read-only inspect / project map / asset catalogue
  → plan.patch.json（明列新增、修改、刪除與預期效果）
  → schema + graph + asset + scope validation
  → staged patch on immutable source snapshot
  → Scratch VM load/save/reload + semantic diff
  → SB3 output + machine-readable validation report
  → isolated renderer preview / screenshot / optional bounded run
  → agent compares intent, diff, diagnostics, screenshots and iterates
```

核心原則：預設保留 Raw Archive IR 中未修改的 bytes 與未知欄位；只對指定 target/block/asset 做白名單 patch。只有 agent 明確選擇 Canonical rebuild 時才走全專案正規化路徑，並額外輸出前後 diff。所有輸出寫到新目的地，來源檔不就地覆寫。

## 5. 分階段實作與 gate

### Phase 0 — 收斂入口、契約與安全邊界（P0）

- 保留現有 `inspect`/`batch` 作靜態分析入口；新增正式文件化的 `edit`/`session` 子命令，或清楚的 `scratch-session` bin，不讓另一支 CLI 暗中讀相同 sidecar。
- Agent mode 一律支援 `--json`，stdout 僅輸出版本化 JSON，進度寫 stderr；help 提供完整 schema、examples、exit code。明確輸入檔、工作副本、輸出檔，不依賴 cwd 自動選專案。
- session manifest 只存 source path、source SHA-256、working-copy path、base revision、最後 patch ID；大 project JSON 和素材另存於受權限保護的工作目錄。檢查 symlink/path traversal、大小上限、並行鎖與 source changed 衝突。
- 預設唯讀載入；每次寫入採新檔＋暫存＋原子 rename＋回讀驗證。提供 `--force` 也不得覆寫輸入來源；另設明確的備份／restore 流程。
- 修正命令語意：現有假 `preview` 改名 `validate-json`，直到真正 renderer preview 完成才提供 `preview`。

**Gate：** 空格及中文路徑、格式錯誤、來源變更、輸出已存在、程序中斷、兩 agent 同時操作都得到明確機器錯誤；來源 SHA-256 不變；stdout 可被 JSON parser 直接讀取。

### Phase 1 — 無損 SB3 project workspace（P0）

- 建立一個受測的 ProjectWorkspace adapter，使用既有 `importLosslessSb3`/Raw Archive IR 讀入 `project.json`、所有 entry bytes、comment 及 archive warnings。
- 任何 patch 後保留未改 entries、未知 project JSON 欄位、extension metadata、自製積木 mutation、comments、monitors 和原始圖像／聲音 bytes。匯出後重新匯入比對每個未改 entry SHA-256。
- 以官方 Scratch VM `loadProject(archive) → saveProjectSb3()` 作正式 compile path（沿用 `docs/vm-write-path.md` adapter）；不可用只有 project.json 的 JSZip serializer 冒充完整 compiler。
- 除非操作本身明確修改 asset，資產 bytes 不重新編碼。每個受影響 asset 先驗證 dataFormat、MD5 命名和引用一致性。

**Gate：** official Scratch fixtures、帶 PNG/SVG/WAV/MP3 的 SB3、未知 extension/custom procedure 專案均可 load/edit unrelated field/save/reopen；未改素材 bytes SHA-256 全數一致；不支援項保留並明確報告，不靜默刪除。

### Phase 2 — Agent 可理解的 project map 與 Scratch 教學契約（P0）

- 增加 `inspect --detail project|targets|blocks|assets|capabilities`；輸出 target 穩定 locator、block graph 拓樸、腳本入口、變數/清單/廣播、procedure 參數、素材庫存及 coverage。
- 同時提供「人類／AI 易讀積木文字」與原始 opcode/fields/inputs/IDs。每筆解讀可追溯到 JSON Pointer/block ID；未知 opcode、extension、opaque/malformed graph 明確標未知，不推測成已理解。
- `capabilities` 由現有 strict authoring registry 和官方 Scratch opcode/schema 產生，逐項記錄 block type、必需欄位／inputs、連接形狀、target 限制、runtime 支援及編譯覆蓋。提示 agent 先讀能力資料，再輸出 patch；禁止自行發明 `shape` 等 IR 欄位。
- 建立精簡 `agent-guide` 輸出：概念、教學／Scratch block graph 規則、命令流程、patch schema、錯誤修復、限制與可重現 examples；可用 `--topic` 只輸出所需章節，並附版本。

**Gate：** 官方 block fixtures 的文字化 graph 可還原原拓樸；capability registry 每項與 validator/compiler 一致；unknown 能保留而不被錯誤翻譯。

### Phase 3 — 強型別、原子式 patch API（P0）

- 新增 `plan`/`apply`/`undo`/`diff`。Patch 使用 JSON file/stdin，帶 `schemaVersion`、`baseFileSha256`、operation IDs、scope selectors、預期舊值與操作列表。
- 第一批操作：target add/rename/remove；block insert/update/delete/reconnect；variable/list/broadcast CRUD；costume/sound add/replace/remove/rename/reorder；位置、顯示、大小、方向、目前造型等 settings。
- block 操作以 semantic locator 優先（target ID＋opcode＋script path＋鄰接錨點），原始 block ID 僅作受檢查的 fallback。新增 ID 用 `crypto.randomBytes`／Scratch 相容產生器並碰撞檢查；文件稱為 Scratch ID，不稱 UUID。
- 每批 patch 先建立副本、套用、驗證所有 graph invariants，再一次提交；任一 operation 失敗則整批 rollback。刪 block 必須檢查 parent/next/input child 反向連結、自製積木定義與呼叫、comment anchor；顯示完整 cascade 預覽並要求 patch 明列 cascade policy。
- Validate 包含 official project parser、opcode schema、input/field shape、ID 唯一性、block link 對稱、無懸空引用、hat/root 可達性、procedure mutation/arguments、asset checksum/存在性與 archive limits。
- `diff` 顯示 Scratch 語意變化、Raw Archive entry hash 變化及新增／移除資產；每個 operation 有可逆 inverse patch（若 asset 不可恢復則標明）。

**Gate：** 每種 CRUD 操作有成功／失敗／rollback fixture；錯誤含 JSON Pointer、operation ID、expected/actual；舊值衝突時拒絕套用；重試不造成重複修改；undo 回到相同 project JSON 語意與 entry hashes。

### Phase 4 — 資產識別、圖像理解與視覺編修（P1）

- `assets list` 先顯示宣告名稱、target、造型／音效順序、assetId/md5ext、archive entry、hash validity、尺寸／解析度／聲音長度及已知 library match。
- `assets render` 使用 Bridge/Scratch renderer 對指定 costume 或 Stage 產生縮圖，回傳輸出檔路徑、寬高、渲染引擎版本、診斷；render fail 時禁止當作空白素材成功。
- 加入可選 `asset describe` provider interface：預設 metadata-only；未來可接使用者自行安裝的本機 vision 模型。輸出須標 `source=local-model|library-catalog|metadata|user`、模型／catalog 版本與信心。不得自動把推測名稱寫回 SB3。
- 視覺修改初期只提供安全、可逆的 SVG primitive/template 編輯及 asset replace；bitmap 裁切／轉換、聲音編輯另列支線，所有轉換產生新 bytes、新 MD5、預覽及明確 diff。
- 建立 `preview --target ... --costume ...` 靜態 renderer 預覽和全舞台合成圖；Scratch VM preview 另開隔離 worker/iframe，沒有硬體權限、網路預設封鎖、執行逾時與資源上限，stop 可完全清場。對話／雲端變數／extension/硬體需 capability consent，不可默默觸發。

**Gate：** 真實 SVG/PNG 與混合 costume 縮圖非空白且尺寸正確；asset byte replacement 後 archive/hash/visual diff 一致；執行 preview 的停用、逾時及取消均不影響 CLI 後續命令；靜態圖與執行中狀態清楚區分。

### Phase 5 — 端到端 agent 範例與跨平台發布（P1）

- 提供 `new`、`inspect`、`assets list/render`、`plan`、`validate`、`apply`、`compile`、`preview`、`diff` 的完整範例；至少涵蓋新專案、修改既有含素材 SB3、刪除角色及回復 patch。
- 用 `--json` 可機讀輸出、stable exit codes、schema docs、Node version 和安裝方式；支援 agent 以 stdin 傳 patch、stdout 讀結果，且 stdout 不夾雜 banner/進度。
- Agent 的基本操作不要求連網、不要求付費 API、不把 SB3 或素材送出本機。檢查 npm lifecycle、沙箱權限、歸檔炸彈及 renderer subprocess 清理。
- 以 macOS/Linux/Windows 各一組 Node smoke，加上 SB3 fixture corpus、lossless hashes、VM reopen、browser renderer、混合錯誤和中斷 recovery gate 驗收。

**完成定義：** 新手 agent 僅根據 `agent-guide` 與 CLI schema，能建立／載入／理解一個作品，提出可審查 patch，執行角色／積木／素材 CRUD，編譯新的 SB3，讀取診斷和圖片結果並迭代；所有操作可追溯、可驗證，既有未修改資料不丟失。

## 6. 建議命令契約（目標形狀）

```text
scratch-ai-bridge inspect project.sb3 --detail project --json
scratch-ai-bridge assets list project.sb3 --json
scratch-ai-bridge assets render project.sb3 --target-id <id> --costume-index 0 --out preview.png --json
scratch-ai-bridge plan project.sb3 --patch patch.json --json
scratch-ai-bridge validate project.sb3 --patch patch.json --json
scratch-ai-bridge apply project.sb3 --patch patch.json --out edited.sb3 --json
scratch-ai-bridge diff project.sb3 edited.sb3 --json
scratch-ai-bridge preview edited.sb3 --mode static --out stage.png --json
scratch-ai-bridge preview edited.sb3 --mode run --seconds 5 --json
```

命令需回報 `format`, `schemaVersion`, `toolVersion`, `sourceSha256`, `status`, `operations`, `diagnostics`, `assetChanges`, `archiveEntryChanges`, `runtimeVerified`, `previewArtifacts`。絕對路徑須 opt-in，避免洩漏本機資訊。

## 7. 執行順序與明確不宣稱事項

先做 Phase 0–1，否則 session CLI 存檔會傷害含素材作品；再完成 Phase 2–3 讓 agent 有正確的 Scratch 知識和可控 patch；Phase 4 讓素材可視化與視覺化回饋成為閉環；Phase 5 最後做發佈／完整 agent 驗收。不要先以 random UUID、MD5 或 `.sb3` ZIP 解包成功作為「知道素材是什麼」的證據。不要把 JSON 可解析、compiler 可載入、VM 可執行、畫面正確四種不同 gate 合併成單一成功狀態。

本研究未修改任何 Scratch 專案程式碼，也未執行新測試；上述狀態是靜態程式與文件分析。正式實作前需先把此計畫拆成帶 fixture、owner、驗收記錄的 checkpoint。
