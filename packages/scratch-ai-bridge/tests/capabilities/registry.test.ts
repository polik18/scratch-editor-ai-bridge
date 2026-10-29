import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import validateProject from 'scratch-parser'
import { describe, expect, it, vi } from 'vitest'
import {
  CANONICAL_BLOCK_CAPABILITIES,
  CANONICAL_OPCODES,
  CORE_INTERNAL_MENU_OPCODES,
  CORE_PRESERVED_LEGACY_OPCODES,
  CORE_PROCEDURE_GRAPH_OPCODES,
  createAuthoringInstruction,
  createStudentProjectInstruction,
} from '../../src/core/capabilities'
import type { CanonicalBlockCapability } from '../../src/core/capabilities/registry'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import schema from '../../src/core/ir/schema.json'
import type { CanonicalBlock, CanonicalInput, CanonicalProject } from '../../src/core/ir/types'
import {
  createVM,
  getBlocks,
  getProjectJson,
  getTargets,
  getVariable,
  loadSb3,
  runForTicks,
  runForTicksAsync,
  saveSb3,
} from '../../src/scratch/vm'

const createHeadlessVM = async (
  penCalls?: { clears: number; points: number; lines: number },
  effectCalls?: { name: string; value: number }[],
  layerCalls?: { order: number; isRelative?: boolean }[],
  touchingCalls?: { targetId: number; candidateIds: number[] }[],
  bubbleCalls?: { type: string; text: string }[],
  pickDrawable?: () => number,
  destroyedDrawableCalls?: number[],
  boundsProvider?: (drawableId: number) => { left: number; right: number; top: number; bottom: number } | null,
  colorCalls?: { drawableId: number; targetColor: number[]; maskColor?: number[] }[],
  penDetails?: {
    points: { diameter: number; color4f: number[]; x: number; y: number }[]
    lines: { diameter: number; color4f: number[]; x1: number; y1: number; x2: number; y2: number }[]
    stamps: number[]
  },
): Promise<any> => {
  let nextId = 1
  const renderer = {
    setLayerGroupOrdering: () => undefined,
    createSVGSkin: () => Promise.resolve(nextId++),
    createTextSkin: (type: string, text: string) => {
      bubbleCalls?.push({ type, text })
      return nextId++
    },
    createPenSkin: () => nextId++,
    getSkinSize: () => [1, 1],
    getBounds: (drawableId: number) => boundsProvider?.(drawableId) ?? null,
    getCurrentSkinSize: () => [76, 76],
    getNativeSize: () => [480, 360],
    getSkinRotationCenter: () => [0.5, 0.5],
    getFencedPositionOfDrawable: (_drawableId: number, position: number[]) => position,
    createDrawable: () => nextId++,
    updateDrawablePosition: () => undefined,
    updateDrawableDirectionScale: () => undefined,
    updateDrawableVisible: () => undefined,
    updateDrawableSkinId: () => undefined,
    updateTextSkin: (_skinId: number, type: string, text: string) => {
      bubbleCalls?.push({ type, text })
    },
    updateDrawableEffect: (_drawableId: number, name: string, value: number) => {
      effectCalls?.push({ name, value })
    },
    setDrawableOrder: (_drawableId: number, order: number, _group: number, isRelative?: boolean) => {
      layerCalls?.push({ order, isRelative })
      return 0
    },
    isTouchingDrawables: (targetId: number, candidateIds: number[]) => {
      touchingCalls?.push({ targetId, candidateIds })
      return true
    },
    isTouchingColor: (drawableId: number, targetColor: number[], maskColor?: number[]) => {
      colorCalls?.push({ drawableId, targetColor, ...(maskColor ? { maskColor } : {}) })
      return Promise.resolve(Boolean(maskColor))
    },
    pick: () => pickDrawable?.() ?? -1,
    getDrawableOrder: (drawableId: number) => drawableId,
    destroyDrawable: (drawableId: number) => {
      destroyedDrawableCalls?.push(drawableId)
    },
    destroySkin: () => undefined,
    penClear: () => {
      if (penCalls) penCalls.clears += 1
    },
    penStamp: (_skinId: number, drawableId: number) => {
      penDetails?.stamps.push(drawableId)
    },
    penPoint: (_skinId: number, attributes: { diameter: number; color4f: number[] }, x: number, y: number) => {
      if (penCalls) penCalls.points += 1
      penDetails?.points.push({ diameter: attributes.diameter, color4f: [...attributes.color4f], x, y })
    },
    penLine: (
      _skinId: number,
      attributes: { diameter: number; color4f: number[] },
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ) => {
      if (penCalls) penCalls.lines += 1
      penDetails?.lines.push({ diameter: attributes.diameter, color4f: [...attributes.color4f], x1, y1, x2, y2 })
    },
    draw: () => undefined,
  }
  // Create a raw Scratch VM instance (no await, no storage/extensions needed for tests)
  const vm = new (await import('@scratch/scratch-vm')).default() as any
  vm.attachStorage({
    project: { save: () => Promise.resolve(), load: () => Promise.resolve(null) },
    sound: { save: () => Promise.resolve(), load: () => Promise.resolve(null) },
    costume: { save: () => Promise.resolve(), load: () => Promise.resolve(null) },
    library: { save: () => Promise.resolve(), load: () => Promise.resolve(null) },
  } as any)
  return vm as any
}

