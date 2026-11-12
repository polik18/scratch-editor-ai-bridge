import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { fetchPublicScratchProject, parseScratchProjectId } from '../../src/scratch/public-project'

describe('public Scratch project fetcher', () => {
  it('accepts public project URLs and numeric IDs only', () => {
    expect(parseScratchProjectId('123456')).toBe('123456')
    expect(parseScratchProjectId('https://scratch.mit.edu/projects/123456/')).toBe('123456')
    expect(() => parseScratchProjectId('https://example.com/projects/123456')).toThrow()
    expect(() => parseScratchProjectId('https://scratch.mit.edu/users/example')).toThrow()
  })

  it('packages project JSON, referenced assets, and author metadata without login', async () => {
    const project = {
      targets: [
        {
          isStage: true,
          costumes: [{ md5ext: 'a'.repeat(32) + '.svg' }],
          sounds: [],
        },
      ],
    }
    const asset = '<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg" />'
    const fetchImpl: typeof fetch = (input) =>
      Promise.resolve().then(() => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.startsWith('https://api.scratch.mit.edu/projects/123456'))
          return new Response(
            JSON.stringify({
              id: 123456,
              title: '公開測試作品',
              author: { username: 'student' },
              project_token: 'token',
              instructions: '按綠旗開始。',
              description: '測試備註',
            }),
            { status: 200 },
          )
        if (url.startsWith('https://projects.scratch.mit.edu/123456'))
          return new Response(JSON.stringify(project), { status: 200 })
        if (url.includes('/internalapi/asset/')) return new Response(asset, { status: 200 })
        return new Response('not found', { status: 404 })
      })
    const result = await fetchPublicScratchProject('123456', fetchImpl)
    expect(result.title).toBe('公開測試作品')
    expect(result.author).toBe('student')
    expect(result.instructions).toBe('按綠旗開始。')
    const archive = await JSZip.loadAsync(await result.blob.arrayBuffer())
    expect(await archive.file('project.json')?.async('string')).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg')
    expect(await archive.file('a'.repeat(32) + '.svg')?.async('string')).toBe(asset)
  })
})
