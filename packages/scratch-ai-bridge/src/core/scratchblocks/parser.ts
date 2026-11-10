import type {
  CanonicalBlock,
  CanonicalInput,
  CanonicalProject,
  CanonicalScript,
  CanonicalSprite,
  CanonicalVariable,
  CanonicalOpcode,
} from '../ir/types'

export interface ScratchblocksParseOptions {
  readonly name?: string
  readonly spriteName?: string
}

export interface ScratchblocksParseResult {
  readonly project: CanonicalProject
  readonly warnings: readonly string[]
  readonly recognizedLines: number
  readonly skippedLines: number
}

type ScratchBlock = CanonicalBlock & { readonly opcode: CanonicalOpcode }

interface ContainerFrame {
  readonly indent: number
  readonly block: ScratchBlock
  body: CanonicalBlock[]
  elseBody?: CanonicalBlock[]
}

const opcode = (value: string): CanonicalOpcode => value

const block = (
  value: string,
  inputs?: Record<string, CanonicalInput>,
  fields?: Record<string, string>,
): ScratchBlock => ({ opcode: opcode(value), ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) })

const literal = (value: string | number): CanonicalInput => ({ type: 'literal', value })
const variable = (name: string): CanonicalInput => ({ type: 'variable', name })
const broadcast = (name: string): CanonicalInput => ({ type: 'broadcast', name })

