# NLP Parser Onboarding

## Overview

The NLP parser converts natural language instructions to Scratch block commands.

- **Input**: Natural language prompt (e.g., "Make the sprite move 10 steps")
- **Output**: Array of parsed commands with opcodes, inputs, and confidence scores
- **Features**: Pattern matching (no LLM) + optional LLM (oMLX) fallback

## API

### `parseNaturalLanguage(text, omlxEndpoint?, apiKey?)`

Parse natural language to Scratch commands.

```typescript
import { parseNaturalLanguage } from '@scratch/scratch-ai-bridge/nlp';

const result = await parseNaturalLanguage('Make the sprite move 10 steps');
console.log(result.commands); // [{ opcode: 'motion_movesteps', inputs: { STEPS: 10 } }]
console.log(result.confidence); // 0.9
```

**Parameters**:
- `text`: Natural language prompt
- `omlxEndpoint`: Optional oMLX endpoint URL (e.g., 'http://localhost:8000/v1')
- `apiKey`: Optional API key for oMLX

**Returns**:
```typescript
{
  commands: ParsedCommand[];
  confidence: number;
  summary: string;
}
```

### `applyCommandsToSession(session, commands, targetName?)`

Apply parsed commands to a Scratch session.

```typescript
import { parseNaturalLanguage, applyCommandsToSession } from '@scratch/scratch-ai-bridge/nlp';
import { ScratchSession } from '@scratch/scratch-ai-bridge/api';

const session = await ScratchSession.create();
await session.newProject('My Project');

const result = await parseNaturalLanguage('Make the sprite move 10 steps');
await applyCommandsToSession(session, result.commands, 'Sprite1');
```

## CLI Usage

```bash
# Basic usage
scratch-session nlpParse "Make the sprite move 10 steps and say hello"

# With oMLX endpoint (optional)
scratch-session nlpParse "Make the sprite move 10 steps" http://localhost:8000/v1

# With API key (optional)
scratch-session nlpParse "Make the sprite move 10 steps" http://localhost:8000/v1 your-api-key
```

## Supported Patterns

| Pattern | Example | Output |
|---------|---------|--------|
| `move X steps` | "move 10 steps" | `motion_movesteps { STEPS: 10 }` |
| `turn right/left` | "turn right" | `motion_turnright { DEGREES: 15 }` |
| `say X` | "say hello" | `looks_say { MESSAGE: "hello" }` |
| `wait X sec` | "wait 2 seconds" | `control_wait { DURATION: 2 }` |
| `when clicked` | "when clicked" | `event_whenthisspriteclicked` |

## Pattern Matching

The parser uses keyword matching to identify common patterns:

1. **Movement**: `move`, `step`, `forward`, `turn right/left`
2. **Looks**: `say`, `hide`, `show`
3. **Control**: `repeat`, `wait`, `second`
4. **Events**: `click`, `flag`, `space`
5. **Sound**: `play`, `sound`
6. **Data**: `variable`, `score`

## Confidence Scoring

- **0.9**: Pattern matching succeeded
- **0.5**: No patterns matched (fallback)
- **0.95**: LLM parsing succeeded (if endpoint available)

## Integration with AI Agents

```typescript
import { ScratchSession, createSession } from '@scratch/scratch-ai-bridge/api';
import { parseNaturalLanguage } from '@scratch/scratch-ai-bridge/nlp';

async function handleUserPrompt(prompt: string) {
  const session = await createSession();
  await session.newProject('AI Project');
  
  // Parse natural language
  const result = await parseNaturalLanguage(prompt);
  
  if (result.commands.length === 0) {
    return 'Sorry, I didn\'t understand that.';
  }
  
  // Apply commands
  for (const cmd of result.commands) {
    await session.addBlock('Sprite1', cmd.opcode, {
      inputs: cmd.inputs,
      fields: cmd.fields,
    });
  }
  
  // Save project
  const sb3 = await session.compile();
  await Bun.file('output.sb3').write(sb3);
  
  return `Created project with ${result.commands.length} commands!`;
}

// Usage
const response = await handleUserPrompt('Make the sprite move 10 steps and say hello');
console.log(response);
```

## LLM Integration (Optional)

To use oMLX for better parsing:

1. Start oMLX server:
   ```bash
   omlx launch claude --model qwen3
   ```

2. Set environment variables:
   ```bash
   export OMLX_ENDPOINT=http://localhost:8000/v1
   export OMLX_API_KEY=dummy  # Required for compatibility
   ```

3. Use in parser:
   ```typescript
   const result = await parseNaturalLanguage(
     'Make the sprite move 10 steps and say hello',
     process.env.OMLX_ENDPOINT,
     process.env.OMLX_API_KEY
   );
   ```

## Example Prompts

| Input | Output |
|-------|--------|
| "Make the sprite move 10 steps" | 1 command |
| "Move forward, turn right, say hi" | 3 commands |
| "Wait 2 seconds, then move 5 steps" | 2 commands |
| "Add a timer that counts to 10" | Variable + repeat commands |
