import { describe, expect, it } from 'vitest'
import { parseProcessPssBytes, sumProcessPssBytes } from '../../scripts/process-tree-memory.mjs'

describe('browser process-tree PSS parsing', () => {
  it('reads PSS in KiB and converts it to bytes', () => {
    expect(parseProcessPssBytes('Rss: 4096 kB\nPss: 1537 kB\nSwap: 0 kB\n')).toBe(1_573_888)
  })

  it('returns no measurement for missing or malformed PSS records', () => {
    expect(parseProcessPssBytes('Rss: 4096 kB\nSwap: 0 kB\n')).toBeUndefined()
    expect(parseProcessPssBytes('Pss: unknown kB\n')).toBeUndefined()
  })

  it('sums every process rollup and rejects partial snapshots', async () => {
    const reads = new Map([
      ['/proc/10/smaps_rollup', 'Pss: 10 kB\n'],
      ['/proc/11/smaps_rollup', 'Pss: 15 kB\n'],
    ])
    const readProcFile = async (path) => {
      const value = reads.get(path)
      if (value === undefined) throw new Error('process exited')
      return value
    }

    expect(await sumProcessPssBytes([10, 11], readProcFile)).toBe(25 * 1024)
    expect(await sumProcessPssBytes([10, 12], readProcFile)).toBeUndefined()
  })
})