const cleanMenu = (value: string): string =>
  value
    .trim()
    .replace(/^[[({<]/, '')
    .replace(/[\]}>)]+$/, '')
    .replace(/\s+v$/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()

const valueInput = (raw: string): CanonicalInput => {
  const value = cleanMenu(raw)
  const random = /^(?:pick\s+)?random\s+(.+?)\s+to\s+(.+)$/i.exec(value)
  if (random?.[1] && random[2])
    return {
      type: 'block',
      block: block('operator_random', { FROM: valueInput(random[1]), TO: valueInput(random[2]) }),
    }
  if (/^x position$/i.test(value)) return { type: 'block', block: block('motion_xposition') }
  if (/^y position$/i.test(value)) return { type: 'block', block: block('motion_yposition') }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return literal(Number(value))
  if (value.startsWith('$')) return variable(value.slice(1))
  return literal(value)
}

const menuInput = (raw: string): CanonicalInput => literal(cleanMenu(raw))

const conditionInput = (raw: string): CanonicalInput => {
  const condition = cleanMenu(raw)
  const conjunction = /\s+(and|or)\s+/i.exec(condition)
  if (conjunction?.index !== undefined && conjunction[1]) {
    const left = condition.slice(0, conjunction.index)
    const right = condition.slice(conjunction.index + conjunction[0].length)
    return {
      type: 'block',
      block: block(conjunction[1].toLowerCase() === 'and' ? 'operator_and' : 'operator_or', {
        OPERAND1: conditionInput(left),
        OPERAND2: conditionInput(right),
      }),
    }
  }
  if (/^not\s+/i.test(condition))
    return {
      type: 'block',
      block: block('operator_not', { OPERAND: conditionInput(condition.replace(/^not\s+/i, '')) }),
    }
  const keyMatch = /^key\s+(.+?)\s+pressed\??$/i.exec(condition)
  if (keyMatch?.[1])
    return {
      type: 'block',
      block: block('sensing_keypressed', { KEY_OPTION: menuInput(keyMatch[1]) }),
    }
  const touchingMatch = /^touching\s+(.+?)[?]?$/.exec(condition)
  if (touchingMatch?.[1])
    return {
      type: 'block',
      block: block('sensing_touchingobject', { TOUCHINGOBJECTMENU: menuInput(touchingMatch[1]) }),
    }
  if (/^(?:mouse down|mouse down\?)$/i.test(condition)) return { type: 'block', block: block('sensing_mousedown') }

  const comparison = /^(.+?)\s*(=|==|>|<)\s*(.+)$/.exec(condition)
  if (comparison?.[1] && comparison[2] && comparison[3]) {
    const comparisonOpcode =
      comparison[2] === '>' ? 'operator_gt' : comparison[2] === '<' ? 'operator_lt' : 'operator_equals'
    return {
      type: 'block',
      block: block(comparisonOpcode, {
        OPERAND1: valueInput(comparison[1]),
        OPERAND2: valueInput(comparison[3]),
      }),
    }
  }
  return valueInput(condition)
}

const openContainer = (line: string): { block: ScratchBlock; elseBody?: CanonicalBlock[] } | undefined => {
  if (/^forever$/i.test(line)) {
    const body: CanonicalBlock[] = []
    return { block: block('control_forever', { SUBSTACK: { type: 'stack', blocks: body } }) }
  }
  const repeatUntil = /^repeat\s+until\s+(.+)$/i.exec(line)
  if (repeatUntil?.[1]) {
    const body: CanonicalBlock[] = []
    return {
      block: block('control_repeat_until', {
        CONDITION: conditionInput(repeatUntil[1]),
        SUBSTACK: { type: 'stack', blocks: body },
      }),
    }
  }
  const repeat = /^repeat\s+(.+)$/i.exec(line)
  if (repeat?.[1]) {
    const body: CanonicalBlock[] = []
    return {
      block: block('control_repeat', { TIMES: valueInput(repeat[1]), SUBSTACK: { type: 'stack', blocks: body } }),
    }
  }
  const ifElse = /^if\s+(.+?)\s+then\s+else$/i.exec(line)
  if (ifElse?.[1]) {
    const body: CanonicalBlock[] = []
    const elseBody: CanonicalBlock[] = []
    return {
      block: block('control_if_else', {
        CONDITION: conditionInput(ifElse[1]),
        SUBSTACK: { type: 'stack', blocks: body },
        SUBSTACK2: { type: 'stack', blocks: elseBody },
      }),
      elseBody,
    }
  }
  const ifOnly = /^if\s+(.+?)\s+then$/i.exec(line)
  if (ifOnly?.[1]) {
    const body: CanonicalBlock[] = []
    return {
      block: block('control_if', { CONDITION: conditionInput(ifOnly[1]), SUBSTACK: { type: 'stack', blocks: body } }),
    }
  }
  return undefined
}

const parseLine = (line: string): ScratchBlock | undefined => {
  if (/^when green flag clicked$/i.test(line)) return block('event_whenflagclicked')
  if (/^when this sprite clicked$/i.test(line)) return block('event_whenthisspriteclicked')
  const keyHat = /^when\s+(.+?)\s+key pressed$/i.exec(line)
  if (keyHat?.[1]) return block('event_whenkeypressed', undefined, { KEY_OPTION: cleanMenu(keyHat[1]) })
  const receiveHat =
    /^when (?:i )?receive\s+(.+)$/i.exec(line) ?? /^when\s+(.+?)\s+(?:broadcast|received)$/i.exec(line)
  if (receiveHat?.[1])
    return block('event_whenbroadcastreceived', undefined, { BROADCAST_OPTION: cleanMenu(receiveHat[1]) })
  const bareReceiveHat = /^when\s+(\[[^\]]+\])$/i.exec(line)
  if (bareReceiveHat?.[1])
    return block('event_whenbroadcastreceived', undefined, { BROADCAST_OPTION: cleanMenu(bareReceiveHat[1]) })
  if (/^when\s+\[?clone\s+v\]?$/i.test(line)) return block('control_start_as_clone')
  if (/^when stage clicked$/i.test(line)) return block('event_whenstageclicked')

  const move = /^move\s+(.+?)\s+steps?$/i.exec(line)
  if (move?.[1]) return block('motion_movesteps', { STEPS: valueInput(move[1]) })
  const changeX = /^change\s+x\s+by\s+(.+)$/i.exec(line)
  if (changeX?.[1]) return block('motion_changexby', { DX: valueInput(changeX[1]) })
  const changeY = /^change\s+y\s+by\s+(.+)$/i.exec(line)
  if (changeY?.[1]) return block('motion_changeyby', { DY: valueInput(changeY[1]) })
  const setX = /^set\s+x\s+to\s+(.+)$/i.exec(line)
  if (setX?.[1]) return block('motion_setx', { X: valueInput(setX[1]) })
  const setY = /^set\s+y\s+to\s+(.+)$/i.exec(line)
  if (setY?.[1]) return block('motion_sety', { Y: valueInput(setY[1]) })
  const goTo = /^go to x:\s*(.+?)\s+y:\s*(.+)$/i.exec(line)
  if (goTo?.[1] && goTo[2]) return block('motion_gotoxy', { X: valueInput(goTo[1]), Y: valueInput(goTo[2]) })
  const turnRight = /^(?:turn cw|turn right)\s+(.+)$/i.exec(line)
  if (turnRight?.[1]) return block('motion_turnright', { DEGREES: valueInput(turnRight[1]) })
  const turnLeft = /^(?:turn ccw|turn left)\s+(.+)$/i.exec(line)
  if (turnLeft?.[1]) return block('motion_turnleft', { DEGREES: valueInput(turnLeft[1]) })
  const point = /^point in direction\s+(.+)$/i.exec(line)
  if (point?.[1]) return block('motion_pointindirection', { DIRECTION: valueInput(point[1]) })
  if (/^if on edge,? bounce$/i.test(line)) return block('motion_ifonedgebounce')

  const sayFor = /^say\s+(.+?)\s+for\s+(.+?)\s+seconds?$/i.exec(line)
  if (sayFor?.[1] && sayFor[2])
    return block('looks_sayforsecs', { MESSAGE: valueInput(sayFor[1]), SECS: valueInput(sayFor[2]) })
  const say = /^say\s+(.+)$/i.exec(line)
  if (say?.[1]) return block('looks_say', { MESSAGE: valueInput(say[1]) })
  const thinkFor = /^think\s+(.+?)\s+for\s+(.+?)\s+seconds?$/i.exec(line)
  if (thinkFor?.[1] && thinkFor[2])
    return block('looks_thinkforsecs', { MESSAGE: valueInput(thinkFor[1]), SECS: valueInput(thinkFor[2]) })
  const think = /^think\s+(.+)$/i.exec(line)
  if (think?.[1]) return block('looks_think', { MESSAGE: valueInput(think[1]) })
  if (/^show$/i.test(line)) return block('looks_show')
  if (/^hide$/i.test(line)) return block('looks_hide')
  if (/^next costume$/i.test(line)) return block('looks_nextcostume')
  const costume = /^switch costume to\s+(.+)$/i.exec(line)
  if (costume?.[1]) return block('looks_switchcostumeto', { COSTUME: menuInput(costume[1]) })

  const wait = /^wait\s+(.+?)\s+seconds?$/i.exec(line)
  if (wait?.[1]) return block('control_wait', { DURATION: valueInput(wait[1]) })
  const waitUntil = /^wait until\s+(.+)$/i.exec(line)
  if (waitUntil?.[1]) return block('control_wait_until', { CONDITION: conditionInput(waitUntil[1]) })
  const broadcastLine = /^broadcast\s+(.+?)(?:\s+and wait)?$/i.exec(line)
  if (broadcastLine?.[1]) {
    const waitForBroadcast = /\s+and wait$/i.test(line)
    return block(waitForBroadcast ? 'event_broadcastandwait' : 'event_broadcast', {
      BROADCAST_INPUT: broadcast(broadcastLine[1]),
    })
  }

  const setVariable = /^set\s+(.+?)\s+to\s+(.+)$/i.exec(line)
  if (setVariable?.[1] && setVariable[2])
    return block('data_setvariableto', { VALUE: valueInput(setVariable[2]) }, { VARIABLE: cleanMenu(setVariable[1]) })
  const changeVariable = /^change\s+(.+?)\s+by\s+(.+)$/i.exec(line)
  if (changeVariable?.[1] && changeVariable[2])
    return block(
      'data_changevariableby',
      { VALUE: valueInput(changeVariable[2]) },
      { VARIABLE: cleanMenu(changeVariable[1]) },
    )
  const showVariable = /^show variable\s+(.+)$/i.exec(line)
  if (showVariable?.[1]) return block('data_showvariable', undefined, { VARIABLE: cleanMenu(showVariable[1]) })
  const hideVariable = /^hide variable\s+(.+)$/i.exec(line)
  if (hideVariable?.[1]) return block('data_hidevariable', undefined, { VARIABLE: cleanMenu(hideVariable[1]) })

  const sound = /^(?:play sound|start sound)\s+(.+?)(?:\s+until done)?$/i.exec(line)
  if (sound?.[1]) {
    const untilDone = /\s+until done$/i.test(line)
    return block(untilDone ? 'sound_playuntildone' : 'sound_play', { SOUND_MENU: menuInput(sound[1]) })
  }
  if (/^stop all sounds$/i.test(line)) return block('sound_stopallsounds')
  const stop = /^stop\s+(.+)$/i.exec(line)
  if (stop?.[1]) return block('control_stop', undefined, { STOP_OPTION: cleanMenu(stop[1]) })
  const clone = /^create clone of\s+(.+)$/i.exec(line)
  if (clone?.[1]) return block('control_create_clone_of', { CLONE_OPTION: menuInput(clone[1]) })

  return undefined
}

