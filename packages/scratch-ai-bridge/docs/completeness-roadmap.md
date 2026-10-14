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
- project 還有 `monitors`、`extensions`、`meta`；extension ID 會由 opcode prefix 推導。Scratch VM upstream loader 遇到未知 ID 會嘗試啟動 extension Worker，因此 Bridge adapter 必須在匯入入口攔截，只允許明確列出的本地 built-ins。
- procedures 有新舊兩種 prototype 格式；官方測試涵蓋 shadow argument reporters、warp、argument IDs 與 definition/call hierarchy。
- 官方 VM fixture 已包含 comments、monitors、cloud variables、broadcast 特殊字元、unknown opcode、procedures、extensions、損壞或缺失素材等案例。

因此目前的「Canonical IR → VM load → VM save → decompiler」不能作為唯一匯入路徑；VM 會進行合法的正規化，卻不保證保留所有原始表示。

## Scratch SVG renderer 整合結論

本機 `@scratch/scratch-svg-renderer` 版本為 15.2.0，已在 monorepo 中由 `scratch-vm`、`scratch-render` 與 `scratch-gui` 使用；Bridge 已依賴 `scratch-vm`，所以目前透過 VM 的 SVG sanitizer 間接使用它。獨立 GitHub repository 已封存，後續維護位置是 `scratch-editor` monorepo；不得另裝舊的 `scratch-svg-renderer` npm 套件或複製 renderer 實作。

套件邊界：

- `sanitizeSvg.sanitizeByteStream()`：SVG bytes 進入 VM 時的安全清理；這會改變輸入 bytes，只能用於 VM/正規化路徑，不能改寫 Raw Archive IR 的原始 asset。
- `loadSvgString()`：SVG parse、sanitize、尺寸/viewBox/stroke/image normalization，並處理 Scratch 2 SVG 相容規則；適合在瀏覽器測試/預覽中驗證單一 SVG。
- `SVGRenderer`：將單一 SVG 畫到 canvas；它不是 Scratch workspace、stage、VM 執行器，也不會把文字變成程式積木。
- 整個作品的 stage preview：應由 Scratch VM 與 `scratch-render` 呈現；若需要積木編輯器，再評估 `scratch-gui`/`scratch-blocks`，不可用 SVG renderer 取代。

整合決策：Bridge 經 Scratch VM 載入專案，再以延遲載入的 workspace `@scratch/scratch-render` 呈現初始舞台狀態；不自行合成角色圖、不啟動專案腳本。SVG costume 的單圖解析/安全測試仍直接驗證 workspace `@scratch/scratch-svg-renderer`。Raw Archive 匯入/匯出仍保存原始 SVG bytes；VM 輸出則記錄 sanitize/normalize 後的差異。

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
2. `normalizeThroughVm()`：已實作；將 lossless project 載入官方 VM，輸出 VM 寫出的 SB3 與版本化差異報告。報告列出 `project.json` JSON Pointer 變更及每個 archive entry 的來源／輸出 SHA-256，不複製原始值；10 個官方 `vm-normalized` fixture 均執行報告 entry/hash 對照並由官方 VM 重新載入；Chromium/Firefox/WebKit 下載與 hash 比對也通過。
3. `compileCanonicalToSb3()`：AI 產出的新專案直接走 VM 驗證，再輸出新檔。
4. `exportLosslessSb3()`：若沒有要求正規化，依 Raw Archive IR 輸出，並保留未理解欄位、archive entry bytes 與 ZIP archive comment bytes。VM 正規化差異報告另以 SHA-256 記錄 archive comment 的新增、移除或變更。

## 分階段實作

### Phase 0：相容性契約與 fixture matrix

工作：

- 建立 `compatibility/` fixture index，收錄官方 `scratch-vm/test/fixtures` 中所有 SB3、sprite3、procedures、comments、monitors、extensions、unknown-opcode、cloud-variable 與壞檔案例。
- 每個 fixture 標記 `parse-only`、`lossless`、`vm-normalized`、`behavioral` 四種期望，不把官方 loader 的已知正規化誤判成 bug。
- 定義比較器：project JSON canonicalization、block graph signature、asset filename/hash、metadata/monitor/comment signature。
- 建立可重現的 baseline：Scratch VM、scratch-parser、Node、browser 版本與 upstream commit 固定記錄。

退出條件：至少 30 個官方代表 fixture 可自動分類；每個失敗都有「資料丟失、VM 正規化、unsupported runtime、壞檔」四類之一的明確原因。

### Phase 1：Raw Archive IR 與安全 ZIP 層

Status: implemented for the current 34-file official SB3 inventory and the malformed/security regression corpus. Import/export round-trips project JSON bytes, every entry payload/hash, filenames/order, supported local/central ZIP metadata, data-descriptor mode, and archive comments. ZIP records are reconstructed, so original compressed streams and non-entry gaps are outside the byte-identity contract.

工作：

- 將目前 `validateSb3Archive()` 擴充為可保存 central-directory metadata、entry ordering、compression method、CRC、compressed/uncompressed size、filename encoding。
- 以 `RawSb3Project` 保存 `project.json` 原始 bytes、解析後 JSON、所有 archive entries、archive comment bytes、asset bytes、MD5/SHA-256 與原始 filename；原始 comment 會在 JSZip 的暫存解析視圖移除，避免註解內的假 EOCD 簽章干擾 entry 解壓，lossless export 再逐 byte 附回。
- 保留未知 root/target/block/monitor 欄位；schema 驗證採 `known fields + unknown fields passthrough`，不能使用 `additionalProperties: false` 把未知資料拒絕掉。
- 加入 duplicate filename、path traversal、symlink-like entry、ZIP64、encrypted entry、compression bomb、巨大 JSON、UTF-8 異常的測試。
- 在解壓前確認各 local file record（header、filename/extra 欄位、壓縮 payload 與可選 data descriptor）不重疊，並驗證 data descriptor 的 CRC/尺寸與 central directory 相符，避免不同 entry 共用或交叉指向 archive bytes。
- `exportLosslessSb3()` 先不經 VM，能對輸入 fixture 產生語意等價且 assets hash 完整的 archive。

Raw Archive IR 保存 central/local extra fields、entry comments、version-made-by/needed、attributes、原始 DOS date/time words、data descriptor 有無 signature，以及 entry 順序、檔名 bytes/編碼、壓縮方法、CRC、尺寸、flags、offset、entry payload 與 archive comment。匯出會重建 ZIP records，保留上述欄位與解壓後 bytes/hash，但不保留原始 compressed stream bytes、local-record 間隙或整份 archive 的 byte-for-byte 表示；CRC/size 與 offsets 會依輸出重新計算。自訂 metadata regression 與目前 inventory 中全部 34 個官方 SB3 fixture 的逐 entry round-trip 比對均通過。

退出條件：所有合法官方 fixture 的 `project.json` 未知欄位、素材 bytes 與 Raw Archive IR 承諾保存的 ZIP metadata 都能 round-trip；惡意 ZIP 測試不能穿透既有大小與 entry 限制。

### Phase 2：通用 Block Graph 與 primitive/shadow 完整化

Status: generic raw-graph preservation gate implemented. The generic graph API copies and replaces per-target block records without
filtering unknown opcodes or fields, and reports dangling references, duplicate references, multiple or inconsistent parents, and cycles across `next` and nested input references.
The validator also checks SB3 input descriptor kinds 1/2/3, inline primitive kinds 4–13, reference field types, and nested
non-shadow substack roots. Copy/replace signatures pass across all classified non-parse-only official SB3 fixtures; procedure
definition/prototype metadata, same-target procedure call resolution, call argument IDs/inputs, and argument reporter ownership
are validated (including legacy shadow prototypes).
Registered block fields also receive tuple-shape, required-field, name, and enumerated-value checks; unknown extension opcodes
remain opaque and are not subjected to the core registry's field rules.
`decompileSb3WithBlockGraphs()` now returns both the VM-derived Canonical IR and a raw graph snapshot from the source
archive; SB3 analysis reports unmodeled opcodes and graph issues from that snapshot. Compiler and decompiler now share one
ID-linked codec for the Canonical IR v1 tree projection. It does not make that tree projection lossless: opaque raw graph
details remain on the raw path. `mergeScratchBlockGraph()` provides a node-level
raw edit contract: omitted node properties and opaque extension fields survive, explicit `null` deletes a node, and the resulting
graph must pass the invariant validator. `patchProjectBlockGraphs()` scopes edits to explicitly identified targets, and
`patchLosslessSb3BlockGraphs()` carries them through SB3 export while retaining every non-project archive entry byte-for-byte.
Nested `inputs`, `fields`, and `mutation` are replaced as units. `CanonicalOpcode` is now an open string type while
`KnownOpcode` names the capability registry; the structural schema accepts unknown opcode strings and strict semantic validation
rejects them before compilation. The canonical projection now covers primitive kinds 4–13 and
uses a type-3 descriptor's shadow fallback when its active value is empty, resolving known menu shadows through capabilities.
Unknown raw fields and shadow details remain available on the independent raw graph path. The compatibility gate now covers the
official extension fixture `load-extensions/confirm-load/pen-dolphin-3d.sb3`, top-level reporters, broadcast special characters,
and a synthetic SB3 containing a third-party opcode. Older official procedure fixtures may omit child `parent` fields; the
validator infers a unique parent from graph references and still reports explicit mismatches. A target-scoped AI patch format
and local apply/export UI are now implemented as a first preservation-edit slice; broader validation and interaction checks stay
in Phase 7.

工作：

- `CanonicalOpcode` 已改為開放字串，`KnownOpcode` 對應 registry；strict semantic validation 仍拒絕未知 opcode，raw preservation path 不經此限制。
- 將 SB3 block graph 表示完整化：`id`、`next`、`parent`、`inputs`、`fields`、`shadow`、`topLevel`、`x/y`、`mutation`、`comment` 與原始 extension data。
- 正確處理 `1/2/3` input descriptor、inline primitives、variable/list/broadcast primitive、obscured shadow、top-level reporter 與 C-block substack。
- 建立 block graph invariant validator：無 dangling IDs、無循環 next、parent/child 一致、substack 邊界正確、procedure definition/call 可解析。
- compiler 與 decompiler 共用 `graph/codec.ts` 的 ID-linked block encoder/decode projection，不再各自維護 link traversal；
- `mergeScratchBlockGraph()`、`patchProjectBlockGraphs()`、`patchLosslessSb3BlockGraphs()` 已串起 raw patch 到 SB3 archive export；Phase 7 已接入受 target identity 約束的 AI patch prompt、UI 與原始 archive export。

退出條件：官方 unknown opcode、top-level reporter、shadow、broadcast special-character 與 nested C-block fixture 通過 graph signature round-trip。

### Phase 3：Procedures / Custom Blocks

