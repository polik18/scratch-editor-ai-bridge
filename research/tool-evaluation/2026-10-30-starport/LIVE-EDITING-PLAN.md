# Scratch AI Bridge 即時互動修改計畫

日期：2026-10-30
目標：讓使用者能在遊玩/預覽中提出調整，立即看到效果；讓 AI 修改受控作品資料或玩法腳本，並能檢視、接受、復原。

## 決策摘要

先交付「執行中即時調參」：讓 AI 以結構化 patch 修改現有變數、target 位置/大小/方向/造型等即時狀態，預覽不重載 iframe。接著增加「結構修改」：對 Canonical IR 做局部修改，完整驗證與編譯後重載同一隔離預覽環境。第一階段不宣稱可以任意熱插入 Scratch 腳本；Scratch VM 的腳本/圖形資料更新方式尚未由 Bridge 公開 API 抽象，最安全的初版是重新載入 VM，並明確顯示目前修改會重置遊戲狀態。

整個計畫需分清三種能力：

1. **使用者即時調整**：Slider/按鈕或手動 patch，方便試手感和難度。
2. **AI 建議、使用者套用**：AI 回傳 patch JSON；使用者檢視差異後按套用，作品於目前預覽更新。這適用現有複製/貼回工作流，不需要接 API。
3. **AI 直接操作**：模型透過 app tool 呼叫 patch/preview/playtest。這需要產品級模型 provider/tool 整合、credential 和同意設計，與目前外部複製提示的架構不同，獨立評估，不當成 MVP 前提。

## 現況與技術邊界

- 學生頁產生靜態預覽；使用者按「執行作品」才在隔離 iframe 啟動 Scratch VM，動畫預覽最長 120 秒，並有明確停止鈕與 parent/iframe watchdog。
- Parent 與 iframe 已以隨機 token 驗訊息，支援 start/stop、鍵盤/滑鼠、硬體狀態及網路語音/翻譯同意。訊息 target origin 為 `*` 是因為 sandbox iframe 使用 opaque origin (`event.origin === 'null'`)；目前 parent 端檢查 origin/token，硬體回覆另檢查來源視窗。新增 patch 協定時所有訊息都需一致檢查 `event.source`、token 和 revision。
- Preview iframe 啟動時只收一個 SB3 archive，載入後執行 `renderSb3Preview()` 和 `startProjectRuntime()`；沒有 update/patch message。
- `ScratchVMHandle` 封裝 VM internals，對外目前提供 project/target/block/variable 讀取、啟停和存檔，沒有變數/target 寫入或腳本圖形更新 API。不得讓 UI 直接操作 VM 私有 runtime。
- 作品主要資料為 Canonical IR；現有 pipeline 可做 schema/semantic validation，再編譯 SB3。AI 目前由外部對話工具產生回覆，Bridge 本身不呼叫模型。

主要入口：`packages/scratch-ai-bridge/src/main.ts`（學生預覽建立與 lifecycle、patch UI）、`src/preview/main.ts`（iframe message handler/runtime lifecycle）、`src/scratch/vm.ts`（VM adapter）、Canonical validator/compiler。

## 預期互動流程

1. 使用者建立或貼入作品，按「執行作品」開始遊玩。
2. 在旁邊「邊玩邊調整」區選擇/描述要改的事，例如「小魚速度慢一點」「敵人生命值加 2」「把場景改成水底」。
3. MVP 沿用外部 AI：複製帶當前作品摘要和可修改欄位的 patch prompt，AI 回傳 patch JSON，貼回工作區。
4. Bridge 顯示具體差異、影響範圍與狀態效果（即時套用/會重載/可能重置），先做 patch validation。
5. 使用者按「套用並看效果」後，Bridge 套用 patch，預覽更新；可撤銷最近修改、重玩或再要求 AI 微調。
6. 結構或驗證失敗時保留畫面與上一版作品，顯示具體錯誤和可供 AI 修復的短報告；不得靜默丟掉修改。

## Patch 協定 v1 草案

Patch 必須是資料，不可執行程式碼或任意 JS。建議 envelope：

