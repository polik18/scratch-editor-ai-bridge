# Preview Automation Onboarding

## Overview

Playwright-based preview automation for Scratch projects.

- **Screenshot generation**: Capture project execution as PNG
- **Preview run**: Run project for specified duration
- **Integration**: Works with `ScratchSession` API

## API

### `previewScreenshot(session, outputPath?)`

Capture screenshot of Scratch project execution.

```typescript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { previewScreenshot } from '@scratch/scratch-ai-bridge/preview';

const session = await createSession();
await session.newProject('My Project');
await session.addSprite('Sprite1');
await session.addBlock('Sprite1', 'motion_movesteps', { 
  inputs: { STEPS: { type: 'literal', value: 10 } } 
});

const filePath = await previewScreenshot(session);
console.log('Screenshot saved:', filePath);
// Output: screenshot saved: /path/to/preview.png
```

**Parameters**:
- `session`: `ScratchSession` instance
- `outputPath`: Optional output file path (default: `process.cwd() + '/preview.png'`)

**Returns**: `Promise<string>` - Output file path

### `previewRun(session, duration?)`

Run preview for specified duration.

```typescript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { previewRun } from '@scratch/scratch-ai-bridge/preview';

const session = await createSession();
await session.newProject('My Project');
await session.addSprite('Sprite1');
await session.addBlock('Sprite1', 'motion_movesteps', { 
  inputs: { STEPS: { type: 'literal', value: 10 } } 
});

await previewRun(session, 5); // Run for 5 seconds
console.log('Preview completed');
```

**Parameters**:
- `session`: `ScratchSession` instance
- `duration`: Run duration in seconds (default: 5)

**Returns**: `Promise<void>`

## CLI Usage

```bash
# Capture screenshot
scratch-session preview-screenshot /tmp/preview.png

# Run preview for 10 seconds
# (Note: preview-screenshot currently only captures screenshot)
```

## Implementation Details

### Browser Launch

- Uses Chromium in headless mode
- Args: `--no-sandbox`, `--disable-setuid-sandbox` (required for Docker/headless servers)

### Screenshot Process

1. Compile project to validate structure
2. Write SB3 to temporary directory
3. Launch Playwright browser
4. Load preview UI (in production, use `preview/main.ts`)
5. Wait for project initialization (2 seconds)
6. Capture screenshot
7. Clean up temporary files

### Production Preview

For full preview functionality, integrate with `preview/main.ts`:

```typescript
import { previewScreenshot } from '@scratch/ai-bridge/preview';
import { createProject, resumePreviewAudio } from '@scratch/ai-bridge/preview/main';

// In production, use the actual preview UI:
// 1. Create VM with `preview/main.ts` functions
// 2. Load project via `createProject()`
// 3. Resume audio via `resumePreviewAudio()`
// 4. Run project for N seconds
// 5. Take screenshot
```

## Testing

```bash
# Test preview screenshot
npx tsx src/cli/session-cli.ts preview-screenshot /tmp/test-preview.png

# Verify output
ls -lh /tmp/test-preview.png
# Should show PNG file with dimensions
```

## Troubleshooting

**Error: `path: unsupported mime type "null"`**

The project may not have any sprites or costumes. Ensure you've added at least one sprite with a costume.

**Error: `Browser not found`**

Install Playwright dependencies:
```bash
npx playwright install chromium
```

**Empty screenshot**

The project may not have any active blocks. Ensure:
1. Block is attached to a hat block (e.g., `event_whenflagclicked`)
2. Hat block is visible on workspace
3. Sprite is visible on stage

## Example: Full Preview Workflow

```typescript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { previewScreenshot } from '@scratch/scratch-ai-bridge/preview';

async function createAndPreview() {
  // Create session
  const session = await createSession();
  await session.newProject('My Project');
  
  // Add sprite
  await session.addSprite('Sprite1');
  
  // Add blocks
  const hatId = await session.addBlock('Sprite1', 'event_whenflagclicked');
  await session.addBlock('Sprite1', 'motion_movesteps', {
    inputs: { STEPS: { type: 'literal', value: 10 } },
    parent: hatId,
  });
  await session.addBlock('Sprite1', 'looks_say', {
    inputs: { MESSAGE: { type: 'literal', value: 'Hello!' } },
    parent: hatId,
  });
  
  // Take screenshot
  const filePath = await previewScreenshot(session);
  console.log('Preview saved:', filePath);
  
  return filePath;
}

createAndPreview();
```

## Integration with CI/CD

```yaml
# .github/workflows/test.yml
name: Test Preview Automation

on: [push]

jobs:
  test-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install chromium
      - run: npx tsx src/cli/session-cli.ts preview-screenshot preview.png
      - uses: actions/upload-artifact@v3
        with:
          name: previews
          path: preview.png
```
