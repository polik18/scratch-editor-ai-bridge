// GameDesign interface for Scratch AI Bridge
// This file defines the input data structure for game design

export interface GameDesign {
  id: string;
  title: string;
  type: string;
  sprites: number;
  blocks: number;
  difficulty: string;
  version: string;
  created: string;
  designDoc: string;
  outputSb3: string;
  outputJson: string;
  spritesDef?: SpriteDef[];
  variables?: VariableDef[];
  lists?: ListDef[];
  scripts?: ScriptDef[];
}

export interface SpriteDef {
  name: string;
  costumes?: string[];
  x?: number;
  y?: number;
  direction?: number;
  visible?: boolean;
  draggable?: boolean;
}

export interface VariableDef {
  name: string;
  value: number | string;
  sprite?: string;
}

export interface ListDef {
  name: string;
  values: (number | string)[];
  sprite?: string;
}

export interface ScriptDef {
  target: string;
  x?: number;
  y?: number;
  blocks: BlockDef[];
}

export interface BlockDef {
  id?: string;
  opcode: string;
  next?: string;
  parent?: string;
  inputs?: Record<string, any>;
  fields?: Record<string, any>;
}