```json
{
    "format": "scratch-ai-bridge/live-patch",
    "version": 1,
    "baseRevision": 4,
    "summary": "降低玩家移動速度並增加初始護盾",
    "operations": [
        {
            "op": "set-variable",
            "target": "玩家",
            "name": "移動速度",
            "value": 4
        },
        { "op": "set-variable", "target": "Stage", "name": "護盾", "value": 5 }
    ]
}
```

### v1 runtime operations

- `set-variable`：只允許已存在 target 上的非 cloud scalar 變數；型別限 Canonical scalar；每欄位再設定合理界限。不在 runtime 建立新宣告，不寫入 cloud variables。
- `set-target-property`：只允許 `x`、`y`、`direction`、`size`、`visible`、`currentCostume` 等明確欄位；範圍由 Canonical validator/合理遊戲界限共同限制。更新必須即時反映在目前 renderer。
- `set-stage-property`：先限於已支援的 tempo/volume/backdrop index；不允許改 renderer/extension/runtime 任意屬性。

### 結構 operations（後續）

- `replace-target-script` / `add-target-script` / `remove-target-script` 需要明確 script identity 或穩定 selector；不得依陣列 index 默默誤改其他腳本。
- 先套用在 Canonical project clone，再跑 schema、semantic、reference、compile/archive 驗證；所有 gate 通過才原子切換預覽。
- 未知操作/欄位、過期 `baseRevision`、target/變數不唯一、cloud variable、超量 patch 一律拒絕，不部分套用。

## 實作階段

### Phase 0 — 契約與 VM 寫入 spike

- 定稿 operation schema、revision/undo 模型、變數型別/範圍與狀態保存規則。
- 在 `src/scratch/vm.ts` 評估 Scratch VM 公開 API 是否可安全寫入 runtime variables、target properties；若必須使用私有 internals，集中於 VM adapter、加版本鎖定與測試，不散佈至 UI。
- 只新增 adapter spike 和測試 fixture，不先改 preview lifecycle。

**驗收**：單元/runtime 測試可將已存在的 number/string/boolean 變數與 sprite position 設為新值，未存在值、cloud 變數及越界值拒絕；預覽 VM handle 仍不暴露 internals。

### Phase 1 — 執行中即時調參 MVP

- iframe message 新增 `apply-runtime-patch` / `runtime-patch-result`；沿用 token，並新增 requestId、revision、大小上限與一次一個 patch 的序列化。
- parent 驗證來源視窗/token/revision；iframe 不接受任何 archive/extension/script code 由 patch 提供。
- 在編輯器增「邊玩邊調整」區：說明、copy patch prompt、patch JSON 貼入、差異預覽、套用/復原按鈕與結果狀態。
- 對 `live` operation 不停止執行中的 VM；修改後在下一個 render/frame 顯示變化。先支援變數與可見 target 屬性，實際可變欄位由 Phase 0 spike 決定。
- 保存應用前的值形成 undo stack；設定容量（例如最近 20 次）並限制 patch operation/count/JSON bytes，超限拒絕。

**驗收**：玩家執行時調整速度變數、位置/大小，畫面不重載且操作不中斷；一鍵 undo 精確還原；多次快速提交有序處理；錯誤 patch 不改 runtime；鍵鼠、音訊、硬體同意與 stop/15 秒 cleanup 不回歸。

### Phase 2 — Canonical 結構修改與安全 reload

- 為 Canonical project 加 revision、checkpoint 和 undo/redo；每次變更以 immutable clone 套用。
- 支援目標明確的 script 增刪/替換和部分 target 屬性/資產變更；show diff 後先驗證、編譯成新 SB3。
- Preview iframe 收 `replace-project`，在同一隔離 frame 內 stop 舊 VM、清理音訊/硬體 listener/renderer，載入新 VM。若 reload 失敗，回滾舊 archive 並保持上一版可玩。
- 第一個版本清楚標示「重載會重置遊戲進度」。可嘗試保存可對應的 variable values、位置、造型，但只有經測試且非 clone/雲端/extension-owned 狀態才恢復。