const appendBlock = (script: CanonicalScript, stack: ContainerFrame[], value: CanonicalBlock): void => {
  const frame = stack.at(-1)
  if (frame) frame.body.push(value)
  else script.blocks.push(value)
}

const collectVariables = (scripts: readonly CanonicalScript[]): CanonicalVariable[] => {
  const names = new Set<string>()
  const visitInput = (input: CanonicalInput): void => {
    if (input.type === 'block') visitBlock(input.block)
    if (input.type === 'stack') input.blocks.forEach(visitBlock)
  }
  const visitBlock = (value: CanonicalBlock): void => {
    const name = value.fields?.VARIABLE
    if (typeof name === 'string') names.add(name)
    Object.values(value.inputs ?? {}).forEach(visitInput)
  }
  scripts.forEach((script) => script.blocks.forEach(visitBlock))
  return [...names].map((name) => ({ name, value: 0 }))
}

const closeByIndent = (stack: ContainerFrame[], indent: number): void => {
  while (stack.length > 0 && indent <= (stack.at(-1)?.indent ?? -1)) stack.pop()
}

export const parseScratchblocks = (
  source: string,
  options: ScratchblocksParseOptions = {},
): ScratchblocksParseResult => {
  const warnings: string[] = []
  const scripts: CanonicalScript[] = []
  const stack: ContainerFrame[] = []
  let currentScript: CanonicalScript | undefined
  let recognizedLines = 0
  let skippedLines = 0

  const ensureScript = (): CanonicalScript => {
    if (!currentScript) {
      currentScript = { blocks: [] }
      scripts.push(currentScript)
    }
    return currentScript
  }

  for (const sourceLine of source.split(/\r?\n/)) {
    const raw = sourceLine.replace(/\t/g, '  ')
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (!line || line === '```' || line.startsWith('//') || line.startsWith('#')) continue
    if (/^end$/i.test(line)) {
      if (stack.length === 0) warnings.push('遇到沒有對應容器的 end')
      else stack.pop()
      continue
    }
    if (/^else$/i.test(line)) {
      const frame = stack.at(-1)
      if (!frame?.elseBody) {
        warnings.push('else 沒有對應的 if/else')
        skippedLines++
        continue
      }
      frame.body = frame.elseBody
      recognizedLines++
      continue
    }
    closeByIndent(stack, indent)
    const container = openContainer(line)
    const parsed = container?.block ?? parseLine(line)
    if (!parsed) {
      warnings.push(`未支援的 scratchblocks 行：${line}`)
      skippedLines++
      continue
    }
    recognizedLines++
    const isHat =
      parsed.opcode.startsWith('event_') &&
      [
        'event_whenflagclicked',
        'event_whenkeypressed',
        'event_whenthisspriteclicked',
        'event_whenstageclicked',
        'event_whenbroadcastreceived',
      ].includes(parsed.opcode)
    if (isHat) {
      currentScript = { blocks: [parsed] }
      scripts.push(currentScript)
    } else {
      const targetScript = ensureScript()
      appendBlock(targetScript, stack, parsed)
    }
    if (container) {
      const body = container.block.inputs?.SUBSTACK
      if (body?.type === 'stack')
        stack.push({ indent, block: container.block, body: body.blocks, elseBody: container.elseBody })
    }
  }

  const spriteName = options.spriteName ?? 'Player'
  const sprite: CanonicalSprite = {
    kind: 'sprite',
    name: spriteName,
    variables: collectVariables(scripts),
    lists: [],
    costumes: [{ name: 'Cat', dataFormat: 'svg' }],
    sounds: [{ name: 'Pop', dataFormat: 'wav' }],
    scripts,
    procedures: [],
    x: 0,
    y: -100,
    direction: 90,
    size: 100,
    visible: true,
    draggable: false,
    rotationStyle: 'left-right',
  }
  const extraSpriteNames = new Set<string>()
  const touchingPattern = /touching\s+\[([^\]]+)\]/gi
  let touchingMatch = touchingPattern.exec(source)
  while (touchingMatch) {
    const name = cleanMenu(touchingMatch[1])
    if (name && name !== spriteName) extraSpriteNames.add(name)
    touchingMatch = touchingPattern.exec(source)
  }
  const extraSprites: CanonicalSprite[] = [...extraSpriteNames].map((name) => ({
    kind: 'sprite',
    name,
    variables: [],
    lists: [],
    costumes: [{ name, dataFormat: 'svg' }],
    sounds: [],
    scripts: [],
    procedures: [],
    x: 0,
    y: 80,
    direction: 90,
    size: 60,
    visible: true,
    draggable: false,
    rotationStyle: 'all around',
  }))
  const broadcasts = new Set<string>()
  const visit = (value: CanonicalBlock): void => {
    const broadcastName = value.inputs?.BROADCAST_INPUT
    if (broadcastName?.type === 'broadcast') broadcasts.add(broadcastName.name)
    const receiveName = value.fields?.BROADCAST_OPTION
    if (typeof receiveName === 'string') broadcasts.add(receiveName)
    Object.values(value.inputs ?? {}).forEach((input) => {
      if (input.type === 'block') visit(input.block)
      if (input.type === 'stack') input.blocks.forEach(visit)
    })
  }
  scripts.forEach((script) => script.blocks.forEach(visit))

  return {
    project: {
      format: 'scratch-ai-bridge/canonical-ir',
      version: 1,
      name: options.name ?? 'Scratchblocks prototype',
      broadcasts: [...broadcasts].map((name) => ({ name })),
      stage: {
        kind: 'stage',
        name: 'Stage',
        variables: [],
        lists: [],
        costumes: [{ name: 'Blue Sky', dataFormat: 'svg' }],
        sounds: [],
        scripts: [],
        procedures: [],
      },
      sprites: [sprite, ...extraSprites],
    },
    warnings,
    recognizedLines,
    skippedLines,
  }
}
