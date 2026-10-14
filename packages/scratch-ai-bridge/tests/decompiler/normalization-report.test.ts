import { sha256 } from '@noble/hashes/sha2'
import { describe, expect, it } from 'vitest'
import type { RawSb3Project } from '../../src/core/archive'
import { createVmNormalizationReport } from '../../src/core/decompiler/normalization-report'

const rawProject = (
  projectJson: Record<string, unknown>,
  entrySpecs: readonly { name: string; sha256: string }[],
  archiveCommentBytes?: Uint8Array,
): RawSb3Project => ({
  projectEntryName: 'project.json',
  projectJsonBytes: new TextEncoder().encode(JSON.stringify(projectJson)),
  projectJson,
  warnings: [],
  ...(archiveCommentBytes ? { archiveCommentBytes } : {}),
  entries: entrySpecs.map(({ name, sha256 }, centralDirectoryIndex) => ({
    centralDirectoryIndex,
    name,
    filenameBytes: new TextEncoder().encode(name),
    filenameEncoding: 'utf-8',
    isDirectory: false,
    bytes: new Uint8Array(),
    sha256,
    compressionMethod: 0,
    crc32: '00000000',
    compressedSize: 0,
    uncompressedSize: 0,
    flags: 0,
    externalAttributes: 0,
    localHeaderOffset: 0,
    date: new Date(0).toISOString(),
  })),
})

describe('VM normalization report', () => {
  it('reports JSON pointer leaf changes and archive entry hash changes without including values', () => {
    const source = rawProject({ keep: {}, 'odd/key~': { before: 1, deleted: false }, list: ['old', 2] }, [
      { name: 'project.json', sha256: 'source-project' },
      { name: 'same.svg', sha256: 'same-hash' },
      { name: 'changed.wav', sha256: 'old-hash' },
      { name: 'removed.bin', sha256: 'removed-hash' },
    ])
    const normalized = rawProject({ keep: {}, 'odd/key~': { after: 1 }, list: ['new', 2, 3] }, [
      { name: 'project.json', sha256: 'normalized-project' },
      { name: 'same.svg', sha256: 'same-hash' },
      { name: 'changed.wav', sha256: 'new-hash' },
      { name: 'added.dat', sha256: 'added-hash' },
    ])

    const report = createVmNormalizationReport(source, normalized)
    expect(report.format).toBe('scratch-ai-bridge/vm-normalization-report')
    expect(report.projectJsonChanges).toEqual([
      { path: '/list/0', kind: 'replaced', beforeType: 'string', afterType: 'string' },
      { path: '/list/2', kind: 'added', beforeType: null, afterType: 'number' },
      { path: '/odd~1key~0/after', kind: 'added', beforeType: null, afterType: 'number' },
      { path: '/odd~1key~0/before', kind: 'removed', beforeType: 'number', afterType: null },
      { path: '/odd~1key~0/deleted', kind: 'removed', beforeType: 'boolean', afterType: null },
    ])
    expect(report.archiveEntryChanges).toEqual([
      { name: 'added.dat', kind: 'added', sourceSha256: null, normalizedSha256: 'added-hash' },
      { name: 'changed.wav', kind: 'content-changed', sourceSha256: 'old-hash', normalizedSha256: 'new-hash' },
      {
        name: 'project.json',
        kind: 'content-changed',
        sourceSha256: 'source-project',
        normalizedSha256: 'normalized-project',
      },
      { name: 'removed.bin', kind: 'removed', sourceSha256: 'removed-hash', normalizedSha256: null },
      { name: 'same.svg', kind: 'unchanged', sourceSha256: 'same-hash', normalizedSha256: 'same-hash' },
    ])
    expect(JSON.stringify(report)).not.toContain('"value"')
  })

  it('does not report identical empty objects as changes', () => {
    const source = rawProject({ empty: {}, array: [] }, [{ name: 'project.json', sha256: 'hash' }])
    const normalized = rawProject({ empty: {}, array: [] }, [{ name: 'project.json', sha256: 'hash' }])
    expect(createVmNormalizationReport(source, normalized).projectJsonChanges).toEqual([])
  })

  it('reports ZIP archive comment removal without exposing the comment bytes', () => {
    const comment = new TextEncoder().encode('private archive note')
    const source = rawProject({ keep: true }, [{ name: 'project.json', sha256: 'project' }], comment)
    const normalized = rawProject({ keep: true }, [{ name: 'project.json', sha256: 'project' }])
    const hash = Array.from(sha256(comment), (byte) => byte.toString(16).padStart(2, '0')).join('')

    const report = createVmNormalizationReport(source, normalized)
    expect(report.archiveCommentChange).toEqual({ kind: 'removed', sourceSha256: hash, normalizedSha256: null })
    expect(JSON.stringify(report)).not.toContain('private archive note')
  })

  it('reports seeded nested JSON changes with exact escaped pointers', () => {
    let state = 0x7e570123
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1')

    for (let sample = 0; sample < 128; sample += 1) {
      const key = `vendor/${nextRandom().toString(16)}~${sample}`
      const source = rawProject(
        { [key]: { nested: { remove: sample, replace: `before-${sample}` }, values: [sample, `old-${sample}`] } },
        [{ name: 'project.json', sha256: `source-${sample}` }],
      )
      const normalized = rawProject(
        { [key]: { nested: { add: `added-${sample}`, replace: sample }, values: [sample, `new-${sample}`, true] } },
        [{ name: 'project.json', sha256: `normalized-${sample}` }],
      )
      const prefix = `/${escape(key)}`

      expect(createVmNormalizationReport(source, normalized).projectJsonChanges, `seed ${sample}`).toEqual([
        { path: `${prefix}/nested/add`, kind: 'added', beforeType: null, afterType: 'string' },
        { path: `${prefix}/nested/remove`, kind: 'removed', beforeType: 'number', afterType: null },
        { path: `${prefix}/nested/replace`, kind: 'replaced', beforeType: 'string', afterType: 'number' },
        { path: `${prefix}/values/1`, kind: 'replaced', beforeType: 'string', afterType: 'string' },
        { path: `${prefix}/values/2`, kind: 'added', beforeType: null, afterType: 'boolean' },
      ])
    }
  })
})
