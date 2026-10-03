import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import parseScratchProject from '../src/scratch/csp-scratch-parser'

const commentsFixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/comments.sb3', import.meta.url))

const parse = (input: string | Uint8Array): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    parseScratchProject(input, false, (error, result) => {
      if (error) {
        reject(
          error instanceof Error ? error : new Error('CSP parser failed with a non-Error value', { cause: error }),
        )
        return
      }
      if (!result) {
        reject(new Error('CSP parser returned no result'))
        return
      }
      resolve(result[0])
    })
  })

describe('CSP-compatible Scratch parser', () => {
  it('loads an official SB3 fixture with precompiled schemas', async () => {
    const project = await parse(await readFile(commentsFixture))

    expect(project.projectVersion).toBe(3)
    expect(project.targets).toBeInstanceOf(Array)
  })

  it('rejects project JSON that does not satisfy the official SB3 schema', async () => {
    await expect(parse('{}')).rejects.toMatchObject({
      validationError: 'Could not parse as a valid SB3 project.',
    })
  })
})
