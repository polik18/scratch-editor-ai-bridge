# Scratch 內建素材庫調查

日期：2026-11-02；範圍為本機 checkout `73ea966d87`，非線上 Scratch 當前庫存。完整改善工作包見 [Bridge 改善計畫](BRIDGE-IMPROVEMENT-PLAN-2026-11-02.md)。

## 已確認

- `packages/scratch-gui/src/lib/libraries/` 存在四份 catalog：sprites 343、costumes 915、backdrops 85、sounds 354 筆。這些是本版索引筆數，不表示素材檔案全都已存在本機。條目有名稱、類別 tag、`assetId`／`md5ext` 等；角色可包含多套造型與音效。造型與背景有旋轉中心和 bitmap resolution，音效有 rate／sampleCount。
- Scratch GUI 有素材庫介面；本機 `src/lib/legacy-library-asset-url.ts` 顯示其庫素材預設透過 `cdn.assets.scratch.mit.edu` 的 asset URL 取得。這是本 checkout 的程式行為，不代表已實測目前遠端可用、離線有完整素材或有無再散布權限。
- Bridge 主網頁並未接入這四份 catalog 作為現成素材選擇器。`design-to-ir.ts` 的 GameDesign 將角色、背景造型名稱轉為沒有 `data` 的 SVG 造型，sound 為空；`project-json.ts` 在缺少造型 bytes 時呼叫 automatic visual，在缺少 sound bytes 時輸出靜音資料。這不是從 Scratch 素材庫依名稱取得資料。Canonical IR 在提供素材資料時可封裝並處理已附帶的造型與音效；不是引擎完全不支援這些格式。
- 實際以 GameDesign 指定 `Abby-a` 與 `Arctic` 產生 `/tmp/scratch-library-test.sb3`：產檔報告 `success`，但輸出 `Abby-a` 的 asset 為 `9e26af0ad5def60ce6ed54070ee5abde.svg`，本地 catalog 為 `809d9b47347a6af2860e7a3a35bce057.svg`；`Arctic` 輸出 SVG 為 `53f6cb9a1591faaee48199615a833121.svg`，catalog 為 `67e0db3305b3c8bac3a363b1c428892e.png`。名稱相同但 bytes 不同，報告成功不代表取得指定的官方外觀。
- 既有分析有造型／音效計數、名稱、缺檔／checksum 等資料以及切換造型、播放聲音等積木分析；raw AI 摘要內容主要是角色屬性及部分變數，沒有以官方 catalog 識別素材，也沒有圖像／音訊語意理解。素材 MD5 相符只可證明與 catalog 某筆 bytes 對得上，不能推論用途或理解自製素材內容。
- Paper Minecraft 的 748 個造型／背景參照中，依此 checkout 的 costumes/backdrops `md5ext` 精確比對命中 0；90 個音效參照命中 sounds catalog 25。這是參照筆數及此版本 exact match，不等於不同內容數、不等於全部素材的來源判定，更不能把未命中當作錯誤。

## 原因與影響

現在缺少的主要是 **catalog 整合、素材 bytes 取得／快取、識別與選擇介面、AI 可查詢工具及來源呈現**。GUI、VM 和 compiler 雖在同一 monorepo，功能不會因此自動出現在 Bridge。生成階段只提供名字時目前會套用生成圖或靜音，可能讓人誤以為所選官方素材已使用；導入已有作品則能保留／渲染其中附帶的素材，但不等於系統理解圖片或聲音。

## 尚未驗證

遠端 CDN 本次未連線；跨來源、可用性、離線、配額及授權須在實作前以適用來源核實。未使用多模態模型或人工檢查 748 張圖、90 個音效，亦未測試學生能否透過素材庫完成任務。
