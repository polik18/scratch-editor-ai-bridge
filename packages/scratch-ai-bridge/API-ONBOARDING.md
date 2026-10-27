# scratch-session API Onboarding

## Quick Start

```bash
# Install dependencies
cd /Users/huangjianzhe/Git/scratch-editor-ai-bridge
npm install

# Use in Node.js (AI agent)
node -e "
const { ScratchSession, createSession } = await import('@scratch/scratch-ai-bridge/api');
const sess = await createSession();
await sess.newProject('My Project');
await sess.addSprite('Sprite1');
await sess.addBlock('Sprite1', 'motion_movesteps', {
  fields: {},
  inputs: { STEPS: { type: 'literal', value: 10 } }
});
const sb3 = await sess.compile();
await Bun.file('output.sb3').write(sb3);
console.log('Project saved!');
"
```

## API Reference

### `createSession(path?: string)`

Helper function to create a new session (mimics static method).

- **`path`**: Optional path to existing SB3 file to load
- **Returns**: Promise that resolves to `ScratchSession` instance

### `ScratchSession`

Stateful Scratch project editor for AI agents.

#### Instance Methods

| Method | Description |
|--------|-------------|
| `info()` | Get project metadata (path, isDirty, targetCount, targets) |
| `listTargets()` | List all target names (Stage/Sprites) |
| `addSprite(name: string) => string` | Add sprite, returns target name |
| `removeTarget(targetId: string)` | Remove target |
| `addBlock(targetName: string, opcode: string, options: BlockOptions) => string` | Add block, returns block ID |
| `editBlock(blockId: string, updates: Partial<Block>)` | Update block fields/inputs |
| `removeBlock(blockId: string)` | Remove block |
| `compile(): Promise<Buffer>` | Compile to SB3 buffer |
| `saveSb3(path: string): Promise<string>` | Save to file |
| `loadSb3(path: string)` | Load existing SB3 file |
| `getProjectMap()` | Get project map (blocks → targets → variables) |

#### Types

```typescript
interface BlockOptions {
  fields?: Record<string, any>;
  inputs?: Record<string, InputRef>;
  parent?: string;      // Parent block ID
  next?: string;        // Next block ID
  position?: { x: number; y: number };
}

interface InputRef {
  type: 'literal' | 'block' | 'stack';
  value?: any;
  block?: BlockOptions;
  blocks?: BlockOptions[];  // For stack type
}
```

## Examples

### Add a repeating counter

```javascript
const { ScratchSession, createSession } = await import('@scratch/scratch-ai-bridge/api');
const sess = await createSession();
await sess.newProject('Counter');

const spriteName = await sess.addSprite('Sprite1');

// event_whenflagclicked
const hatId = await sess.addBlock(spriteName, 'event_whenflagclicked');

// data_setvariableto (score = 0)
await sess.addBlock(spriteName, 'data_setvariableto', {
  fields: { VARIABLE: 'score' },
  inputs: { VALUE: { type: 'literal', value: 0 } },
  parent: hatId
});

// control_repeat (10 times)
const repeatId = await sess.addBlock(spriteName, 'control_repeat', {
  inputs: {
    TIMES: { type: 'literal', value: 10 },
    SUBSTACK: { type: 'stack', blocks: [] }
  }
});

// motion_movesteps (10)
await sess.addBlock(spriteName, 'motion_movesteps', {
  inputs: { STEPS: { type: 'literal', value: 10 } },
  parent: repeatId
});

// data_changevariableby (score += 1)
await sess.addBlock(spriteName, 'data_changevariableby', {
  fields: { VARIABLE: 'score' },
  inputs: { VALUE: { type: 'literal', value: 1 } },
  parent: repeatId
});

// Looks_say ("Done!")
await sess.addBlock(spriteName, 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: 'Done!' } },
  parent: repeatId
});

// Compile and save
const sb3 = await sess.compile();
await Bun.file('counter.sb3').write(sb3);
```

### Edit existing project

```javascript
const { ScratchSession, createSession } = await import('@scratch/scratch-ai-bridge/api');
const sess = await createSession('my-project.sb3');

const targets = sess.listTargets();
const sprite = targets.find(t => t === 'Sprite1');
if (sprite) {
  // Find all motion_movesteps blocks
  const map = sess.getProjectMap();
  const blocks = map.findBlocksByOpcode(sprite, 'motion_movesteps');
  
  // Change all steps to 20
  blocks.forEach(blockId => {
    sess.editBlock(blockId, {
      inputs: { STEPS: { type: 'literal', value: 20 } }
    });
  });
}

const sb3 = await sess.compile();
await Bun.file('modified.sb3').write(sb3);
```

## CLI Usage

```bash
# Create new project
scratch-session new "My Project"

# Add sprite
scratch-session add-sprite Sprite1

# Add block (JSON format)
scratch-session add-block <targetName> motion_movesteps '{"fields":{},"inputs":{"STEPS":{"type":"literal","value":10}}}'

# Compile to SB3
scratch-session compile output.sb3

# Preview (validates structure)
scratch-session preview
```

## Integration with oMLX (Next Step)

Once Step 2 is implemented:

```javascript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { parseNaturalLanguage } from '@scratch/scratch-ai-bridge/nlp';

const sess = await createSession();
await sess.newProject('AI Project');

const prompt = "Make the sprite move 10 steps and say hello";
const commands = await parseNaturalLanguage(prompt);

commands.forEach(cmd => {
  switch (cmd.type) {
    case 'move':
      sess.addBlock(cmd.targetName, 'motion_movesteps', {
        inputs: { STEPS: { type: 'literal', value: cmd.steps } }
      });
      break;
    case 'say':
      sess.addBlock(cmd.targetName, 'looks_say', {
        inputs: { MESSAGE: { type: 'literal', value: cmd.message } }
      });
      break;
  }
});

await sess.compile();
```

## Troubleshooting

**Error: `Cannot find module '@scratch/scratch-vm'`**

Run `npm install` in the monorepo root to build dependencies.

**Error: `SB3 validation failed`**

Use `compile()` which validates before output. Check block structure matches Canonical IR spec.

**Block not showing in preview**

Ensure block has `position` field or is attached to a hat block with position.

**`addSprite()` returns target name, not ID**

Use the returned name directly for `addBlock(targetName, ...)`.
