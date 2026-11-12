/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition -- Archive and generated Scratch message data are intentionally loosely typed. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

interface BlockMessage {
  readonly messageKey: string
  readonly template: string
  readonly args: readonly string[]
}

interface LocaleBundle {
  readonly blocks: Record<string, BlockMessage>
}

const require = createRequire(import.meta.url)
const l10nBlocks = require(resolve(process.cwd(), '../../node_modules/scratch-l10n/locales/blocks-msgs.js'))
  .default as {
  'zh-tw': Record<string, string>
}
const l10nExtensions = require(resolve(process.cwd(), '../../node_modules/scratch-l10n/locales/extensions-msgs.js'))
  .default as { 'zh-tw': Record<string, string> }

const matchingBrace = (source: string, opening: number): number => {
  let depth = 0
  let quote: string | undefined
  let escaped = false
  for (let index = opening; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === String.fromCharCode(96)) {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) return index
  }
  return -1
}

const matchingBracket = (source: string, opening: number, open = '[', close = ']'): number => {
  let depth = 0
  let quote: string | undefined
  let escaped = false
  for (let index = opening; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === String.fromCharCode(96)) {
      quote = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close && --depth === 0) return index
  }
  return -1
}

const addCoreBlocks = (blocks: Record<string, BlockMessage>, source: string): void => {
  const assignment = /Blockly\.Blocks\.([A-Za-z0-9_]+)\s*=\s*\{/g
  for (;;) {
    const match = assignment.exec(source)
    if (match?.index === undefined) break
    const opening = source.indexOf('{', match.index)
    const closing = matchingBrace(source, opening)
    if (opening < 0 || closing < 0) continue
    const body = source.slice(opening, closing + 1)
    const message = /message0:\s*Blockly\.Msg\.([A-Z0-9_]+)/.exec(body)?.[1]
    if (!message) continue
    const template = l10nBlocks['zh-tw'][message]
    if (!template) continue
    const argsStart = body.indexOf('args0:')
    const openingArgs = argsStart < 0 ? -1 : body.indexOf('[', argsStart)
    const argsEnd = openingArgs < 0 ? -1 : matchingBracket(body, openingArgs)
    const argsBody = openingArgs >= 0 && argsEnd >= 0 ? body.slice(openingArgs, argsEnd + 1) : ''
    const args = [...argsBody.matchAll(/\bname:\s*['"]([^'"]+)['"]/g)].map((item) => item[1] ?? '')
    blocks[match[1]] = { messageKey: message, template, args }
  }
}

const addExtensionBlocks = (blocks: Record<string, BlockMessage>, root: string): void => {
  const extensionDirectory = resolve(root, 'packages/scratch-vm/src/extensions')
  for (const directory of readdirSync(extensionDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith('scratch3_')) continue
    const prefix = directory.name.slice('scratch3_'.length)
    const sourcePath = join(extensionDirectory, directory.name, 'index.js')
    let source: string
    try {
      source = readFileSync(sourcePath, 'utf8')
    } catch {
      continue
    }
    const opcodePattern = /opcode:\s*['"]([^'"]+)['"]/g
    for (;;) {
      const match = opcodePattern.exec(source)
      if (match?.index === undefined) break
      const nextOpcode = source.indexOf('opcode:', match.index + 1)
      const chunk = source.slice(match.index, nextOpcode < 0 ? source.length : nextOpcode)
      const key = /\bid:\s*['"]([^'"]+)['"]/.exec(chunk)?.[1] ?? prefix + '.' + match[1]
      const template = l10nExtensions['zh-tw'][key]
      if (!template) continue
      const fullOpcode = prefix + '_' + match[1]
      const args = [...template.matchAll(/\[([A-Z0-9_]+)\]/g)].map((item) => item[1] ?? '')
      blocks[fullOpcode] = { messageKey: key, template, args }
    }
  }
}

const addKnownCoreFallbacks = (blocks: Record<string, BlockMessage>): void => {
  const fallbacks: Record<
    string,
    {
      readonly messageKey: string
      readonly args: readonly string[]
      readonly template?: string
    }
  > = {
    control_stop: { messageKey: 'CONTROL_STOP', args: [] },
    control_create_clone_of_menu: {
      messageKey: 'CONTROL_CREATECLONEOF_MENU',
      template: '%1',
      args: ['CLONE_OPTION'],
    },
    event_whenbackdropswitchesto: { messageKey: 'EVENT_WHENBACKDROPSWITCHESTO', args: ['BACKDROP'] },
    looks_backdrops: { messageKey: 'LOOKS_BACKDROPS_MENU', template: '%1', args: ['BACKDROP'] },
    looks_costume: { messageKey: 'LOOKS_COSTUME_MENU', template: '%1', args: ['COSTUME'] },
    looks_costumenumbername: { messageKey: 'LOOKS_COSTUMENUMBERNAME', args: ['COSTUME'] },
    motion_glideto_menu: { messageKey: 'MOTION_GLIDETO_MENU', template: '%1', args: ['TO'] },
    motion_goto_menu: { messageKey: 'MOTION_GOTO_MENU', template: '%1', args: ['TO'] },
    motion_pointtowards_menu: { messageKey: 'MOTION_POINTTOWARDS_MENU', template: '%1', args: ['TOWARDS'] },
    music_menu_DRUM: { messageKey: 'MUSIC_MENU_DRUM', template: '鼓聲 %1', args: ['DRUM'] },
    music_menu_INSTRUMENT: { messageKey: 'MUSIC_MENU_INSTRUMENT', template: '樂器 %1', args: ['INSTRUMENT'] },
    note: { messageKey: 'NOTE', template: '音符 %1', args: ['NOTE'] },
    pen_menu_colorParam: { messageKey: 'PEN_MENU_COLOR_PARAM', template: '顏色參數 %1', args: ['COLOR_PARAM'] },
    sensing_distancetomenu: { messageKey: 'SENSING_DISTANCETOMENU', template: '%1', args: ['DISTANCETOMENU'] },
    sensing_keyoptions: { messageKey: 'SENSING_KEYOPTIONS', template: '%1', args: ['KEY_OPTION'] },
    sensing_of_object_menu: { messageKey: 'SENSING_OF_OBJECT_MENU', template: '%1', args: ['OBJECT'] },
    sensing_touchingobjectmenu: {
      messageKey: 'SENSING_TOUCHINGOBJECT_MENU',
      template: '%1',
      args: ['TOUCHINGOBJECTMENU'],
    },
    sensing_of: { messageKey: 'SENSING_OF', args: ['PROPERTY', 'OBJECT'] },
    sound_sounds_menu: { messageKey: 'SOUND_SOUNDS_MENU', template: '%1', args: ['SOUND_MENU'] },
  }
  for (const [opcode, fallback] of Object.entries(fallbacks)) {
    if (blocks[opcode]) continue
    const template = fallback.template ?? l10nBlocks['zh-tw'][fallback.messageKey]
    if (template) blocks[opcode] = { ...fallback, template }
  }
}

const main = (): void => {
  const packageRoot = resolve(process.cwd())
  const root = resolve(packageRoot, '../..')
  const blocks: Record<string, BlockMessage> = {}
  const sourceDirectory = resolve(root, 'node_modules/scratch-blocks/src/blocks')
  for (const name of readdirSync(sourceDirectory)
    .filter((file) => file.endsWith('.ts'))
    .sort())
    addCoreBlocks(blocks, readFileSync(join(sourceDirectory, name), 'utf8'))
  addExtensionBlocks(blocks, root)
  addKnownCoreFallbacks(blocks)
  const output: LocaleBundle = {
    blocks: Object.fromEntries(Object.entries(blocks).sort(([left], [right]) => left.localeCompare(right))),
  }
  mkdirSync(resolve(packageRoot, 'src/core/reader'), { recursive: true })
  writeFileSync(
    resolve(packageRoot, 'src/core/reader/block-messages.json'),
    JSON.stringify(output, null, 2) + '\n',
    'utf8',
  )
  process.stdout.write('generated ' + Object.keys(output.blocks).length + ' block messages\n')
}

main()
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition */
