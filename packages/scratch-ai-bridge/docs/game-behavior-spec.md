# 遊戲行為規格格式

本文件定義遊戲行為規格的格式，用於描述和驗證 Scratch 遊戲的行為。

## 規格結構

```typescript
interface BehaviorSpec {
  gameId: string;
  title: string;
  version: string;
  
  // 輸入定義
  inputs: {
    // 鍵盤輸入
    keyboard: {
      key: string;
      duration: number;
    }[];
    
    // 滑鼠輸入
    mouse: {
      x: number;
      y: number;
      button: 'left' | 'right' | 'middle';
      duration: number;
    }[];
    
    // 事件輸入
    events: {
      type: 'click' | 'keydown' | 'keyup' | 'touchstart' | 'touchend';
      target: string;
      detail?: any;
    }[];
  };
  
  // 預期輸出
  expectedOutputs: {
    // 變數變化
    variables: {
      name: string;
      initialValue: any;
      expectedValue: any;
      condition: 'equals' | 'greaterThan' | 'lessThan';
    }[];
    
    // 角色行為
    sprites: {
      name: string;
      position: {
        x: number;
        y: number;
      };
      direction: number;
      visible: boolean;
      costume: string;
    }[];
    
    // 音效/視覺效果
    effects: {
      type: 'sound' | 'visual' | 'message';
      name: string;
      triggered: boolean;
    }[];
  };
  
  // 邊界案例
  edgeCases: {
    description: string;
    input: any;
    expectedBehavior: any;
  }[];
  
  // 失敗案例
  failureScenarios: {
    description: string;
    input: any;
    expectedError: string;
  }[];
}
```

## 測試案例範例

### 最小遊戲

```json
{
  "gameId": "minimal-game",
  "title": "Minimal Game",
  "version": "1.0",
  "inputs": {
    "keyboard": [
      {"key": "space", "duration": 100}
    ]
  },
  "expectedOutputs": {
    "variables": [
      {"name": "Score", "initialValue": 0, "expectedValue": 1, "condition": "equals"}
    ]
  },
  "edgeCases": [],
  "failureScenarios": []
}
```

### 平台遊戲

```json
{
  "gameId": "platform-game",
  "title": "Platform Game",
  "version": "1.0",
  "inputs": {
    "keyboard": [
      {"key": "ArrowRight", "duration": 500},
      {"key": "Space", "duration": 100}
    ]
  },
  "expectedOutputs": {
    "sprites": [
      {
        "name": "Sprite1",
        "position": {"x": 100, "y": 0},
        "direction": 90,
        "visible": true,
        "costume": "costume1"
      }
    ]
  },
  "edgeCases": [
    {
      "description": "在平台邊緣跳躍",
      "input": {"key": "Space", "duration": 100},
      "expectedBehavior": "角色掉出平台"
    }
  ],
  "failureScenarios": [
    {
      "description": "沒有角色時跳躍",
      "input": {"key": "Space", "duration": 100},
      "expectedError": "No sprite to jump"
    }
  ]
}
```

## 測試執行規範

1. **測試環境**
   - 使用 Scratch VM 執行遊戲
   - 模擬使用者輸入
   - 監測變數和角色狀態

2. **測試流程**
   - 載入遊戲
   - 執行輸入序列
   - 讀取最終狀態
   - 比對預期與實際結果

3. **測試結果**
   - PASS：所有預期輸出符合
   - FAIL：任何預期輸出不符合
   - SKIP：測試環境不支援

## 診斷格式

```typescript
interface BehaviorTestResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  expectedOutputs: {
    name: string;
    expected: any;
    actual: any;
    status: 'pass' | 'fail';
  }[];
  executionTime: number;
  vmState: any;
}
```
