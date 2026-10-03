# Scratch AI Bridge 完整化開發計畫

研究基準：2026-10-03，官方 `scratchfoundation/scratch-editor` develop workspace、目前鎖定的 Scratch VM
15.2.0、官方 `scratch-parser` SB3 schema，以及本 repository 的現有 TypeScript bridge。

## 先定義「完整」

「完整 Scratch 支援」不能只用「能輸出一個可開啟的 `.sb3`」判定。這份計畫將完成度拆成三個可驗收等級：

| 等級        | 定義                                                                                   | 必須達成的結果                                                                                      |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| L1 資料完整 | 任意官方 parser 可接受的 SB3 都能匯入、分析、再輸出，未理解的資料仍保留                | 未知 opcode、mutation、comments、monitors、extensions、target metadata、所有素材 bytes 不被靜默丟失 |
| L2 VM 相容  | 產出的 SB3 經官方 Scratch VM 載入、執行、保存後，語意與輸入一致                        | procedures、broadcast、lists、clones、控制流程、核心 opcode 與官方 fixture 通過差異測試             |
| L3 AI 完整  | AI 可以在明確 capability contract 下產生所有核心積木，並安全處理未知或第三方 extension | 不靠硬編碼的 12 個 opcode；輸入 arity、欄位、shadow、mutation 與 procedure 參數可驗證               |

L1 是「無損保存」；L2 是「可執行相容」；L3 是「完整 AI authoring」。第三方 extension 的執行仍取決於是否有對應 runtime，
但沒有 runtime 時也必須達到 L1 的保存與警告要求。這是可長期維護的完整定義，而不是承諾永遠追上所有未來 extension。

## 官方研究得到的邊界

官方 VM 的 SB3 serializer 不是單純 JSON 轉換器：

- block inputs 使用 `1/2/3` shadow 關係與 inline primitive arrays；序列化時會壓縮，載入時再展開。
- primitive blocks、variable/list/broadcast fields、`next`、`parent`、`topLevel`、`shadow`、`mutation`、block comment 都有特殊規則。
- target 除了 blocks 還包含 variables、lists、broadcasts、comments、costumes、sounds、position、rotation、volume、layer 等資料。
- project 還有 `monitors`、`extensions`、`meta`；extension ID 會由 opcode prefix 推導，但官方 loader 不會替第三方 extension 載入遠端程式碼。
- procedures 有新舊兩種 prototype 格式；官方測試涵蓋 shadow argument reporters、warp、argument IDs 與 definition/call hierarchy。
- 官方 VM fixture 已包含 comments、monitors、cloud variables、broadcast 特殊字元、unknown opcode、procedures、extensions、損壞或缺失素材等案例。

因此目前的「Canonical IR → VM load → VM save → decompiler」不能作為唯一匯入路徑；VM 會進行合法的正規化，卻不保證保留所有原始表示。

## 目標架構

```text
SB3 ZIP
 ├─ Raw Archive IR（project.json 原文/解析樹 + 全部 ZIP entries + hashes）
 │    ├─ Lossless export：保留未知資料與原始素材
 │    └─ Semantic projection：提供 AI、分析器與 UI 使用
 └─ VM Normalized IR（可選）
      ├─ 官方 Scratch VM load/save
      ├─ 行為驗證與修復
      └─ 匯出可執行 SB3
```

兩條路徑必須有明確名稱，避免使用者以為「VM 正規化輸出」等於 byte-for-byte 原檔回復：

1. `importLosslessSb3()`：只做 ZIP/JSON/schema/asset 驗證，不讓 VM 改寫資料。
2. `normalizeThroughVm()`：將 lossless project 載入官方 VM，輸出 VM 可執行的正規化版本與變更報告。
3. `compileCanonicalToSb3()`：AI 產出的新專案直接走 VM 驗證，再輸出新檔。
4. `exportLosslessSb3()`：若沒有要求正規化，依 Raw Archive IR 輸出，並保留未理解欄位。

## 分階段實作

### Phase 0：相容性契約與 fixture matrix

工作：

- 建立 `compatibility/` fixture index，收錄官方 `scratch-vm/test/fixtures` 中所有 SB3、sprite3、procedures、comments、monitors、extensions、unknown-opcode、cloud-variable 與壞檔案例。
- 每個 fixture 標記 `parse-only`、`lossless`、`vm-normalized`、`behavioral` 四種期望，不把官方 loader 的已知正規化誤判成 bug。
- 定義比較器：project JSON canonicalization、block graph signature、asset filename/hash、metadata/monitor/comment signature。
- 建立可重現的 baseline：Scratch VM、scratch-parser、Node、browser 版本與 upstream commit 固定記錄。

退出條件：至少 30 個官方代表 fixture 可自動分類；每個失敗都有「資料丟失、VM 正規化、unsupported runtime、壞檔」四類之一的明確原因。

