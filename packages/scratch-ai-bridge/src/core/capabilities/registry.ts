export type CanonicalBlockCategory = 'motion' | 'looks' | 'events' | 'control' | 'sensing' | 'operators' | 'data'
export type CanonicalBlockShape = 'hat' | 'command' | 'reporter' | 'boolean'
export type CanonicalInputKind = 'any' | 'number' | 'string' | 'boolean' | 'stack' | 'broadcast' | 'menu'
export type CanonicalTargetKind = 'stage' | 'sprite'

export interface CanonicalMenuShadow {
  readonly opcode: string
  readonly field: string
}

export interface CanonicalInputCapability {
  readonly kind: CanonicalInputKind
  readonly required: boolean
  readonly shadow?: CanonicalMenuShadow
}

export interface CanonicalFieldCapability {
  readonly required: boolean
  readonly values?: readonly string[]
}

export interface CanonicalBlockCapability {
  readonly category: CanonicalBlockCategory
  readonly shape: CanonicalBlockShape
  readonly targets: readonly CanonicalTargetKind[]
  readonly inputs?: Readonly<Record<string, CanonicalInputCapability>>
  readonly fields?: Readonly<Record<string, CanonicalFieldCapability>>
}

const bothTargets = ['stage', 'sprite'] as const
const spriteTarget = ['sprite'] as const
const keyOptions = [
  'space',
  'up arrow',
  'down arrow',
  'right arrow',
  'left arrow',
  'any',
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
] as const

export const CANONICAL_BLOCK_CAPABILITIES = {
  event_whenflagclicked: { category: 'events', shape: 'hat', targets: bothTargets },
  event_whenkeypressed: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    fields: { KEY_OPTION: { required: true, values: keyOptions } },
  },
  event_whenbroadcastreceived: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    fields: { BROADCAST_OPTION: { required: true } },
  },
  event_broadcast: {
    category: 'events',
    shape: 'command',
    targets: bothTargets,
    inputs: { BROADCAST_INPUT: { kind: 'broadcast', required: true } },
  },
  motion_movesteps: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { STEPS: { kind: 'number', required: true } },
  },
  motion_gotoxy: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { X: { kind: 'number', required: true }, Y: { kind: 'number', required: true } },
  },
  motion_changexby: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DX: { kind: 'number', required: true } },
  },
  motion_setx: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { X: { kind: 'number', required: true } },
  },
  motion_changeyby: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DY: { kind: 'number', required: true } },
  },
  motion_sety: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { Y: { kind: 'number', required: true } },
  },
  looks_say: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: { MESSAGE: { kind: 'string', required: true } },
  },
  looks_switchcostumeto: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      COSTUME: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'looks_costume', field: 'COSTUME' },
      },
    },
  },
  control_wait: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { DURATION: { kind: 'number', required: true } },
  },
  control_repeat: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { TIMES: { kind: 'number', required: true }, SUBSTACK: { kind: 'stack', required: true } },
  },
  control_forever: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { SUBSTACK: { kind: 'stack', required: true } },
  },
  control_if: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
    },
  },
  control_if_else: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
      SUBSTACK2: { kind: 'stack', required: true },
    },
  },
  sensing_touchingobject: {
    category: 'sensing',
    shape: 'boolean',
    targets: spriteTarget,
    inputs: {
      TOUCHINGOBJECTMENU: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'sensing_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU' },
      },
    },
  },
  operator_lt: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_equals: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_gt: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_and: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: {
      OPERAND1: { kind: 'boolean', required: true },
      OPERAND2: { kind: 'boolean', required: true },
    },
  },
  operator_or: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: {
      OPERAND1: { kind: 'boolean', required: true },
      OPERAND2: { kind: 'boolean', required: true },
    },
  },
  operator_not: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND: { kind: 'boolean', required: true } },
  },
  data_setvariableto: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'any', required: true } },
    fields: { VARIABLE: { required: true } },
  },
  data_changevariableby: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: { VARIABLE: { required: true } },
  },
} as const satisfies Readonly<Record<string, CanonicalBlockCapability>>

