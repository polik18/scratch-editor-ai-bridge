import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const limits = {
  app: { raw: 5 * 1024 * 1024, gzip: 1.75 * 1024 * 1024 },
  renderer: { raw: 2.5 * 1024 * 1024, gzip: 0.95 * 1024 * 1024 },
  sandbox: { raw: 128 * 1024, gzip: 64 * 1024 },
  js: { raw: 7.5 * 1024 * 1024, gzip: 2.8 * 1024 * 1024 },
  css: { raw: 256 * 1024, gzip: 64 * 1024 },
}

const collect = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? collect(path) : [path]
    }),
  )
  return nested.flat()
}

const files = await collect(dist)
const totals = Object.fromEntries(Object.keys(limits).map((key) => [key, { raw: 0, gzip: 0, files: 0 }]))
for (const path of files) {
  const type = path.endsWith('.js') ? 'js' : path.endsWith('.css') ? 'css' : undefined
  if (!type) continue
  const bytes = await readFile(path)
  const name = path.split('/').pop()
  const group =
    type === 'css'
      ? 'css'
      : /^(runner|measure-svg)\./.test(name)
        ? 'sandbox'
        : /^scratch-render-/.test(name)
          ? 'renderer'
          : 'app'
  for (const bucket of type === 'js' ? [group, 'js'] : ['css']) {
    totals[bucket].raw += bytes.byteLength
    totals[bucket].gzip += gzipSync(bytes, { level: 9 }).byteLength
    totals[bucket].files += 1
  }
}

const format = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`
let failed = false
for (const type of ['app', 'renderer', 'sandbox', 'js', 'css']) {
  const actual = totals[type]
  const limit = limits[type]
  if (actual.files === 0) throw new Error(`No production ${type.toUpperCase()} files found in ${dist}`)
  console.log(
    `${type.toUpperCase()}: ${actual.files} file(s), ${format(actual.raw)} raw / ${format(actual.gzip)} gzip; ` +
      `budget ${format(limit.raw)} raw / ${format(limit.gzip)} gzip`,
  )
  if (actual.raw > limit.raw || actual.gzip > limit.gzip) failed = true
}

if (failed) process.exitCode = 1
