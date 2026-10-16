# Scratch extension 與 procedure 支援矩陣

更新：2026-10-16。靜態分析以 repo 鎖定的 Scratch VM 15.2.0 與原始 SB3 block graph 為依據。表中的「辨認」只代表 Bridge 可以讀出積木意圖；未執行不等於功能失敗。

## 樣本實際使用的官方 extension

| Extension      | Catalog 範圍                                    | 靜態輸入分析                                        | Bridge runtime                                        | SB3 保留／回編                                         |
| -------------- | ----------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Face Sensing   | 樣本 1 opcode：指定臉部部位                     | 讀取可辨認選單值；不推論攝影機辨識結果              | 停用，避免自動啟用相機/模型                           | 原始 block graph 保留；不支援 Canonical 編譯時不得丟棄 |
| Music          | 樣本 3 opcodes：播放鼓聲、音符、指定樂器        | menu 與數值輸入可讀；不聲稱實際聽到聲音             | 本機 Music adapter 有測試；CLI 靜態分析不執行         | 未經 VM/回編驗證前標示未執行                           |
| Text to Speech | 樣本 3 opcodes：朗讀、選聲音、選語言            | 自由文字遮蔽；僅記錄有值/安全選單；語言預設為動態值 | 外部語音服務未在 CLI 執行；依現有同意流程處理資料外傳 | 原始 block graph 保留；Canonical 缺項不可靜默丟棄      |
| Video Sensing  | 樣本 3 opcodes：讀取動作/方向、切換畫面、透明度 | 選單和透明度可讀；不推論攝影機實際畫面              | 停用，CLI 不開相機                                    | 原始 block graph 保留；Canonical 缺項不可靜默丟棄      |

## 第三方 extension 與自製積木

| 類別                                   | 原始資料                                                   | 語意                                                      | 執行／分數                                              |
| -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `facemesh2scratch`、`handpose2scratch` | 保留原始 graph 與 extension 宣告                           | 沒有可信 metadata 時顯示合併白話限制；不猜 opcode 意義    | 不下載、不執行；opaque 本身不扣分                       |
| 其他未知 extension                     | 保留 raw graph；coverage 依 extension 前綴分組             | 可提供 block 定位；未知意圖不生成肯定事實                 | 不載入外部程式；opaque 本身不扣分                       |
| 有效 procedures                        | 現代格式可投影 Canonical；舊 shadow prototype 有相容正規化 | 名稱、參數、呼叫與 body 以 procedure map 呈現             | 執行能力依 VM/專案測試，不由靜態報告推定                |
| 缺損 procedures                        | 原始 mutation 保留；正規化報告列 skipped 並指出不一致欄位  | Canonical 省略無法安全表示的定義，raw graph 可供檢查/修補 | 不以 extension unsupported 混報；結構問題需降低分數信心 |

## 本次報告欄位

- `coverage.extensions` 逐 extension 提供辨認/opaque 數與 runtime 分類；未知 extension 的學生畫面不顯示原始 opcode。
- 學生可見 evidence 對自由文字內容遮蔽，只呈現是否有設定；安全數值和選單值可呈現。
- CLI JSON 保留機器可讀 extension ID；CLI Markdown 使用白話名稱與數量，不列 opcode。
- Project Score 不把 extension runtime unavailable/unverified 或 opaque 數直接當成扣分警告；限制會說明判讀範圍。

## 尚未宣告支援

Catalog 仍是本批學生樣本使用的 10 個 opcode，不是 Scratch 官方 extension 的完整目錄。其他官方 extension opcode 維持 raw-preserved/metadata-unknown，直到有 VM 版本對照、fixture 與審核過的語意資料。相機/Face Sensing 未做實機測試；語音服務未做外部服務測試；教師用語校準須由教師實際審閱。

教師白話用語與學生可理解性 review 表見 `docs/extension-teacher-review.md`；未填表前不算教學驗收。