Status: initial compiler/decompiler slices implemented. Canonical procedure definitions compile to current-format
`procedures_definition` / `procedures_prototype` graphs; `procedures_call` maps named Canonical IR inputs to Scratch argument IDs,
and call blocks plus argument reporters decompile with procedure/parameter names restored. `%s`/`%n`/`%b` parameter kinds, defaults,
warp, procedure bodies, and recursive call graphs round-trip through Scratch VM save/reload. Legacy shadow prototypes import into
the same Canonical IR. The official `pen-dolphin-3d.sb3` mixed-extension fixture now verifies all 19 procedure definitions, 31 calls, parameter names/kinds/defaults, warp flags,
canonical call mapping, and graph invariants. Numeric-only `%n` parameters now retain their `number` kind through Canonical and Scratch VM compile/decompile; the report continues to identify legacy prototype normalization and invalid
metadata (including malformed warp values) that causes a procedure to be skipped; the browser exposes and downloads this report. Bounded VM execution assertions run the five-level recursive countdown using a numeric-only `%n` parameter with warp both disabled and enabled; both produce the expected score, in addition to the official fixture’s warp serialization checks. The upstream fixture suite contains no additional SB3 procedure project; other legacy variants remain open. A fixed-seed 128-case generated regression now executes recursive procedures whose omitted calls use all three typed defaults (`%s`, `%n`, `%b`) across all six parameter orderings and both warp settings. It covers Unicode strings, both boolean defaults, and boundary-sized numeric defaults. The generated corpus verifies the complete import/compile/reload path; broader procedure graph variations and additional legacy metadata layouts remain open. During Canonical import, omitted call inputs are now materialized as literal prototype defaults, while Raw Graph validation accepts missing declared inputs but continues to reject unknown argument IDs. The full 128-case matrix verifies project JSON → Canonical import → SB3 compile/save → separate VM reload and execution for all three default kinds, all six parameter orders, and both warp settings. A separately compiled SB3 archive with call inputs removed also passes `decompileSb3WithBlockGraphs()`; its Raw Graph has no false invalid-call issue, Canonical IR receives both defaults, and the recompiled VM executes with the expected result.
Although the upstream suite has no independent SB3 procedure fixture, a reproducible execution slice is now generated from the official `pen-dolphin-3d.sb3`: it keeps Stage plus the procedure-bearing Title target, removes unrelated Stage scripts and Pen extension data, and substitutes blank costumes, and sets `control_wait` durations to zero so the synchronous execution harness reaches both procedure calls. Official VM execution invokes both preserved `fade in` and `fade out` procedures; Bridge decompile validates the Raw Graph and retains both definitions; Canonical recompilation and saved-SB3 reload each invoke both procedures again. This verifies one SB3 project path, not the full multi-target Pen project or every procedure body.
The upstream Scratch VM's older shadow-prototype serializer regression includes a procedure body attached after its definition. Bridge now adds a three-parameter legacy `%s %n %b` shadow-prototype case with embedded reporters, executes the imported old-format project, normalizes and recompiles it, then executes the modern result with exact string/number/boolean state assertions. The focused project-json file passes 28/28; Bridge passes 310/310 and production build/bundle budgets pass. This closes one multi-argument legacy layout, not all legacy procedure variants. The explicit legacy execution fixture matrix now compares itself to every upstream `procedures-*.sb2` file, so additions or removals fail until the set is reviewed; all 12 current fixtures are included.
An additional bounded VM assertion calls a procedure twice with string and boolean arguments and confirms that the false call leaves state unchanged while the true call passes its string into the procedure body. Another raw Scratch project JSON execution case removes serialized call inputs and confirms that the VM applies the string and boolean defaults from the procedure prototype; Canonical import now materializes omitted call inputs from the corresponding procedure prototype defaults. Nested calls now include single-string forwarding, a three-procedure mixed-type forwarding chain, and a three-procedure call chain where a raw nested call omits string and boolean inputs and receives both prototype defaults across mixed warp settings. A recursive case also omits the boolean input on each recursive call and verifies that the prototype default is applied with warp both enabled and disabled. Legacy shadow-prototype tests cover `%s`, `%n`, and `%b`, then recompile and verify modern SB3 reload and graph invariants. All 12 upstream Scratch VM procedure execution SB2 fixtures now pass through official VM normalization, Bridge Canonical decompile/compile, a second VM execution, and a saved-SB3 reload in a separate VM; the test compares `plan/pass/fail/end` SAY assertions across all three runs. This exposed and fixed `%b` false serialized as an empty string and Scratch's numeric-zero fallback for argument reporters outside their procedure scope, including boolean reporters. The official SB3 procedure fixture `pen-dolphin-3d.sb3` contains pen opcodes outside the current Canonical allowlist, so it remains covered by import/mapping checks rather than an execution assertion. A separately authored minimal SB3 procedure project now executes through the official VM, decompiles to Canonical IR, recompiles, saves, and reloads with the same SAY output; this closes the independent SB3 execution fixture gap. Broader procedure graph variations and legacy metadata layouts remain open.

A generated procedure-body case now compiles a boolean argument reporter through nested `control_if_else` branches followed by a nested `control_repeat`; it exports SB3, decompiles back to Canonical IR with no Raw Graph issues, recompiles, and executes in a separate reloaded VM. Both branches and the repeated side effect are asserted after both VM runs. This closes that specific C-block combination; broader graph and legacy metadata variants remain open. A separate two-target fixture declares and calls the same procedure name independently on Stage and Sprite, with a boolean parameter on Stage and a string-number parameter on Sprite; round-trip, compile, and VM reload assertions confirm each distinct signature and call remains target-local. Broader graph and legacy metadata variants remain open.

工作：

- 將 `CanonicalProcedure` 接入 project JSON 與 VM round-trip（definition/prototype/body/call 初始 slices 已落地）。
- 產生 `procedures_definition`、`procedures_prototype`、`procedures_call` 與 procedure-scoped `argument_reporter_string_number`、`argument_reporter_boolean`。
- 正確產生與解析 `proccode`（含 `%s`/`%n`/`%b`）、`argumentids`、`argumentnames`、`argumentdefaults`、`warp`、call input mapping。
- 同時接受官方新格式與舊 shadow-prototype 格式，輸出時採官方目前格式；normalization report 涵蓋舊格式與不完整 metadata skip，其他變體仍待補。
- 驗證 target-local call scope、遞迴 call graph、缺少 definition、參數數量/型別、default value 與 boolean reporter；12 個官方 SB2 execution fixtures 經官方 VM 正規化後已通過 Bridge 往返與行為對照。

退出條件：官方 procedures serialization tests 與現有 procedures execute fixtures 已通過；遞迴、warp、舊格式匯入都不會遺失語意。上游 execution fixtures 是 SB2，故以官方 VM 轉成 SB3 後測試；Bridge 不宣稱直接支援 SB2 archive。

### Phase 4：Assets、comments、monitors、metadata

Status: initial costumes, sounds, comments, and monitors slices implemented. Canonical IR round-trips workspace and block-bound comments, including text, layout,
and minimized state. Monitor IR preserves mode, params, values, visibility, layout, and slider limits, and recompilation remaps variable/list monitor IDs to the generated symbol IDs. Official fixtures cover two workspace comments, five block comments, and 18 monitors. Both SB3 decompiler APIs retain referenced SVG/PNG/JPG/BMP costume and WAV/MP3 sound bytes as data URLs. Official default and bitmap-bearing fixtures verify byte-identical assets after recompilation; focused archive tests also check WAV data-URL and MP3 Base64 input, stored bytes, rate, and sample count. Recursive metadata is bounded to 128 levels and 100,000 values to prevent unbounded validation/import work. Missing assets and MD5 mismatches on VM-decodable targets are flagged in Canonical IR, and compilation rejects them instead of substituting placeholders. Bridge VM instances attach the official `@scratch/scratch-svg-renderer` `BitmapAdapter`. When restoring raw costume bytes after VM normalization, the decompiler also restores source `bitmapResolution` and rotation centers; Chromium/Firefox/WebKit assert those values and bytes against official bitmap-bearing `comments.sb3`, then verify its recompiled SB3 preserves the PNG bytes and two-costume sprite while rendering the preview. Sprite position, direction, size, visibility, drag mode, rotation style, and selected costume index are also checked against the source fixture; a source direction of 360 remains 360 in Canonical IR despite official VM normalization. The corrupt/missing PNG fixtures stay parse-only because their assets are intentionally unusable. Cross-browser smoke exercises official `loadSvgString()` normalization and `SVGRenderer` drawing on generated and imported SVGs; it also verifies `sanitizeSvgText()` removes script, foreignObject, external image URI, and event-handler attributes, and malformed non-SVG input rejects. A separate smoke loads the official renderer as a same-origin script on the app's CSP and verifies nonblank canvases for generated and imported SVG costume assets in Chromium, Firefox, and WebKit. The student result now uses Scratch VM + `scratch-render` for a positioned, static initial-stage preview; scripts remain stopped. SVG and bitmap rendering use the VM pipeline. Screenshot-difference assertions verify the VM-rendered canvas contributes visible pixels in Chromium, Firefox, and WebKit. A two-costume synthetic Player project selects costume index 1 and verifies the selection survives compile/download in all three engines. On the first browser import, the decompiler now detects bitmap costumes and attaches the deferred official Scratch renderer before VM loading; its temporary canvas is removed and its WebGL context released after import. Chromium/Firefox/WebKit upload official `missing_png.sb3` and `corrupt_png.sb3` from clean pages, complete Canonical conversion, retain `missing-archive-entry` / `checksum-mismatch`, and show the asset warning in analysis. Animated execution now uses the isolated VM + `scratch-render` path, with keyboard/pointer input and a 15-second cap; Chromium, Firefox, and WebKit verify visible response and restoration on stop. The official `monitors.sb3` fixture separately verifies its selected Stage backdrop with sprites hidden and selected Heart costume with other sprites hidden. The official `pen-dolphin-3d.sb3` fixture renders the project with its selected resolution-2 PNG backdrop and mixed PNG/SVG costumes in Chromium, Firefox, and WebKit. Its index-0 versus selected-backdrop screenshot check was removed because the fixture/VM run produced identical screenshots; `monitors.sb3` remains the selected Stage/sprite costume difference assertion. Chromium/Firefox/WebKit now also preview the official corrupt/missing WAV (2), PNG (2), and SVG (2) fixtures without failing VM initialization; Before VM decompilation, the Bridge now makes a safe copy of imported projects and replaces missing/checksum-invalid costume assets with generated, MD5-valid SVG assets; it then restores the original bytes and issue markers in Canonical IR from Raw Archive. The student preview uses a separate preview-only archive for animation. Chromium/Firefox/WebKit assert nonblank canvas pixels for official missing/corrupt PNG and SVG costume fixtures; the SVG fixtures are root-normalized in the smoke because upstream stores their project.json under a folder, which is intentionally an archive-boundary case. The Pen fixture confirms a real Scratch audio source starts, a canvas gesture resumes its AudioContext, and stopping the preview closes that context. A generated archive based on the official default fixture gives two sprites separate green-flag `sound_play` scripts using the bundled WAV; Chromium, Firefox, and WebKit instrument `AudioBufferSourceNode` start/end events, require a concurrency peak greater than one, and verify preview stop closes the context. One sprite sets Scratch PITCH to 120 and its source playback rate reaches 2×. A second sets PAN to -100, plays, then changes by +200; AudioParam gain targets move from 1/0 to 0/1. A third sets PITCH 120, clears effects, then plays at 1×. A fourth sets PITCH 120, changes by -30, then plays at the PITCH 90 rate (~1.682×). A fifth sets volume to 50, plays, waits 0.5 seconds, lowers volume by 25, and plays again; AudioParam ramps reach 0.5 then 0.25. A sixth voice calls `sound_stopallsounds` after 0.2 seconds; Chromium, Firefox, and WebKit verify at least four active AudioBufferSourceNodes receive stop while the preview AudioContext remains running, then preview stop closes it. A separate one-sprite fixture verifies `sound_playuntildone` by requiring AudioBufferSourceNode lifecycle order start → ended → start before the next `sound_play`. Other sound-effect combinations, output latency, hardware output, and perceptual fidelity remain open. Project extensions, recursive JSON `meta` values (including null, arrays, nested objects, and special keys), and common Stage/sprite settings (`currentCostume`, `volume`, `layerOrder`, `tempo`, `videoTransparency`, `videoState`, `textToSpeechLanguage`) now round-trip through Canonical IR and the compiler; official monitors and Pen extension fixtures cover these paths.

工作：

- costumes：SVG、PNG、JPG/JPEG、bitmapResolution、rotation center、broken/missing asset policy。
- sounds：WAV、MP3、rate、sampleCount、format 與 raw bytes。
- comments：獨立 comment、block-bound comment、位置、尺寸、minimized、文字與官方 ID remapping。
- monitors：variable/list watcher、opcode、params、spriteName、mode、value、slider、位置、visibility。
- stage/sprite metadata：layerOrder、tempo、video state、text-to-speech language、visibility、rotationStyle、volume。
- project meta 與 extension list 全部保留；對 offline cloud variable 只標示不可連線，不改寫其宣告。
- SVG 整合採三步：①確認原始 bytes 在 lossless path 不變；②以官方 VM 載入/保存並記錄 sanitizer 差異；③已在 Chromium/Firefox/WebKit 的 production CSP（same-origin scripts/style attributes；inline style elements 僅供固定 sandbox 樣式與 bundled font-face）頁面驗證同源官方 renderer 可將生成與匯入 SVG 畫成非空 canvas，另驗證 `loadSvgString()` 尺寸/viewBox 正規化、危險節點/URI 清除及 malformed 文件拒絕。Scratch 2 SVG quirks 與其他內嵌 bitmap renderer 邊界行為仍待補；官方 BitmapAdapter 已掛入 VM 並有三瀏覽器解析度 1 PNG smoke。
- 產品預覽需求分流：單張 costume 檢視可使用 `loadSvgString()`/`SVGRenderer`；靜態及可執行作品預覽使用 VM + `scratch-render`，不自行實作 stage 合成或 runtime。可執行預覽位於腳本限定的 opaque-origin iframe，支援鍵盤／舞台滑鼠輸入、手動停止及 15 秒 Runtime 上限；三瀏覽器 smoke 驗證輸入造成畫面變化並在停止後還原靜態預覽。官方 `monitors.sb3` 中非預設 Stage backdrop 與 sprite costume 的畫面選取也通過三瀏覽器檢查。隔離預覽頁以專用 CSP 支援 renderer 內層 sandbox，應維持與主應用頁的 CSP 邊界。
- 不在原始匯入路徑 sanitize 後覆寫 asset；sanitize/normalize 只作用在 VM runtime 或明確選擇的正規化輸出，並加入 normalization report。

退出條件：官方 comments/monitors/assets/cloud fixture 通過；官方 SVG renderer 能載入 Bridge 生成和選定的 fixture costume；原始 SVG bytes 在 lossless round-trip 保持一致；每一種被 VM 正規化的差異都出現在機器可讀 normalization report，而不是靜默消失；`normalizeThroughVm()` 已通過 10 個官方 vm-normalized fixture、未知欄位移除案例與三瀏覽器輸出／hash 驗收；其他 parse-only/lossless 類別不應被 VM 正規化路徑替代。

