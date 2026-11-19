# 教師評量：rubric、試玩評分與成績表

這份說明給要用 Bridge 評 Scratch 作業的老師與 AI。評分分成三層，只有最後一層可以當成績：

| 分層                 | 來源                                                                                      | 可以當成績嗎                         |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `static-diagnostic`  | `inspect`／`batch` 的 `sb3-static-v3` 靜態結構診斷分                                      | 不可以，只是修正線索                 |
| `runtime-assessment` | 在真的 Scratch 預覽中試玩時記錄到的事件（移動、碰觸、聲音、造型、背景、對白、分身、變數） | 只是正式分的證據                     |
| `formal-grade`       | 核准的教師 rubric + 試玩證據 + AI／教師判定                                               | 可以；附 rubric 版本、信心與複核狀態 |

沒有實際試玩的作品**一定是 `pending`**，不會用靜態分補成正式分。

## 1. 寫 rubric（老師的規準最優先）

最簡單的方式是用文字寫，每行一項，結尾寫「N 分」：

```text
1. 大魚、小魚的游泳方式正確 30分
2. 大魚碰到小魚，小魚消失並播放吃掉的音效 30分
3. 小魚被吃掉後，新的小魚分身在別處出現 40分
```

```sh
npm run --silent bridge -- rubric draft 規準.txt --id big-fish-v1 --title "大魚吃小魚" --project-type animation --out rubric.json
```

草案完全保留老師寫的項目與配分，只建議自動檢查（`checks`）和測試步驟。有多個可觀察動作的項目（例如「碰撞＋消失＋音效」）會拆成 `components` 子項目，配分平均分配，老師可以改。也可以用網頁編輯器：Bridge 網站的 `src/ui/teacher-rubric.html`（本機 `npm run dev` 後開 `/src/ui/teacher-rubric.html`）。

### rubric 格式重點

- `format: "scratch-ai-bridge/rubric"`、`version: 1`、`id`、`title`、`projectType`、`totalPoints`、`criteria`。
- 每個 criterion：`id`、`title`、`points`、`mode`、`evidence`（`static`／`runtime`／`visual`／`audio`／`ai`／`teacher`）、`testPlan`。
- 判分模式：
  - `binary`：`checks` 全部通過才得滿分。
  - `partial`：老師定義的 `levels`（`ratio` 0～1），自動評分取「檢查全部通過」的最高級距；沒有檢查的級距只能由 AI／教師判定。
  - `components`：子項目配分加總必須等於項目配分。
- 自動檢查種類：`runtime-ready`、`runtime-no-errors`、`runtime-opcode`、`runtime-collision`、`runtime-motion`、`runtime-sprite-changed`、`runtime-variable-changed`、`runtime-clones`、`runtime-control`、`runtime-feedback-kinds`、`static-opcode`、`static-sprites`、`static-scripts`、`static-diagnostic`。
- 可選 `runtime`：`playMs`（1000～120000）、`keys`、`clicks`，覆寫自動試玩設定。

```sh
npm run --silent bridge -- rubric validate rubric.json
npm run --silent bridge -- rubric approve rubric.json --by T1
```

核准會記錄內容指紋（`rubricHash`）。核准後只要改過任何內容，就要重新核准；整班作品都用同一個版本評分。未核准的 rubric 只能加 `--trial` 試跑，結果標成 `trial`，不是正式成績。

沒有提供 rubric 時，`--project-type` 會用內建的通用評量表（意圖 / 可執行性 / 內容深度 / 回饋表達 / 結構 / 測試反思，權重依作品類型調整）。其中「意圖、內容深度、測試反思」沒有自動檢查，需要 AI 或教師判定才會有分數。

## 2. 評分

```sh
npm run --silent bridge -- grade ./class --rubric rubric.json --manifest class.csv --playtest
```

- `--playtest` 是正式成績的必要條件（需要先 `npm run build --workspace=@scratch/scratch-ai-bridge`）。自動試玩會依作品偵測到的按鍵與點擊操作，作品越大玩越久（8～30 秒）。
- `--manifest`：`studentId,file[,gradeLevel,classId,assignmentId]` 的 CSV 或 JSON；也可以用 `--grade-level`、`--class`、`--assignment` 給整批預設值。
- `--judgments`：AI 或教師對無法自動判定項目的判定，JSON 陣列 `[{ "studentId", "criterionId", "source": "ai"|"teacher", "ratio" | "passed" | "components", "confidence", "note" }]`。教師判定覆蓋自動結果；AI 判定信心低於 0.7 會進複核佇列。
- `--overrides`：教師調整 CSV（`studentId,score,reason,reviewer`）。原始自動分保留，`exportScore` 才用教師分。
- `--policy`：班內相對校準設定（見下）。

單一檔案：`grade work.sb3 --rubric rubric.json --playtest`，直接輸出 formal-grade JSON。

### 輸出

