# Web UI Onboarding

## Overview

React-based web UI for AI × Scratch Bridge (Step 5 of improvement plan).

- **Natural language parsing**: Convert prompts to Scratch blocks
- **Project preview**: Take screenshots with Playwright
- **Download SB3**: Export projects as downloadable files

## Architecture

```
src/ui/
├── App.tsx       # React-like components (DOM API)
├── style.css     # UI styles
├── main.ts       # Browser entry point
└── preview.html  # Preview page
```

## Components

### Header

```tsx
<h1>AI × Scratch 編輯器</h1>
<p>將自然語言指令轉為 Scratch 專案</p>
```

### Editor

- **Prompt Input**: Textarea for natural language instructions
- **Buttons**: 
  - `生成專案` (Generate Project)
  - `預覽截圖` (Preview Screenshot)
  - `下載 .sb3` (Download SB3)
- **Status Bar**: Current status (idle/loading/success/error)
- **Output Log**: Console for operation logs

### Footer

```tsx
<p>Powered by Scratch AI Bridge • Step 5: Web UI</p>
```

## Usage

### Start Dev Server

```bash
cd /Users/huangjianzhe/Git/scratch-editor-ai-bridge/packages/scratch-ai-bridge
npm run dev
```

Then visit: `http://localhost:5173/src/ui/preview.html`

### Use API in Code

```typescript
import createApp, { bindEvents } from '@scratch/scratch-ai-bridge/ui';

const app = createApp();
document.getElementById('app')!.appendChild(app);
bindEvents(app);
```

## Event Flow

### Generate Project

1. User enters natural language prompt
2. Click "生成專案" button
3. Parse prompt with `parseNaturalLanguage()`
4. Create session with `createSession()`
5. Add blocks based on parsed commands
6. Log operation to output log

### Preview Screenshot

1. Click "預覽截圖" button
2. Compile project with `currentSession.compile()`
3. Capture screenshot with `previewScreenshot()`
4. Save to `/tmp/preview.png`
5. Log file path

### Download SB3

1. Click "下載 .sb3" button
2. Compile project with `currentSession.compile()`
3. Create Blob from SB3 data
4. Trigger download
5. Log completion

## Styling

```css
.ai-bridge-app {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.ai-bridge-header {
  text-align: center;
  margin-bottom: 30px;
}

.btn-generate {
  background: #174f3c;
  color: white;
}

.btn-preview {
  background: #4a90d9;
  color: white;
}

.btn-download {
  background: #6c757d;
  color: white;
}
```

## Integration with Existing UI

The existing `index.html` / `src/main.ts` is a full-featured Scratch analyzer. This new UI focuses on the AI bridge workflow:

- **Existing**: Project upload, analysis, scoring, feedback
- **New**: Natural language → blocks → preview → download

## Future Enhancements

- [ ] Real-time preview with Scratch VM
- [ ] Block-based editor (scratch-blocks)
- [ ] Multiple sprites support
- [ ] Custom sprite upload
- [ ] Project templates
- [ ] Export to JSON/JS