### Phase 5：核心 opcode capability registry

Status: registry, source inventory, VM serialization coverage, and runtime invocation tracking for every strict opcode are implemented; exhaustive edge-case and visual behavior coverage remain open. The 130-opcode strict-authoring
registry drives AI instructions, required input/field checks, target restrictions, Boolean shapes, and Scratch menu-shadow
compilation. A generated project containing all 130 strict capabilities passes the official `scratch-parser` SB3 validator,
then loads, saves, and reloads through the official Scratch VM with a headless renderer stub; the test confirms every opcode
survives that round-trip. A pinned-source inventory test classifies all 139 primitive entries found in Scratch VM: 130 strict capabilities,
9 intentionally preserved legacy/no-op opcodes, internal sound menu opcodes, and procedure graph opcodes are separated by
their existing runtime/graph roles. That serializer gate is separate from runtime behavior; the coverage gate and targeted runtime cases are described below.
Bounded runtime assertions now cover all 14 registered `operator_mathop` function choices, all seven `sensing_current` menu values, and all three `control_stop` options; green-flag/arithmetic/comparison/Boolean/random/string reporters, repeat/list/text, broadcast send/receive and
broadcast-and-wait completion ordering,
clone creation/start/deletion, repeat-until/if/if-else control flow (true and false if branches), sprite position/visibility/rotation, motion reporters, and timed glide completion/resume,
next/direct costume switching, costume-name reporter, and size set/change/reporter, say/think text-skin events plus timed say/think bubble drawable removal through the renderer adapter, Stage and sprite click hats, backdrop-switch and touching-object event hats plus switching/name/number and backdrop-and-wait when its hat is unavailable, sound play/stop and play-until-done wait/resume, pitch/pan effect clamp/change/clear through a target sound-bank adapter, plus sound volume, keyboard event hats plus pressed/any-key, mouse coordinate/button, drag-mode state, and username sensing, `sensing_distanceto` reports for other sprites and the mouse, `sensing_of` sprite position/size and target-variable reads plus Stage volume/backdrop number/name, and `ask`/`answer` wait/resume behavior. A TypeScript-AST coverage gate checks every strict opcode literal appears inside a VM behavior-test callback that invokes a runtime execution helper and contains an observable expectation; a second gate instruments Scratch VM primitive and hat dispatch calls and confirms all 130 strict opcodes were actually invoked across those tests. Titles and comments alone do not count. The cases cover representative valid behavior, not every edge-value combination, concurrency condition, rendering detail, or browser-dependent outcome. Additional fixtures cover timer reset/reporter, control-counter increment/read/clear, all seven registered graphic-effect renderer updates, sprite layer-order renderer commands, list contents reporter plus insert/replace/search/delete operations, sprite-to-sprite collision
sensing through the renderer adapter, and variable/list watcher show/hide transitions, calendar/year and days-since-2000 reporters, and no-audio loudness/Boolean behavior. Exhaustive edge-case and visual equivalence remain open.

工作：

- 從官方 VM/Scratch Blocks opcode metadata 建立版本化 registry：opcode、category、輸入名稱/型別、field、shadow、stack input、reporter/statement/hat、可否在 stage 使用。
- compiler 只依 registry 產生 generic block graph；不再把 12 個 opcode 寫死在 schema。
- registry 分 `core-supported`、`core-preserved`、`extension-preserved`、`runtime-unavailable`，讓 UI 能精確顯示能力而不是籠統說「未知」。
- 為全部 core opcode 建立最小合法 fixture，逐一載入/保存；130 個 strict opcode 現各有 targeted VM behavior assertion，且 runtime instrumentation 確認實際 primitive/hat dispatch 全部發生；TypeScript-AST gate 同時檢查 opcode literal、runtime execution call 與 observable expectation；其餘官方 legacy/no-op opcode 只作 preservation 分類。

退出條件：所有官方 core opcode 能被 parser 接受並在 L1 round-trip；可執行 opcode 在 L2 通過行為測試；不支援 runtime 的項目只產生清楚警告。

### Phase 6：Extensions 與第三方資料保存

Local behavior coverage includes micro:bit sensor packet decoding and VM-registered block primitive wrappers for button,
gesture, tilt, touch-pin, LED matrix, text, and clear-display behavior. Sensor decoding ignores frames shorter than the
10-byte protocol payload so malformed notifications cannot erase the last valid reading. A mock Scratch Link BLE socket exercises discover,
connect, notification-enabled read, incoming sensor notification, exact LED symbol/text/clear payloads, and disconnect; the
wire test checks 19-character text truncation. WeDo 2.0 has a
separate mock pairing regression for service filters, connection, notification subscription, and startup LED writes. EV3
verifies BT discovery/PIN, exact tone bytes, and mock device-list discovery followed by VM motor power/direction execution;
mock touch/color/ultrasonic sensor replies verify button, brightness, distance, and motor-position reporters/predicates;
the `PROJECT_STOP_ALL` path checks the EV3 motor coast and sound-stop direct commands. Boost verifies its manufacturer-data
filter and notification subscription. GDX now
runs a mock Go Direct initialization over its BLE adapter and clears the Go Direct command-polling interval when reset.
WeDo 2.0 also exercises the registered VM motor-direction, motor-power, and motor-off primitives against the mock Scratch
Link socket, checking the exact firmware bytes, reverse direction encoding, and the 100% power clamp. Distance and tilt
sensor advertisements and BLE value notifications now reach registered VM reporters and hats, including distance
comparisons, directional tilt angles, and threshold predicates. This remains a mock protocol check; physical firmware
interoperability is unverified.
The GDX mock returns a sensor-channel mask and four sensor-info responses during Go Direct initialization, starts
measurements, then sends Go Direct `NORMAL_REAL32`, `WIDE_REAL32`, `SINGLE_CHANNEL_REAL32`, `SINGLE_CHANNEL_INT32`,
`APERIODIC_REAL32`, and `APERIODIC_INT32` notifications through the Scratch Link characteristic callback. Decoded values
reach registered Scratch VM primitives, which assert force saturation/sign and push/pull threshold, acceleration, tilt,
and free-fall behavior. Values and sensor metadata are synthetic; ignored packet types, live sensor calibration, and
physical sensor interoperability remain unverified.
Boost now invokes the registered motor-power, motor-direction, motor-on, and motor-off primitives against its mock BLE
peripheral. The test checks 100% clamping, reverse signed-power encoding, speed-profile bytes, and the stop command in the
exact LEGO Wireless Protocol messages. A 1.5-rotation command also checks degree conversion, braking/profile bytes, and
that the VM primitive waits until the mock hub reports completion. Mock `PORT_VALUE` notifications now also exercise
registered tilt-angle/tilt-hat and color reporter/change-hat behavior. The test covers tilt values, stable five-sample
color readings, and the temporary `none` reporter state while mixed color samples pass through the rolling window.
This remains a protocol-mock check; physical hub interoperability is unverified.
Physical Scratch Link installations and device firmware interoperability remain open.

Status: initial preservation slice implemented. Project extension IDs survive Canonical decompile/compile; all six official
VM extension projects (Video Sensing, Text to Speech, Music, WeDo 2.0, EV3, and micro:bit), both Pen fixtures, and a synthetic
third-party unknown-opcode archive are classified for raw archive preservation. Their project JSON bytes, entry ordering, and
entry hashes are checked after export. Focused VM behavior checks run built-in Pen clear/down/move/up, size set/change, color/saturation set/change, transparency, and stamp blocks through a
headless renderer adapter and assert point/line attributes and coordinates, 8-bit RGB quantization/transparency, plus stamped drawable IDs; Music tempo commands/reporters plus `rest`, `play note`, and `play drum` beat-duration wait/resume behavior are exercised, including a zero-beat note completing without a wait and headless timing without an audio device. Text to Speech has a network-mocked primitive test for its fixed service endpoint and 128-character input bound. Interactive preview now asks before every Text to Speech or Translate request to the fixed Scratch service endpoint; consent displays the submitted text, caps Text to Speech at 128 characters and Translate at 1,024 characters, and cancels declined or over-limit calls. Other hosts are not covered by this consent. Chromium, Firefox, and WebKit browser smoke exercises the parent consent dialog; denial sends no request, per-call approval sends one, 1,024-character Translate input is accepted, and 1,025 characters are rejected before consent. A bundled WAV mock confirms approved TTS responses decode and start Scratch Audio, while stubbed Translate JSON visibly changes stage output in all three engines; live service response/codec fidelity remain unverified. The
VM adapter allows only explicitly bundled extension IDs to load. Unknown IDs are blocked from the VM worker/importScripts
path while their declarations and block graph remain serialized. `faceSensing` and `videoSensing` are explicitly disabled:
their upstream adapters access the camera during initialization, and face sensing also falls back to a MediaPipe model
hosted on jsDelivr. Analysis warns that their original raw graph/archive data remains preserved while runtime loading is
disabled. All 10 other bundled adapters instantiate through the local VM adapter; six official non-camera extension fixtures
load through their corresponding local adapters, and the Video Sensing fixture remains preserved in Raw Graph IR. Broader extension behavior
and device availability remain open.

The animation preview now exposes scan, connect, status, and disconnect controls for WeDo 2.0, micro:bit, EV3, Boost, and GDX for.
Scratch Link's local `ws://127.0.0.1:20111` and fixed `wss://device-manager.scratch.mit.edu:20110` fallback are allowed only
in the isolated preview CSP. Searching starts only after the user presses its control; stopping the preview disconnects all
five adapters. Chromium, Firefox, and WebKit smoke now mock Scratch Link discovery, connect, and disconnect; stopping the
preview also verifies the WebSocket closes. Physical device behavior and Safari's Scratch Link integration remain unverified.

工作：

- 以 opcode prefix 與 project `extensions` 建立 extension registry，但禁止 Pages 在匯入時執行遠端 extension code。
- 對官方 extension fixture 做「保存/還原」測試；有官方 runtime adapter 時再做行為測試。
- 未知 extension block 必須原樣保留 opcode、inputs、fields、mutation、comments 與 assets。
- 對會使用網路、硬體、micro:bit、攝影機、雲端的 extension 明確標示 browser/offline 限制。
- extension URL、metadata 或自訂 schema 不得被當成可執行 script 注入頁面。

退出條件：任何官方 parser 可接受的第三方 extension SB3 都能 L1 保存；有 adapter 的 extension 才能宣稱 L2 行為相容。

### Phase 7：Analysis 與 AI authoring 完整化

Status: in progress. AI-output hardening now includes a full prompt contract, path-specific structural repair, semantic symbol/block
checks, a real Gemini regression fixture, capability-derived strict-authoring prompts, and incremental generic analysis for
variable/list access plus procedure call dependencies; both script and procedure summaries include typed Canonical `variable`/`list` inputs, and transitive procedure effects retain those references. Direct and transitive procedure broadcast sends are also included in sender dependencies. Analysis now reports monitor references and missing symbols, declared
extension block usage from raw graphs, and missing/checksum-mismatched assets. A first preservation-edit flow copies source raw
graphs into a scoped AI patch prompt, binds returned target identities, validates graph invariants locally, rejects deletion IDs absent from the source, and exports from the
original lossless archive. Selected existing block properties can be removed explicitly through `removeProperties`; nested existing object properties can be replaced or removed with JSON Pointer `setPaths`/`removePaths` while sibling opaque values remain intact. Path operations reject unsafe segments, malformed pointers, duplicate or ancestor/descendant-overlapping edits, and paths that do not resolve against the source graph; parser and low-level merge tests both cover overlapping operations. A seeded 128-key property test exercises JSON Pointer slash/tilde escapes and verifies only the intended nested values change while opaque siblings and the source stay intact. Archive round-trip and Chromium/Firefox/WebKit downloaded-file re-import verify these edits preserve unrelated fields and assets. Broader mutation semantics remain open. Procedure variable/list access propagates through target-local call graphs to a fixed point, including
recursion. AI draft trees and recursive Canonical metadata are bounded to 128 levels/100,000 values and cycles reject before
recursive processing. Known node property shapes, registered field descriptor/value rules, graph references, and envelope
limits are validated. Raw Scratch imports also reject more than 100,000 blocks per target or nested input graphs deeper than
128 levels before VM loading or Canonical conversion. Repair Reports derive local input/field suggestions from the capability
registry and valid replacement samples for Canonical schema required/type/const/enum/oneOf/anyOf errors, string/array size constraints, and inclusive/exclusive numeric bounds; branch and lower-bound examples are checked by re-validating the corrected project. Every semantic validator code has an explicit suggestion and regression coverage. Missing/checksum-mismatched assets, malformed/empty encodings, raster signature mismatches, browser-decode failures for truncated PNG/JPEG/BMP data, and browser media-decode failures for truncated WAV/MP3 data now fail before VM compilation with exact repair paths; asset diagnostics avoid suggesting fabricated replacement bytes. AI response validation reports now cover both rejected and successful student-build outputs, hash the exact response and normalized Canonical project when available, and list passed/failed/review/skipped parsing, normalization, schema, semantic, and Scratch VM compile stages without storing raw response text. Parsing and normalization failures are now caught and reported separately, so parsed JSON that exceeds normalization depth/value limits is not mislabeled as a parse failure. Chromium, Firefox, and WebKit verify student-build validation reports for parse, normalization, Canonical schema, and semantic failures, plus successful Scratch VM compilation. Browser compilation now rejects malformed SVG XML before VM load using the browser XML parser; a student-build regression verifies the complete parse/normalize/schema/semantic-pass path and records malformed SVG as `compileFailureStage: svg-preflight` with `scratchVmCompile: skipped` and an exact costume pointer in Chromium, Firefox, and WebKit. Compiler reports distinguish SVG/raster/audio preflight, archive generation, Scratch VM load, and Scratch VM save failures. SVG parsing remains browser-only because the bridge is a front-end package. Production browser recovery loops cover six Canonical schema failures (`type`, `additionalProperties`, `enum`, `const`, nested `required`, and `minLength`) plus seven semantic failures (invalid costume index, unknown sprite, variable, broadcast, list, procedure, and procedure argument) across Chromium, Firefox, and WebKit; each checks the report/prompt, complete corrected project, SB3 download, and relevant re-imported data. For `/name` minLength, the suggested `Scratch Project` is submitted before compilation; SB3 does not store Canonical project-name metadata. Malformed SVG, raster, and audio preflight failures each have an end-to-end report/prompt → corrected complete project → SB3 download → re-import flow, and the browser release evidence gate requires all three. Other compile-failure classes, broader semantic recovery, extensive preservation-edit usability, and broader mutation semantics remain open.