export type CanonicalOpcode = keyof typeof CANONICAL_BLOCK_CAPABILITIES

export const CANONICAL_OPCODES: readonly CanonicalOpcode[] = Object.freeze(
  Object.keys(CANONICAL_BLOCK_CAPABILITIES) as CanonicalOpcode[],
)

export const getBlockCapability = (opcode: string): CanonicalBlockCapability | undefined =>
  CANONICAL_BLOCK_CAPABILITIES[opcode as CanonicalOpcode]

export const getInputCapability = (opcode: string, inputName: string): CanonicalInputCapability | undefined =>
  getBlockCapability(opcode)?.inputs?.[inputName]

const describeBlock = (opcode: CanonicalOpcode): string => {
  const capability: CanonicalBlockCapability = CANONICAL_BLOCK_CAPABILITIES[opcode]
  const inputs = Object.entries(capability.inputs ?? {}).map(
    ([name, input]) => `${name}:${input.kind}${input.required ? '' : '?'}`,
  )
  const fields = Object.entries(capability.fields ?? {}).map(
    ([name, field]) => `${name}:field${field.required ? '' : '?'}`,
  )
  const argumentsText = [...fields, ...inputs].join(', ')
  return `- ${opcode} [${capability.shape}; ${capability.targets.join('|')}]${argumentsText ? ` (${argumentsText})` : ''}`
}

export const createAuthoringInstruction = (): string => `你要輸出 Scratch AI Bridge Canonical IR JSON。
不要執行 Python、不要使用程式碼工具、不要顯示思考或驗證過程。
只輸出一個最終 JSON 根物件；不要 Markdown code fence、說明文字或多個候選版本。
根物件必須包含 format="scratch-ai-bridge/canonical-ir"、version=1、name、stage、sprites、broadcasts。
stage 必須包含 kind="stage"、name、variables、lists、costumes、sounds、scripts、procedures。
每個 sprite 必須包含 kind="sprite"、name、variables、lists、costumes、sounds、scripts、procedures、x、y、direction、size、visible、draggable、rotationStyle。
每個 script 必須是 {"blocks":[...]}，不能直接使用積木陣列。
每個 input 都必須是下列物件之一：
- 常數：{"type":"literal","value":10}
- 變數：{"type":"variable","name":"score"}
- 清單：{"type":"list","name":"items"}
- 廣播：{"type":"broadcast","name":"start"}
- reporter：{"type":"block","block":{"opcode":"..."}}
- 子堆疊：{"type":"stack","blocks":[...]}
broadcasts 必須使用 [{"name":"start"}]，不能使用字串陣列。
fields 的值必須直接是 string、number 或 boolean，例如 {"KEY_OPTION":"right arrow"}、{"VARIABLE":"score"}；不可使用 {"value":"..."} 或 {"name":"..."} wrapper。
每個 costume 至少要有 name 與 dataFormat（svg/png/jpg/jpeg/bmp）；若沒有造型資料，請輸出 costumes:[]。
空的 lists、costumes、sounds、scripts、procedures 也必須輸出 []。
布林條件必須使用 shape=boolean 的 reporter，不可直接把數值變數當條件。
可用積木與必要參數：
${CANONICAL_OPCODES.map(describeBlock).join('\n')}
鍵盤 KEY_OPTION 可用 space、方向鍵（up/down/right/left arrow）、any、a-z、0-9。
碰撞 TOUCHINGOBJECTMENU 可用角色名稱、_edge_ 或 _mouse_。
不要自行加入 Scratch block id、parent、next 或 shadow id；這些由 compiler 產生。
若需求超出上述 capability，只產生可執行的簡化示範，不得杜撰 opcode。`

export const createStudentProjectInstruction = (request: string): string => `請依照下面的作品需求製作 Scratch 專案。
保留需求中的角色、玩法與目標；若目前能力無法完整做到，請產生可執行的簡化版本。

作品需求：
${request.trim()}

${createAuthoringInstruction()}`
