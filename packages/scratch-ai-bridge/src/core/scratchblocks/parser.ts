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

/**
 * Strip scratchblocks brackets, dropdown markers and quotes from a menu or reporter value.
 * @param value Raw text.
 * @returns The bare value.
 */
export const cleanMenu = (value: string): string =>
  value
    .trim()
    .replace(/^[[({<]/, '')
    .replace(/[\]}>)]+$/, '')
    .replace(/\s+v$/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()

/** Variables declared by set/change lines in the source being parsed, so `(score)` reads as a variable reporter. */
let knownVariables = new Set<string>()

const SPECIAL_MENU_VALUES: Readonly<Record<string, string>> = {
  edge: '_edge_',
  邊緣: '_edge_',
  'mouse-pointer': '_mouse_',
  'mouse pointer': '_mouse_',
  mouse: '_mouse_',
  滑鼠: '_mouse_',
  'random position': '_random_',
  random: '_random_',
  隨機位置: '_random_',
  myself: '_myself_',
  自己: '_myself_',
}

const specialMenuInput = (raw: string): CanonicalInput => {
  const value = cleanMenu(raw)
  return literal(SPECIAL_MENU_VALUES[value.toLowerCase()] ?? value)
}

const REPORTERS: Readonly<Record<string, string>> = {
  answer: 'sensing_answer',
  回答: 'sensing_answer',
  timer: 'sensing_timer',
  計時器: 'sensing_timer',
  'mouse x': 'sensing_mousex',
  'mouse y': 'sensing_mousey',
  size: 'looks_size',
  x: 'motion_xposition',
  y: 'motion_yposition',
  direction: 'motion_direction',
}

const ARITHMETIC: Readonly<Record<string, string>> = {
  '+': 'operator_add',
  '-': 'operator_subtract',
  '*': 'operator_multiply',
  '/': 'operator_divide',
}

/**
 * Remove exactly one balanced outer `(...)` pair, keeping inner reporters intact.
 * @param raw Value text as written.
 * @returns The inner text, or undefined when the text is not wrapped in one balanced pair.
 */
const unwrapRound = (raw: string): string | undefined => {
  const text = raw.trim()
  if (!text.startsWith('(') || !text.endsWith(')')) return undefined
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    else if (text[index] === ')') depth -= 1
    if (depth === 0 && index < text.length - 1) return undefined
  }
  return text.slice(1, -1).trim()
}

const valueInput = (raw: string): CanonicalInput => {
  const value = cleanMenu(raw)
  const inner = unwrapRound(raw) ?? raw.trim()
  const arithmetic = /^\((.+?)\)\s*([+\-*/])\s*\((.+)\)$/.exec(inner)
  if (arithmetic?.[1] && arithmetic[2] && arithmetic[3])
    return {
      type: 'block',
      block: block(ARITHMETIC[arithmetic[2]] ?? 'operator_add', {
        NUM1: valueInput(`(${arithmetic[1]})`),
        NUM2: valueInput(`(${arithmetic[3]})`),
      }),
    }
  const join = /^join\s+(\[[^\]]*\]|\([^)]*\))\s*(\[[^\]]*\]|\([^)]*\))$/i.exec(inner)
  if (join?.[1] && join[2])
    return {
      type: 'block',
      block: block('operator_join', { STRING1: valueInput(join[1]), STRING2: valueInput(join[2]) }),
    }
  const reporter = REPORTERS[value.toLowerCase()]
  if (reporter && raw.trim().startsWith('(')) return { type: 'block', block: block(reporter) }
  if (raw.trim().startsWith('(') && knownVariables.has(value)) return variable(value)
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

const KEY_NAMES: Readonly<Record<string, string>> = {
  right: 'right arrow',
  left: 'left arrow',
  up: 'up arrow',
  down: 'down arrow',
  右: 'right arrow',
  右鍵: 'right arrow',
  向右鍵: 'right arrow',
  左: 'left arrow',
  左鍵: 'left arrow',
  向左鍵: 'left arrow',
  上: 'up arrow',
  上鍵: 'up arrow',
  向上鍵: 'up arrow',
  下: 'down arrow',
  下鍵: 'down arrow',
  向下鍵: 'down arrow',
  空白: 'space',
  空白鍵: 'space',
  空格: 'space',
  空格鍵: 'space',
  spacebar: 'space',
  'space bar': 'space',
  return: 'enter',
}

/**
 * Scratch key names from what models write ("right", "空白鍵", "A").
 * @param raw Key text, possibly in a dropdown.
 * @returns Scratch's KEY_OPTION value.
 */