工作：

- Analysis IR 改為 generic graph 分析：detached script、dangling link、procedure dependency、broadcast dependency、list/variable read-write、monitor dependency、extension usage、asset missing。
- AI 輸入分兩種：`strict-authoring` 只允許 registry 已驗證能力；`preservation-edit` 允許未知 block 但只能做局部 patch，不讓模型重寫整個 raw graph。
- 加入 JSON schema version migration、repair suggestions、path-specific diagnostics、token/size/depth limits。
- AI 產生結果先做 schema validation、symbol resolution、graph invariant validation，再進 VM；失敗時不下載半成品。
- prompt 中提供 capability registry 摘要與已知限制，避免模型自行捏造 mutation 或 block IDs。

退出條件：每一個 AI output 都可追溯到 validation report；strict mode 不能產生 VM 不接受的 graph；preservation-edit 不會改動未選取的 raw fields。

### Phase 8：差異測試、效能與發布

Status: in progress. The private `scratch-ai-bridge` workspace is included in generated CI path filters with its
transitive Scratch dependencies. Its package CI lane runs unit tests with JUnit output, lint, Chromium/Firefox/WebKit browser
smoke, and native Safari WebDriver smoke. The Pages workflow also builds and validates the nested-path static artifact and gates deployment on Linux process-tree PSS evidence plus a macOS native Safari run. The hosted candidate workflow passed all of these gates on 2026-10-15 (run `38596592201`, candidate SHA `4749f4a8d8`); the Pages artifact was uploaded, while deployment correctly remained skipped because the source was not `main`. The public Pages site therefore still serves the older deployment. Monorepo CI reusable-workflow permissions were corrected on candidate SHA `61d7c76c1d`; its first Bridge Firefox smoke then had a Playwright click-stability timeout. The runner now matches the passed Pages environment (PulseAudio, headed Firefox under Xvfb, software GL). Full monorepo CI run `38600719853` passed on attempt 2 at SHA `967382bd88`, including all workspace checks and Bridge browser smokes; the first-attempt timeout remains recorded as a transient. The full workspace test and production build passed sequentially on 2026-10-14 (VM 3,872/3,872; GUI Selenium 127 passed/7 skipped; GUI Playwright 8/8; Bridge 410/410). Browser smokes cover exact-cap archive, AI recovery, SVG/raster/audio compile recovery, accessibility, security flow, import analysis, and offline reload under `/scratch-editor-ai-bridge/`.

Broad fuzz/differential suites, low-memory device validation, student usability sessions, physical Scratch Link hardware interoperability, vulnerable dependency owner triage, a real Pages rollback drill, deployed-page functional acceptance, and the final L1/L2/L3 release decision remain open. Latest hosted evidence establishes the candidate workflow gates, not those project-wide exit conditions. Browser smoke records 40 ms sampled process-tree RSS and Linux PSS; sparse sampling can miss short peaks. Production builds enforce emitted JavaScript limits of 5 MiB raw / 1.75 MiB gzip and
CSS limits of 256 KiB raw / 64 KiB gzip. Vitest and browser smoke have explicit latency budgets, while maximum-size archive
memory and first-interaction latency on low-memory devices remain unverified. Deterministic
512-sample generated tests now check valid chain preservation/opaque-field retention and reject malformed graphs with dangling
references, parent mismatch, cycles, duplicate references, multiple parents, invalid substack boundaries, and invalid input
descriptors. Every SB3 fixture classified `lossless` now passes raw import/export
differential checks for exact project JSON bytes and ordered entry hashes.
An additional seeded property check builds 128 valid nested C-block graphs at depths 1–128 and verifies copy/patch preservation,
opaque node data, and graph invariants. Four official malformed/missing costume fixtures now decode their actual 480×360
preview screenshots in Chromium, Firefox, and WebKit and assert at least 90% opaque pixels plus 16 distinct colors; exact
per-engine counts are retained in browser JSON artifacts. This confirms rendered image content is present, not that corrupted
assets have faithful appearance. The official parser/VM differential suite now runs 64 generated nested-script projects
through Canonical → SB3 → `scratch-parser` → VM decompile/Raw IR validation → Canonical → SB3 → `scratch-parser`, checking
Unicode and punctuation payload survival at each serialized boundary. These fixed-seed corpora improve reproducibility but do
not replace broad fuzzing or minimized-regression review.
The differential corpus also includes 32 generated projects with nested repeat stacks containing a Boolean reporter and
both if/else substacks; both branch payloads survive official parsing, VM decompile, and Canonical recompilation. The full
Bridge suite passes 311/311 tests across 30 files; this remains a bounded opcode/shape sample, not broad generated fuzzing.
Archive regressions now mutate local ZIP flags, compression method, CRC, compressed size, uncompressed size, and filename
independently and assert that local/central-header disagreement is rejected before import. The release checklist documents
pre-deploy gates, deployed-page smoke, and a corrective-commit rollback procedure; a real rollback drill is still required.
Every strict byte-prefix truncation of a valid minimal SB3 archive is also rejected, while the complete archive remains
importable; this adds systematic truncation-boundary coverage but does not replace broader structure-aware fuzzing.
Signed and unsigned ZIP data descriptors now have positive coverage, descriptor CRC corruption rejects, and overlapping local
record ranges reject before decompression. ZIP strong and central-directory encryption flags, plus unsupported general-purpose
flags, are rejected before decompression. Large native DEFLATE regressions cover CRC mismatch, output overrun, declared-size
underrun, and JSZip fallback when `DecompressionStream` is absent. The `scratch-render` hull dependency was removed and replaced by an output-equivalent
local convex-boundary normalizer, verified against 5,005 random point sets plus every 3×3/4×4 binary drawable mask; Scratch
Render TAP 183/183 and webpack build pass. Bridge suite passes 311/311 tests across 30 files after generated response,
normalization-report, procedure, and parser/VM differential follow-ups; package lint, production build/bundle
budgets, and three-engine browser smoke pass. Latest browser runs measured Chromium/Firefox/WebKit 322.7/316.2/284.6 ms and
process-tree RSS sums 2,309,046,272/3,925,524,480/439,681,024 bytes (5/5/5 samples); Chromium retained heap plus
backing-store growth is 5,610,983 bytes. Linux PSS remains pending its first Ubuntu artifact. An exact-cap 256 MiB Node
import now uses native `DecompressionStream('deflate-raw')` for entries at least 1 MiB, with JSZip fallback where unavailable;
the Node 26.8.2/macOS arm64 run accepted the archive in 3.18 s at 450,772,992-byte peak RSS from a 154,451,968-byte start
(+296,321,024 bytes), versus +393,019,392 bytes and 2.92 s before the native path. These are single-run samples and
exact-cap 256 MiB imports now pass in Chromium, Firefox, and WebKit, with sampled process-tree RSS recorded for each engine; precise peaks and the first Linux PSS artifact remain open. Workspace npm audit fell from 27 to 26 findings (7 to 6
critical) after removing hull.js; current source-map check matches zero of 28 vulnerable installed paths.
Latest CI-version Node 24.21.0/macOS arm64 browser run also passes the three exact-cap imports in 7.626/9.065/6.094 seconds, with sparse process-tree RSS sums 1,701,085,184/2,545,188,864/605,437,952 bytes (118/141/93 samples). Per-browser JSON now records Node, OS, architecture, and browser versions. Node 24 benchmark means are 51.894 ms for 4 MiB DEFLATE import and 1.169/0.452/0.218/0.690/8.597 ms for 2,000-block normalization/schema/analysis/JSON parse/archive compilation; all remain within configured budgets. These local macOS results do not establish Ubuntu PSS.
An additional seeded 512-sample single-bit mutation check flips bytes across a compressed SB3 archive and confirms each sample
is either rejected or leaves the project JSON and every entry payload unchanged. This is a reproducible mutation smoke, not
exhaustive fuzzing of ZIP structures or decompression behavior. A second seeded corpus now generates 12 valid multi-entry
archives with mixed STORE/DEFLATE entries and asset sizes immediately below, at, and above the 1 MiB native-decompression
threshold; each archive imports, losslessly exports, and re-imports with project JSON, payload hashes, and compression methods
asserted. A duplicate-payload regression also verifies that two differently named assets with identical bytes remain distinct
entries through lossless export and retain their STORE/DEFLATE methods. Broader structure-aware fuzzing across parser/Raw IR/VM normalization remains open.
The AI response parser also accepts exactly 2,000,000 JSON characters and rejects 2,000,001 before parsing. Its deterministic embedded-response corpus now includes 1,024 Markdown/noise extraction cases, 1,024 malformed/mixed-fence selection cases, and 2,048 malformed-prose recovery/rejection cases. Seed 1885 exposed an unmatched prose quote that hid a later valid project; the scanner now resets JSON string state at literal line breaks, which are illegal inside JSON strings. Broader parser fuzzing across larger adversarial corpora remains open.

The package now runs a repeatable Vitest benchmark for 100/500/2,000-block synthetic projects, measuring JSON parse, AI draft
normalization, Canonical schema validation, project analysis, and SB3 archive compilation. CI writes the machine-tagged JSON report
to the `scratch-ai-bridge-test-output` artifact and enforces mean-time ceilings at 2,000 blocks: 12 ms normalization, 6 ms schema
validation, 6 ms analysis, 8 ms JSON parse, and 75 ms archive compilation. Its deterministic 4 MiB pseudorandom asset is
DEFLATE-compressed, so the benchmark exercises the native streaming decompressor; the 250 ms mean ceiling passed at 56.359 ms
on Node 26.8.2/macOS arm64. Latest 2,000-block means are 1.030 ms normalization, 0.442 ms schema validation, 0.205 ms analysis, 0.624 ms JSON
parse, and 8.475 ms archive compilation.
The initial 2,000-block
baseline on Node 24.21.0 / macOS arm64 measured 1.206 ms, 0.460 ms, 0.218 ms, 0.703 ms, and 8.875 ms respectively. The three-engine browser smoke also measures a
real 2,000-block SB3 upload→VM decompile→Canonical conversion→analysis flow with a 5-second ceiling and stores one JSON
measurement per browser in the CI artifact. The import fixture includes an unreferenced 2 MiB binary DEFLATE asset, so each browser exercises native streamed decompression plus CRC/SHA-256 verification. Latest runs measured Chromium 322.7 ms, Firefox 316.2 ms, and WebKit 284.6 ms, including nested preservation path edits/export, successful-output validation-report download, and SVG normalization/sanitizer checks.
Each browser smoke also uploads a 253-byte synthetic ZIP whose central/local metadata declares 256 MiB + 1 uncompressed bytes; preflight rejects it before decompression in 44.63/12.26/8.06 ms (Chromium/Firefox/WebKit), and records the result in the per-browser JSON artifact. This checks limit enforcement with negligible fixture size. Setting `BROWSER_NEAR_LIMIT_IMPORT_BYTES=268435456` also imports a real exact-cap archive; the package CI step now enables that probe so its browser JSON artifact includes time and sampled process-tree RSS/PSS.
Chromium also forces garbage collection around that import and enforces a 64 MiB retained V8 heap plus backing-store growth
ceiling; latest post-import retained heap plus backing-store growth is 5,610,983 bytes with the 2 MiB binary asset. Archive extraction streams each entry into its single retained buffer and computes CRC plus incremental SHA-256 in the same pass. Project JSON bytes alias the retained entry buffer while remaining isolated from mutation of the original archive. This avoids JSZip's chunk accumulation/concatenation buffers and a full-size Web Crypto hash input copy. A repeatable isolated-process probe accepts exactly 256 MiB aggregate uncompressed in a 1,171,705-byte archive. Native streaming decompression reduced one exact-cap Node 26.8.2/macOS arm64 sample to +296,321,024 bytes RSS growth (450,772,992-byte peak from 154,451,968 bytes) in 3.18 seconds, versus one pre-change sample at +393,019,392 bytes in 2.92 seconds. The exact-cap browser runs accepted the archive in Chromium/Firefox/WebKit in 7.66/9.06/6.03 seconds; sampled process-tree RSS sums peaked at 1,697,693,696/2,550,366,208/611,467,264 bytes (120/143/93 samples). These single-run macOS RSS sums can double-count shared pages and miss short peaks; Ubuntu PSS artifact and low-memory device coverage remain open.

