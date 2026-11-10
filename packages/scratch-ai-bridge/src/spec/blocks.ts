import type { CanonicalBlock, CanonicalInput, CanonicalScalar } from '../core/ir/types'

/** Terse builders for Canonical IR blocks used by the behavior library. */

export type Value = CanonicalScalar | CanonicalInput | CanonicalBlock

const isInput = (value: Value): value is CanonicalInput => typeof value === 'object' && 'type' in value
const isBlock = (value: Value): value is CanonicalBlock => typeof value === 'object' && 'opcode' in value

export const input = (value: Value): CanonicalInput => {
  if (isInput(value)) return value
  if (isBlock(value)) return { type: 'block', block: value }
  return { type: 'literal', value }
}

export const variable = (name: string): CanonicalInput => ({ type: 'variable', name })
const stack = (blocks: readonly CanonicalBlock[]): CanonicalInput => ({ type: 'stack', blocks: [...blocks] })

const op = (
  opcode: string,
  inputs?: Record<string, Value>,
  fields?: Record<string, CanonicalScalar>,
): CanonicalBlock => ({
  opcode,
  ...(inputs
    ? { inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, input(value)])) }
    : {}),
  ...(fields ? { fields } : {}),
})

export const whenFlag = (): CanonicalBlock => op('event_whenflagclicked')
export const whenCloned = (): CanonicalBlock => op('control_start_as_clone')
export const whenReceive = (name: string): CanonicalBlock =>
  op('event_whenbroadcastreceived', undefined, { BROADCAST_OPTION: name })
export const broadcast = (name: string): CanonicalBlock => ({
  opcode: 'event_broadcast',
  inputs: { BROADCAST_INPUT: { type: 'broadcast', name } },
})

export const setVar = (name: string, value: Value): CanonicalBlock =>
  op('data_setvariableto', { VALUE: value }, { VARIABLE: name })
export const changeVar = (name: string, value: Value): CanonicalBlock =>
  op('data_changevariableby', { VALUE: value }, { VARIABLE: name })
export const showVar = (name: string): CanonicalBlock => op('data_showvariable', undefined, { VARIABLE: name })
export const hideVar = (name: string): CanonicalBlock => op('data_hidevariable', undefined, { VARIABLE: name })
export const itemOf = (index: Value, list: string): CanonicalBlock =>
  op('data_itemoflist', { INDEX: index }, { LIST: list })
export const lengthOf = (list: string): CanonicalBlock => op('data_lengthoflist', undefined, { LIST: list })

export const add = (a: Value, b: Value): CanonicalBlock => op('operator_add', { NUM1: a, NUM2: b })
export const sub = (a: Value, b: Value): CanonicalBlock => op('operator_subtract', { NUM1: a, NUM2: b })
export const mul = (a: Value, b: Value): CanonicalBlock => op('operator_multiply', { NUM1: a, NUM2: b })
export const mod = (a: Value, b: Value): CanonicalBlock => op('operator_mod', { NUM1: a, NUM2: b })
export const abs = (a: Value): CanonicalBlock => op('operator_mathop', { NUM: a }, { OPERATOR: 'abs' })
export const gt = (a: Value, b: Value): CanonicalBlock => op('operator_gt', { OPERAND1: a, OPERAND2: b })
export const lt = (a: Value, b: Value): CanonicalBlock => op('operator_lt', { OPERAND1: a, OPERAND2: b })
export const eq = (a: Value, b: Value): CanonicalBlock => op('operator_equals', { OPERAND1: a, OPERAND2: b })
export const and = (a: CanonicalBlock, b: CanonicalBlock): CanonicalBlock =>
  op('operator_and', { OPERAND1: a, OPERAND2: b })
export const or = (a: CanonicalBlock, b: CanonicalBlock): CanonicalBlock =>
  op('operator_or', { OPERAND1: a, OPERAND2: b })
