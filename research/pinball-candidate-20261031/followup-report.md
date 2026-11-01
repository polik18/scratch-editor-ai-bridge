# Scratch 後續改善執行紀錄

2026-10-31，狀態：部分完成，仍有未驗收項目。原始 session、PinballGame.sb3 與 PinballImproved.sb3 的 SHA-256 均與執行前相同。

## SVG 與本機 GUI

- webpack-dev-server 5.2.6 的跨來源檢查會拒絕 opaque iframe 對 sandbox 腳本的請求；舊 8601 服務使用模擬跨來源 script 請求回 403，且回應含 `Cross-Origin-Resource-Policy: same-origin`。缺少 `viewBox` 的 SVG 需要 iframe 測量，因此曾卡住；同樣 fixture 加上 `viewBox` 可載入。
- 修改 Scratch GUI 的開發伺服器：在既有 Host 檢查之後、跨來源攔截之前，僅對四種具內容雜湊的 sandbox 腳本、指定 `?resource` 與跨站 no-cors script GET 提供輸出檔；其他請求照既有防護處理，不改 production 設定。
- 獨立的 `127.0.0.1:8602` 服務實測：必要 runner 請求為 200／CORP cross-origin，其他跨來源路徑及錯誤 Host 為 403；Camoufox 成功載入無 viewBox 的 `fixture-no-viewbox.sb3` 並顯示球，也載入之前失敗的完整彈珠台候選稿。截圖為 `svg-no-viewbox-fixed.png`。測試未涵蓋第二種瀏覽器、Scratch 2 與所有 SVG 尺寸、座標案例。
- 未停止或重啟原有 8601 服務，所以該程序仍使用舊的開發伺服器設定。新的 GUI 啟動後才會套用修正；臨時 8602 程序不保證持久運行。

## 彈珠台與 CLI

- VM 回歸先重現持續接觸同一個碰撞物時分數由 10 重複增加到 40；新版加入各碰撞物的接觸狀態，測試確認持續接觸只計一次、分離後再次接觸再計分。這是模擬碰撞感測的 VM 測試；並非全角度真實物理驗收。
- `PinballRefined.sb3` 保留舊作品，SHA-256 `bf63fda33429dc7524f2309a441f308c94267cbf3e77a3d5a943ce4e6e458662`；可重建來源 `pinball-refined.json` SHA-256 `009a210fcbe743aff643e60d21020fb57239340769e3207f0ae0574811d1cb5d`，產生腳本 `create-refined.py`。SB3 位於 `packages/scratch-ai-bridge/`，受該目錄 `.gitignore` 排除。
- Codex 在 Camoufox 及 8602 成功載入此檔、按綠旗，2.5 秒內球從 (-160, 110) 移到 (-100, 107)，分數由 0 增至 10。VM 測試另涵蓋左右按鍵、落球、生命歸零及綠旗重置。真實鍵盤、完整碰撞角度和 Hermes caller 尚未驗收。
- 新增跨角色積木引用的驗證；此改善不代表涵蓋所有積木語義、循環與自訂擴充相容性。
- Codex 在獨立分頁修改作品標題與角色名後嘗試 GUI「Save to your computer」，未能在預期位置取得檔案，沒有宣稱存檔／重新載入成功。其後 Camoufox 服務短暫拒絕連線，系統恢復後有其他活動 session；後續取得新工作租約失敗，未繼續操作共享瀏覽器。

## 檢查與待辦

- Bridge 工作前基準：65 個測試檔、542 項測試通過；lint 失敗，報告 1,377 errors、1 warning，包含不同既有與已修改檔案，不能全部視為既有問題。
- 本次測試：Scratch GUI middleware 9 項單元測試通過；Bridge 最終全套 544 項測試與 build 通過；SVG renderer 245 項單元測試通過。新 middleware、相關 GUI 設定與新測試的針對性 ESLint 通過；Bridge Camoufox 模組和彈珠台測試的針對性 ESLint 通過。完整 Bridge lint 仍未通過。
- 剩餘工作：完成獨立跨瀏覽器與 Scratch 2 SVG 測試；確認實際 GUI 存檔、CLI 重新載入與 Hermes caller；補全積木語義／圖互惠驗證；釐清並分階段修復 lint；依 owner 協調原 8601 服務更新。
- 使用者要求先告一段落後，已正常關閉本次啟動的暫時 8602 服務，原 8601 服務未更動。最後一次 Bridge 全套 lint 為 1,362 errors、1 warning；GUI 及 Bridge 受影響的新模組／測試之針對性 ESLint 通過。GUI 獨立輸出路徑的開發版 build 通過。
