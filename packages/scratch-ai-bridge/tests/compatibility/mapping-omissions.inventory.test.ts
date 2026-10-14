import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler'
import expectedInventory from '../fixtures/canonical-mapping-omissions.json'
import { OFFICIAL_FIXTURE_MATRIX } from './fixture-matrix'

const omissionReasons: Record<string, string> = {
  argument_reporter_string_number: 'procedure-argument-represented-in-canonical-parameters',
  looks_backdrops: 'shadow-menu-value-represented-in-parent-input',
  looks_costume: 'shadow-menu-value-represented-in-parent-input',
  sensing_of_object_menu: 'shadow-menu-value-represented-in-parent-input',
  sound_sounds_menu: 'shadow-menu-value-represented-in-parent-input',
}

describe('official Canonical mapping omission inventory', () => {
  it('accounts for every raw block without an independent Canonical node', async () => {
    const fixtures = OFFICIAL_FIXTURE_MATRIX.filter(
      ({ format, expectation }) => format === 'sb3' && expectation !== 'parse-only',
    )
    const inventory = []

    for (const fixture of fixtures) {
      const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
      const mappedKeys = new Set(
        result.canonicalBlockMappings.map((mapping) => `${mapping.targetIndex}:${mapping.blockId}`),
      )
      const groups = new Map<
        string,
        { targetIndex: number; targetName: string; opcode: string; reason: string; blockIds: string[] }
      >()

      for (const target of result.rawBlockGraphs) {
        for (const [blockId, block] of Object.entries(target.blocks)) {
          if (mappedKeys.has(`${target.targetIndex}:${blockId}`)) continue
          const reason = omissionReasons[block.opcode]
          expect(reason, `${fixture.name} omitted ${block.opcode}`).toBeDefined()
          expect(block.shadow, `${fixture.name} omitted ${blockId} must be an implicit shadow`).toBe(true)
          expect(block.topLevel, `${fixture.name} omitted ${blockId} must not be a top-level script`).toBe(false)
          expect(block.parent, `${fixture.name} omitted ${blockId} must have a mapped parent`).toBeTruthy()
          expect(
            mappedKeys.has(`${target.targetIndex}:${block.parent}`),
            `${fixture.name} parent of omitted ${blockId}`,
          ).toBe(true)

          if (typeof block.parent !== 'string') throw new Error(`${fixture.name} omitted ${blockId} has no parent`)
          const parent = target.blocks[block.parent]
          if (block.opcode === 'argument_reporter_string_number') {
            expect(parent.opcode, `${fixture.name} procedure argument parent`).toBe('procedures_prototype')
          } else {
            expect(JSON.stringify(parent.inputs ?? {}), `${fixture.name} menu shadow parent input`).toContain(blockId)
          }

          const key = `${target.targetIndex}:${block.opcode}:${reason}`
          const group = groups.get(key) ?? {
            targetIndex: target.targetIndex,
            targetName: target.targetName,
            opcode: block.opcode,
            reason,
            blockIds: [],
          }
          group.blockIds.push(blockId)
          groups.set(key, group)
        }
      }

      inventory.push({
        name: fixture.name,
        omissions: [...groups.values()]
          .sort((left, right) => left.targetIndex - right.targetIndex || left.opcode.localeCompare(right.opcode))
          .map((group) => ({ ...group, blockIds: group.blockIds.sort() })),
      })
    }

    expect(inventory).toEqual(expectedInventory.fixtures)
  })
})