export const not = (a: CanonicalBlock): CanonicalBlock => op('operator_not', { OPERAND: a })
export const keyPressed = (key: string): CanonicalBlock => op('sensing_keypressed', { KEY_OPTION: key })
export const anyKey = (...keys: string[]): CanonicalBlock =>
  keys.map(keyPressed).reduce((left, right) => or(left, right))
export const touching = (target: string): CanonicalBlock =>
  op('sensing_touchingobject', { TOUCHINGOBJECTMENU: target })

export const ifThen = (condition: CanonicalBlock, ...body: CanonicalBlock[]): CanonicalBlock => ({
  opcode: 'control_if',
  inputs: { CONDITION: input(condition), SUBSTACK: stack(body) },
})
export const ifElse = (
  condition: CanonicalBlock,
  then: readonly CanonicalBlock[],
  otherwise: readonly CanonicalBlock[],
): CanonicalBlock => ({
  opcode: 'control_if_else',
  inputs: { CONDITION: input(condition), SUBSTACK: stack(then), SUBSTACK2: stack(otherwise) },
})
export const forever = (...body: CanonicalBlock[]): CanonicalBlock => ({
  opcode: 'control_forever',
  inputs: { SUBSTACK: stack(body) },
})
export const repeat = (times: Value, ...body: CanonicalBlock[]): CanonicalBlock => ({
  opcode: 'control_repeat',
  inputs: { TIMES: input(times), SUBSTACK: stack(body) },
})
export const repeatUntil = (condition: CanonicalBlock, ...body: CanonicalBlock[]): CanonicalBlock => ({
  opcode: 'control_repeat_until',
  inputs: { CONDITION: input(condition), SUBSTACK: stack(body) },
})
export const waitUntil = (condition: CanonicalBlock): CanonicalBlock => ({
  opcode: 'control_wait_until',
  inputs: { CONDITION: input(condition) },
})
export const wait = (seconds: Value): CanonicalBlock => op('control_wait', { DURATION: seconds })
export const stop = (option: 'all' | 'this script' | 'other scripts in sprite'): CanonicalBlock =>
  op('control_stop', undefined, { STOP_OPTION: option })
export const cloneSelf = (): CanonicalBlock => op('control_create_clone_of', { CLONE_OPTION: '_myself_' })
export const deleteClone = (): CanonicalBlock => op('control_delete_this_clone')
export const call = (name: string): CanonicalBlock => ({ opcode: 'procedures_call', procedure: { name } })

export const gotoXY = (x: Value, y: Value): CanonicalBlock => op('motion_gotoxy', { X: x, Y: y })
export const changeX = (dx: Value): CanonicalBlock => op('motion_changexby', { DX: dx })
export const changeY = (dy: Value): CanonicalBlock => op('motion_changeyby', { DY: dy })
export const setX = (x: Value): CanonicalBlock => op('motion_setx', { X: x })
export const setY = (y: Value): CanonicalBlock => op('motion_sety', { Y: y })
export const xPos = (): CanonicalBlock => op('motion_xposition')
export const yPos = (): CanonicalBlock => op('motion_yposition')
export const pointIn = (direction: Value): CanonicalBlock => op('motion_pointindirection', { DIRECTION: direction })

export const show = (): CanonicalBlock => op('looks_show')
export const hide = (): CanonicalBlock => op('looks_hide')
export const say = (text: Value): CanonicalBlock => op('looks_say', { MESSAGE: text })
export const sayFor = (text: Value, seconds: Value): CanonicalBlock =>
  op('looks_sayforsecs', { MESSAGE: text, SECS: seconds })
export const costume = (name: string): CanonicalBlock => op('looks_switchcostumeto', { COSTUME: name })
export const ghost = (value: Value): CanonicalBlock => op('looks_seteffectto', { VALUE: value }, { EFFECT: 'ghost' })
export const toFront = (): CanonicalBlock => op('looks_gotofrontback', undefined, { FRONT_BACK: 'front' })