const normalizeKey = (raw: string): string => {
  const value = cleanMenu(raw).trim()
  const lower = value.toLowerCase()
  if (Object.hasOwn(KEY_NAMES, lower)) return KEY_NAMES[lower]
  return Object.hasOwn(KEY_NAMES, value) ? KEY_NAMES[value] : lower
}

const ALIASES: readonly [RegExp, string][] = [
  [
    /^(?:when\s+(?:gf|flag|green\s*flag)\s+clicked|<?\s*green flag\s*>?|when green flag pressed|當綠旗被點(?:擊|一下)|當綠旗被按下)$/i,
    'when green flag clicked',
  ],
  [/^(?:when|當)\s*<\s*(?:key\s+)?(.+?)\s+(?:key\s+)?pressed\??\s*>$/i, 'when $1 key pressed'],
  [/^<\s*key\s+(.+?)\s+pressed\??\s*>$/i, 'when $1 key pressed'],
  [/^當\s*(.+?)\s*鍵被按下$/, 'when [$1] key pressed'],
  [/^(?:receive|收到|收|當收到|當我收到|等待收到)\s*(.+)$/i, 'when I receive $1'],
  [
    /^(?:start_as_clone|when i start as clone|when cloned|當分身產生|當我是分身|當作為分身啟動時)$/i,
    'when I start as a clone',
  ],
  [/^當角色被點(?:擊|一下)$/, 'when this sprite clicked'],
  [/^if\s+(\[[^\]]+\])\s+key pressed\??(?:\s+then)?$/i, 'if <key $1 pressed?> then'],
  // `if <…>` written without `then` (never `if on edge, bounce`).
  [/^if\s+(<.+>)$/i, 'if $1 then'],
  [/^(?:wait|等待)\s*<(.+)>$/i, 'wait until <$1>'],
  [/^wait\s+(.+?)\s+(?:secs?|s)\.?$/i, 'wait $1 seconds'],
  [/^等待\s*(.+?)\s*秒$/, 'wait $1 seconds'],
  [/^(?:send|發送|廣播)\s*(.+?)(?:\s*給所有角色)?(\s*(?:and wait|並等待))?$/i, 'broadcast $1$2'],
  [/^(?:switch|change)\s+background\s+to\s+(.+)$/i, 'switch backdrop to $1'],
  [/^(?:換背景為|切換背景為|換成背景|背景換成)\s*(.+)$/, 'switch backdrop to $1'],
  [/^說\s*(.+?)\s*(?:持續|等待)\s*(.+?)\s*秒$/, 'say $1 for $2 seconds'],
  [/^說\s+(.+)$/, 'say $1'],
  // "[角色] 說 [台詞] for (2) seconds": the speaker is the sprite the script belongs to.
  [/^\S+\s+說\s+(.+)$/, 'say $1'],
  [/^等待\s*\(?\s*(-?\d+(?:\.\d+)?)\s*\)?$/, 'wait ($1) seconds'],
  [/^(?:去|移到|移動到)\s*x[:：]\s*(.+?)\s+y[:：]\s*(.+)$/i, 'go to x: $1 y: $2'],
  [/^go to front$/i, 'go to [front v] layer'],
  [/^go to back$/i, 'go to [back v] layer'],
  [/^(?:backdrop|去背景|背景)\s+(\[.+\])$/i, 'switch backdrop to $1'],
  [/^隱藏\s+\S+$/, 'hide'],
  [/^顯示\s+\S+$/, 'show'],
  [/^hide\s+(?:sprite\s+)?\[[^\]]*\]$/i, 'hide'],
  [/^show\s+(?:sprite\s+)?\[[^\]]*\]$/i, 'show'],
  [/^start clone of\s+(.+)$/i, 'create clone of $1'],
  [/^建立\s*(.+?)\s*的分身$/, 'create clone of $1'],
  // Scratch has no while loop: `while <c>` runs until <c> stops holding.
  [/^while\s+<(.+)>$/i, 'repeat until <not <$1>>'],
  [/^思考\s*(.+?)\s*(?:持續|等待)\s*(.+?)\s*秒$/, 'think $1 for $2 seconds'],
  [/^(?:一直重複|重複無限次|永遠重複)$/, 'forever'],
  [/^重複\s*(.+?)\s*次$/, 'repeat $1'],
  [/^重複直到\s*(.+)$/, 'repeat until $1'],
  [/^如果\s*(.+?)\s*那麼$/, 'if $1 then'],
  [/^否則$/, 'else'],
  [/^結束$/, 'end'],
  [/^隱藏$/, 'hide'],
  [/^顯示$/, 'show'],
  [/^下一個造型$/, 'next costume'],
  [/^下一個背景$/, 'next backdrop'],
  [/^播放音效\s*(.+?)\s*直到結束$/, 'play sound $1 until done'],
  [/^播放音效\s*(.+)$/, 'play sound $1'],
  [/^將\s*(.+?)\s*設為\s*(.+)$/, 'set $1 to $2'],
  [/^將\s*(.+?)\s*改變\s*(.+)$/, 'change $1 by $2'],
  [/^移動\s*(.+?)\s*步$/, 'move $1 steps'],
  [/^(?:停止全部|停止所有)$/, 'stop [all v]'],
  [/^set size to\s+(.+?)\s*(?:percent|%)$/i, 'set size to $1 %'],
]

