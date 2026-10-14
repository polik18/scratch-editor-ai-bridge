import { describe, expect, it } from 'vitest'
import emptyVisuals from '../../src/core/ir/examples/02-green-flag-move-say.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { resolveAutomaticVisual, summarizeAutomaticVisuals } from '../../src/core/visuals/presets'

describe('automatic visual presets', () => {
  it('maps common Chinese and English game roles to distinct visible presets', () => {
    const cases = [
      ['玩家', 'platform-hero'],
      ['Goomba', 'platform-enemy'],
      ['金幣', 'coin'],
      ['Ground', 'platform'],
      ['終點旗', 'goal'],
      ['太空船', 'spaceship'],
    ] as const

    for (const [targetName, expectedPreset] of cases) {
      const visual = resolveAutomaticVisual({
        isStage: false,
        projectName: 'Super Mario Platformer',
        targetName,
        costumeName: targetName,
      })
      expect(visual.preset).toBe(expectedPreset)
      expect(visual.data).toContain(`<svg`)
      expect(visual.data).toContain(`data-sab-preset="${expectedPreset}"`)
      expect(visual.rotationCenterX).toBeGreaterThan(1)
      expect(visual.rotationCenterY).toBeGreaterThan(1)
    }
  })

  it('prioritizes breakout target roles over generic costume labels and orients walls', () => {
    const cases = [
      { targetName: 'Paddle', costumeName: 'platform', expected: 'paddle', width: 104, height: 18 },
      { targetName: 'TopWall', costumeName: 'platform', expected: 'wall', width: 480, height: 18 },
      { targetName: 'BottomWall', costumeName: 'platform', expected: 'wall', width: 480, height: 18 },
      { targetName: 'LeftWall', costumeName: 'platform', expected: 'wall', width: 18, height: 360 },
      { targetName: 'RightWall', costumeName: 'platform', expected: 'wall', width: 18, height: 360 },
      { targetName: 'Brick1', costumeName: 'coin', expected: 'brick', width: 64, height: 28 },
    ] as const

    for (const { targetName, costumeName, expected, width, height } of cases) {
      const visual = resolveAutomaticVisual({
        isStage: false,
        projectName: 'Breakout Game',
        targetName,
        costumeName,
      })
      expect(visual.preset, targetName).toBe(expected)
      expect(visual.data, targetName).toContain(`width="${width}" height="${height}"`)
    }
  })

  it('selects a backdrop from the project theme and escapes generic labels', () => {
    const space = resolveAutomaticVisual({
      isStage: true,
      projectName: '太空冒險',
      targetName: 'Stage',
      costumeName: 'backdrop1',
    })
    const generic = resolveAutomaticVisual({
      isStage: false,
      projectName: '故事',
      targetName: '<朋友 & 我>',
      costumeName: 'costume1',
    })

    expect(space.preset).toBe('space')
    expect(generic.preset).toBe('generic-character')
    expect(generic.data).toContain('&lt;朋友 &amp; 我&gt;')
    expect(generic.data).not.toContain('<朋友 & 我>')
  })

  it('reports only costumes that need automatic artwork', () => {
    expect(summarizeAutomaticVisuals(emptyVisuals as CanonicalProject)).toEqual({
      backdropCostumes: 1,
      spriteCostumes: 1,
      spriteNames: ['Sprite1'],
    })
    expect(summarizeAutomaticVisuals(platformer as CanonicalProject)).toEqual({
      backdropCostumes: 1,
      spriteCostumes: 0,
      spriteNames: [],
    })
  })
})
