// NLP Parser: Convert natural language to Scratch block commands
// Usage: import { parseNaturalLanguage } from '@scratch/scratch-ai-bridge/nlp';
import type { CanonicalInputRef } from '../cli/session/session.js'

export type ParsedCommandInput =
  CanonicalInputRef | { type: 'literal'; value: number | string } | { type: 'variable'; name: string }

// Common task templates mapped to block opcodes
const COMMON_TASKS: Record<string, string[]> = {
  // Movement
  move: ['motion_movesteps', 'motion_turnright', 'motion_turnleft', 'motion_gotoxy'],
  'move forward': ['motion_movesteps'],
  'turn right': ['motion_turnright'],
  'turn left': ['motion_turnleft'],
  // Looks
  say: ['looks_say', 'looks_sayforsecs'],
  show: ['looks_show'],
  hide: ['looks_hide'],
  // Events
  'when clicked': ['event_whenthisspriteclicked'],
  'when flag clicked': ['event_whenflagclicked'],
  'when space pressed': ['event_whenkeypressed'],
  // Control
  repeat: ['control_repeat', 'control_wait'],
  wait: ['control_wait'],
  // Sound
  play: ['sound_play', 'sound_playuntildone'],
  // Data
  variable: ['data_setvariableto', 'data_changevariableby'],
  // Sensing
  touch: ['sensing_touchingobject'],
}

// Input defaults for common blocks
const INPUT_DEFAULTS: Record<string, Record<string, ParsedCommandInput>> = {
  motion_movesteps: { STEPS: { type: 'literal', value: 10 } },
  motion_turnright: { DEGREES: { type: 'literal', value: 15 } },
  motion_turnleft: { DEGREES: { type: 'literal', value: 15 } },
  looks_say: { MESSAGE: { type: 'literal', value: 'Hello!' } },
  looks_sayforsecs: { MESSAGE: { type: 'literal', value: 'Hello!' } },
  control_wait: { DURATION: { type: 'literal', value: 1 } },
  sound_play: { SOUND_MENU: { type: 'literal', value: 'Meow' } },
  data_setvariableto: { VALUE: { type: 'literal', value: 0 } },
  data_changevariableby: { VALUE: { type: 'literal', value: 1 } },
}

export interface ParsedCommand {
  type: string
  opcode: string
  targetName?: string
  inputs?: Record<string, ParsedCommandInput>
  fields?: Record<string, [string, string | null]>
  description: string
}

export interface NLPResponse {
  commands: ParsedCommand[]
  confidence: number
  summary: string
}

interface LlmChoice {
  message?: {
    content?: string
  }
}

interface LlmResponse {
  choices?: LlmChoice[]
}

export interface CommandSession {
  addBlock(
    targetName: string,
    opcode: string,
    opts?: {
      inputs?: Record<string, ParsedCommandInput>
      fields?: Record<string, [string, string | null]>
      parent?: string | null
    },
  ): string | Promise<string>
}

/**
 * Parse natural language to Scratch commands.
 * @param text - Natural language prompt to parse.
 * @param omlxEndpoint - Optional oMLX inference endpoint URL.
 * @param apiKey - Optional API key for authentication.
 * @returns Parsed commands and confidence information.
 */
export async function parseNaturalLanguage(
  text: string,
  omlxEndpoint?: string,
  apiKey?: string,
): Promise<NLPResponse> {
  const normalizedText = text.toLowerCase().trim()

  // Try to match common patterns first
  const commands = matchCommonPatterns(normalizedText)

  // If no patterns matched and oMLX is available, use it
  if (commands.length === 0 && omlxEndpoint) {
    try {
      return await parseWithLlm(text, omlxEndpoint, apiKey)
    } catch {
      // Fall back to basic parsing
    }
  }

  // Return parsed commands or empty result
  return {
    commands,
    confidence: commands.length > 0 ? 0.9 : 0.5,
    summary:
      commands.length > 0 ? `Parsed ${commands.length} command(s) from "${text}"` : `No commands found in "${text}"`,
  }
}

