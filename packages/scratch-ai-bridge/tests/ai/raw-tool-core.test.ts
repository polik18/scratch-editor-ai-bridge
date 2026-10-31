import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { inspectRawProjectForAi, proposeRawLivePatch } from '../../src/core/ai/raw-tool-core'
import { importLosslessSb3, rawSb3Revision } from '../../src/core/archive'

describe('raw SB3 AI proposal', () => {
  it('validates candidate and rejects stale, cloud and unknown operations', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          { name: 'Cat', isStage: false, x: 0, variables: { cloud: ['☁ cloud', 2, true], score: ['score', 3] } },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const patch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: rawSb3Revision(project),
      summary: '移動角色',
      change: { kind: 'property', targetName: 'Cat', property: 'x', expected: 0, value: 20 },
    }
    expect(inspectRawProjectForAi(project)).toContain('score')
    expect(inspectRawProjectForAi(project)).not.toContain('☁ cloud')
    const candidate = proposeRawLivePatch(project, JSON.stringify(patch))
    expect(candidate.changes[0]).toContain('20')
    expect(() => proposeRawLivePatch(candidate.project, JSON.stringify(patch))).toThrow(/revision/)
    expect(() =>
      proposeRawLivePatch(
        project,
        JSON.stringify({
          ...patch,
          change: { kind: 'variable', targetName: 'Cat', variableId: 'cloud', expected: 2, value: 3 },
        }),
      ),
    ).toThrow(/non-cloud/)
    expect(() =>
      proposeRawLivePatch(project, JSON.stringify({ ...patch, change: { ...patch.change, property: '__proto__' } })),
    ).toThrow(/Unsupported/)
  })
})