**驗收**：腳本修改可見且可執行；錯誤 compile 不影響現有遊戲；reload/rollback/undo 多輪後無重複 frame、音訊、VM timer 或 hardware subscription；重設狀態行為明確。

### Phase 3 — AI 修改與 playtest 迴圈

- 用當前 Canonical project、遊戲 brief、最近 patch history 和 validator/playtest failures 建立短 repair prompt；只要求輸出 `live-patch`，不用重貼完整 project。
- 提供「修改前後差異、套用、撤銷、再描述」對話迴圈。MVP 仍由使用者複製/貼回；若要 AI 直接操作，另做 provider tool API/credential/consent 設計與安全審查。
- 將鍵盤/滑鼠 playtest scenario、狀態斷言與截圖/事件結果提供給 AI 作局部修復依據；所有修改需通過 validator 和相關 scenario 後標示 gate。

**驗收**：對至少平台跳躍、射擊、解謎各一款固定遊戲，AI 能修改一個可觀察參數/玩法片段、通過結構與行為測試、保留需求並能 rollback；未測內容仍標示未驗證。

## 安全、可靠性與 UX 門檻

- Patch 是封閉 schema/有限 enum，不接收 JS、opcode 任意執行、外部 URL、任意 extension id 或 filesystem/network 操作。
- Runtime patch 限定在 preview sandbox；不會修改原 SB3 檔或 Scratch 雲端。寫回作品/下載成品須由使用者另行確認。
- Parent 與 iframe 每個 request 都驗 event source、隨機 token、revision、大小與 operation allowlist；亂序/重播/跨 session 訊息拒絕。
- 先 prepare/validate/compile，成功才 commit；失敗保留舊遊戲。undo/history 清楚標版本、修改摘要和是否重置進度。
- 長時間即時修改可能需要放寬目前 15 秒 preview 上限；此事只能連同 memory/CPU/time limit、stop control 與 idle cleanup 一起設計，不單獨移除 watchdog。

## 測試策略

- Patch schema unit：支援/不支援 operation、型別錯誤、NaN/Infinity、超界、未知 property、巨量 payload、stale revision、cloud variable、重複名稱。
- VM adapter integration：運行中變數可見且下一步 script 使用新值、target transform 呈現、undo 恢復原狀、stop/quit 不留 listener。
- Compile/reload e2e：合法 script patch 更新畫面/行為；compile fail 保留舊遊戲；reload rollback；多輪 undo/redo。
- Browser smoke：Playwright 走開啟預覽→操作→AI patch paste→差異→apply→觀察→undo；驗外部訊息偽造/錯 token 被拒。
- Playtest regression：至少一個 deterministic assertion 對應被修改的行為；revision/manifest 留存輸入 patch、gate 和狀態重置事實。

## 風險與未決問題

1. Scratch VM runtime variable/target setters 是否有穩定 API，需 Phase 0 spike 實證；不要把私有資料結構直接變成產品契約。
2. 相同角色可有 clone、多執行緒和同名 target-local variables；操作需能界定原始 target 或 clone policy。
3. 腳本 reload 會停止執行緒；無法一般化地在任意點無縫熱插入。對使用者明示 reload/reset 影響，不能暗示「不中斷」。
4. AI 可能提出數值劇烈變化或失去遊戲可玩性；要用操作範圍、delta preview、undo 和 playtest assertions 管理，而非假設語意安全。
5. 預覽含硬體 extension 或使用者已同意的網路積木時，reload 需安全中斷裝置/請求，重新載入不可自動再次連線或重送外部請求。
6. 直接 AI integration 會引入 provider credential、成本、隱私與授權問題；先讓 copy/paste patch flow 可用，再評估是否值得接 API。

## 建議執行順序

1. Phase 0 VM adapter spike + patch contract/tests。
2. Phase 1 即時變數/target 調參 UI、undo 和 parent/iframe protocol。
3. 在三款不同 genre 作品中驗收真實互動與 patch loop。
4. Phase 2 結構 patch、安全 reload/rollback 和有限狀態恢復。
5. Phase 3 加入 scenario-based playtest repair；provider 直連獨立評估。

