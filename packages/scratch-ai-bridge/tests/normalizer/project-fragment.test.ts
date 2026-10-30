import { describe, expect, it } from 'vitest'
import {
  createEmptyProjectFragmentSession,
  mergeProjectFragment,
  PROJECT_FRAGMENT_FORMAT,
} from '../../src/core/normalizer'

const stage = (scripts: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  kind: 'stage',
  name: '深海救援',
  variables: [],
  lists: [],
  costumes: [{ name: '海底', dataFormat: 'svg' }],
  sounds: [],
  scripts,
  procedures: [],
  ...extra,
})
const sprite = (name: string, scripts: unknown[] = []) => ({
  kind: 'sprite',
  name,
  variables: [],
  lists: [],
  costumes: [{ name: 'generic-character', dataFormat: 'svg' }],
  sounds: [],
  scripts,
  procedures: [],
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  visible: true,
  draggable: false,
  rotationStyle: 'all around',
})
const fragment = (fragmentId: string, target: unknown, extra: Record<string, unknown> = {}) => ({
  format: PROJECT_FRAGMENT_FORMAT,
  version: 1,
  projectName: '深海救援',
  fragmentId,
  target,
  ...extra,
})

describe('project fragment session', () => {
  it('requires Stage first, then assembles Stage, sprites, scripts, broadcasts and extensions', () => {
    const empty = createEmptyProjectFragmentSession()
    expect(() => mergeProjectFragment(empty, fragment('player', sprite('潛水員')))).toThrow(/先加入 Stage/)
    const withStage = mergeProjectFragment(
      empty,
      fragment('stage', stage([{ blocks: [{ opcode: 'event_whenflagclicked' }] }]), {
        broadcasts: [{ name: '救援完成' }],
        extensions: ['pen'],
      }),
    )
    const withPlayer = mergeProjectFragment(
      withStage,
      fragment('player-core', sprite('潛水員', [{ blocks: [{ opcode: 'motion_movesteps' }] }])),
    )
    const withPlayerExtra = mergeProjectFragment(
      withPlayer,
      fragment('player-score', sprite('潛水員', [{ blocks: [{ opcode: 'data_changevariableby' }] }])),
    )
    expect(withPlayerExtra.project?.stage.scripts).toHaveLength(1)
    expect(withPlayerExtra.project?.sprites[0]?.scripts).toHaveLength(2)
    expect(withPlayerExtra.project?.broadcasts).toEqual([{ name: '救援完成' }])
    expect(withPlayerExtra.project?.extensions).toEqual(['pen'])
  })

  it('rejects repeated ids, mismatched project names and conflicting named declarations without mutating input', () => {
    const session = mergeProjectFragment(createEmptyProjectFragmentSession(), fragment('stage', stage()))
    expect(() => mergeProjectFragment(session, fragment('stage', stage()))).toThrow(/已加入/)
    expect(() =>
      mergeProjectFragment(session, fragment('other', sprite('潛水員'), { projectName: '其他作品' })),
    ).toThrow(/不同/)
    const withVar = mergeProjectFragment(
      session,
      fragment('vars-a', stage([], { variables: [{ name: '氧氣', value: 100 }] })),
    )
    const original = JSON.stringify(withVar.project)
    expect(() =>
      mergeProjectFragment(withVar, fragment('vars-b', stage([], { variables: [{ name: '氧氣', value: 50 }] }))),
    ).toThrow(/變數.*衝突/)
    expect(JSON.stringify(withVar.project)).toBe(original)
  })

  it('rejects a sprite that duplicates the Stage name', () => {
    const session = mergeProjectFragment(createEmptyProjectFragmentSession(), fragment('stage', stage()))
    expect(() => mergeProjectFragment(session, fragment('same-name', sprite('深海救援')))).toThrow(/不可使用相同名稱/)
  })
})