工作：

- Differential harness：fixture-level `official scratch-parser → Raw Archive IR → lossless export/re-import → official scratch-parser` 已涵蓋所有 `lossless` 分類 SB3，對照 project JSON、原始 bytes 與 entry hashes；`official VM → normalized export` 保持獨立 fixture gate，驗證 normalization report hashes 與輸出可由官方 VM 重載。更廣泛跨 parser/VM 版本與生成輸入的 differential fuzz 仍待。
- 建立 property-based/fuzz tests：隨機 block graph、深層 C-block、巨大文字、重複 asset、壞 ZIP、未知 opcode/mutation。現有 fixed-seed graph/C-block/ZIP/Unicode corpus 持續擴增；384 KiB Unicode + 特殊字元 block text 已驗證經 UTF-8 archive construction、production ZIP parser、官方 VM serialization、SB3 save 與 Sprite3 export 後逐字保留。更廣泛跨版本 fuzz 仍待。
- Chrome、Firefox、Safari 最低 smoke；CSP report-only → enforce；nested Pages path、offline reload、download/upload 全部在 CI 驗證。
- 已設定初始 bundle 大小與 2,000-block JSON/normalization/schema/analysis/archive compilation 平均延遲門檻；Vitest JSON report 會作為 CI artifact。首次互動、不同 asset byte 數、最大解析時間與記憶體仍須補量測。
- Scratch VM 的 `uuid` 已由 8.3.2 升至相容 CommonJS 的 11.1.1，且重新生成 production source map 確認 VM bundle 使用新版本；其他 audit findings 仍須依實際 source-map reachability 與 workspace owner 分項處理。每次 upstream rebase 自動重跑 audit、fixture matrix 與 source-map reachability。
- 完成版本 migration、使用者文件、資料遺失警告、Pages deploy rollback 與 release checklist。

退出條件：L1/L2/L3 各自有綠燈；任何未完成能力都在 UI、README、CI artifact 與 release notes 明確列出。

## 建議實施順序

不要先把所有 opcode 填進 strict schema，也不要把 SVG renderer 當成文字轉積木工具。依賴現有官方路徑，按以下交付順序推進：

1. **Phase 0–1（已完成）**：維持 fixture matrix、Raw Archive IR 與 ZIP 邊界作為資料保全基線。
2. **Phase 2（raw graph gate 完成）**：generic graph invariants、共用 ID-linked projection 與 raw patch 到 SB3 archive export 已落地；官方大型 extension、top-level reporter、special broadcast 與 synthetic unknown-opcode SB3 graph signatures 通過。Canonical projection 有界，原始 shadows/extensions 由 raw graph path 保全。
3. **Phase 3（核心及官方 fixture gate 完成；邊界組合持續中）**：procedure definition/prototype/body/call、argument reporter mapping、recursive graph round-trip、舊 shadow-prototype 匯入、normalization report、官方 `pen-dolphin-3d.sb3` procedure mapping、12 個 upstream procedure execution fixture 對照，以及三 procedure mixed-type forwarding 已接入；固定種子的 128-case typed default/recursion matrix 現已通過完整 import/compile/reload。更廣泛圖形變體與 legacy metadata layout 仍待補。
4. **Phase 4（初始切片完成；靜態與動畫預覽已完成）**：costume/sound/comments/monitors 與遞迴 JSON metadata 資料路徑已有實作及 fixture/round-trip 驗證；WAV/MP3 bytes、metadata 及 data URL/Base64 inputs 已覆蓋。官方 renderer 的單張 SVG strict-CSP canvas 已在三個瀏覽器通過。VM + `scratch-render` 顯示 positioned static stage；可執行作品使用隔離 iframe、鍵盤／滑鼠輸入、手動停止與 15 秒 Runtime 上限。Chromium/Firefox/WebKit screenshot-difference smoke 覆蓋初始靜態舞台、動畫鍵盤反應、停止後還原，以及官方 `monitors.sb3` 非預設 Stage／sprite costume 選取；`comments.sb3` 解析度 1 PNG 舞台背景也在三引擎解碼截圖驗證不透明像素與色彩數。其餘官方 edge-case preview fixtures remain open。Scratch 2 bitmap adapter 已掛入 VM，三瀏覽器解析度 1 PNG smoke 通過。
5. **Phase 5（registry/inventory/load-save implemented；behavior in progress）–6（official extension raw-preservation matrix implemented）**：registry 分類鎖定版本全部 139 個 VM primitive；130 項已通過官方 parser 與 VM load/save/reload opcode-preservation，且 runtime instrumentation 已證實 130 項 strict opcode 都在行為測試中實際 dispatch；事件/算術、分支/迴圈、清單/文字、音量、造型、移動、clone 與廣播已有代表性 runtime 測試。逐 opcode edge/render、其餘 extension adapter 行為仍待做。
6. **Phase 7–8（持續中）**：擴充 procedure/list/variable dependency analysis 與 preservation-edit；再完成 monitor/asset/extension 分析、schema migration、fuzz/differential tests、跨瀏覽器驗收與發布硬化。

