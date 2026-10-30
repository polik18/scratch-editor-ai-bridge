// GameDesign interface for Scratch AI Bridge
// This file defines the input data structure for game design

export interface GameDesign {
  id?: string
  title: string
  type?: string
  sprites?: number
  blocks?: number
  difficulty?: string
  version?: string
  created?: string
  designDoc?: string
  outputSb3?: string
  outputJson?: string
  stage?: StageDef
  extensions?: string[]
  spritesDef?: SpriteDef[]
  variables?: VariableDef[]
  lists?: ListDef[]
  scripts?: ScriptDef[]
}

export interface StageDef {
  name?: string
  costumes?: string[]
  currentCostume?: number
  tempo?: number
  videoTransparency?: number
  videoState?: string
}

export interface SpriteDef {
  name: string
  costumes?: string[]
  x?: number
  y?: number
  direction?: number
  size?: number
  visible?: boolean
  draggable?: boolean
  rotationStyle?: 'all around' | 'left-right' | "don't rotate"
  currentCostume?: number
  volume?: number
}

export interface VariableDef {
  name: string
  value: number | string | boolean
  sprite?: string
  cloud?: boolean
}

export interface ListDef {
  name: string
  values: (number | string | boolean)[]
  sprite?: string
}

export interface ScriptDef {
  target: string
  x?: number
  y?: number
  blocks: BlockDef[]
}

export interface BlockDef {
  opcode: string
  next?: string
  parent?: string
  inputs?: Record<string, unknown>
  fields?: Record<string, unknown>
}
