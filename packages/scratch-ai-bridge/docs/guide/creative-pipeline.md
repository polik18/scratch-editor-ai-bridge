# 兩階段生成：先自由構想，再分段轉成 Scratch

`create` 適用於任何類型的 Scratch 作品（遊戲、動畫、故事、互動藝術、音樂、問答、教學、模擬）。它把「設計作品」和「遵守 Scratch 格式」分開，讓模型在最需要創意的時候不必先背格式。

```sh
npm run --silent bridge -- create "做一個大魚吃小魚的遊戲，用方向鍵控制，吃到加分有音效，30秒結束" --playtest
```

## 流程

| 階段         | 模型看到什麼                                                              | Bridge 做什麼                                                                          |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A 自由創作   | 只有需求與一段簡短引導；沒有格式、積木或能力清單                          | 原文保存（`brief`），不因格式打回                                                      |
| B 轉譯       | A 的原文 + 只和這個作品相關的能力卡 + 做不到的想法與建議替代              | 抽取意圖錨點（類型、角色、場景、音效、互動、狀態、做不到的想法）、規劃分段             |
| C 分段實作   | 目前作品大綱 + 這一段的目標 + 這一段用得到的能力卡 + 上一次試玩發現的問題 | 解析積木文字、驗證、合併、建置、在 Scratch 預覽試玩；失敗時回滾這一段再請模型重做一次  |
| D 執行與修正 | —                                                                         | 用試玩證據檢查每個意圖；`done` 只在作品真的執行過且每個規劃的意圖都觀察到時才是 `true` |

`--mode a-b` 只做 A 和一次性 B（整份作品一次轉譯）；預設 `a-b-c` 分段實作。

## 積木文字格式（模型在 B／C 輸出的內容）

```text
stage (背景: Underwater 1)
when green flag clicked
set [分數 v] to (0)

sprite 鯊魚 (外觀: Shark 2; 音效: Chomp)
when green flag clicked
forever
  if <key [right arrow v] pressed?> then
    change x by (6)
  end
  if <touching [小魚 v]?> then
    play sound [Chomp v]
    change [分數 v] by (1)
  end
end

sprite 小魚 (replace)
when I start as a clone
go to [random position v]
```

- `sprite 名稱 (外觀: …; 音效: …)` 與 `stage (背景: …)` 開始一個段落；外觀、背景、音效寫官方素材名稱或中文描述，Bridge 會找最接近的官方素材，找不到時在報告的 `assets.alternatives` 建議替代。
- 段落名稱後加 `(replace)` 會取代該角色的程式，不加則是追加；同一角色的造型、音效、變數會合併。
- 支援事件、移動、滑行、方向、造型、背景、大小、特效、對白、提問與回答、聲音、變數（`(分數)` 當 reporter）、四則運算、`join`、碰觸、按鍵、分身、廣播、計時器與停止。
- 真實模型常見的寫法也能讀：先一次宣告所有 `sprite` 再用 `// ===== 角色名：說明 =====` 註解分段、只寫角色名稱的標頭（`金魚 (replace)` 接著帽子積木）、`if … then` / `else` / `end`、`when flag clicked`、`wait (1) secs`、`(x)`／`(y)`、`right`／`空白鍵` 等按鍵名稱，以及常見中文積木（當綠旗被點擊、一直重複、重複 N 次、如果…那麼、說…持續 N 秒、等待 N 秒、廣播、當收到、將…設為／改變、播放音效）。
- 修正輪只送出有問題的段落，修好後接回原本的回覆，避免把整份作品重送一次。
- 只有第一段（核心）會看到完整構想與做不到的想法；之後的段落只收到「作品重點」（類型、對象、角色、場景、構想開頭約 240 字）與目前作品大綱，讓每次呼叫保持精簡。
- 模型可以用 `// 近似：原想法 → 做法` 記錄它怎麼處理 Scratch 做不到的事；報告的 `decisions` 會列出每個做不到的想法採用了近似、替代或延後，不會默默刪掉。

## 報告

`output/games/<名稱>/_過程/<名稱>.creative-run.json` 保存：A 的原文、意圖錨點、分段計畫、每一步的提示與回覆（含字數）、解析結果、試玩檢查、最後的 `checks`、`decisions`、`assets`、`done`／`notDone`。

## 離線或手動貼上回覆

`--replies <資料夾>` 從檔案讀回覆：`A.txt`，再來是 `B.txt`（`a-b`）或 `C1.txt`、`C2.txt`…（`a-b-c`），修正輪是 `repair1.txt`…。回覆不夠時，已完成的部分照樣保存，缺的列在 `notDone`。

## 對照 benchmark（V2-0／V2-7）

```sh
cd packages/scratch-ai-bridge
BENCH_BASE_URL=http://127.0.0.1:8000/v1 BENCH_API_KEY=... npm run benchmark:creative -- run --run ../../output/bench/<日期> --playtest
npm run benchmark:creative -- report --run ../../output/bench/<日期> --baseline <舊的 report.json>
```

同一模型、`research/project-quality-benchmark/cases.json` 的 10 個跨類型題目，比較 `spec`（舊單段 Game Spec）、`a-b`、`a-b-c`：提示長度、模型呼叫數、建置、實際執行、意圖保留（試玩觀察到的意圖比例；「意圖（需求）」三組都只用原始需求抽出的意圖計分，是可直接比較的欄位）、媒體／回饋種類、近似決策、失敗類型與人工評分。人工評分填在 `<run>/ratings.csv`（1～5 分），`report` 會合併；不能只用建置成功率宣稱品質提升。
