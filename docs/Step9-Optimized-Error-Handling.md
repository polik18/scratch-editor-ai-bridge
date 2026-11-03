## Scratch AI Bridge Step 9 C.4：優化錯誤處理（2026-11-03）

- **修改檔案**：`packages/scratch-ai-bridge/src/main.ts`
- **變更**：在 `bootstrapVm.loadProject()` 外層包裝 try-catch
  - 預覽失敗時顯示明確錯誤訊息：`❌ 預覽失敗：{error.message}（已貼上 JSON，請手動貼回）`
  - 保留「貼回 JSON」作為備用方案：`iterationPaste.value = JSON.stringify(newProject, null, 2)`
- **Git 提交**：`refactor(bridge): 優化 vm.loadProject 錯誤處理` (commit `33aea4d520`)
- **驗收標準**：
  - [x] 預覽失敗時，顯示明確錯誤訊息
  - [x] 保留 JSON 貼上功能作為備用方案

### 代碼變更摘要

在 `iterationGenerate` 事件處理函數中，將原本直接呼叫 `bootstrapVm.loadProject(newProject)` 的區塊包裝在 try-catch 中：

```typescript
if (immediatePreview) {
  // 開啟：直接載入到 VM 預覽
  try {
    await bootstrapVm.loadProject(newProject)
    iterationStatus.textContent = '新版作品已載入預覽！'
    iterationStatus.dataset.kind = 'ok'
  } catch (previewError) {
    // 預覽失敗：顯示明確錯誤訊息並保留 JSON 貼上
    const errorMessage = `❌ 預覽失敗：${previewError instanceof Error ? previewError.message : String(previewError)}（已貼上 JSON，請手動貼回）`
    iterationStatus.textContent = errorMessage
    iterationStatus.dataset.kind = 'error'
    
    // 保留貼回 JSON 作為備用方案
    iterationPaste.value = JSON.stringify(newProject, null, 2)
  }
}
```

### 測試驗證

- `npm run build` 編譯通過
- TypeScript 0 錯誤
- Git commit 已推送至遠端
