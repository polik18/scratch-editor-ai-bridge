import { describe, expect, it } from 'vitest'
import { parseScratchblocks } from '../../../src/core/scratchblocks/parser'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../../src/core/validator'

describe('scratchblocks prototype parser', () => {
  it('parses a small nested game script into valid Canonical IR', () => {
    const result = parseScratchblocks(`
when green flag clicked
set [score v] to (0)
forever
  move (10) steps
  if <key [space v] pressed?> then
    change [score v] by (1)
    play sound [Pop v] until done
  end
end
when [left arrow v] key pressed
change x by (-10)
`)

    expect(result.warnings).toEqual([])
    expect(result.skippedLines).toBe(0)
    expect(result.project.sprites[0]?.scripts).toHaveLength(2)
    expect(result.project.sprites[0]?.variables).toEqual([{ name: 'score', value: 0 }])
    expect(result.project.sprites[0]?.scripts[0]?.blocks[2]?.opcode).toBe('control_forever')
    const validation = validateCanonicalProject(result.project)
    expect(validation.valid).toBe(true)
    expect(validateCanonicalSemantics(result.project).filter(({ severity }) => severity === 'error')).toEqual([])
  })

  it('reports unsupported lines without hiding recognized blocks', () => {
    const result = parseScratchblocks('when green flag clicked\nthis is not supported\nmove (5) steps')

    expect(result.recognizedLines).toBe(2)
    expect(result.skippedLines).toBe(1)
    expect(result.warnings[0]).toContain('未支援')
    expect(result.project.sprites[0]?.scripts[0]?.blocks.map(({ opcode }) => opcode)).toEqual([
      'event_whenflagclicked',
      'motion_movesteps',
    ])
  })
})
