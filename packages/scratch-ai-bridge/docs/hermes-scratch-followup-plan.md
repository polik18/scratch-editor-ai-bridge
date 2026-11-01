# Scratch CLI 與彈珠台後續改善計畫

日期：2026-10-31。狀態：規劃，以下階段尚未完成驗收。此計畫承接 [原互動修復計畫](hermes-scratch-interactive-repair-plan.md)，不取代其既有證據或未完成項目。

2026-10-31 執行紀錄：F0 保全雜湊；F1 在獨立 127.0.0.1:8602 服務加入限定 sandbox 靜態腳本的跨來源處理，以 Camoufox 驗證原本卡住的無 viewBox fixture 與彈珠台候選稿均能載入，其他跨來源資源及錯誤 Host 仍拒絕。原 8601 程序未重啟，並未套用新設定；其他瀏覽器及 Scratch 2 測量路徑仍待驗證。F3 發現持續接觸碰撞物會反覆加分，新增防重複計分及 VM 測試，產物為 `PinballRefined.sb3`；實際 GUI 觀察到球移動與加分。F4 增加跨角色積木引用驗證。Codex 測試 GUI 另存未能取得檔案，Hermes 本身尚未驗收。當次完整 Bridge 測試與 SVG renderer 單元測試、build 及限制請見 [執行紀錄](../../../research/pinball-candidate-20261031/followup-report.md)。

## 2026-10-31 暫停交接

- **已完成的工程切片**：Scratch GUI 開發伺服器限定開放 sandbox 必要靜態腳本，Host 驗證及其他跨來源限制仍生效；在隔離 8602 服務與 Camoufox 載入無 `viewBox` SVG、原候選作品及新版彈珠台。修正新版同一碰撞物持續接觸重複計分，並加入跨角色積木引用檢查。
- **驗證**：Bridge 65 個測試檔、544 項測試及 build 通過；SVG renderer 245 項單元測試通過；GUI middleware 9 項單元測試、相關檔案 ESLint 及獨立輸出路徑的 GUI 開發版 build 通過。Bridge 全套 lint 尚有 1,362 errors、1 warning，需繼續分類與修復；本次受影響的 Camoufox 模組及彈珠台測試針對性 ESLint 通過。
- **交付與保全**：新版作品為 `packages/scratch-ai-bridge/PinballRefined.sb3`（SHA-256 `bf63fda33429dc7524f2309a441f308c94267cbf3e77a3d5a943ce4e6e458662`，受 `.gitignore` 排除）；可重建來源為 `research/pinball-candidate-20261031/pinball-refined.json`。原 session、原 SB3 和先前改良版雜湊均未改變；未提交的既有修改均保留。
- **服務狀態**：依使用者要求暫停後，已正常關閉本次啟動的暫時 8602 服務；原有 8601 程序沒有重啟，仍未套用新的開發伺服器設定。重新測試可在 `packages/scratch-gui` 執行 `npm run start -- --host 127.0.0.1 --port 8602`，再使用 `open-camofox --caller <實際執行者> --url http://127.0.0.1:8602/`。
- **接手順序**：先重新確認 Git／服務狀態與 Camoufox lease；再查明 GUI「另存到電腦」未取得檔案的原因並完成重新載入，使用 Hermes 實際 caller 驗收；接著補其他瀏覽器、Scratch 2 與實體鍵盤／碰撞測試，深化積木語義驗證並處理 lint。共用 Camoufox 曾短暫拒絕連線並由系統恢復，之後另有活動 session，最後一次新租約取得失敗；不得假設瀏覽器目前閒置。

## 目標與現況

讓 Hermes 可使用 Scratch CLI 與 Camoufox 開啟、修改、儲存和重新載入作品，並以可重複的測試確認彈珠台行為。現有 `PinballImproved.sb3` 已通過結構檢查，曾以 Codex caller 在 Camoufox 顯示並觀察移動、分數與生命；VM 測試涵蓋彈板、落球、生命歸零及重開。Hermes 實際 caller、GUI 存檔交接、真實鍵盤和完整碰撞尚未驗收。

已知有效 fixture 的 SVG 換成缺少 `viewBox` 的球後，GUI 載入逾時；同一球加上 `viewBox` 後可載入。缺少 `viewBox` 的 SVG 會進入 sandbox 測量路徑，本機開發伺服器對模擬的 sandbox 跨來源請求回 403。這是有力線索，仍須以瀏覽器請求與修復後對照驗證因果，不能把所有載入逾時都歸於此。

## F0：保護工作現況與建立基準

- 執行前檢查 Git 狀態、修改時間與是否有其他執行者；保留未提交程式、既有 session、原 SB3 和改良版，不使用現有 session 目錄做破壞性測試。使用獨立暫存目錄及副本，記錄 SHA-256、Node、服務與瀏覽器版本。
- 記錄目前全套測試、build 和 lint 結果及錯誤明細，區分現有與新引入問題。不要憑先前的錯誤數量認定最新基線。
- 驗收：原檔雜湊與修改內容保留，可重現下列案例；記錄限制與權威測試命令。

## F1：SVG 通用載入修復