const executedRuntimeOpcodes = new Set<string>()

describe('Canonical block capability registry', () => {
  it('keeps the schema open to opcode strings and lists known opcodes in AI authoring instructions', () => {
    expect(schema.definitions.block.properties.opcode).toEqual({ type: 'string', minLength: 1 })

    const instruction = createAuthoringInstruction()
    for (const opcode of CANONICAL_OPCODES) expect(instruction).toContain(opcode)
    expect(instruction).toContain('不要執行 Python')
    expect(instruction).toContain('{"KEY_OPTION":"right arrow"}')
    expect(instruction).toContain('每個 costume 至少要有 name 與 dataFormat')
    expect(instruction).toContain('platform-hero')
    expect(instruction).toContain('platform-day')
    expect(instruction).toContain('Bridge 會安全加入圖像')
    expect(instruction).toContain('Canonical IR block 禁止輸出 shape 欄位')
    expect(instruction).not.toContain('shape=boolean 的 reporter')
  })

  it('describes the platform-game authoring slice', () => {
    expect(CANONICAL_BLOCK_CAPABILITIES.event_whenkeypressed.fields.KEY_OPTION.required).toBe(true)
    expect(CANONICAL_BLOCK_CAPABILITIES.motion_gotoxy.inputs).toMatchObject({
      X: { kind: 'number', required: true },
      Y: { kind: 'number', required: true },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.sensing_touchingobject.inputs.TOUCHINGOBJECTMENU).toMatchObject({
      kind: 'menu',
      required: true,
      shadow: { opcode: 'sensing_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU' },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_and.shape).toBe('boolean')
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_subtract).toMatchObject({
      shape: 'reporter',
      inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_mathop.fields.OPERATOR.values).toContain('sqrt')
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_contains.shape).toBe('boolean')
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_letter_of.inputs).toMatchObject({
      LETTER: { kind: 'number', required: true },
      STRING: { kind: 'string', required: true },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.looks_switchcostumeto.inputs.COSTUME.shadow).toEqual({
      opcode: 'looks_costume',
      field: 'COSTUME',
    })
  })

  it('combines a student idea with the complete authoring contract', async () => {
    const instruction = createStudentProjectInstruction('  做一個可以收集金幣的平台遊戲  ')

    expect(instruction).toContain('作品需求：\n做一個可以收集金幣的平台遊戲')
    expect(instruction).toContain('只輸出一個最終 JSON 根物件')
    expect(instruction).toContain('event_whenkeypressed')
    expect(instruction).not.toContain('  做一個')
  })

  it('classifies every primitive in the pinned Scratch VM core block packages', async () => {
})