### Phase 1：Raw Archive IR 與安全 ZIP 層

工作：

- 將目前 `validateSb3Archive()` 擴充為可保存 central-directory metadata、entry ordering、compression method、CRC、compressed/uncompressed size、filename encoding。
- 以 `RawSb3Project` 保存 `project.json` 原始 bytes、解析後 JSON、所有非 project entries、asset bytes、MD5/SHA-256 與原始 filename。
- 保留未知 root/target/block/monitor 欄位；schema 驗證採 `known fields + unknown fields passthrough`，不能使用 `additionalProperties: false` 把未知資料拒絕掉。
- 加入 duplicate filename、path traversal、symlink-like entry、ZIP64、encrypted entry、compression bomb、巨大 JSON、UTF-8 異常的測試。
- `exportLosslessSb3()` 先不經 VM，能對輸入 fixture 產生語意等價且 assets hash 完整的 archive。

退出條件：所有合法官方 fixture 的 `project.json` 未知欄位與素材 bytes 都能 round-trip；惡意 ZIP 測試不能穿透既有大小與 entry 限制。

### Phase 2：通用 Block Graph 與 primitive/shadow 完整化

工作：

- 將目前 `CanonicalOpcode` 的固定 union 改成 `KnownOpcode` 加上受驗證的 `string opcode`；AI strict mode 仍可限制 capability，但保存模式不得拒絕未知 opcode。
- 將 SB3 block graph 表示完整化：`id`、`next`、`parent`、`inputs`、`fields`、`shadow`、`topLevel`、`x/y`、`mutation`、`comment` 與原始 extension data。
- 正確處理 `1/2/3` input descriptor、inline primitives、variable/list/broadcast primitive、obscured shadow、top-level reporter 與 C-block substack。
- 建立 block graph invariant validator：無 dangling IDs、無循環 next、parent/child 一致、substack 邊界正確、procedure definition/call 可解析。
- compiler 與 decompiler 使用同一個 generic graph codec，不再為每個新 opcode 寫一份 switch。

退出條件：官方 unknown opcode、top-level reporter、shadow、broadcast special-character 與 nested C-block fixture 通過 graph signature round-trip。

### Phase 3：Procedures / Custom Blocks

工作：

- 將目前已存在但 compiler 尚未實際使用的 `CanonicalProcedure` 接入 project JSON。
- 產生 `procedures_definition`、`procedures_prototype`、`procedures_call`、`argument_reporter_string_number`、`argument_reporter_boolean`。
- 正確產生與解析 `proccode`、`argumentids`、`argumentnames`、`argumentdefaults`、`warp`、call input mapping。
- 同時接受官方新格式與舊格式，輸出時採官方目前格式並留下 normalization report。
- 驗證同角色 scope、遞迴 call、缺少 definition、參數數量/型別、default value 與 boolean reporter。

退出條件：官方 procedures serialization tests 與所有 procedures execute fixtures 通過；遞迴、warp、舊格式匯入都不會遺失語意。

### Phase 4：Assets、comments、monitors、metadata

工作：

- costumes：SVG、PNG、JPG/JPEG、bitmapResolution、rotation center、broken/missing asset policy。
- sounds：WAV、MP3、rate、sampleCount、format 與 raw bytes。
- comments：獨立 comment、block-bound comment、位置、尺寸、minimized、文字與官方 ID remapping。
- monitors：variable/list watcher、opcode、params、spriteName、mode、value、slider、位置、visibility。
- stage/sprite metadata：layerOrder、tempo、video state、text-to-speech language、visibility、rotationStyle、volume。
- project meta 與 extension list 全部保留；對 offline cloud variable 只標示不可連線，不改寫其宣告。

退出條件：官方 comments/monitors/assets/cloud fixture 通過；每一種被 VM 正規化的差異都出現在機器可讀 normalization report，而不是靜默消失。

### Phase 5：核心 opcode capability registry

工作：

- 從官方 VM/Scratch Blocks opcode metadata 建立版本化 registry：opcode、category、輸入名稱/型別、field、shadow、stack input、reporter/statement/hat、可否在 stage 使用。
- compiler 只依 registry 產生 generic block graph；不再把 12 個 opcode 寫死在 schema。
- registry 分 `core-supported`、`core-preserved`、`extension-preserved`、`runtime-unavailable`，讓 UI 能精確顯示能力而不是籠統說「未知」。
- 為全部 core opcode 建立最小合法 fixture，並將每個 opcode 至少載入/保存一次；高風險 opcode 再加入 VM execution assertion。

退出條件：所有官方 core opcode 能被 parser 接受並在 L1 round-trip；可執行 opcode 在 L2 通過行為測試；不支援 runtime 的項目只產生清楚警告。

