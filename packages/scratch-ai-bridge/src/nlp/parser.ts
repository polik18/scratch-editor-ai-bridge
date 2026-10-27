// NLP Parser: Convert natural language to Scratch block commands
// Usage: import { parseNaturalLanguage } from '@scratch/scratch-ai-bridge/nlp';

import type { CanonicalBlockCategory, CanonicalBlockCapability } from '../core/capabilities';
import type { Session } from '../cli/session';

// Common task templates mapped to block opcodes
const COMMON_TASKS: Record<string, string[]> = {
  // Movement
  move: ['motion_movesteps', 'motion_turnright', 'motion_turnleft', 'motion_gotoxy'],
  'move forward': ['motion_movesteps'],
  'turn right': ['motion_turnright'],
  'turn left': ['motion_turnleft'],
  // Looks
  say: ['looks_say', 'looks_sayforsecs'],
  'show': ['looks_show'],
  'hide': ['looks_hide'],
  // Events
  'when clicked': ['event_whenthisspriteclicked'],
  'when flag clicked': ['event_whenflagclicked'],
  'when space pressed': ['event_whenkeypressed'],
  // Control
  repeat: ['control_repeat', 'control_wait'],
  'wait': ['control_wait'],
  // Sound
  play: ['sound_play', 'sound_playuntildone'],
  // Data
  variable: ['data_setvariableto', 'data_changevariableby'],
  // Sensing
  touch: ['sensing_touchingobject'],
};

// Block categories by opcode
const OPCODE_TO_CATEGORY: Record<string, CanonicalBlockCategory> = {
  motion_movesteps: 'motion',
  motion_turnright: 'motion',
  motion_turnleft: 'motion',
  motion_gotoxy: 'motion',
  looks_say: 'looks',
  looks_sayforsecs: 'looks',
  looks_show: 'looks',
  looks_hide: 'looks',
  event_whenthisspriteclicked: 'events',
  event_whenflagclicked: 'events',
  event_whenkeypressed: 'events',
  control_repeat: 'control',
  control_wait: 'control',
  sound_play: 'sound',
  sound_playuntildone: 'sound',
  data_setvariableto: 'data',
  data_changevariableby: 'data',
  sensing_touchingobject: 'sensing',
};

// Input defaults for common blocks
const INPUT_DEFAULTS: Record<string, Record<string, any>> = {
  motion_movesteps: { STEPS: 10 },
  motion_turnright: { DEGREES: 15 },
  motion_turnleft: { DEGREES: 15 },
  looks_say: { MESSAGE: 'Hello!' },
  looks_sayforsecs: { MESSAGE: 'Hello!', SECS: 2 },
  control_wait: { DURATION: 1 },
  sound_play: { SOUND_MENU: 'Meow' },
  data_setvariableto: { VALUE: 0 },
  data_changevariableby: { VALUE: 1 },
};

export interface ParsedCommand {
  type: string;
  opcode: string;
  targetName?: string;
  inputs?: Record<string, any>;
  fields?: Record<string, any>;
  description: string;
}

export interface NLPResponse {
  commands: ParsedCommand[];
  confidence: number;
  summary: string;
}

/**
 * Parse natural language to Scratch commands
 * @param text Natural language prompt
 * @param omlxEndpoint Optional oMLX endpoint URL
 * @param apiKey Optional API key for oMLX
 * @returns Parsed commands
 */
export async function parseNaturalLanguage(
  text: string,
  omlxEndpoint?: string,
  apiKey?: string
): Promise<NLPResponse> {
  const normalizedText = text.toLowerCase().trim();
  
  // Try to match common patterns first
  const commands = matchCommonPatterns(normalizedText);
  
  // If no patterns matched and oMLX is available, use it
  if (commands.length === 0 && omlxEndpoint) {
    try {
      return await parseWithLlm(text, omlxEndpoint, apiKey);
    } catch {
      // Fall back to basic parsing
    }
  }
  
  // Return parsed commands or empty result
  return {
    commands,
    confidence: commands.length > 0 ? 0.9 : 0.5,
    summary: commands.length > 0 
      ? `Parsed ${commands.length} command(s) from "${text}"` 
      : `No commands found in "${text}"`,
  };
}

/**
 * Match common natural language patterns to Scratch blocks
 */
