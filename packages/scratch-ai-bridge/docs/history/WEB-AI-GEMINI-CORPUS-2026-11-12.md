# 網頁 AI × 真人 SB3 測試紀錄（2026-11-12）

測試來源：`/Users/huangjianzhe/Git/scratch-editor-ai-bridge/output/handmade-corpus/leejoneshane`，共 73 個 `.sb3`。本次使用已登入的 Gemini 網頁版與本機 Bridge 兩個 Camoufox 分頁往返；作品沒有上傳到第三方服務。

## 已完成案例

| 真人作品 | 規模 | 網頁 AI 要求 | 結果 |
| --- | ---: | --- | --- |
| `1813168-青蛙過街.sb3` | 5 角色、12 段程式、190 積木 | Frog 大小 40% → 80% | Gemini 產生正確 property patch；Bridge 檢查、套用成功。 |
| `1813168-青蛙過街.sb3` | 同上 | Frog 變數「速度」→ 5 | Gemini 產生正確 variable ID 與 expected；Bridge 套用成功，並顯示執行時可能被初始化積木覆寫的警告。 |
| `1813168-青蛙過街.sb3` | 同上 | 要求修改不存在的「死光」 | Gemini 正確拒絕，指出作品摘要與需求不符，沒有猜測 patch。 |
| `1813144-射擊大對決.sb3` | 6 角色、14 段程式、145 積木 | 遊戲結束後死光不再發射 | Gemini 回傳 `lines` patch：在梅林 L29 後加入 `停止 [這個角色的其他程式]`；原 parser 不認得此合法讀本格式，已加入轉譯與單元測試，重新建置後 Bridge 檢查、套用成功。 |
| `1813144-射擊大對決.sb3` | 同上 | 套用後預覽／自動試玩 | 預覽可啟動；自動試玩指出作品沒有觀察到角色、造型或變數變化，保留為作品本身或試玩診斷結果。 |
| `903260953-函式庫.sb3` | 21 角色、58 段程式、2,463 積木 | 觸控大小 120% → 110% | 提示詞約 15,702 字元；Gemini 完整回傳 property patch，expected 正確為 120；Bridge 檢查、警告並套用成功。 |
| `1813166-超級瑪莉.sb3` | 9 角色、54 段程式、1,861 積木；含廣播、自訂積木、清單與分身 | 生命／碰撞／遊戲結束的跨程式修改 | Gemini 發現讀本截斷、未列出生命變數與碰撞後續，要求補資料並拒絕猜測 patch；安全拒絕通過。 |
| `1813166-超級瑪莉.sb3` | 同上 | 玩家大小 200% → 180% | Gemini 回傳單一 property patch；Bridge 顯示 `玩家/size：200 → 180`，檢查與確認套用成功。 |
| 從零產生「太空採礦」 | Gemini 回覆 4 個需求角色；Bridge 產生 7 個角色 | 方向鍵移動、空白鍵發射、隕石／礦石分身、計分、生命、倒數與開始畫面 | Gemini 將 DSL 不支援的廣播、自訂積木、結束畫面列入 `做不到`；Bridge 仍成功產生可預覽作品。原自動試玩把空白鍵動作誤判成移動，修正驗證器後重跑為「自動試玩通過」。 |

## 已確認的問題與處理

1. 換入新 `.sb3` 時，上一個網頁 AI 回覆可能殘留在 textarea／candidate state。已在 `renderStudentPreview` 清空外部 patch DOM reference 與 textarea，並加入瀏覽器 smoke regression。
2. Gemini 會使用 `停止 [這個角色的其他程式]`；原本行號 parser 只支援部分中文積木，造成合法回覆被拒絕。已支援角色其他程式、這段程式、全部程式的停止語法，並加入 `raw-tool-core` 測試。
3. Camoufox 自動化在 Gemini 與 localhost Bridge 間的系統剪貼簿不是穩定共享：Gemini 可貼入提示詞，但切回 Bridge 時 `Meta+V` 可能成為空字串。這是自動化環境限制；測試用同一份未修改的 Gemini JSON 驗證 Bridge parser／UI，沒有手動改寫 patch。人工可見瀏覽器仍需另外做原生剪貼簿驗收。
4. 大型作品可產生長提示詞並完成 Gemini 往返，但應持續量測回覆時間、截斷、逾時與換作品後狀態清理。
5. 從零生成流程已證實必須區分「DSL 能做到」與「學生原始需求」；應保留 `做不到` 與自動試玩診斷，不能只看 JSON 編譯成功就宣稱完整完成。
6. 自動化輸入 React controlled textarea 時，DOM setter 會造成畫面值與內部 state 不一致；測試流程改用真實鍵盤輸入並驗證最後一則 Gemini 對話，避免把上一輪 prompt 當成本輪回覆。
7. 未下載修改時換入另一個真人 `.sb3` 會被 Bridge 的確認保護攔下；測試必須先復原或在可見 UI 確認放棄，不能把沒有切換成功誤判成 SB3 解析問題。

## 後續必測矩陣

- `blocks`：跨角色、廣播、分身、自訂積木與保留 `parent`／`next`／`inputs` 的圖形 patch。
- `script`：完整程式重寫、事件帽保留、VM 驗證與原有 graph issue 不增加。
- 拒絕路徑：錯誤 revision、錯誤 expected、雲端變數、空回覆、Markdown code fence、多個 JSON、解說混入 JSON。
- 生命週期：確認套用、不要修改、復原、重做、重新載入、換作品、下載 `.sb3`。
- 預覽：綠旗、停止、方向鍵／滑鼠／空白鍵、素材損壞 fallback、截圖、自動試玩成功與診斷失敗兩種結果。
- 規模分層：小型教學作品、中型遊戲、含自訂積木／分身的遊戲、長讀本與大型函式庫。
- 網頁 AI 交互：Gemini、ChatGPT 等各自的貼上、回覆格式、串流完成判定與複製回 Bridge；每個服務都只需知道作品摘要與 patch 契約，不應要求 API／MCP 實作細節。

