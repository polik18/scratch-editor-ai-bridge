import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import emptyVisuals from '../../src/core/ir/examples/02-green-flag-move-say.json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft } from '../../src/core/normalizer/ai-draft'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import geminiPlatformer from '../fixtures/gemini-platformer-shorthand.json'

describe('Scratch project JSON compiler', () => {
  it('creates visible themed assets instead of a white stage and transparent sprites', async () => {
    const archive = await buildScratchProjectArchive(emptyVisuals as CanonicalProject)
    const zip = await JSZip.loadAsync(archive)
    const projectFile = zip.file('project.json')
    expect(projectFile).not.toBeNull()
    if (!projectFile) return
    const project = JSON.parse(await projectFile.async('string')) as ReturnType<typeof buildScratchProjectJson>
    const stage = project.targets[0]
    const sprite = project.targets[1]
    const stageFile = zip.file(stage.costumes[0].md5ext)
    const spriteFile = zip.file(sprite.costumes[0].md5ext)
    expect(stageFile).not.toBeNull()
    expect(spriteFile).not.toBeNull()
    if (!stageFile || !spriteFile) return
    const stageSvg = await stageFile.async('string')
    const spriteSvg = await spriteFile.async('string')

    expect(stageSvg).toContain('data-sab-preset="platform-day"')
    expect(stageSvg).toContain('linearGradient')
    expect(spriteSvg).toContain('data-sab-preset="generic-character"')
    expect(spriteSvg).toContain('Sprite1')
    expect(sprite.costumes[0].rotationCenterX).toBe(38)
    expect(sprite.costumes[0].rotationCenterY).toBe(38)
    expect(stage.costumes[0].assetId).not.toBe(sprite.costumes[0].assetId)
  })

  it('gives the reported Gemini platformer distinct role-based artwork', async () => {
    const normalized = normalizeAiDraft(geminiPlatformer)
    const validation = validateCanonicalProject(normalized.data)
    expect(validation.valid).toBe(true)
    if (!validation.valid) return

    const archive = await buildScratchProjectArchive(validation.data)
    const zip = await JSZip.loadAsync(archive)
    const projectFile = zip.file('project.json')
    expect(projectFile).not.toBeNull()
    if (!projectFile) return
    const project = JSON.parse(await projectFile.async('string')) as ReturnType<typeof buildScratchProjectJson>
    const presets = await Promise.all(
      project.targets.map(async (target) => {
        const costumeFile = zip.file(target.costumes[0].md5ext)
        expect(costumeFile).not.toBeNull()
        return costumeFile ? /data-sab-preset="([^"]+)"/.exec(await costumeFile.async('string'))?.[1] : undefined
      }),
    )

    expect(presets).toEqual(['platform-day', 'platform-hero', 'platform-enemy', 'coin', 'generic-character'])
  })

  it('creates deterministic block graph, symbols and nested substacks', () => {
    const result = buildScratchProjectJson(example as CanonicalProject)
    const stage = result.targets[0]
    expect(stage.isStage).toBe(true)
    expect(Object.keys(stage.variables)).toHaveLength(1)

    const blocks = Object.values(stage.blocks)
    expect(blocks.some((block) => block.opcode === 'event_whenflagclicked')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'control_repeat')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'data_changevariableby')).toBe(true)
  })

  it('creates official menu shadows for platformer collision and costume blocks', () => {
    const result = buildScratchProjectJson(platformer as CanonicalProject)
    const player = result.targets.find((target) => target.name === 'Player')
    expect(player).toBeDefined()
    if (!player) return

    const blocks = Object.values(player.blocks)
    const keyHat = blocks.find((block) => block.opcode === 'event_whenkeypressed')
    expect(keyHat?.fields.KEY_OPTION).toEqual(['right arrow'])

    const touching = blocks.find((block) => block.opcode === 'sensing_touchingobject')
    const touchingInput = touching?.inputs.TOUCHINGOBJECTMENU
    expect(touchingInput?.[0]).toBe(1)
    const touchingShadowId = touchingInput?.[1]
    expect(typeof touchingShadowId).toBe('string')
    if (typeof touchingShadowId !== 'string') return
    expect(player.blocks[touchingShadowId]).toMatchObject({
      opcode: 'sensing_touchingobjectmenu',
      fields: { TOUCHINGOBJECTMENU: ['Platform'] },
      shadow: true,
      topLevel: false,
    })

    const costume = blocks.find((block) => block.opcode === 'looks_switchcostumeto')
    const costumeShadowId = costume?.inputs.COSTUME[1]
    expect(typeof costumeShadowId).toBe('string')
    if (typeof costumeShadowId !== 'string') return
    expect(player.blocks[costumeShadowId]).toMatchObject({
      opcode: 'looks_costume',
      fields: { COSTUME: ['player'] },
      shadow: true,
    })
  })
})