/**
 * Match common natural language patterns to Scratch blocks.
 * @param text - Normalized input text.
 * @returns Array of matched command structures.
 */
function matchCommonPatterns(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = []

  // Check each task type
  for (const [taskType, opcodes] of Object.entries(COMMON_TASKS)) {
    if (text.includes(taskType)) {
      // Generate command for each matching opcode
      for (const opcode of opcodes) {
        const inputs = { ...INPUT_DEFAULTS[opcode] }

        // Special cases for common patterns
        if (opcode === 'motion_movesteps') {
          const stepMatch = /(\d+)/.exec(text)
          if (stepMatch?.[1]) {
            inputs.STEPS = { type: 'literal', value: parseInt(stepMatch[1], 10) }
          }
        }
        if (opcode === 'looks_say' && text.includes('say')) {
          const sayMatch = /say["']?([^"']+)/.exec(text)
          if (sayMatch?.[1]) {
            inputs.MESSAGE = { type: 'literal', value: sayMatch[1].trim() }
          }
        }
        if (opcode === 'control_wait') {
          const waitMatch = /(\d+\.?\d*)\s*(second|sec|s)/.exec(text)
          if (waitMatch?.[1]) {
            inputs.DURATION = { type: 'literal', value: parseFloat(waitMatch[1]) }
          }
        }

        commands.push({
          type: taskType,
          opcode,
          inputs,
          fields: {},
          description: taskType,
        })
      }
    }
  }

  // Special case: "make sprite move X steps"
  if (text.includes('move') && text.includes('step')) {
    const stepsMatch = /(\d+)\s*step/.exec(text)
    if (stepsMatch?.[1]) {
      commands.push({
        type: 'move',
        opcode: 'motion_movesteps',
        inputs: { STEPS: { type: 'literal', value: parseInt(stepsMatch[1], 10) } },
        fields: {},
        description: 'Move 10 steps',
      })
    } else {
      commands.push({
        type: 'move',
        opcode: 'motion_movesteps',
        inputs: { STEPS: { type: 'literal', value: 10 } },
        fields: {},
        description: 'Move 10 steps',
      })
    }
  }

  return commands
}

/**
 * Parse natural language using LLM (oMLX).
 * @param text - Prompt text.
 * @param endpoint - Model inference endpoint.
 * @param apiKey - Optional bearer API key.
 * @returns Parsed NLP response.
 */
async function parseWithLlm(text: string, endpoint: string, apiKey?: string): Promise<NLPResponse> {
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

Return only valid JSON. Use English for type and description.`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
    })

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`)
    }

    const data = (await response.json()) as LlmResponse
    const content = data.choices?.[0]?.message?.content ?? ''

    // Extract JSON from response
    const jsonMatch = /\[[\s\S]*\]/.exec(content)
    if (jsonMatch?.[0]) {
      const commands = JSON.parse(jsonMatch[0]) as ParsedCommand[]
      return {
        commands,
        confidence: 0.95,
        summary: `Parsed ${commands.length} command(s) using LLM`,
      }
    }

    throw new Error('No JSON array found in response')
  } catch (error) {
    console.error('LLM parsing failed:', error)
    throw error
  }
}

/**
 * Apply parsed commands to a Scratch session.
 * @param session - Target Scratch session instance.
 * @param commands - Array of parsed commands to insert.
 * @param targetName - Optional target sprite name, defaults to Sprite1.
 */
export async function applyCommandsToSession(
  session: CommandSession,
  commands: ParsedCommand[],
  targetName = 'Sprite1',
): Promise<void> {
  // Create a hat block if needed
  const hatId = await session.addBlock(targetName, 'event_whenflagclicked')

  let parentId = hatId

  for (const cmd of commands) {
    // Add command block
    const blockId = await session.addBlock(targetName, cmd.opcode, {
      inputs: cmd.inputs,
      fields: cmd.fields,
      parent: parentId,
    })

    parentId = blockId
  }
}
