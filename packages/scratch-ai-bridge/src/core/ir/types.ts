export const CANONICAL_IR_FORMAT = 'scratch-ai-bridge/canonical-ir' as const
export const CANONICAL_IR_VERSION = 1 as const

export const CANONICAL_OPCODES = [
  'event_whenflagclicked',
  'motion_movesteps',
  'looks_say',
  'control_wait',
  'control_repeat',
  'control_forever',
  'control_if',
  'control_if_else',
  'data_setvariableto',
  'data_changevariableby',
  'event_broadcast',
  'event_whenbroadcastreceived',
] as const

export type CanonicalOpcode = (typeof CANONICAL_OPCODES)[number]
export type CanonicalScalar = string | number | boolean

export interface LiteralInput {
  type: 'literal'
  value: CanonicalScalar
}

export interface VariableInput {
  type: 'variable'
  name: string
}

export interface ListInput {
  type: 'list'
  name: string
}

export interface BroadcastInput {
  type: 'broadcast'
  name: string
}

export interface BlockInput {
  type: 'block'
  block: CanonicalBlock
}

export interface StackInput {
  type: 'stack'
  blocks: CanonicalBlock[]
}

export type CanonicalInput = LiteralInput | VariableInput | ListInput | BroadcastInput | BlockInput | StackInput

export interface CanonicalBlock {
  opcode: CanonicalOpcode
  inputs?: Record<string, CanonicalInput>
  fields?: Record<string, CanonicalScalar>
}

export interface ScriptPosition {
  x: number
  y: number
}

export interface CanonicalScript {
  blocks: CanonicalBlock[]
  position?: ScriptPosition
}

export interface CanonicalVariable {
  name: string
  value: CanonicalScalar
  cloud?: boolean
}

export interface CanonicalList {
  name: string
  value: CanonicalScalar[]
}

export interface CanonicalBroadcast {
  name: string
}

export type ProcedureParameterKind = 'string-number' | 'boolean'

export interface CanonicalProcedureParameter {
  name: string
  kind: ProcedureParameterKind
  default: CanonicalScalar
}

export interface CanonicalProcedure {
  name: string
  parameters: CanonicalProcedureParameter[]
  warp: boolean
  body: CanonicalBlock[]
}

export type CostumeDataFormat = 'svg' | 'png' | 'jpg' | 'jpeg' | 'bmp'

export interface CanonicalCostume {
  name: string
  dataFormat: CostumeDataFormat
  data?: string
  rotationCenterX?: number
  rotationCenterY?: number
  bitmapResolution?: number
}

export type SoundDataFormat = 'wav' | 'mp3'

export interface CanonicalSound {
  name: string
  dataFormat: SoundDataFormat
  data?: string
  rate?: number
  sampleCount?: number
}

export interface CanonicalTargetBase {
  name: string
  variables: CanonicalVariable[]
  lists: CanonicalList[]
  costumes: CanonicalCostume[]
  sounds: CanonicalSound[]
  scripts: CanonicalScript[]
  procedures: CanonicalProcedure[]
}

export interface CanonicalStage extends CanonicalTargetBase {
  kind: 'stage'
}

export type RotationStyle = 'all around' | 'left-right' | "don't rotate"

export interface CanonicalSprite extends CanonicalTargetBase {
  kind: 'sprite'
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  draggable: boolean
  rotationStyle: RotationStyle
}

export interface CanonicalProject {
  format: typeof CANONICAL_IR_FORMAT
  version: typeof CANONICAL_IR_VERSION
  name: string
  stage: CanonicalStage
  sprites: CanonicalSprite[]
  broadcasts: CanonicalBroadcast[]
}
