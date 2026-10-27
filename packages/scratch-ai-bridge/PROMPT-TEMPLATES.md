# Prompt Templates Onboarding

## Overview

Prompt template library for common Scratch issues.

- **Structure**: Missing start blocks, detached scripts
- **Behavior**: Infinite loops, wait inside loops
- **Debug**: Sprite not visible, wrong directions
- **Learning**: Variable not set, score not updating
- **General**: Unknown blocks, unsupported features

## API

### `getPromptTemplate(category, title)`

Get prompt template by category and title.

```typescript
import { getPromptTemplate } from '@scratch/scratch-ai-bridge/prompt';

const template = getPromptTemplate('structure', '缺少開始積木');
console.log(template?.prompt);
// Output: 這段程式一開始是「{studentLabel}」，前面沒有綠旗或按鍵等開始積木...
```

**Parameters**:
- `category`: `TemplateCategory` ('structure' | 'behavior' | 'debug' | 'learning' | 'general')
- `title`: Template title (exact match)

**Returns**: `PromptTemplate | undefined`

### `getTemplatesByCategory(category)`

Get all templates in a category.

```typescript
import { getTemplatesByCategory } from '@scratch/scratch-ai-bridge/prompt';

const templates = getTemplatesByCategory('structure');
console.log(templates.length);
// Output: 2 (missing start block, detached script)
```

**Parameters**:
- `category`: `TemplateCategory`

**Returns**: `PromptTemplate[]`

### `getAllTemplates()`

Get all templates.

```typescript
import { getAllTemplates } from '@scratch/scratch-ai-bridge/prompt';

const templates = getAllTemplates();
console.log(templates.length);
// Output: 10
```

**Returns**: `PromptTemplate[]`

## Template Structure

```typescript
interface PromptTemplate {
  readonly category: TemplateCategory;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly examples: string[];
  readonly適用场景: string[];
}
```

### Fields

- **`category`**: Category of the issue
- **`title`**: Title of the template (used for lookup)
- **`description`**: Short description of the issue
- **`prompt`**: Main prompt text with placeholders
- **`examples`**: Example prompts
- **`適用场景`**: List of适用场景 where the template can be used

## Usage Example

```typescript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { getPromptTemplate } from '@scratch/scratch-ai-bridge/prompt';

async function analyzeProject() {
  const session = await createSession();
  await session.newProject('My Project');
  await session.addSprite('Sprite1');
  
  // Add blocks without start event
  await session.addBlock('Sprite1', 'motion_movesteps', {
    inputs: { STEPS: { type: 'literal', value: 10 } },
  });
  
  // Detect missing start block
  const template = getPromptTemplate('structure', '缺少開始積木');
  
  if (template) {
    const prompt = template.prompt.replace('{studentLabel}', 'Sprite1');
    console.log('提示:', prompt);
  }
}

analyzeProject();
```

## Integration with Analyzer

```typescript
import { parseAnalysis } from '../analyzer';
import { getPromptTemplate } from '@scratch/scratch-ai-bridge/prompt';

export function createAnalysisReport(analysis: AnalysisIR): string {
  const issues: string[] = [];
  
  // Check for missing start blocks
  const missingStart = getPromptTemplate('structure', '缺少開始積木');
  if (missingStart && hasMissingStartBlock(analysis)) {
    issues.push(missingStart.prompt);
  }
  
  // Check for infinite loops
  const infiniteLoop = getPromptTemplate('behavior', '無限迴圈');
  if (infiniteLoop && hasInfiniteLoop(analysis)) {
    issues.push(infiniteLoop.prompt);
  }
  
  return issues.join('\n\n');
}
```

## Template Categories

### Structure

| Title | Description |
|-------|-------------|
| `缺少開始積木` | Missing start event (green flag or key press) |
| `斷裂的積木群組` | Disconnected scripts or missing inputs |

### Behavior

| Title | Description |
|-------|-------------|
| `無限迴圈` | Infinite loop that may cause freezing |
| `迴圈內等待` | Wait block inside loop |

### Debug

| Title | Description |
|-------|-------------|
| `角色不可見` | Sprite is hidden or outside screen |
| `方向錯誤` | Wrong direction for movement |

### Learning

| Title | Description |
|-------|-------------|
| `變數未設定` | Variable not initialized |
| `分數未更新` | Score not incrementing |

### General

| Title | Description |
|-------|-------------|
| `未知的積木` | Unknown block or extension |
| `不支援的功能` | Unsupported feature |

## Example: Create New Template

```typescript
// Add new template to common-issues.ts
const MY_NEW_TEMPLATE: PromptTemplate = {
  category: 'structure',
  title: '我的新模板',
  description: '描述問題',
  prompt: '提示文字 {placeholder}',
  examples: ['範例 1', '範例 2'],
  適用场景: ['适用场景 1', '适用场景 2'],
};

// Register in TEMPLATES array
const TEMPLATES: readonly PromptTemplate[] = [
  // ... existing templates
  MY_NEW_TEMPLATE,
];
```

## CLI Usage

```bash
# No CLI command yet (integrated into analyzer/report.ts)
# Planned: scratch-session prompt "missing start block"
```