/**
 * Rewrite common variants (Chinese block names, `when flag clicked`, `wait 1 secs`, trailing `// notes`) into the
 * canonical English lines the parser understands.
 * @param line Trimmed source line.
 * @returns The canonical line.
 */
const normalizeLine = (line: string): string => {
  const text = line.replace(/\s+\/\/.*$/, '').trim()
  for (const [pattern, replacement] of ALIASES) if (pattern.test(text)) return text.replace(pattern, replacement)
  return text
}

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
      block: block('sensing_keypressed', { KEY_OPTION: literal(normalizeKey(keyMatch[1])) }),
    }
  const touchingMatch = /^touching\s+(.+?)[?]?$/i.exec(condition)
  if (touchingMatch?.[1])
    return {
      type: 'block',
      block: block('sensing_touchingobject', { TOUCHINGOBJECTMENU: specialMenuInput(touchingMatch[1]) }),
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
  if (keyHat?.[1]) return block('event_whenkeypressed', undefined, { KEY_OPTION: normalizeKey(keyHat[1]) })
  const receiveHat =
    /^when (?:i )?receive\s+(.+)$/i.exec(line) ?? /^when\s+(.+?)\s+(?:broadcast|received)$/i.exec(line)
  if (receiveHat?.[1])
    return block('event_whenbroadcastreceived', undefined, { BROADCAST_OPTION: cleanMenu(receiveHat[1]) })
  const bareReceiveHat = /^when\s+(\[[^\]]+\])$/i.exec(line)
  if (bareReceiveHat?.[1])
    return block('event_whenbroadcastreceived', undefined, { BROADCAST_OPTION: cleanMenu(bareReceiveHat[1]) })
  if (/^when\s+\[?clone\s+v\]?$/i.test(line)) return block('control_start_as_clone')
  if (/^when stage clicked$/i.test(line)) return block('event_whenstageclicked')
  if (/^when i start as a clone$/i.test(line)) return block('control_start_as_clone')
  const backdropHat = /^when backdrop switches to\s+(.+)$/i.exec(line)
  if (backdropHat?.[1])
    return block('event_whenbackdropswitchesto', undefined, { BACKDROP: cleanMenu(backdropHat[1]) })

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
  const glideXY = /^glide\s+(.+?)\s+secs?\s+to x:\s*(.+?)\s+y:\s*(.+)$/i.exec(line)
  if (glideXY?.[1] && glideXY[2] && glideXY[3])
    return block('motion_glidesecstoxy', {
      SECS: valueInput(glideXY[1]),
      X: valueInput(glideXY[2]),
      Y: valueInput(glideXY[3]),
    })
  const glideTo = /^glide\s+(.+?)\s+secs?\s+to\s+(.+)$/i.exec(line)
  if (glideTo?.[1] && glideTo[2])
    return block('motion_glideto', { SECS: valueInput(glideTo[1]), TO: specialMenuInput(glideTo[2]) })
  const goToMenu = /^go to\s+(\[.+\])$/i.exec(line)
  if (goToMenu?.[1]) {
    const target = cleanMenu(goToMenu[1]).toLowerCase()
    if (target === 'front' || target === 'back' || target === 'front layer' || target === 'back layer')
      return block('looks_gotofrontback', undefined, { FRONT_BACK: target.startsWith('front') ? 'front' : 'back' })
    return block('motion_goto', { TO: specialMenuInput(goToMenu[1]) })
  }
  const frontBack = /^go to\s+\[?(front|back)\s*v?\]?\s+layer$/i.exec(line)
  if (frontBack?.[1]) return block('looks_gotofrontback', undefined, { FRONT_BACK: frontBack[1].toLowerCase() })
  const towards = /^point towards\s+(.+)$/i.exec(line)
  if (towards?.[1]) return block('motion_pointtowards', { TOWARDS: specialMenuInput(towards[1]) })
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
  if (/^next backdrop$/i.test(line)) return block('looks_nextbackdrop')
  const backdrop = /^switch backdrop to\s+(.+?)(\s+and wait)?$/i.exec(line)
  if (backdrop?.[1])
    return block(backdrop[2] ? 'looks_switchbackdroptoandwait' : 'looks_switchbackdropto', {
      BACKDROP: menuInput(backdrop[1]),
    })
  const setSize = /^set size to\s+(.+?)\s*%?$/i.exec(line)
  if (setSize?.[1]) return block('looks_setsizeto', { SIZE: valueInput(setSize[1].replace(/\s*%$/, '')) })
  const changeSize = /^change size by\s+(.+)$/i.exec(line)
  if (changeSize?.[1]) return block('looks_changesizeby', { CHANGE: valueInput(changeSize[1]) })
  const effect =
    /^(change|set)\s+\[?(color|fisheye|whirl|pixelate|mosaic|brightness|ghost)\s*v?\]?\s+effect\s+(?:by|to)\s+(.+)$/i.exec(
      line,
    )
  if (effect?.[1] && effect[2] && effect[3])
    return effect[1].toLowerCase() === 'change'
      ? block('looks_changeeffectby', { CHANGE: valueInput(effect[3]) }, { EFFECT: effect[2].toLowerCase() })
      : block('looks_seteffectto', { VALUE: valueInput(effect[3]) }, { EFFECT: effect[2].toLowerCase() })
  if (/^clear graphic effects$/i.test(line)) return block('looks_cleargraphiceffects')
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
  if (clone?.[1]) return block('control_create_clone_of', { CLONE_OPTION: specialMenuInput(clone[1]) })
  if (/^delete this clone$/i.test(line)) return block('control_delete_this_clone')
  const ask = /^ask\s+(.+?)\s+and wait$/i.exec(line)
  if (ask?.[1]) return block('sensing_askandwait', { QUESTION: valueInput(ask[1]) })
  if (/^reset timer$/i.test(line)) return block('sensing_resettimer')

  return undefined
}