| 檔案                             | 內容                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grades.csv`                     | 教師成績表：`exportScore`、`finalScore`、`autoScore`、`teacherScore`、`rawScore`、`cohortScore`、`diagnosticScore`、排名、信心、證據覆蓋、試玩狀態、複核、rubric 版本與各項目得分 |
| `review-queue.csv`               | 需要老師先看的作品與原因（待判定項目、試玩沒觸發但程式有相關積木、低信心、未執行…）                                                                                               |
| `class-summary.json`             | 匿名統計、各群組分布與校準警告                                                                                                                                                    |
| `<studentId>.json`／`.md`        | 逐筆詳報：每項得分、證據、信心、複核原因                                                                                                                                          |
| `PRIVATE-teacher-source-map.csv` | 學生代碼與原始檔名的對照，只留在本機                                                                                                                                              |

CSV 以 UTF-8 BOM 輸出，Excel／Numbers 直接開啟中文不會亂碼；文字欄位會防止試算表公式注入。

### 防止誤判

- 只依 rubric 的項目與配分計分；積木數、角色數、檔案大小不會加分。
- 程式裡有相關積木、但自動試玩沒觸發的項目，會標「請教師確認」而不是默默給 0 分。
- Bridge 只辨識不到 90% 的積木時，整份作品進複核佇列。

## 3. 班內相對校準（預設 80～100、眾數約 90）

同一個「年級／班級／作業／rubric 版本」才一起排名，不同年級不混排。報表同時保留三種分數：

1. `rawScore`：rubric 絕對分，跨批次比較進步用這個。
2. `cohortScore`：本群組內依 raw 排名（midrank）以常態分布映射到 80～100、中心 90。
3. `finalScore`：`(1 − relativeWeight) × 絕對映射 + relativeWeight × cohortScore`。

規則：

- 只有「已評完、試玩通過、信心 ≥ 0.6、raw ≥ 40」的作品進入 80～100；原始分太低或無法執行的作品是 `below-range`（低於 80），待判定或低信心的作品是 `pending`，不會被排名灌分。
- 沒有完整試玩證據的作品，`finalScore` 最高 89。
- 可排名作品少於 10 件時不做相對校準。
- 每個群組都檢查眾數、中位數、四分位距、80／90／100 人數，並對「全部同分」「超過三成 100 分」「眾數偏離 90」「證據越少分數越高」發出校準警告。

`grading-policy.json` 可以只寫要改的欄位，例如 `{ "relativeWeight": 0.3, "minimumRawForRange": 50 }`。

## 4. 教師校準（V2-12）

正式上線前，至少 30 件匿名代表作品由兩位以上教師獨立盲評。先產生盲評材料：

```sh
npm run --silent bridge -- calibrate prepare <作品資料夾> --rubric rubric.json --out output/calibration/<批次> --teachers T1,T2 --playtest
```

- `teacher-kit/`：交給老師。裡面只有匿名作品（`works/S0001.sb3`…）、每位老師一份空白評分表（`scores-T1.csv`…）和依 rubric 產生的 `評分說明.md`，**沒有任何系統分數**。
- `auto-report/`：系統自動評分（不要給老師）。`PRIVATE-source-map.csv`：匿名代碼與原始檔名，只留本機。

老師在評分表的 `c:<項目>` 欄位填各項得分（`score` 可留空，系統依各項加總換算成 100 分制）。收回後：

```sh
npm run --silent bridge -- calibrate output/calibration/<批次>/auto-report --teachers scores-T1.csv,scores-T2.csv
```

報告列出自動分與教師中位數的 Spearman、平均絕對誤差、各項目誤差、教師間一致性、大幅落差中已進複核佇列的比例、90 分以上比例與「證據覆蓋率越低分數越高」檢查。系統分數還是 pending 的作品（例如有只能由老師判定的項目），只比對系統已自動判定的項目，雙方用同一範圍（`partialScope` 列出件數）。任何一項沒過，`officialReady` 就是 `false`，結果只能稱為「試行正式評量」。

## 5. MCP 與 API

- MCP 工具：`validate_rubric`、`draft_rubric`、`grade_sb3`、`grade_sb3_batch`、`get_grade_report`。檔案必須放在 Bridge 的 `output/` 底下（例如 `output/classes/601/`），報告寫到 `output/reports/`；不會回傳姓名對照表，也不會把學生作品送到外部模型。
- 本機 JSON API：`npm run grading-api -- --token-file <只有自己可讀的 64 位十六進位 token 檔>`，只聽 `127.0.0.1`，需要 `Authorization: Bearer <token>`，拒絕帶 `Origin` 的瀏覽器請求。端點：`GET /v1/health`、`POST /v1/rubrics/validate`、`POST /v1/rubrics/draft`、`POST /v1/grade`（`file` 或 `sb3Base64`）、`POST /v1/jobs`、`GET /v1/jobs/<id>`、`GET /v1/jobs/<id>/grades.csv|review-queue.csv|summary|students/<studentId>`。
- 程式內使用：`src/api/index.ts` 匯出瀏覽器安全的評分核心（rubric、證據、評分、校準、報表）。