**SVG 整合的 go/no-go**：Phase 4 的資產驗收必須直接通過現有 VM→renderer 路徑。單張 costume 安全與尺寸檢查使用 workspace `scratch-svg-renderer`；整個作品預覽使用 VM + `scratch-render`；若要提供可拖拉積木編輯，再另評估 scratch-gui/scratch-blocks。

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
- [scratch-svg-renderer migration notice](https://github.com/scratchfoundation/scratch-svg-renderer)（獨立 repo 已封存）
- 本機 SVG renderer：[`packages/scratch-svg-renderer`](../../scratch-svg-renderer)
- VM SVG asset sanitizer：[`deserialize-assets.js`](../../scratch-vm/src/serialization/deserialize-assets.js)
- stage SVG normalization/render path：[`SVGSkin.js`](../../scratch-render/src/SVGSkin.js)
- 本機 VM fixtures：[`packages/scratch-vm/test/fixtures`](../../scratch-vm/test/fixtures)
- 目前 bridge：[status.md](status.md)

A Node 24.21.0/macOS arm64 near-limit process probe accepted a highly compressible 255 MiB asset in a 1,167,133-byte archive in 3.182 s; RSS grew 288,260,096 bytes (140,345,344 start, 428,605,440 peak). This adds CI-Node evidence for streaming decompression, but does not establish Ubuntu PSS or worst-case incompressible 64 MiB archive behavior.

Phase 10 procedure runtime also adds 32 seeded Scratch VM executions with mixed string/number/boolean arguments, varied defaults and warp flags, and Unicode/punctuation procedure and parameter names. Every reporter result is asserted (booleans through conditional execution); Bridge passes 308/308 with lint, typecheck, production build/budgets, and diff check. This is bounded generated coverage, not exhaustive recursive/default/legacy-layout execution.

Phase 10 now also has 128 seeded recursive Scratch VM runs with all three typed call inputs (`%n`/`%s`/`%b`) removed from the nested raw call; declaration order rotates through all six permutations. An independent recursion budget keeps the procedure running after its numeric argument receives the prototype default, and assertions verify number, string, and Boolean defaults under varied warp settings and Unicode values. The targeted decompiler/project JSON file passes 28/28. Together with 32 generated mixed-type explicit-argument runs, this adds a bounded execution slice; broader recursive/default/legacy-layout combinations remain open.

Phase 14 control-flow differential coverage now generates 56 seeded project shapes across `control_repeat`, `control_repeat_until`, `control_forever`, `control_if`, `control_if_else`, `control_wait_until`, and `control_wait`, with nested Unicode/punctuation SAY payloads and varied Boolean reporters. Each source passes the official parser, VM decompile yields issue-free Raw Graphs, and Canonical recompilation preserves both the selected control opcode and all payloads in the normalized SB3. For the finite `control_repeat`, `control_if`, `control_if_else`, and `control_wait` cases, 32 bounded official-VM executions also compare the SAY-event prefix before and after Canonical normalization/recompilation; observation stops after 32 SAY events to keep loop execution bounded. Focused compatibility tests pass 12/12; Bridge passes 312/312; lint/Prettier and production build/bundle budgets pass. Broad parser/Raw IR/VM/archive fuzzing and external release gates remain open.

Phase 14 large Unicode payload regression: a 384 KiB block-text value containing non-BMP emoji, CJK, and XML punctuation now survives Bridge archive construction, production ZIP parsing, official VM JSON serialization, Scratch VM SB3 save, and Sprite3 export byte-for-byte. The regression exposed JSZip's string chunking splitting UTF-16 surrogate pairs. Bridge archive writes and Scratch VM project/sprite exports now pass UTF-8 byte arrays; the production Scratch parser decodes complete decompressed byte arrays using fatal UTF-8. Compatibility suite 13/13 passes. Production browser upload→analysis→Canonical JSON payload equality passes in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6; per-engine JSON now records `unicodeBlockTextRoundTrip: { utf16CodeUnits: 393240, exact: true }`. Latest accompanying 2,020-block import-analysis takes 317.1/328.7/293.1 ms. Full Bridge passes 350/350 and production build/bundle budgets pass. Broader Unicode/fuzz corpus and external release gates remain open.

Phase 14 normalization corpus now adds 32 seeded nested metadata probes across targets, blocks, and costumes, including Unicode payloads and JSON Pointer slash/tilde escaping. The VM normalization report must identify each removed property; every archive entry reported unchanged is verified against source and normalized SHA-256. Bridge passes 313/313 across 30 files; package lint/Prettier, TypeScript production build, bundle budgets, and `git diff --check` pass. Scratch VM inserts/changes generated SVG archive entries during normalization, so the invariant is deliberately limited to report-marked unchanged entries. Broad fuzzing and external Phase 13/15 release gates remain open.

2026-10-14 workspace-wide verification: `PATH=/tmp/scratch-editor-chromedriver-bin:$PATH npm test` exits 0 across all workspaces. Counts include Task Herder 28, storage 21, SVG renderer 245, paint 64, render 183, VM 3,872, GUI unit 328 passed/1 skipped, GUI Selenium integration 127 passed/7 skipped, GUI Playwright 8/8, media-library scripts 20, and Bridge 313. The first attempt exposed missing local ChromeDriver; downloaded the matching Chrome 155.0.8059.80 driver into `/tmp` and reran without repository dependency changes. Workspace-wide `npm run build` also exits 0; Bridge bundle budgets pass. Existing upstream webpack direct-eval/large-chunk and lint warnings remain. These local checks do not complete native Safari, Ubuntu PSS, GitHub Pages rollback/redeploy, student usability, dependency triage, or the L1/L2/L3 release decision.

2026-10-14 three-engine release smoke follow-up: exact 256 MiB aggregate SB3 imports, 256 MiB + 1 pre-decompression rejection, malformed-asset preview, strict-CSP SVG/bitmap checks, and student keyboard preview pass in Chromium 155, Firefox 155, and WebKit 26.6. Browser import/analysis of 2,020 blocks measured 323.6/329.3/281.2 ms; exact-cap import measured 7.666/8.677/6.142 s (Chromium/Firefox/WebKit). Chromium retained heap growth was 5,605,259 bytes under 64 MiB. macOS process-tree RSS observations are sparse and are not PSS or precise peaks. Firefox's prior keyboard visual assertion was intermittent; the smoke fixture now displays a distinct Scratch speech bubble on right-arrow input while retaining movement. Firefox passes twice after this change; all three full browser runs pass. Package lint/Prettier passes. Ubuntu PSS and native Safari remain open.

Phase 14 AI-input resource-boundary regression now verifies exact acceptance at both configured limits: a nested value at depth 128 and a project containing exactly 100,000 counted JSON values normalize successfully; existing depth/node over-limit inputs still reject before recursive normalization. AI response parsing adds 512 seeded cases that recover an intact fenced Canonical project after malformed prose and reject malformed text with no intact project. Focused AI draft suite passes 12/12, Bridge passes 316/316 across 30 files, package lint/Prettier and production TypeScript build/bundle budgets pass. Broader generated response/parser fuzz remains open.

Phase 11 official bitmap preview expansion: browser smoke now loads the official `comments.sb3` resolution-1 PNG Stage backdrop into the isolated VM/renderer preview and validates decoded 480×360 screenshot opacity/color evidence. Exported official bitmap SB3 verification checks the complete PNG signature (`89 50 4e 47`). Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 smoke pass; package lint/Prettier passes. Broader official preview edge cases, native Safari, Ubuntu PSS, Pages rollback, student usability and release gates remain open.

Phase 11 official draggable preview: isolated animation now follows Scratch GUI's drag threshold, draggable-only renderer picking, stage-coordinate offset math, VM drag lifecycle, and `wasDragged` mouse event. The official `draggable.sb3` fixture moves `Sprite1` by +50/+40 stage units and changes the visible stage in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. The cross-browser fixture dispatches standard Pointer Events on the actual canvas because Playwright's mouse movement after press is not delivered consistently into nested Firefox iframes; it exercises the production canvas listeners and VM/renderer code. Bridge tests 395/395, production build/budgets, and package lint pass. Hosted Ubuntu PSS, native Safari, student/hardware validation, dependency owner triage, Pages rollback, and final L1/L2/L3 decision remain open.

Phase 11 official timer-event preview: browser smoke imports official `edge-triggered-hat.sb3`, checks its TIMER `event_whengreaterthan` threshold (-1) and `motion_movesteps(10)` chain, starts the isolated VM, and requires equal nonzero before/after canvas dimensions plus a visible stage change. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 pass; all report 478×359 canvases. The release-evidence gate contract and mismatch regression pass within Bridge 397/397; package lint, production build and bundle budgets pass. This is local Darwin evidence, not the required Linux PSS/browser artifact. Phase 11 and the external release gates remain open.

Phase 14 ZIP-comment compatibility regression: valid SB3 archives whose arbitrary ZIP comments end with false EOCD signatures now import successfully. A 24-seed corpus tests random comment bytes, including the maximum 65,535-byte comment; every sample preserves the comment bytes and entry hashes through import/export/re-import. The Raw Archive IR stores comment bytes and lossless export restores them byte-for-byte; JSZip only receives a temporary comment-free view for entry decoding. VM normalization reports the archive comment's source/output SHA-256 and whether it was added, removed or changed. The targeted archive/normalization-report tests pass 50/50; complete Bridge passes 319/319 across 30 files, package lint/Prettier and production TypeScript build/bundle budgets pass. Broader archive fuzz and external release gates remain open.

Phase 6 hardware adapter follow-up: the EV3 Scratch Link mock now verifies the BT discovery/PIN contract and decodes the outgoing 440 Hz, 250 ms tone command to assert the EV3 protocol bytes. Hardware adapter tests pass 6/6; full Bridge tests pass 325/325, package lint/Prettier and production build/bundle budgets pass. This is protocol-mock evidence; physical EV3 hardware and firmware interoperability remain unverified.

Phase 7 analyzer scalability follow-up: procedure variable/list/broadcast effects now propagate through a reverse-call worklist instead of repeatedly scanning the complete procedure set. Script call traversal also uses an appendable queue without front-removal. A 1,024-procedure chain regression confirms terminal writes reach both the first procedure and calling script without recursion. Analyzer tests pass 9/9; full Bridge passes 326/326, lint/Prettier and production build/bundle budgets pass. Safari WebDriver and remaining release gates are still open.
The post-worklist Node 26.8.2/macOS arm64 benchmark remains within every configured ceiling: 4 MiB DEFLATE import 54.816 ms, 2,000-block normalization/schema/analysis/JSON parse/archive compilation 1.043/0.439/0.207/0.595/8.601 ms.

Phase 7 analyzer diagnostic correction: forever-loop yield checks now track each `control_forever` body independently, so a wait outside the loop cannot suppress a high-CPU warning. Regression covers an outside wait incorrectly masking a tight loop and a wait inside the loop. Analyzer tests pass 10/10; full Bridge 327/327, lint/Prettier and production build/bundle budgets pass.

Follow-up: forever-loop yield analysis now also follows same-target procedure calls, including indirect call chains. A loop invoking `waitIndirectly` → `waitDirectly` (`control_wait`) no longer receives a false CPU-risk diagnostic. Analyzer 10/10, Bridge 327/327, lint/Prettier and production build/bundle budgets pass; procedure bodies with yields remain graph-level evidence, not runtime timing evidence.

Post-analyzer-change three-engine release smoke on Node 26.8.2/macOS arm64 passes in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6: 2,020-block upload→VM decompile→Canonical analysis completes in 326.2/323.4/291.3 ms (5,000 ms ceiling). All engines reject a 253-byte ZIP declaring 256 MiB + 1 uncompressed bytes before decompression. Sparse macOS process-tree RSS samples are not PSS or precise peak-memory evidence; Ubuntu PSS remains open.

Phase 7 validator follow-up: Canonical semantics now rejects `currentCostume` indexes outside the target's available costume range (including the generated fallback costume for empty arrays). Repair Reports offer the last valid zero-based index, and student-build browser smoke verifies the error path, skipped VM compile stage, and replacement example in Chromium/Firefox/WebKit. Semantic/report tests pass 25/25; full Bridge 329/329, lint/Prettier, production build/bundle budgets, benchmark ceilings and `git diff --check` pass. Latest 2,020-block browser import-analysis times: 324.0/319.1/280.2 ms. External release gates remain open.

Phase 7 compile-report follow-up: malformed non-SVG XML-shaped costume data now fails the browser compiler before archive generation; the student-build flow reports parsing, normalization, schema and semantic checks passed, VM compile failed, and the exact `/sprites/0/costumes/0` pointer. Compiler reports now extract actionable Canonical pointers from compiler errors. Chromium 153.0.8010.12/Firefox 155.0/WebKit 26.6 browser smoke passes (2,020-block import-analysis 325.5/317.2/312.3 ms); full Bridge passes 330/330, lint/Prettier, production build and bundle budgets pass. Native Safari, Ubuntu PSS artifact, rollback, student sessions, physical hardware and release decision remain open.

Phase 0 behavioral fixture gate: the official `edge-triggered-hat.sb3` is now classified as `behavioral`, completing the four explicit expectation classes in the fixture matrix. An integration test executes the timer hat through the official VM and expects the sprite to move from x=50 to x=60, then decompiles/recompiles/reloads the project and verifies the same behavior. The fixture-matrix suite passes 13/13. Broader generated differential fuzz remains open.

Phase 8 comparator boundary corpus: the 128-seed nested control-flow differential draws comparison operands from finite extremes, very small/large values, numeric strings, whitespace and empty strings, and Unicode. It compares SAY execution traces from the original and Canonical decompile/recompile VMs while preserving official parser/block-graph checks. Compiler compatibility suite passes 12/12 in 8.07 s; this remains deterministic bounded fuzz, not broad randomized or cross-version fuzz.

Phase 5 math boundary regression: all 14 registered `operator_mathop` functions now have targeted boundary inputs for negative fractions, signed zero, invalid square-root/inverse-trig domains, trig singularities, logarithm limits, exponential overflow, and power underflow. Scratch VM assertions preserve `NaN`, infinities, and negative zero where produced. Capability registry suite passes 63/63; targeted ESLint, Prettier, and `git diff --check` pass. This closes these math boundary cases only; exhaustive opcode edge and visual behavior coverage remains open.

Phase 4 cloud-variable follow-up: the VM decompiler now restores each cloud flag from the unnormalized source project metadata after VM load. Analysis emits a machine-readable `cloud-variable-offline` warning per cloud variable, and the UI explains that the current preview does not sync with Scratch Cloud. Official `cloud_variables_local.sb3`, `cloud_variables_simple.sb3`, and `cloud_variables_limit.sb3` verify 1/1/10 declarations survive Canonical conversion and compiler JSON output without mutation. The browser smoke checks the visible warning and declaration in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. Bridge passes 339/339; production TypeScript/Vite build and bundle budgets pass; lint/Prettier and `git diff --check` pass. This closes offline declaration preservation/reporting for these official fixtures only; external release gates remain open.

Phase 4 cloud-variable authoring follow-up: direct Canonical compile and the successful student-build result now both explain that cloud declarations are preserved but the Bridge preview does not sync with Scratch Cloud. Cross-browser smoke generates a cloud-enabled Stage, checks the result message, and confirms the downloaded SB3 still has the third `true` variable-tuple item. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 pass. Bridge full suite 339/339, production build/bundle budgets, lint/Prettier, and `git diff --check` pass. Cloud sync remains unavailable by design; other external release gates remain open.

Phase 1 archive security regression: the ZIP directory parser now rejects `/`-terminated directory entries that declare nonzero compressed/uncompressed payloads or CRC. Previously the archive extractor treated every directory as an empty byte array without decompressing it, silently losing payload bytes on raw export. A crafted local/central-consistent directory payload fixture now verifies early rejection. The existing 256 MiB size-limit test now locates `assets/oversized.bin` by its central-directory filename instead of assuming it is the second entry (JSZip inserts an `assets/` directory entry). Archive tests pass 48/48; Bridge full suite passes 340/340; lint/Prettier, TypeScript/Vite production build, bundle budgets, and `git diff --check` pass. Broad ZIP structure fuzz and external release gates remain open.

Phase 14 UTF-8 chunk-edge regression: fixed-seed cases place emoji surrogate pairs immediately before, across, and after JSZip's 16 KiB UTF-16 string-chunk boundaries at 16/32/48/64 KiB. All 12 generated archives preserve exact text through both official `scratch-parser` and the production parser. The 384 KiB integration regression remains covered; Bridge passes 351/351, and targeted ESLint/Prettier plus `git diff --check` pass. This closes the tested chunk-edge cases, not broad cross-version Unicode fuzz or external release gates.

2026-10-14 full workspace gate after Unicode chunk-edge regression: root `npm test` and `npm run build` both exit 0. Bridge 351/351; Scratch VM 3,872/3,872; GUI Selenium 127 passed/7 skipped; GUI Playwright 8/8; Task Herder 28, Storage 21, SVG Renderer 245, Paint 64, Render 183, GUI unit 328 passed/1 skipped, Media 20. Scratch VM, Scratch GUI dev/dist/standalone, and Bridge production builds complete; Bridge size budgets pass. Bridge lint passes; VM/Render lint have zero errors and existing warnings. Safari hosted CI, Ubuntu PSS, physical hardware, student study, security-owner triage, rollback/deploy and release decision remain open.

2026-10-14 workspace lint follow-up: all six workspaces that provide a lint script were checked individually. Bridge, Task Herder, media-library scripts, Scratch Paint, Scratch VM and Scratch Render report zero errors; VM/Render/Paint emit existing warnings. Scratch Paint's lone newline-per-chained-call error was fixed as formatting only, then Paint tests pass 64/64 and Paint webpack build succeeds. The root monorepo has no aggregate lint command.

2026-10-14 dependency/security follow-up: Scratch Storage moved runtime asset-ID hashing from `js-md5` to `@noble/hashes@1.8.0`, with compatibility tests for strings, typed bytes and legacy plain arrays. Storage 27/27, full root test/build, and Chromium/Firefox/WebKit exact-cap and Unicode smoke pass. Bridge production build still reports two direct-eval warnings from `node_modules/js-md5/src/md5.js`; trace the bundled path and assign remaining dependency findings to their owning workspace. This does not close production audit triage or any external release gate.

2026-10-14 strict-CSP VM import follow-up: production Bridge now routes SB3 parsing through the generated official-schema validator before VM deserialization, and aliases out the unused legacy SB1 converter that introduced `js-md5` eval warnings. The standalone upstream VM loader remains incompatible with strict CSP because Ajv 6 compiles schemas with `new Function`; the Bridge adapter does not call that path. Build has no eval warning and reduced raw APP/VM bundle sizes by 0.43/0.45 MiB. Bridge 351/351, lint, build/budgets, and three-engine smoke pass with zero blocked eval violations, exact 256 MiB imports, and exact Unicode round-trip. Remaining security triage and external Safari/PSS/hardware/student/release gates remain open.

Security reachability audit after bundle pruning: current bridge workspace audit still has 25 findings (9 moderate, 10 high, 6 critical); a fresh sourcemap build reports 7 maps, 301 modules, 29 package roots, and zero exact matches to all 27 vulnerable installation paths. No finding is cleared by source-map exclusion; confirm owners and compatibility-safe remediations separately.

2026-10-14 Phase 8 local performance recheck: all budgets pass on Node 26.8.2/macOS arm64. 4 MiB DEFLATE import mean 56.612 ms; 2,000-block means: normalization 1.1634 ms, schema validation 0.465 ms, analysis 0.2208 ms, JSON parse 0.6417 ms, archive compile 7.2873 ms. This does not close Ubuntu PSS, low-memory device, hosted Safari, student usability, dependency-owner remediation, Pages rollback, or release decision gates.

2026-10-14 remote release evidence recheck: Pages run 37132144623 succeeded on 2026-10-03 before the current Safari gate, so that deployment does not verify the current workflow. Latest scheduled i18n run 38509010850 failed during Scratch VM localization; GUI localization was skipped. The local workflow now permits GUI localization after a VM localization failure when setup succeeds, pending a new hosted run. GitHub CLI is unauthenticated and public job-log retrieval returned HTTP 403; the underlying error remains unknown.

2026-10-14 compile resource-boundary follow-up: sound decoding still allows 10 seconds per asset but is now capped at 30 seconds for the complete compilation, preventing sequential slow decodes from accumulating without bound. A four-asset fake browser case verifies the total-budget failure includes the fourth sound's exact pointer and `audio-preflight` stage. Bridge suite 353/353, lint/Prettier, TypeScript, production build/budgets and dependency build pass. The dependency build now materializes the jsdom stylesheet required by the generated Node VM bundle so tests run from a clean dependency build without a hand-created file. External release gates remain open.

2026-10-14 shared raster/audio deadline: PNG/JPEG/BMP and WAV/MP3 preflights now share a 30-second wall-clock cap for the whole compilation and a 10-second cap per asset. Raster timeouts release the image source and event handlers. A fake browser consumes 18 seconds in two successful raster decodes, then confirms the total budget terminates the second slow audio asset at its exact path. Full Bridge suite remains 353/353; targeted lint, Prettier, TypeScript, production bundle and three-engine smoke pass. Chromium/Firefox/WebKit 2,020-block analysis took 325.4/314.3/266.5 ms; exact-cap import took 7.629/8.953/6.064 s. macOS process RSS samples do not replace Linux PSS or precise peak-memory evidence.

## 2026-10-14 imported damaged-asset preview

Imported SB3 analysis now has an explicit student-preview action. It losslessly re-exports the retained raw archive for preview compilation, applies existing generated costume placeholders for missing or checksum-invalid assets, and reports the affected asset count. This path does not rewrite the imported archive or clear Canonical asset diagnostics. Browser smoke coverage uses the official missing-PNG and corrupt-PNG fixtures and checks that their issue markers survive preview. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 verify both official damaged-asset fixtures; this closes the local preview usability gap only. External release gates remain open.

### 2026-10-14 damaged costume animation fallback

The isolated animation preview now patches only its temporary SB3 copy when imported costumes are missing or fail checksum validation. It adds deterministic generated SVG assets with Scratch-schema-valid MD5 IDs, updates only those temporary costume references, and preserves the imported Raw Archive and Canonical diagnostics. The official `missing_png.sb3` and `corrupt_png.sb3` fixtures both execute in the isolated VM; browser smoke checks nonblank canvas pixels in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. Bridge 353/353, targeted ESLint/Prettier, TypeScript, production build/bundle budgets, and `git diff --check` pass. This resolves the damaged costume animation fallback gap for these two official fixtures; damaged sound, broader fixture matrix, and external release gates remain.

### 2026-10-14 SVG import and animation fallback

The official `corrupt_svg.sb3` and `missing_svg.sb3` fixtures exposed that Scratch VM can throw while creating an SVG skin before analysis has a chance to report the damaged costume. `decompileSb3` and `decompileSb3WithBlockGraphs` now load a temporary archive copy with valid MD5-named SVG placeholders for missing/checksum-invalid costume entries. They retain the untouched source Raw Archive and restore original asset bytes plus `missing-archive-entry` / `checksum-mismatch` markers in Canonical IR. Student static/animation previews use the sanitized copy; only the preview archive changes. Browser smoke root-normalizes the two official nested-project fixtures, then checks import, static placeholder, isolated animation, nonblank stage pixels, and unchanged Canonical issue markers for both SVG fixtures. Along with missing/corrupt PNG, all four cases pass Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. Bridge suite 353/353, ESLint/Prettier, TypeScript, production build/bundle budgets, and `git diff --check` pass.

The VM-safe costume preflight exact-cap recheck also passes Chromium's 256 MiB uncompressed acceptance at 7.69 s (process-tree RSS sum sample peak 1.69 GB; not PSS/exact peak), while 256 MiB + 1 rejects before decompression. The 2,020-block path remains 329 ms under the 5 s budget, and retained heap growth is 5.54 MB under 64 MiB. This was measured on macOS Chromium; Ubuntu PSS and other-engine exact-cap reruns remain open.

2026-10-14 post-preflight exact-cap completion: reran Firefox 155.0 and WebKit 26.6 against the latest production build. Both accept exactly 268,435,456 aggregate uncompressed bytes, reject 268,435,457 before decompression, and pass the 2,020-block import/analysis flow (330.5/295.5 ms). Exact-cap acceptance now has current Chromium/Firefox/WebKit evidence after VM-safe costume preflight. macOS RSS samples are not Linux PSS or exact peaks. Native Safari smoke was attempted locally and reports Allow Remote Automation disabled; hosted Safari workflow still needs a run. Ubuntu PSS and all external/user/release gates remain open.

2026-10-14 release-document truth check: deployment docs now match the 353/353 Bridge test status, current 130-capability authoring scope, isolated animation preview, exact-cap cross-browser evidence and corrected dependency-reachability findings. Public Pages still responds HTTP 200 but reports Last-Modified 2026-10-03; latest successful Pages workflow 37132144623 deployed SHA e814add96a5e before the native Safari required gate. The Pages API 404 was unauthenticated and is not interpreted as site configuration evidence. Updated documentation passes Prettier and `git diff --check`. Publishing the local state and completing hosted gates remain open.

2026-10-14 Phase 14 AI response parser fuzz follow-up: generated 256 fixed-seed malformed/mixed-fence cases spanning unterminated opposing fences, fence lengths and indentation, CRLF, Unicode/escaped-brace prose, two valid Canonical candidates, and longest-valid-candidate selection. Focused suite passes 13/13; Bridge 354/354 across 31 files; package lint, TypeScript, production build and bundle budgets pass. This broadens deterministic parser regression coverage but does not complete broad/property-based AI-response fuzz or cross-version differential fuzz.

Phase 8 benchmark recheck after parser corpus expansion: all configured means pass on Node 26.8.2/macOS arm64: 4 MiB DEFLATE import 58.784 ms; at 2,000 blocks normalization/schema/analysis/JSON parse/archive compilation 0.993/0.463/0.234/0.651/7.572 ms. This is local macOS benchmark evidence, not hosted Linux PSS or low-memory-device coverage.

2026-10-14 Phase 14 multi-entry ZIP structure corpus: generated 120 malformed three-entry archives across 15 seeded mutations covering EOCD/directory bounds, central/local metadata, flags, compression, CRC, sizes, and payload bytes; all reject during import. Archive suite 57/57; full Bridge 355/355 across 31 files; lint/Prettier pass. This adds varied real entry offsets and payload layouts beyond the minimal archive mutation set, but does not close exhaustive ZIP/decompression fuzz or cross-version differential fuzz.

2026-10-14 fixture classification differential: added a regression that sends every `parse-only` official SB3 fixture through upstream `scratch-parser`, verifies version 3 and compares all remaining project JSON fields with Raw Archive IR. The parser synthesizes `projectVersion`, which the test removes before comparison; this exposed the actual boundary: those fixtures are parseable by upstream but remain outside Bridge's current VM/Canonical scope. Fixture matrix 15/15; Bridge 356/356, lint, TypeScript, production build/budgets pass.

2026-10-14 control-flow differential depth expansion: the generated official parser/VM round-trip now covers 160 seeded project shapes (up from 128); non-runtime-comparable nested forms reach depths 1–8. Control opcode and Unicode payloads remain preserved across official parser → VM decompile/Raw Graph validation → Canonical compile → official parser, with bounded SAY trace equality for finite shapes. Focused case passes in 9.64 s under the 20 s limit; Bridge 356/356 and lint/Prettier pass. This is still deterministic bounded fuzz, not cross-version differential evidence.

2026-10-14 Phase 10 numeric procedure-default boundary: expanded the 128-seed recursive omitted-argument VM corpus to rotate `%n` defaults through negative, fractional, zero, tiny, large, safe-integer, and 2^40 values. All six declaration orders, `%s`/`%b` defaults, and warp modes remain covered; the VM receives the expected omitted numeric default in the recursive body. Bridge 356/356, lint, TypeScript, production build/budgets pass. Linux PSS cannot be produced locally: this Darwin arm64 host has no Docker, Podman, Lima, or QEMU runner; hosted Linux evidence remains open.

2026-10-14 Phase 15 keyboard smoke: three-engine production browser smoke now checks ARIA tab keyboard behavior (ArrowRight/ArrowLeft), focused tab ID, `aria-selected`, roving `tabindex`, and linked panel visibility. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 pass; package lint passes. This improves technical accessibility evidence but does not substitute for the planned student sessions; Phase 15 remains open.

2026-10-14 Phase 15 text contrast gate: browser smoke now calculates WCAG contrast from computed foreground colors and composited ancestor backgrounds for eight student-facing text targets; all must meet 4.5:1. Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 full smoke and package lint pass. This does not cover every dynamic state or replace the required student study; Phase 15 remains open.

2026-10-14 Phase 15 mobile reflow smoke: a 320×800 CSS-pixel viewport now checks horizontal overflow plus bounds of the student app shell, idea input and primary action. Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 full smoke and package lint pass. This closes the tested viewport case only; dynamic result views and real student sessions remain open.

2026-10-14 Phase 15 accessibility artifact gate: per-engine CI JSON now preserves eight computed contrast measurements, keyboard tab focus/ARIA state, and 320 CSS-pixel reflow bounds. Chromium/Firefox/WebKit each report minimum 4.52:1, correct left/right tab navigation, and document width equal to 320px; full smokes and lint pass. These machine-readable artifacts can be retained by hosted workflow but are not a full accessibility audit or substitute for student sessions.

2026-10-14 Phase 15 mobile state expansion: 320×800 reflow smoke now covers Generate, Analyze, and validation-error states, retaining viewport/document/body widths and visible target bounds in each browser JSON. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 full smoke pass; package ESLint/Prettier passes. The invalid-input result card is correctly hidden while its status message stays in bounds. This closes only these responsive states; student sessions and a full accessibility audit remain open.

2026-10-14 Phase 15 keyboard focus visibility: production browser smoke now checks that ArrowLeft returns keyboard focus to the selected Generate tab with a visible computed outline at least 3 CSS px wide. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 all report `solid 3px rgb(21, 87, 176)` in their JSON evidence; full smoke, lint/Prettier, and diff checks pass. Only this tab focus state is covered; full accessibility review and student usability remain open.

2026-10-14 whole-monorepo re-verification: root `npm test` and `npm run build` both exit 0 on the current local worktree. Counts: Task Herder 28; Storage 21; SVG Renderer 245; Paint 64; Render 183; Scratch VM 3,872; GUI unit 328 passed/1 skipped; GUI Selenium 127 passed/7 skipped; GUI Playwright 8/8; Media Library 20; Bridge 356/356 (31 files). The root test needed the matching ChromeDriver available on PATH; all GUI Selenium suites then passed. This does not publish the worktree or close hosted Safari/Ubuntu PSS, student/hardware, dependency-owner, rollback, or release-decision gates.

2026-10-14 SB3 network privacy gate: production browser smoke watches requests across official damaged-costume import, analysis, static preview, and isolated animation preview. Any off-origin request or request method other than GET/HEAD fails. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 all pass, and their JSON artifacts retain the same-origin/no-write assertion. This supports the static Pages privacy claim for the tested flow; wider network auditing and hosted release gates remain open.

2026-10-14 Pages workflow hardening: deployment and Safari workflows now pin every external action to its official release commit SHA; push/PR triggers include `.nvmrc` and `scripts/**`, covering build inputs used by dependency setup. YAML, 40-character action SHA, path-filter, Prettier, and diff checks pass. Hosted execution has not yet verified the current workflow; deployment and remaining external gates remain open.

2026-10-14 generated control-flow differential expansion: increased the deterministic official parser/VM corpus from 160 to 224 projects. Nested control-flow/Unicode cases pass source parsing, VM import/Raw Graph validation, Canonical recompilation and official parser checks; finite supported shapes retain runtime SAY trace comparison. Focused case runs in 12.75 s within its 20 s timeout. This remains bounded fixed-seed evidence, not broad cross-version fuzz.

The 224-case control-flow differential expansion passes with the full Bridge suite (357/357 across 31 files) and package ESLint/Prettier. This confirms local regression status only; hosted gates and external usability/hardware evidence remain open.

2026-10-14 `operator_contains` boundary evidence: added official Scratch VM execution assertions for case-insensitive Unicode (`ÉCOLE` contains `éco`), empty substring, and numeric operand string coercion (`2026` contains `02`). Focused behavior test passes. These representative inputs do not establish full Unicode normalization or every coercion boundary.

2026-10-14 stage-specific AI compile repair feedback: Repair Report now distinguishes SVG/raster/audio preflight, SB3 archive generation, Scratch VM load/save, and unknown failure with stage-specific expected values and corrective suggestions. The existing report shape/version and `compile-failed` code remain stable. Seven unit cases pass, and Chromium production smoke verifies the downloaded malformed SVG/raster/audio reports include stage, exact path, expected value, and tailored suggestion. Full Bridge suite 364/364, lint/Prettier, TypeScript production build and bundle budgets pass. Other browser engines and non-compile repair flows remain open.

The stage-specific compile-repair report assertions now pass in Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 production smoke for malformed SVG, raster, and audio assets. Their 2,020-block import/analysis paths measure 322.1/317.4/284.1 ms. Native Safari remains unverified.

2026-10-14 Ubuntu PSS artifact enforcement: the Pages build now validates per-engine Linux PSS for Chromium/Firefox/WebKit, including both the 2,020-block flow and exact 256 MiB import; the validator rejects missing, zero, wrong-platform, or non-exact-cap evidence. Six validator unit tests pass. This makes PSS an enforced hosted release gate but does not provide the first PSS run; a successful Ubuntu workflow artifact is still outstanding.

2026-10-14 browser release evidence gate verification: full Bridge suite passes 370/370 across 32 files, including six PSS-evidence gate cases; package ESLint/Prettier and production TypeScript/Vite build with bundle budgets pass. The generated static output includes index.html and preview.html. This confirms local build readiness only; hosted Linux PSS and native Safari workflow results remain pending, so no deployment was triggered.

2026-10-14 L1 preservation for parse-only official SB3 fixtures: all seven official SB3 fixtures that are intentionally outside VM/Canonical support now pass Raw Archive import → lossless export → re-import. The test verifies official scratch-parser acceptance, exact project.json bytes, project entry path, and every archive entry name/type/SHA-256, including corrupt/missing media and cloud-limit cases. Full Bridge suite 371/371 and package lint/Prettier pass. This extends L1 evidence for these fixtures without claiming VM execution support; SB2 and sprite3 are separate format scopes.

2026-10-14 official Scratch VM SB3 inventory gate: the fixture matrix now classifies all 34 `.sb3` files under the upstream VM fixture directory; a recursive inventory assertion fails when an upstream fixture is absent from the reviewed matrix. Added both execution-order library fixtures and verified their raw archive export hashes and official parser acceptance. The Canonical mapping omission baseline includes both with zero omissions. Full Bridge suite 372/372 and package lint/Prettier pass.

2026-10-14 full monorepo regression after official fixture expansion: root `npm test` exits 0 when the temporary ChromeDriver directory is included in PATH. Counts: Task Herder 28, Storage 27, SVG Renderer 245, Paint 64, Render 183, Scratch VM 3,872, GUI unit 328 passed/1 skipped, GUI Selenium 127 passed/7 skipped, GUI Playwright 8/8, Media Library scripts 20, and Bridge 372/372 across 32 files. The first rerun used the parent temp directory instead of `chromedriver-mac-arm64/` and all 127 Selenium cases failed to initialize; the corrected run confirms this was a local PATH setup issue. The current project still awaits hosted Safari/Linux PSS, user/hardware and release gates.

2026-10-14 official Sprite3 fixture inventory gate: added the missing `corrupt_svg.sprite3` classification and a recursive assertion that every upstream Scratch VM `.sprite3` fixture appears in the explicit matrix. Together with the existing SB3 inventory check, CI now accounts for all 34 official SB3 and all 5 official Sprite3 fixtures. The focused matrix passes 18/18; full Bridge 373/373 and package lint/Prettier pass. These Sprite3 rows are classified as parse-only for Bridge scope; this does not claim Raw Archive preservation or Canonical conversion for Sprite3 input.

2026-10-14 AI schema repair browser loop: production smoke now starts with a complete Canonical project whose `/name` has the wrong type, verifies a `schema-type` Repair Report with expected `type=string` and replacement example, checks the copied prompt identifies `/name`, then submits the complete corrected response, downloads SB3, and re-imports it to confirm the `Player` sprite remains. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 all pass; JSON artifacts record `schemaFailureCorrectionLoop`, Bridge production build and bundle budgets pass, and lint/Prettier pass. This covers the schema-name failure only; other failure-class recovery and native Safari remain open.

2026-10-14 AI semantic repair browser loop: added a full student flow for `current-costume-out-of-range`. The smoke triggers the invalid index, checks the `/stage/currentCostume` report replacement value `0`, applies that value to the complete Canonical response, downloads SB3, and re-imports it to verify index 0 survives. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 pass. All three release JSON reports now record both this semantic recovery and the `/name` schema recovery loops; package lint and Prettier pass. Other semantic error classes and native Safari remain open.

2026-10-14 AI schema additional-property recovery: Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 now verify a complete `schema-additionalProperties` correction at `/unexpectedField`, including removal guidance, copied prompt, corrected full response, SB3 download and re-import assertion that the unsupported field is gone. The release evidence gate requires this ninth repair class; its regression suite passes 14/14. Full Bridge 382/382, lint/Prettier, production build and bundle budgets pass. Missing root `name` is normalized before schema validation, so it is not counted as a reachable failure class. Hosted Linux PSS, native Safari, student usability and remaining release decisions are still pending.

2026-10-14 AI schema enum recovery: added a complete `schema-enum` correction for sprite `rotationStyle`. Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 confirm the exact issue pointer/value, schema-provided replacement, copied prompt, corrected Canonical project, SB3 output and re-imported allowed enum value. The release gate now requires ten correction loops. Hosted Linux PSS, native Safari, student usability and external release checks remain pending.

2026-10-14 AI schema const recovery: Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 now cover an invalid Stage `kind` through the full `schema-const` feedback loop at `/stage/kind`, including required replacement `stage`, copied prompt, corrected project, SB3 download and re-import. The release evidence gate now requires eleven repair loops. Hosted Linux PSS, native Safari, student usability, hardware and publication remain open.

2026-10-14 nested schema-required example correction: the full browser flow for missing literal input `value` found that nested `oneOf` schemas received an issue path but no valid `addProperty` example. The repair reporter now selects the matching union branch by its `type` discriminator, while retaining the full union for `oneOf` alternative examples. Unit coverage proves the suggested sample validates; Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 complete all twelve AI recovery loops and verify the repaired input after SB3 re-import. Focused report/release-gate tests pass 41/41, full Bridge 386/386, lint/Prettier and production build/budgets pass. Native Safari is still disabled for WebDriver; hosted Linux PSS, student usability and external release checks remain pending.

2026-10-14 AI schema minLength recovery: added the thirteenth non-compile recovery flow for an empty Canonical project `name` at `/name`. Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 complete report/prompt → suggested-name correction → SB3 download → re-import, with `Player` retained. Scratch SB3 does not store the Canonical project name, so re-imported name comes from the filename; the evidence only asserts the suggestion was submitted before compilation. Focused browser release-evidence tests pass 18/18, full Bridge 387/387 across 32 files, lint/Prettier and production build/bundle budgets pass. Hosted Ubuntu PSS, native Safari, student study, hardware, rollback drill, dependency-owner triage and publication remain open.

2026-10-14 duplicate procedure argument recovery: duplicate Scratch procedure parameter names now fail semantic validation with an exact path and unique-name repair suggestion; the three-engine smoke covers report/prompt → correction → SB3 download → re-import. The release evidence gate requires fourteen non-compile recovery loops. Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 pass; Bridge 406/406, lint/Prettier, production build and bundle budgets pass. The GitHub Pages skill v1.2.2 and repository Pages guide were reviewed with no operational gap found. Hosted Ubuntu PSS, native Safari, student study, hardware, rollback drill, dependency-owner triage and publication remain open.

2026-10-14 dependency/performance gate refresh: rebuilt seven production source maps and reran the lockfile-scoped npm audit. Of 27 vulnerable install paths (25 advisory records), all are attributed to the `scratch-gui` workspace; none intersects mapped production sources, and none is in the Bridge production closure (262 dependency paths). The Bridge bench passes all ceilings: 4 MiB import 55.633 ms; 2,000-block normalize/schema/analyze/JSON/compile 1.062/0.446/0.204/0.614/7.119 ms. This does not replace owner triage of the `scratch-gui` findings or hosted Ubuntu PSS evidence.

2026-10-14 monorepo gate refresh: root tests pass across all workspaces, including Bridge 406/406, VM 3,872/3,872, GUI unit 329/1 skipped, GUI Selenium 127/7 skipped and GUI Playwright 8/8. GUI Selenium runs with two workers because four-worker local runs intermittently time out; repeated 2-worker full integration lanes pass all 17 suites. The helper now preserves the underlying WebDriver failure when diagnostic capture cannot use a closed session. Root production builds complete, including GUI dev/dist/standalone and the Bridge static bundle under all size budgets. Linux PSS, native Safari, student/hardware validation, dependency-owner triage, rollback/release decision and publication remain open.

2026-10-14 verification correction: the latest whole-workspace `npm test` and `npm run build` were initially launched concurrently; the GUI build deletes/recreates `packages/scratch-gui/build`, causing the regular and standalone Selenium toolbox-click checks to read a transient local-file error page. Each focused case passes when isolated after build, and the full workspace test then passes sequentially with exit 0 (Bridge 408/408, VM 3,872/3,872, GUI Selenium 127 passed/7 skipped, Playwright 8/8). The production build also exits 0. Static Pages suitability is confirmed by relative `base: './'`, local `dist/index.html` and assets, and live verifier HTTP 200 with same-path JS/CSS; public deployment is still the older SHA and local changes are unpublished.

2026-10-14 Pages path checklist correction: release checklist now matches the implementation: Vite `base: './'` and relative `./assets/...` URLs resolve under `/REPOSITORY/`. The existing local browser smoke mounts the built site at `/scratch-editor-ai-bridge/`, and the post-deploy HTTP verifier constrains asset fetches to the deployed path. The production artifact and public URL were verified; the live site still serves the older deployment. Hosted candidate workflow, post-deploy project flow, rollback drill, and release decision remain open.

2026-10-14 fresh release-candidate build: sequential root production build completes with exit 0; Bridge bundle JS/CSS budgets pass despite existing upstream GUI large-chunk warnings. Static artifact inspection resolves all six app-entry and five preview-entry resource URLs from `./assets/...` to nonempty files within `dist`; these paths resolve beneath the configured project Pages URL. Live verifier confirms HTTP 200 and same-path assets, while remote content remains at the older deployment SHA. No publication occurred.

2026-10-14 current monorepo release-candidate recheck: sequential root `npm test` and `npm run build` both exit 0 after the offline service-worker changes. Latest counts: Bridge 410/410, VM 3,872/3,872, GUI unit 329 passed/1 skipped, GUI Selenium 127 passed/7 skipped (17 suites), GUI Playwright 8/8, plus Task Herder 28, Storage 27, SVG Renderer 245, Paint 64, Render 183, and Media Library 20. The fresh local production artifact passes `verify-deployed-pages.mjs` under `/scratch-editor-ai-bridge/` and serves the worker; the public deployment remains at old remote SHA `e814add96a5ee243f15a1626821e61f1afe270c2`, where the worker is 404. This is local evidence only. Hosted Ubuntu PSS/Safari, student/hardware validation, upstream dependency-owner triage, rollback drill, release decision, and publication remain incomplete.

2026-10-14 performance/security gate refresh: all six current Bridge benchmark means pass their configured ceilings (4 MiB archive import 56.589 ms; 2,000-block normalization/schema/analysis/JSON/archive compile 1.077/0.464/0.211/0.632/7.233 ms). Fresh workspace-linked audit reports 25 advisories in 27 vulnerable installation paths (9 moderate, 10 high, 6 critical); 7 production source maps cover 302 sources with zero exact vulnerable-path intersections, and all 27 install paths point to `scratch-gui` as nearest introducing-workspace candidate. Bridge production closure contains 262 dependency paths and zero vulnerable paths. This does not close dependency owner confirmation or remediation.

2026-10-15 hosted Pages candidate gate: branch `codex/scratch-ai-bridge-hosted-gates-20261014` at `4749f4a8d8` passes the official release workflow ([run 38596592201](https://github.com/polik18/scratch-editor-ai-bridge/actions/runs/38596592201)). The workflow uploaded the nested-path Pages artifact after production audit, Bridge tests/lint/build/benchmark, Chromium/Firefox/WebKit, native Safari, and Linux PSS gates passed. Firefox CI now starts PulseAudio for WebAudio coverage, and the isolated Scratch preview delegates autoplay while retaining its script-only sandbox. Deployment skipped because this is a candidate branch; the public site remains on the older release. Student and physical hardware validation, dependency owner triage, rollback drill, broad fuzzing, deployed-page acceptance, and L1/L2/L3 release decision remain open.

2026-10-15 PR timeout stabilization: two slow generated compatibility tests exceeded their Vitest limits under hosted runner contention. Their explicit timeouts were raised to 30 and 60 seconds without reducing the 64- and 224-seed corpora. Focused tests pass 17/17; ESLint and Prettier pass. PR head `8934ba74cf` passes Pages workflow `38608398226` (build and Safari; deploy skipped for PR) and monorepo CI `38608398703` (all 12 jobs, including every workspace and report aggregation). Draft PR #1 remains open; CLA Assistant fails because the repository's signing credential must be configured by a maintainer. Student/hardware validation, dependency-owner triage, rollback drill, broad fuzzing, production Pages deployment/post-deploy acceptance, and final L1/L2/L3 release decision remain open.
