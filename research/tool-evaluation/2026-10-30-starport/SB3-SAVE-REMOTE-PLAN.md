# 原始 SB3、遊戲存檔與遠端連線實施計畫

日期：2026-10-31｜狀態：計畫，尚未實作本文件的新增工作

## 目標與現況

讓使用者能開啟現有 Scratch 作品，交給 AI 提案修改並在遊戲中檢視；玩家可保存與恢復進度；Bridge 可使用區網的自架模型，遠端 MCP host 也能在授權下連線。現有 Canonical 即時修改、loopback 本機模型及 stdio MCP 已有 MVP；raw SB3 不開放 live patch，尚無下述一般化進度保存或 Scratch cloud sync。這份計畫不宣稱所有 Scratch 專案或模型都必然相容。

遵守使用者不另付費偏好：預設採本機儲存、自架服務；不建立付費帳號、不啟用計費服務。跨裝置同步若需第三方服務，先提供匯出匯入和自架選項，外部服務需另行確認費用與授權。

## 共通基礎：作品身分、版本與可恢復性

- 為 Canonical 與 raw SB3 定義穩定 project identity、內容 revision/hash 和 session ID；區分作品身分、作品版本及玩家存檔。SB3 無內建穩定身分時由 Bridge 管理持久 ID，匯出或搬移後提供明確重新綁定流程，不依檔名猜測。
- 所有 patch 與 checkpoint 帶 project ID、base revision 和 schema version；過期或目標不唯一時拒絕，提供重新讀取/比對。套用前呈現差異；失敗保持原作品和正在執行狀態可恢復。
- 設計可升級的資料格式、錯誤分類、大小限制與取消；自動測試覆蓋切換作品、並行請求、舊 revision、損毀資料與中途失敗。

## A. 原始 SB3 即時修改

1. **保真基礎**：盤點 ZIP 與 `project.json`，保留未知欄位、extension 資料和未修改素材；建立包含未知積木、擴充、重名角色、大素材的 fixture。匯出另存新檔。ZIP 可重打包，因此驗證未修改 entry 的解壓內容 hash 與 JSON 未改語義，不宣稱 ZIP bytes 全部相同。
2. **安全小步修改**：以 target ID/可驗證 anchor 指定唯一對象，先支援既有非 cloud 變數和位置、方向、大小、顯示、造型等欄位。區分「只改目前執行」與「寫入作品並匯出」。提供驗證、diff、確認、undo/redo 和 stale revision 阻擋。
3. **積木圖修改**：使用既有 block ID/結構 anchor，檢查 parent、next、input、shadow、變數/廣播引用與 extension 相依；先支援已確認的操作，再擴充。無法證明安全或目標有歧義時拒絕並提示使用者。修改後先在隔離 VM 載入驗證，再提交；必要時重載預覽並說明進度可能重置。
4. **AI 整合**：API、MCP、手動模式使用同一 raw adapter；提供按需的精簡 target/block inventory，不送全部素材；AI 僅提候選，使用者審閱後套用。

**驗收**：測試作品多輪修改、undo/redo、匯出再由 Scratch VM 載入；未修改素材 hash、未知欄位和不相關積木語義保留。錯誤、歧義、過期 revision、失敗回滾和不同來源候選均有測試。以瀏覽器實測 runtime 更新與結構重載。

## B. 玩家進度與雲端

1. **本機存檔**：使用 IndexedDB、版本化 snapshot 與多存檔槽；儲存使用者或遊戲明確指定的變數、清單及可恢復角色狀態。預設排除 cloud 值、clone、執行緒、硬體與擴充私有狀態；顯示不支援的狀態。提供儲存、讀取、刪除、匯出/匯入及空間不足提示。
2. **恢復契約**：定義遊戲啟動與 resume hook 的執行順序，避免綠旗初始化覆寫存檔；不相容的 project ID/revision/schema 要提示且不靜默套用。遷移必須可預覽、可取消，保留原存檔。
3. **跨裝置存檔**：先提供檔案匯出匯入。自架同步列獨立階段：帳號、傳輸加密、資料加密與金鑰復原、手動啟用、版本衝突選擇、刪除與離線佇列等明確設計後再實作；無自動付費部署。
4. **Scratch cloud variables**：此功能是 Scratch 專案的雲端變數，與個人存檔分開。先以 mock provider 完成狀態、節流、重連、切換作品與失權測試；正式連線前查證當時官方支援的登入、專案權限與服務規則。若缺少可支援的授權方式，保持停用並呈現原因。正式帳號與作品上的寫入需使用者啟用。

**驗收**：Canon­ical/raw SB3 各完成重啟後存檔恢復；錯作品、版本變更、資料損壞、quota 和拒絕覆寫均不破壞原資料；跨裝置衝突不靜默覆蓋。Scratch cloud 使用 mock 完成邊界測試，真實連線只有授權條件具備才另行驗收。

## C. 區網模型與遠端 MCP

