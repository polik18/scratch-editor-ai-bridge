import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

export const parseProcessPssBytes = (rollup) => {
  const pssKb = /^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1]
  return pssKb === undefined ? undefined : Number(pssKb) * 1024
}

export const sumProcessPssBytes = async (processIds, readProcFile = readFile) => {
  const values = await Promise.all(
    processIds.map(async (pid) => {
      try {
        return parseProcessPssBytes(await readProcFile(`/proc/${pid}/smaps_rollup`, 'utf8'))
      } catch {
        return undefined
      }
    }),
  )
  return values.every((value) => value !== undefined) ? values.reduce((total, value) => total + value, 0) : undefined
}

const readProcessTreeMemory = async (rootPid) =>
  new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' }, async (error, stdout) => {
      if (error) return resolve(undefined)
      const processes = new Map()
      for (const line of stdout.split('\n')) {
        const [pidText, parentText, rssText, command] = line.trim().split(/\s+/)
        const pid = Number(pidText)
        const parentPid = Number(parentText)
        const rssKb = Number(rssText)
        if (command !== 'ps' && Number.isInteger(pid) && Number.isInteger(parentPid) && Number.isFinite(rssKb)) {
          processes.set(pid, { parentPid, rssKb })
        }
      }
      if (!processes.has(rootPid)) return resolve(undefined)
      const pids = new Set([rootPid])
      let changed = true
      while (changed) {
        changed = false
        for (const [pid, child] of processes) {
          if (!pids.has(pid) && pids.has(child.parentPid)) {
            pids.add(pid)
            changed = true
          }
        }
      }
      const processIds = [...pids]
      const rssSumBytes = processIds.reduce((total, pid) => total + processes.get(pid).rssKb * 1024, 0)
      const pssSumBytes = process.platform === 'linux' ? await sumProcessPssBytes(processIds) : undefined
      resolve({ rssSumBytes, ...(pssSumBytes === undefined ? {} : { pssSumBytes }) })
    })
  })

export const sampleProcessTreePeakMemory = (rootPid) => {
  if (!rootPid || process.platform === 'win32') return undefined
  const sample = { active: true, rssPeakBytes: 0, rssSamples: 0, pssPeakBytes: 0, pssSamples: 0 }
  const sampler = (async () => {
    while (sample.active) {
      const memory = await readProcessTreeMemory(rootPid)
      if (memory !== undefined) {
        sample.rssPeakBytes = Math.max(sample.rssPeakBytes, memory.rssSumBytes)
        sample.rssSamples += 1
        if (memory.pssSumBytes !== undefined) {
          sample.pssPeakBytes = Math.max(sample.pssPeakBytes, memory.pssSumBytes)
          sample.pssSamples += 1
        }
      }
      if (sample.active) await new Promise((resolve) => setTimeout(resolve, 40))
    }
  })()
  return {
    stop: async () => {
      sample.active = false
      await sampler
      return sample.rssSamples > 0
        ? {
            rssPeakBytes: sample.rssPeakBytes,
            rssSamples: sample.rssSamples,
            ...(sample.pssSamples > 0 ? { pssPeakBytes: sample.pssPeakBytes, pssSamples: sample.pssSamples } : {}),
          }
        : undefined
    },
  }
}
