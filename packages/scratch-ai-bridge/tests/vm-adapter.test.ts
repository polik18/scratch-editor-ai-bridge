import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getBlocks, getTargets, loadSb3, saveSb3 } from '../src/scratch/vm'

const commentsFixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/comments.sb3', import.meta.url))

describe('Scratch VM adapter', () => {
  it('rejects malformed input before passing it to Scratch VM', async () => {
    await expect(loadSb3(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('valid SB3 ZIP archive')
  })

  it('loads an SB3 and exposes project targets and blocks', async () => {
    const source = await readFile(commentsFixture)
    const vm = await loadSb3(source)

    try {
      const targets = getTargets(vm)
      const stage = targets.find((target) => target.isStage)
      const sprite = targets.find((target) => !target.isStage)

      expect(targets).toHaveLength(2)
      expect(stage?.getName()).toBe('Stage')
      expect(sprite?.getName()).toBe('Sprite1')
      expect(sprite && getBlocks(sprite).length).toBeGreaterThan(0)
    } finally {
      vm.quit()
    }
  })

  it('saves and reloads an SB3 through the official VM serializer', async () => {
    const source = await readFile(commentsFixture)
    const firstVm = await loadSb3(source)
    let generated: Blob

    try {
      generated = await saveSb3(firstVm)
      expect(generated.type).toBe('application/x.scratch.sb3')
      expect(generated.size).toBeGreaterThan(0)
    } finally {
      firstVm.quit()
    }

    const secondVm = await loadSb3(await generated.arrayBuffer())

    try {
      const targets = getTargets(secondVm)
      const sprite = targets.find((target) => !target.isStage)

      expect(targets).toHaveLength(2)
      expect(sprite && getBlocks(sprite).length).toBeGreaterThan(0)
    } finally {
      secondVm.quit()
    }
  })
})