### Phase 6：Extensions 與第三方資料保存

工作：

- 以 opcode prefix 與 project `extensions` 建立 extension registry，但禁止 Pages 在匯入時執行遠端 extension code。
- 對官方 extension fixture 做「保存/還原」測試；有官方 runtime adapter 時再做行為測試。
- 未知 extension block 必須原樣保留 opcode、inputs、fields、mutation、comments 與 assets。
- 對會使用網路、硬體、micro:bit、攝影機、雲端的 extension 明確標示 browser/offline 限制。
- extension URL、metadata 或自訂 schema 不得被當成可執行 script 注入頁面。

退出條件：任何官方 parser 可接受的第三方 extension SB3 都能 L1 保存；有 adapter 的 extension 才能宣稱 L2 行為相容。

### Phase 7：Analysis 與 AI authoring 完整化

工作：

- Analysis IR 改為 generic graph 分析：detached script、dangling link、procedure dependency、broadcast dependency、list/variable read-write、monitor dependency、extension usage、asset missing。
- AI 輸入分兩種：`strict-authoring` 只允許 registry 已驗證能力；`preservation-edit` 允許未知 block 但只能做局部 patch，不讓模型重寫整個 raw graph。
- 加入 JSON schema version migration、repair suggestions、path-specific diagnostics、token/size/depth limits。
- AI 產生結果先做 schema validation、symbol resolution、graph invariant validation，再進 VM；失敗時不下載半成品。
- prompt 中提供 capability registry 摘要與已知限制，避免模型自行捏造 mutation 或 block IDs。

退出條件：每一個 AI output 都可追溯到 validation report；strict mode 不能產生 VM 不接受的 graph；preservation-edit 不會改動未選取的 raw fields。

### Phase 8：差異測試、效能與發布

工作：

- 建立 differential harness：`official parser → Raw IR → lossless export` 與 `official VM → normalized export` 分開比較。
- 建立 property-based/fuzz tests：隨機 block graph、深層 C-block、巨大文字、重複 asset、壞 ZIP、未知 opcode/mutation。
- Chrome、Firefox、Safari 最低 smoke；CSP report-only → enforce；nested Pages path、offline reload、download/upload 全部在 CI 驗證。
- 設定效能預算：初始 bundle、首次互動、100/500/2,000 blocks、asset bytes、最大解析時間與記憶體。
- 升級 `uuid` 與其他可達依賴；每次 upstream rebase 自動重跑 audit、fixture matrix 與 source-map reachability。
- 完成版本 migration、使用者文件、資料遺失警告、Pages deploy rollback 與 release checklist。

退出條件：L1/L2/L3 各自有綠燈；任何未完成能力都在 UI、README、CI artifact 與 release notes 明確列出。

## 建議實施順序

不要先把所有 opcode 填進現有 strict schema。正確順序是：

1. Phase 0：先建立官方 fixture 與比較器。
2. Phase 1：先完成 raw archive/lossless path，阻止資料遺失。
3. Phase 2：完成 generic block graph，解除 12 opcode 硬限制。
4. Phase 3–4：procedures、assets、comments、monitors、metadata。
5. Phase 5–6：core registry 與 extensions。
6. Phase 7–8：AI 編輯安全、差異測試、跨瀏覽器與 release hardening。

這樣每個階段都能發布可用的增量版本，而且不會因先擴大 opcode 清單而把目前的資料遺失問題藏在更大的 schema 後面。

## 不應承諾的事項

- 不承諾所有第三方 extension 在 GitHub Pages offline 環境執行；只能承諾資料保存，除非有明確 adapter。
- 不承諾 VM normalization 後與原始 ZIP byte-for-byte 相同；應提供 normalization report。
- 不承諾 cloud variables、硬體、攝影機、聲音輸入在沒有服務/權限的瀏覽器中可執行。
- 不以「官方 parser 接受」單獨代表「官方 VM 可執行」；兩者必須是不同測試燈號。

## 官方與本機證據

- [Scratch VM README](https://github.com/scratchfoundation/scratch-editor/tree/develop/packages/scratch-vm)
- [官方 SB3 serializer/deserializer](https://github.com/scratchfoundation/scratch-editor/blob/develop/packages/scratch-vm/src/serialization/sb3.js)
- [官方 procedures serialization tests](https://github.com/scratchfoundation/scratch-editor/blob/develop/packages/scratch-vm/test/unit/serialization_procedures.js)
- [官方 SB3 serialization tests](https://github.com/scratchfoundation/scratch-editor/blob/develop/packages/scratch-vm/test/unit/serialization_sb3.js)
- 本機 VM fixtures：[`packages/scratch-vm/test/fixtures`](../../scratch-vm/test/fixtures)
- 目前 bridge：[status.md](status.md)
