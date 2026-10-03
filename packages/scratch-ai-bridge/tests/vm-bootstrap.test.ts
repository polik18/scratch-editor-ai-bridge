import { describe, expect, it } from 'vitest'
import { initializeScratchVM } from '../src/bootstrap/vm-bootstrap'
import { getTargets } from '../src/scratch/vm'

describe('Scratch VM bootstrap', () => {
  it('initializes the official Scratch VM runtime behind the adapter', () => {
    const vm = initializeScratchVM()

    expect(getTargets(vm)).toEqual([])

    vm.quit()
  })
})
