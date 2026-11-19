import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../../src/core/compiler'
import { parseScratchblocksProject } from '../../../src/core/scratchblocks'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../../src/core/validator'

const bigFish = `
stage (背景: Underwater 1)
when green flag clicked
set [分數 v] to (0)

sprite 大魚 (外觀: Shark 2; 音效: Chomp)
when green flag clicked
go to x: (0) y: (0)
forever
  if <key [right arrow v] pressed?> then
    change x by (5)
  end
  if <key [left arrow v] pressed?> then
    change x by (-5)
  end
  if <touching [小魚 v]?> then
    play sound [Chomp v]
    change [分數 v] by (1)
    say (join [分數：] (分數)) for (1) seconds
  end
end

sprite 小魚 (外觀: Fish)
when green flag clicked
hide
forever
  create clone of [myself v]
  wait (2) seconds
end
when I start as a clone
go to [random position v]
show
repeat until <touching [大魚 v]?>
  move (3) steps
  if on edge, bounce
end
delete this clone
`

describe('multi-target scratchblocks', () => {
  it('turns sprite and stage sections into a valid, compilable project', async () => {
    const result = parseScratchblocksProject(bigFish, { name: '大魚吃小魚' })
    expect(result.warnings).toEqual([])
    expect(result.skippedLines).toBe(0)
    expect(result.project.sprites.map(({ name }) => name)).toEqual(['大魚', '小魚'])
    expect(result.project.stage.costumes.map(({ name }) => name)).toEqual(['Underwater 1'])
    expect(result.project.stage.variables).toEqual([{ name: '分數', value: 0 }])
    expect(result.project.sprites[0]?.costumes.map(({ name }) => name)).toEqual(['Shark 2'])
    expect(result.project.sprites[0]?.sounds.map(({ name }) => name)).toEqual(['Chomp'])
    const fish = result.project.sprites[1]
    expect(fish.scripts.map((script) => script.blocks[0]?.opcode)).toEqual([
      'event_whenflagclicked',
      'control_start_as_clone',
    ])
    const clone = fish.scripts[0].blocks[2]
    expect(clone.opcode).toBe('control_forever')
    const validation = validateCanonicalProject(result.project)
    expect(validation.valid).toBe(true)
    expect(validateCanonicalSemantics(result.project).filter(({ severity }) => severity === 'error')).toEqual([])
    const archive = await compileCanonicalProjectToSb3(result.project)
    expect(archive.size).toBeGreaterThan(1000)
  })

  it('parses scenes, questions, glides, effects and variable reporters', () => {
    const result = parseScratchblocksProject(`
stage (背景: Forest, Castle 1)
when green flag clicked
switch backdrop to [Forest v]
sprite 嚮導
when green flag clicked
ask [你叫什麼名字？] and wait
say (answer) for (2) seconds
glide (1) secs to x: (100) y: (0)
change [ghost v] effect by (20)
set size to (120) %
next backdrop
when backdrop switches to [Castle 1 v]
think [到城堡了] for (2) seconds
`)
    expect(result.warnings).toEqual([])
    const opcodes = result.project.sprites[0]?.scripts.flatMap((script) => script.blocks.map(({ opcode }) => opcode))
    expect(opcodes).toEqual(
      expect.arrayContaining([
        'sensing_askandwait',
        'motion_glidesecstoxy',
        'looks_changeeffectby',
        'looks_setsizeto',
        'looks_nextbackdrop',
        'event_whenbackdropswitchesto',
      ]),
    )
    expect(result.project.stage.costumes.map(({ name }) => name)).toEqual(['Forest', 'Castle 1'])
    expect(validateCanonicalProject(result.project).valid).toBe(true)
  })

  it('marks replace sections and adds sprites that are touched but never defined', () => {
    const result = parseScratchblocksProject(
      'sprite 貓 (replace)\nwhen green flag clicked\nif <touching [蘋果 v]?> then\n  hide\nend',
    )
    expect(result.sections[0]).toMatchObject({ name: '貓', mode: 'replace' })
    expect(result.project.sprites.map(({ name }) => name)).toEqual(['貓', '蘋果'])
    expect(result.warnings.join()).toContain('蘋果')
  })
})