/**
 * Whether a line is a block, container, `end` or `else` the parser understands (used to tell block lines from
 * bare target-name headers).
 * @param line Trimmed source line.
 * @returns True for a recognised block line.
 */
export const isBlockLine = (line: string): boolean => {
  const text = normalizeLine(line)
  return /^(?:end|else)$/i.test(text) || openContainer(text) !== undefined || parseLine(text) !== undefined
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

const HAT_OPCODES = new Set([
  'event_whenflagclicked',
  'event_whenkeypressed',
  'event_whenthisspriteclicked',
  'event_whenstageclicked',
  'event_whenbroadcastreceived',
  'event_whenbackdropswitchesto',
  'control_start_as_clone',
])

/**
 * Variable names declared with set/change lines.
 * @param source scratchblocks text.
 * @returns Names.
 */
export const scanVariables = (source: string): Set<string> =>
  new Set(
    [...source.matchAll(/^\s*(?:set|change)\s+\[([^\]]+?)(?:\s+v)?\]\s+(?:to|by)\s/gim)]
      .map((match) => cleanMenu(match[1]))
      .filter((name) => name && !/^(?:color|fisheye|whirl|pixelate|mosaic|brightness|ghost)$/i.test(name)),
  )

export interface ParsedScripts {
  readonly scripts: CanonicalScript[]
  readonly warnings: string[]
  readonly recognizedLines: number
  readonly skippedLines: number
}

/**
 * Parse scratchblocks lines into scripts (no targets). Shared by the single-sprite and multi-target parsers.
 * @param source scratchblocks text for one target.
 * @param variables Variable names known across the whole project.
 * @returns Scripts, warnings and line counts.
 */
export const parseScripts = (source: string, variables: Set<string> = scanVariables(source)): ParsedScripts => {
  knownVariables = variables
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
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('//') || trimmed.startsWith('#')) continue
    const line = normalizeLine(trimmed)
    if (/^end$/i.test(line)) {
      if (stack.length === 0) warnings.push('遇到沒有對應容器的 end')
      else stack.pop()
      continue
    }
    if (/^else$/i.test(line)) {
      const frame = stack.at(-1)
      if (frame && !frame.elseBody && frame.block.opcode === 'control_if') {
        // Standard scratchblocks writes `if <...> then` … `else` … `end`: turn the open if into an if/else.
        const elseBody: CanonicalBlock[] = []
        const mutable = frame.block as { opcode: CanonicalOpcode; inputs?: Record<string, CanonicalInput> }
        mutable.opcode = opcode('control_if_else')
        mutable.inputs = { ...mutable.inputs, SUBSTACK2: { type: 'stack', blocks: elseBody } }
        frame.elseBody = elseBody
      }
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
    if (HAT_OPCODES.has(parsed.opcode)) {
      stack.length = 0
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
  return { scripts, warnings, recognizedLines, skippedLines }
}

export const parseScratchblocks = (
  source: string,
  options: ScratchblocksParseOptions = {},
): ScratchblocksParseResult => {
  const { scripts, warnings, recognizedLines, skippedLines } = parseScripts(source)

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