第一個可 review 的實作切片應限定為 Phase 0 + 一個「運行中調整已存在變數」的縱切片；確認 VM adapter 行為、iframe protocol、undo 和端到端 UI 後再增加 target property，避免一次同時引入腳本 reload 和模型供應商風險。

## 執行狀態（2026-10-31）

### Phase 0–3 已完成的實作與驗收

- Patch v1 支援執行中調整既有非 cloud scalar 變數、sprite 的 x/y/direction/size/visible/currentCostume、Stage tempo/volume/backdrop；已加 script add/replace/remove 結構操作。所有 patch 都以 immutable Canonical clone 套用、schema/semantic gate、編譯 SB3 後才 commit；不接受 JS、任意 opcode、任意 extension、cloud variable 或混合 runtime/結構操作。
- Parent/iframe 驗證 source、token、requestId、revision、操作 allowlist 與大小/數量。執行中 patch 可即時更新，不重載；結構操作重載同一 iframe 的文件，先由 pagehide 清除 VM、音訊與硬體訂閱，再由父頁提供已編譯 archive。載入首幀等待有 100ms fallback，避免隱藏 iframe 的 requestAnimationFrame 被暫停而卡住。結構修改清楚提示進度重置，支援 undo/redo 與 reload 失敗回復。
- AI copy/paste repair 指令提供目前可修改變數、角色/舞台屬性與有 SHA-256 selector 的腳本清單；大型作品 inventory 分段限額，prompt 控制在約 12 KiB 內，省略目標會明示並要求 AI 先列出或詢問，不讓 AI 靜默猜測。provider 直連仍不在此 MVP 範圍。
- 三種遊戲類型的 deterministic 行為測試通過：平台跳躍可改移動腳本且回滾恢復 8 步；射擊遊戲初始護盾由 3 調為 5 並可回復；解謎 broadcast 新增開門行為後 Door state 由 locked 轉為 open。原星港射擊遊戲的移動、命中、失敗與重置回歸仍通過。
- Browser smoke 通過 runtime 套用/undo/redo、結構 apply/undo/redo、多輪後仍使用同一 iframe DOM、非法 script patch 拒絕且不中斷作品、鍵盤/滑鼠與音訊/硬體等既有預覽路徑。可選 120 秒 soak 實際確認 watchdog 自動停止預覽並移除 iframe。
- 驗收：`npx tsc --noEmit`、`npm run build`（bundle budgets 通過）、全套 Vitest **101 個 test files / 488 項全通過**、Chromium browser smoke 通過；`BROWSER_LIVE_EDIT_SOAK=1 node scripts/browser-smoke.mjs` 另通過完整 120 秒 watchdog soak。build 仍顯示既有大型 VM/renderer chunk 警告，未超過專案 bundle budgets。

### 使用邊界與剩餘工作

- 原始 SB3 匯入作品不套用 Canonical live patch，避免破壞未知 block graph/素材；cloud variables 保留宣告但不修改或同步。clone-local state、一般化遊戲進度 snapshot/恢復仍未支援；結構修改會重置進度。
- AI 由使用者在外部模型複製/貼回 patch；本次測試以固定 patch 驗證系統通道與三類遊戲行為，不代表不同模型都能穩定產出高品質遊戲，也不包含 provider credentials、直接 AI tool call 或成本/隱私設計。
- reload gate 失敗會保留未提交的 Canonical 狀態並嘗試重載舊 archive；目前 browser smoke 覆蓋非法結構在 commit 前拒絕、結構多輪成功重載及 undo/redo，尚未用故意損壞的 compiled archive 注入 VM deserialize 中途失敗來模擬最壞 reload rollback。若後續加入自動 asset/model 生成，需另加該 failure injection。
- 未刪除舊計畫文件：其他既有 improvement/release plans 仍各自對應未完成的專案工作，不能因本 live-edit 計畫完成而推定無用。