1. **區網模型 companion**：擴充本機 companion，以使用者明確設定的單一模型 endpoint 連接 OpenAI-compatible 自架服務；瀏覽器仍配對 loopback companion。設定顯示目的地及資料摘要，無 key 或 key 僅短期記憶體。拒絕 URL credentials、任意 redirect、DNS 重綁及代理到其他目的地；每次解析/連線驗證所選地址並限制路徑、大小與時間。公開/付費 endpoint 預設不啟用。
2. **實用相容性**：連線測試、可取消、CORS/瀏覽器權限與網路錯誤說明；測試具工具呼叫及只支援 JSON 的服務。HTTP 區網明示資料未加密，優先支援可信 TLS；不可聲稱區網即可信。透過真實自架模型做端到端驗收，沒有可用模型時只標記 mock 通過。
3. **遠端 MCP**：本機 stdio 保留；新增獨立 Streamable HTTP transport，先限明確啟用的自架部署。按實作當時 MCP 規格與 SDK 版本支援協定協商、TLS、標準授權、token audience/scope、每 host 身分與可撤銷 session；按 client 驗證 Origin、session 隔離、節流與到期清理。不得把現有 loopback 配對 token 直接當遠端身分驗證。
4. **操作介面與發佈門檻**：顯示連線者、作品與能力範圍、停止/撤銷；沿用候選 patch 人工確認。提供本機/區網部署、停用與故障排除。公網或多使用者部署需另做安全審查、威脅模型、維運及費用評估；完成前不宣稱可安全公開。

**驗收**：兩台裝置間自架模型請求成功，錯誤目的地、redirect、超時、取消與不支援 tools 均正確處理；遠端 MCP 用相容 client 測初始化、工具呼叫、過期/撤銷、跨 session 隔離及斷線。真實模型與真實跨裝置結果分別記錄，mock 不算端到端驗收。

## 順序與交付

| 階段 | 交付 | 前置及完成門檻 |
| --- | --- | --- |
| 0 | project identity、revision 與 fixture | 共通失敗/回滾測試 |
| 1 | raw SB3 欄位修改與匯出 | 保真矩陣與 VM round trip |
| 2 | 本機進度保存、恢復與檔案移轉 | 兩種作品類型和恢復順序測試 |
| 3 | 區網模型 companion | 端點限制、實際自架服務驗收 |
| 4 | raw SB3 積木圖與 AI 工具 | 圖一致性、隔離驗證及回滾 |
| 5 | 遠端 MCP | 授權、session 隔離與跨裝置測試 |
| 6 | 自架跨裝置存檔、Scratch cloud | 各自確認部署/身分方式後實作與驗收 |

每階段更新功能矩陣、使用說明及限制，通過對應自動測試、瀏覽器測試、build 和相容性檢查後才標示完成。跨項整合驗收：開啟 raw SB3 → AI 提案 → 審閱套用 → 遊戲存檔 → 重開恢復 → 另存 SB3；再分別測區網模型與遠端 MCP。既有整包 lint baseline 應獨立清理，不能以此掩蓋新增錯誤。

## 依據與既有細節

- 原始保真、snapshot 與 Scratch VM/GUI 原始碼分析：[`REMAINING-CAPABILITIES-PLAN.md`](REMAINING-CAPABILITIES-PLAN.md)。
- 目前 API/MCP MVP 與既有邊界：[`AI-PROVIDER-AND-MCP-PLAN.md`](AI-PROVIDER-AND-MCP-PLAN.md)。
- [MCP transport 規格](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 安全最佳實務](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)：實作時應重新核對所採協定版本。
- [MDN 本機網路存取](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)：瀏覽器權限與混合內容行為因環境而異，需在目標瀏覽器實測。

## 實作進度（2026-10-31）

已新增 raw SB3 內容 revision、屬性及非雲端變數修改；匯入作品預覽支援下載、復原/重做。支援的執行中變更與其復原/重做不重載，其他操作重載並重置進度；復原綁定原動畫 session。API 與 MCP 使用 raw 專用 validator，可對每次一個既有屬性或變數提案，顯示差異並要求人工確認；AI 提案套用目前重載。瀏覽器以模擬 provider 與 relay 驗證待審、過期拒絕及操作；尚未使用真實模型或完整 MCP host 驗證本路徑。本機進度 MVP 已支援非雲端變數/清單儲存、讀取、刪除、匯出匯入，以內容 hash 綁定精確作品版本；原始角色位置、方向、大小、造型及顯示狀態亦可恢復；分身/執行緒及跨版本遷移尚未支援。區網模型 gateway 已支援私人 IPv4 固定端點與本機短效配對；已在同機私人網卡測試模擬服務，尚未以另一台電腦或真實模型驗收。新增只監聽 loopback 的 MCP Streamable HTTP，可經 SSH 通道使用並要求獨立短效 bearer token；尚未跨實體裝置驗收，無 OAuth 或公網部署支援。穩定作品 ID、AI 積木修改、跨裝置存檔同步與 Scratch cloud 等階段尚未實作。