- 使用相同作品、同樣素材位元組，僅改變有無 `viewBox`，在本機 Scratch GUI 重現並記錄 sandbox 請求 URL、狀態、回應標頭、主頁 CSP 與 iframe 錯誤；覆蓋 PNG、已有 `viewBox` 的 SVG、缺少 `viewBox` 的 SVG 與 Scratch 2 測量路徑。不要只依截圖或 VM load 判定。
- 定位伺服器跨來源限制、資源 URL、sandbox 初始化與逾時的責任邊界。先比較可行修復，保留 SVG 實際測量、座標及裁切語義；避免直接把任意 SVG 改寫為固定 `viewBox`。若調整開發伺服器，只針對必要資源及最小範圍，保留 Host 檢查、CSP、opaque iframe 隔離與既有部署相容性，不為省事全域開放跨來源或 `allowedHosts: all`。
- 加入會先失敗的整合回歸：真實 GUI 載入缺少 `viewBox` 的 fixture，驗證素材可見、座標與尺寸正確、載入有界且失敗時能顯示可行動錯誤；同時跑既有 SVG renderer 的測量、安全與 CSP 測試，避免破壞舊作品。
- 在獨立的本機服務驗證修復；未確認正在使用的 8601 服務 owner 前不停止或重啟它。至少在 Camoufox 和專案支援的另一種瀏覽器確認，結果按實測回報。
- 驗收：原始缺陷案例與對照案例均成功，沒有擴大不必要的跨來源存取；保留產物、請求證據與測試結果。

## F2：Hermes、Camoufox 與作品交接

- 在 Hermes 真正的執行環境確認 Node、工作目錄、PATH、本機 GUI 服務及命令錯誤輸出；以獨立資料夾與作品副本操作。遵守 Camoufox status、caller、唯一 task、lease、續租及 release 規則，不透過其他路徑操作共享 profile。
- 使用 `open-camofox --caller hermes` 實際載入作品、辨識同一 task 的分頁、按綠旗及操作；確認 headless／desktop 選擇和使用者畫面符合設定。測試未啟動服務、重複 tab ID、租約衝突、錯誤作品、非本機 URL 與 GUI 載入逾時，確認錯誤不外洩 lease 檔路徑或機密。
- 驗證 GUI 編輯後的「另存新檔 → CLI 重新 load → 比對角色、素材、積木及行為」流程。若現有 Camoufox CLI 無法可靠處理下載或檔案選取，先確認能力與權限，再設計支援的受控介面；不繞過 CLI，也不宣稱自動雙向同步。
- 驗收：Hermes 以自身 caller 完成一輪操作、存檔、重新開啟與比對；任何環境或人工操作限制清楚標註，不以 Codex 測試冒充 Hermes 驗收。

## F3：彈珠台互動與碰撞

- 以 `PinballImproved.sb3` 與對應 Canonical IR 為副本基線，定義左右按鍵、彈板可視旋轉、有效反彈區域、牆面與碰撞物、計分、防重複計分、落球、三條生命、結束及綠旗重置的預期行為。
- 用真實 Scratch renderer／GUI 測試球碰撞與實體鍵盤；用 VM 測試可確定的初始化、鍵盤狀態、落球、遊戲結束與重開。加入彈板邊緣、落球速度、重複碰撞、長按與未按鍵等案例；清楚區分座標近似與造型碰撞，不宣稱物理引擎。
- 修復可重現缺陷，避免覆寫原作；若修改遊戲，保留可重建的來源與新 SB3，記錄雜湊與控制說明。測試交付檔而非只測中間版本。
- 驗收：同一交付檔在 GUI 實際操作並重新開啟後可完成一局；分數、生命、碰撞與重開有可重複證據，無法涵蓋的角度和裝置明列限制。

## F4：CLI 積木與驗證器可靠性

- 擴充本次修正以外的圖結構驗證，涵蓋同 target 參照、parent／next／input 互惠、子堆疊、reporter／shadow、合法 opcode 與 extension／自訂積木相容性。以 Scratch VM 與正式 fixture 作對照，避免以有限的 canonical 能力表錯拒合法專案。
- 測試並修正 add、edit、connect、remove 的失敗原子性、巢狀刪除、變數識別、錯誤輸入與既有 session 相容性；對歷史錯誤資料提出診斷和非破壞性修復，不靜默猜測使用者原意。
- 區分結構、素材、VM 載入、renderer 畫面和遊戲行為的結果；明確顯示哪些檢查未執行。避免把 `compile` 成功表述為遊戲已驗收。
- 驗收：畸形與合法 fixture 均按預期通過或拒絕；CLI 與 VM round-trip 保留作品內容，錯誤訊息可定位。

## F5：品質、交付與文件

- 先分類 lint 基線，修復本次新增或修改內容造成的錯誤；其他存量問題依實際範圍修正或另列具體項目，不能宣稱全部為既有問題。執行受影響套件的測試、build 與 lint，記錄命令、結果及無法通過的原因。
- 更新操作手冊、常見錯誤和兩份計畫進度；清楚標示 `open` 的獨立 Chromium、`open-camofox` 的本機及語言限制、GUI 存檔交接與驗證狀態。檢查忽略規則：若 SB3 被 Git 忽略，交付須有可重建來源並清楚標示本機產物，避免誤認為已納入版本管理。
- 完成差異審查與原始檔雜湊比對，彙整變更、測試、產物、已知限制及下一步。只有 F1–F4 的指定驗收完成，才宣稱完整工作流程已完成。

建議順序為 F0 → F1 → F2 → F3 → F4 → F5；F4 的獨立驗證器測試可在不干擾 F1／F2 共同檔案與瀏覽器使用的前提下進行。各階段未通過時保留證據與未完成狀態，不以暫時繞過或歷史測試結果代替驗收。