function matchCommonPatterns(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  
  // Check each task type
  for (const [taskType, opcodes] of Object.entries(COMMON_TASKS)) {
    if (text.includes(taskType)) {
      // Generate command for each matching opcode
      for (const opcode of opcodes) {
        const inputs = { ...INPUT_DEFAULTS[opcode] };
        
        // Special cases for common patterns
        if (opcode === 'motion_movesteps' && text.match(/(\d+)/)) {
          inputs.STEPS = parseInt(text.match(/(\d+)/)![1], 10);
        }
        if (opcode === 'looks_say' && text.includes('say')) {
          const match = text.match(/say["']?([^"']+)/);
          if (match && match[1]) {
            inputs.MESSAGE = match[1].trim();
          }
        }
        if (opcode === 'control_wait' && text.match(/(\d+\.?\d*)\s*(second|sec|s)/)) {
          inputs.DURATION = parseFloat(text.match(/(\d+\.?\d*)\s*(second|sec|s)/)![1]);
        }
        
        commands.push({
          type: taskType,
          opcode,
          inputs,
          fields: {},
          description: taskType,
        });
      }
    }
  }
  
  // Special case: "make sprite move X steps"
  if (text.includes('move') && text.includes('step')) {
    const stepsMatch = text.match(/(\d+)\s*step/);
    if (stepsMatch) {
      commands.push({
        type: 'move',
        opcode: 'motion_movesteps',
        inputs: { STEPS: parseInt(stepsMatch[1], 10) },
        fields: {},
        description: `Move 10 steps`,
      });
    } else {
      commands.push({
        type: 'move',
        opcode: 'motion_movesteps',
        inputs: { STEPS: 10 },
        fields: {},
        description: 'Move 10 steps',
      });
    }
  }
  
  return commands;
}

/**
 * Parse natural language using LLM (oMLX)
 */
async function parseWithLlm(
  text: string,
  endpoint: string,
  apiKey?: string
): Promise<NLPResponse> {
  const systemPrompt = `You are a Scratch programming assistant. Convert natural language instructions to a JSON array of Scratch block commands.

Each command should have:
- type: category of the action (move, say, wait, etc.)
- opcode: Scratch block opcode (e.g., 'motion_movesteps', 'looks_say')
- inputs: object with block inputs (e.g., { STEPS: 10 }, { MESSAGE: 'Hello!' })
- fields: object with block fields (e.g., { VARIABLE: 'score' })
- targetName: optional sprite name (default: 'Sprite1')

Available opcodes:
- motion_movesteps, motion_turnright, motion_turnleft, motion_gotoxy
- looks_say, looks_sayforsecs, looks_show, looks_hide
- event_whenthisspriteclicked, event_whenflagclicked, event_whenkeypressed
- control_repeat, control_wait
- sound_play, sound_playuntildone
- data_setvariableto, data_changevariableby

Example:
Input: "Make the sprite move 10 steps and say hello"
Output: [
  { "type": "move", "opcode": "motion_movesteps", "inputs": { "STEPS": 10 } },
  { "type": "say", "opcode": "looks_say", "inputs": { "MESSAGE": "Hello!" } }
]

Return only valid JSON. Use English for type and description.`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'qwen3-coder-next-80b-local',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Convert to Scratch blocks: "${text}"` },
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const commands = JSON.parse(jsonMatch[0]) as ParsedCommand[];
      return {
        commands,
        confidence: 0.95,
        summary: `Parsed ${commands.length} command(s) using LLM`,
      };
    }
    
    throw new Error('No JSON array found in response');
  } catch (error) {
    console.error('LLM parsing failed:', error);
    throw error;
  }
}

/**
 * Apply parsed commands to a Scratch session
 */
export async function applyCommandsToSession(
  session: any,
  commands: ParsedCommand[],
  targetName: string = 'Sprite1'
): Promise<void> {
  // Create a hat block if needed
  const hatId = await session.addBlock(targetName, 'event_whenflagclicked');
  
  let parentId = hatId;
  
  for (const cmd of commands) {
    // Add command block
    const blockId = await session.addBlock(targetName, cmd.opcode, {
      inputs: cmd.inputs,
      fields: cmd.fields,
      parent: parentId,
    });
    
    parentId = blockId;
  }
}
