import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const scriptPath = fileURLToPath(import.meta.url)
const args = process.argv.slice(2)
const mebibyte = 1024 * 1024
const bytesFlag = args.indexOf('--bytes')
const assetBytes = bytesFlag >= 0 ? Number(args[bytesFlag + 1]) : Math.floor(Number(args.at(-1) ?? 255) * mebibyte)
if (!Number.isSafeInteger(assetBytes) || assetBytes < 1 || assetBytes >= 256 * mebibyte) {
  throw new Error('Asset size must be a positive whole byte count below 256 MiB')
}

if (args[0] === '--import-archive') {
  const archivePath = args[1]
  if (!archivePath) throw new Error('Missing generated archive path')
  const { createServer } = await import('vite')
  const vite = await createServer({
    configFile: 'vite.config.ts',
    appType: 'custom',
    server: { middlewareMode: true },
  })

  try {
    const { importLosslessSb3 } = await vite.ssrLoadModule('/src/core/archive/sb3-archive.ts')
    const archive = new Uint8Array(await readFile(archivePath))
    globalThis.gc?.()
    const memory = process.memoryUsage()
    let peakRss = memory.rss
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }, 5)
    let imported
    const startedAt = performance.now()
    try {
      imported = await importLosslessSb3(archive)
    } finally {
      clearInterval(sampler)
    }
    const importDurationMs = performance.now() - startedAt

    const entry = imported.entries.find(({ name }) => name === 'assets/near-limit.bin')
    if (entry?.bytes.byteLength !== assetBytes) {
      throw new Error(`Expected ${assetBytes} asset bytes; received ${entry?.bytes.byteLength ?? 'no entry'} bytes`)
    }

    console.log(
      JSON.stringify(
        {
          assetBytes,
          assetMiB: assetBytes / mebibyte,
          compressedArchiveBytes: archive.byteLength,
          archiveLimitBytes: 64 * 1024 * 1024,
          accepted: true,
          startRssBytes: memory.rss,
          peakRssBytes: peakRss,
          peakGrowthBytes: peakRss - memory.rss,
          importDurationMs,
          retainedHeapBytes: process.memoryUsage().heapUsed,
          retainedArrayBufferBytes: process.memoryUsage().arrayBuffers,
          assetSha256: entry.sha256,
        },
        null,
        2,
      ),
    )
    imported = null
  } finally {
    await vite.close()
  }
} else {
  const directory = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-memory-'))
  try {
    const zip = new JSZip()
    const asset = new Uint8Array(assetBytes)
    zip.file('project.json', '{}')
    zip.file('assets/near-limit.bin', asset, { compression: 'DEFLATE', compressionOptions: { level: 1 } })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    })
    const archivePath = join(directory, 'near-limit.sb3')
    await writeFile(archivePath, archive)

    const result = spawnSync(
      process.execPath,
      ['--expose-gc', scriptPath, '--import-archive', archivePath, '--bytes', String(assetBytes)],
      { stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status ?? 1
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