describe('scratchblocks reporters', () => {
  it('keeps join, arithmetic and variable reporters as blocks', () => {
    const result = parseScratchblocksProject(
      'sprite 貓\nwhen green flag clicked\nset [分數 v] to (0)\nsay (join [分數：] (分數)) for (1) seconds\nset [分數 v] to ((分數) + (1))\nif <(分數) > (9)> then\n  stop [all v]\nend',
    )
    const blocks = result.project.sprites[0]?.scripts[0]?.blocks ?? []
    const say = blocks[2]?.inputs?.MESSAGE
    expect(say?.type === 'block' && say.block.opcode).toBe('operator_join')
    const join = say?.type === 'block' ? say.block.inputs?.STRING2 : undefined
    expect(join).toEqual({ type: 'variable', name: '分數' })
    const sum = blocks[3]?.inputs?.VALUE
    expect(sum?.type === 'block' && sum.block.opcode).toBe('operator_add')
    expect(validateCanonicalProject(result.project).valid).toBe(true)
  })
})

describe('layouts real models write (Cyber-Tiel 35B benchmark replies)', () => {
  it('reads declared-first sprites, banner comments, if/else and Chinese aliases', () => {
    const result = parseScratchblocksProject(`
// 《咪咪接蘋果》
sprite 白貓籃子 (外觀: Cat; 音效: Pop)
sprite 蘋果 (外觀: Apple)
stage (背景: Blue Sky)

// ===== 白貓籃子：左右鍵控制 =====
when flag clicked
set [分數 v] to (0)
forever
  if <key [right v] pressed?> then
    change x by (5)
  else
    if <key [左 v] pressed?> then
      change x by (-5)
    end
  end
end

// ===== 蘋果：往下掉 =====
當綠旗被點擊
一直重複
  change y by (-3)
  如果 <touching [白貓籃子 v]?> 那麼
    將 [分數 v] 改變 (1)
    播放音效 [Pop v]
    go to x: (pick random -200 to 200) y: (180)
  結束
  wait (0.1) secs // 控制速度
結束
`)
    expect(result.warnings.filter((warning) => warning.includes('未支援'))).toEqual([])
    expect(result.project.sprites.map(({ name }) => name)).toEqual(['白貓籃子', '蘋果'])
    expect(result.project.stage.scripts).toEqual([])
    const [cat, apple] = result.project.sprites
    const forever = cat.scripts[0].blocks[2]
    const outer = forever.inputs?.SUBSTACK
    const ifElse = outer?.type === 'stack' ? outer.blocks[0] : undefined
    expect(ifElse?.opcode).toBe('control_if_else')
    const key = ifElse?.inputs?.CONDITION
    expect(key?.type === 'block' && key.block.inputs?.KEY_OPTION).toEqual({ type: 'literal', value: 'right arrow' })
    expect(apple.scripts[0].blocks.map(({ opcode }) => opcode)).toEqual(['event_whenflagclicked', 'control_forever'])
    expect(validateCanonicalProject(result.project).valid).toBe(true)
    expect(validateCanonicalSemantics(result.project).filter(({ severity }) => severity === 'error')).toEqual([])
  })

  it('treats a bare name before a hat as a section header but never a block line', () => {
    const result = parseScratchblocksProject(
      '金魚 (replace) 吃魚段落\nwhen green flag clicked\nnext costume\nwhen this sprite clicked\nhide',
    )
    expect(result.sections.map(({ name, mode }) => [name, mode])).toEqual([['金魚', 'replace']])
    expect(result.project.sprites[0].scripts).toHaveLength(2)
  })
})
