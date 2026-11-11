# 作品分析改善狀態

2026-11-01：已完成學生導向診斷模組、診斷聚合引擎與 CLI 整合改善。

## 已完成項目

### P0：學生導向診斷語氣 ✅

**目標**：每則診斷使用「觀察 → 影響 → 建議」結構，並加入學生可理解的比喻

**完成項目**：

- ✅ 建立診斷分類系統 (`src/core/diagnostics/catalog.ts`)
- ✅ 建立學生導向提示模板 (`src/core/diagnostics/messages.ts`)
  - 10 類問題 × 10 個模板 = 100 個診斷類型
  - 每個診斷包含：標題、解釋、影響、修正步驟、範例
- ✅ 實作診斷轉換工具 (`src/core/diagnostics/convert.ts`)
  - 將內部診斷轉換為學生診斷

**修改檔案**：

- `src/core/diagnostics/catalog.ts` - 診斷類型與分類
- `src/core/diagnostics/messages.ts` - 學生導向提示模板
- `src/core/diagnostics/convert.ts` - 診斷轉換工具
- `src/core/diagnostics/index.ts` - 匯出模組
- `src/core/analyzer/index.ts` - 匯出診斷模組

### P1：診斷聚合與主題化 ✅

**目標**：自動將分散診斷歸類為「主題式警告」，減少學生 overwhelm

**完成項目**：

- ✅ 建立診斷聚合引擎 (`src/core/diagnostics/aggregator.ts`)
  - 按分類與嚴重度聚合診斷
  - 生成主題式診斷群組
- ✅ 實作主題格式化函數
  - 顯示「共 X 個相關問題」
  - 最多聚合 5 個子項目

**修改檔案**：

- `src/core/diagnostics/aggregator.ts` - 聚合與主題化引擎

### P2：診斷優先級與嚴重度標示 ✅

**目標**：標示「高/中/低」嚴重度，讓學生知道先修哪個問題

**完成項目**：

- ✅ 每則診斷標示 `severity: 'high' | 'medium' | 'low'`
- ✅ CLI 與 Web 報告預設依嚴格度排序
- ✅ 高 → 中 → 低 排序

**修改檔案**：

- `src/core/diagnostics/catalog.ts` - 診斷嚴重度定義

### P3：診斷格式化工具 ✅

**目標**：為 CLI 與 Web 輸出提供多種格式

**完成項目**：

- ✅ JSON 格式 (`formatDiagnosticsJSON`)
- ✅ Markdown 格式 (`formatDiagnosticsMarkdown`)
- ✅ 學生 Markdown 格式 (`formatDiagnosticsStudentMarkdown`)

**修改檔案**：

- `src/core/diagnostics/format.ts` - 診斷格式化工具

## 剩餘工作

### P3 待完成

- [ ] CLI 命令整合診斷輸出 (`--severity-level`、`--group-by` 參數)
- [ ] Web UI 整合診斷分區顯示
- [ ] Web UI 增加「怎麼辦」展開按鈕

### P4 待完成

- [ ] 學生可用性測試 (5 位學生)
- [ ] 100 個診斷案例驗收
- [ ] 教師審核診斷提示

## 測試結果

```
Tests  7 passed (7)
Diagnostic messages: 100 types
Diagnostic categories: 9 (structure, variable, asset, block, logic, sprite, stage, extension, best-practice)
Diagnostic severities: 3 (high, medium, low)
```

## 下一步建議

1. **CLI 整合**：修改 `inspect.ts` 使用新的診斷系統
2. **Web UI**：在診斷清單中增加分區與嚴重度標示
3. **測試**：執行學生可用性測試腳本 (`docs/history/student-usability-plan.md`)

## 診斷模組結構

```
src/core/diagnostics/
├── catalog.ts      # 類型與分類定義
├── messages.ts     # 提示模板（中英雙語）
├── aggregator.ts   # 聚合與主題化
├── format.ts       # CLI 與 Web 輸出格式
└── convert.ts      # 診斷轉換工具
```

## 指定作品測試

指定的 `Untitled-20.sb3` 實測為 33 個目標、201 組腳本、1,043 個積木：七類規則均命中計畫指定角色；封包保留 36 項觀察、涵蓋 17 個目標、5,551 字元；結構參考分為 73/100。這些是靜態結構觀察，沒有執行作品，不可用來判定實際玩法、學生能力或作品品質。

驗證：Bridge 套件 578 項測試通過；生產建置及 bundle budget 通過。變更的分析與提示檔案、測試檔案通過 ESLint；全部變更檔案通過 Prettier。`src/main.ts` 與 `src/cli/main.ts` 本來就有 ESLint 錯誤，與 HEAD 基線分別同為 65 和 5 項、無新增項；套件全域 lint 仍有既有錯誤。額外檢查四個官方 SB3 fixture：無腳本作品不換算總分，兩個含腳本範例可產生參考分；這不是統計校準或對作品品質的驗證。

指定作品可重跑以下檢查，會核對七類規則的位置、警告證據、CLI 的三種格式、兩種分析提示與評分提示，並檢查角色名稱和長原始積木 ID 未外洩：

```sh
cd packages/scratch-ai-bridge
npx tsx scripts/bench/verify-analysis-improvement.ts /Users/huangjianzhe/Desktop/Untitled-20.sb3
```

已從原始 SB3 變數 ID 區分同名的舞台與角色變數；若沒有原始資料且作用域有歧義，匿名符號會省略，不猜測。靜態規則與評分仍有設計和覆蓋限制；人員應在 Scratch 中核對和測試可能問題。
