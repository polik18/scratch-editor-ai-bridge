import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceDirectories = [
  fileURLToPath(new URL('../../scratch-render/dist/web/assets/', import.meta.url)),
  fileURLToPath(new URL('../../scratch-svg-renderer/dist/web/assets/', import.meta.url)),
]
const distAssets = join(appRoot, 'dist/assets')
const sandboxAssets = new Map()
for (const directory of sourceDirectories) {
  for (const filename of await readdir(directory)) {
    if (/^(runner|measure-svg)\.[a-f\d]+\.js$/.test(filename)) {
      sandboxAssets.set(filename, join(directory, filename))
    }
  }
}
if (
  !['runner', 'measure-svg'].every((prefix) =>
    [...sandboxAssets.keys()].some((filename) => filename.startsWith(`${prefix}.`)),
  )
) {
  throw new Error('Scratch renderer builds are missing the SVG sandbox runner assets')
}

await mkdir(distAssets, { recursive: true })
for (const [filename, source] of sandboxAssets) {
  await copyFile(source, join(distAssets, filename))
}
