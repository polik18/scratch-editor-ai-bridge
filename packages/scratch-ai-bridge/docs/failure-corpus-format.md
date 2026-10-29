# Failure Corpus Format

本文件定義失敗案例的格式，用於追蹤和統計 Gate 失敗。

## 失敗案例結構

```typescript
interface FailureCase {
  id: string;  // 唯一識別碼，例如 f-001
  title: string;
  description: string;
  
  // 輸入
  input: {
    type: 'sb3' | 'design-json';
    path: string;
    hash: string;
  };
  
  // 錯誤訊息
  error: {
    message: string;
    stack?: string;
  };
  
  // 診斷
  diagnostic: {
    type: 'error' | 'warning';
    stage: ProjectCompileFailureStage;
    code: string;
    message: string;
    suggestion: string;
    location?: DiagnosticLocation;
  };
  
  // 修正提示
  fix?: {
    description: string;
    example?: string;
  };
}
```

## Gate 分類

失敗案例必須標記其 Gate 分類：

- `parse`: 解析錯誤（JSON 解析、檔案格式錯誤等）
- `normalize`: 正規化錯誤（設計格式不正確等）
- `schema`: 結構驗證錯誤（缺少必要欄位等）
- `semantic`: 語義錯誤（無效的 block graph、缺少素材等）
- `vm-load`: VM 載入錯誤
- `vm-save`: VM 儲存錯誤
- `reload`: Reload 錯誤
- `unknown`: 未知錯誤

## 失敗原因分類

每個 Gate 失敗必須標記其失敗原因：

- `missing-assets`: 缺少素材
- `bad-graph`: 無效的 block graph
- `unknown-opcode`: 未知的 opcode
- `invalid-value`: 無效的值
- `type-mismatch`: 類型不匹配
- `missing-reference`: 缺少參考
- `unsupported-feature`: 不支援的功能
- `other`: 其他原因

## 範例

```json
{
  "id": "f-001",
  "title": "Missing costume asset",
  "description": "SB3 檔案缺少必需的 costume 資訊",
  "input": {
    "type": "sb3",
    "path": "examples/f-001.sb3",
    "hash": "a1b2c3d4e5f6..."
  },
  "error": {
    "message": "Missing costume asset",
    "stack": "Error: Missing costume asset\n    at ..."
  },
  "diagnostic": {
    "type": "error",
    "stage": "svg-preflight",
    "code": "MISSING_ASSET",
    "message": "Missing costume asset",
    "suggestion": "Add costume with MD5 hash",
    "location": {
      "target": "Sprite1",
      "costumeIndex": 0
    }
  },
  "fix": {
    "description": "Add costume with valid MD5 hash",
    "example": "{\"name\":\"costume1\",\"baseLayerMD5\":\"abc123...\"}"
  }
}
```

## 失敗案例目錄結構

```
research/sb3-failure-corpus/
├── f-001/
│   ├── sb3/           # 失敗的 SB3 檔案
│   ├── error.json     # 錯誤訊息和診斷
│   ├── fix.md         # 修正提示
│   └── metadata.json  # 失敗案例元資料
├── f-002/
│   └── ...
```
