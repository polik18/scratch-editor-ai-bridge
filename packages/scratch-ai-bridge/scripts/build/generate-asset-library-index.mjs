// Builds a compact index of the official Scratch asset library from the scratch-gui catalog files.
// Only names, tags and asset metadata are kept; asset bytes are fetched on demand from the Scratch asset server.
// With --sizes, every costume is downloaded once (cached in <repo>/output/cache/assets) to record its width and
// height in stage pixels, so tools can scale a costume to fit without downloading it first.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const libraryRoot = path.resolve(packageRoot, '../scratch-gui/src/lib/libraries')
const outputPath = path.join(packageRoot, 'src/core/visuals/library-index.json')

const read = async (name) => JSON.parse(await readFile(path.join(libraryRoot, name), 'utf8'))
const cacheDirectory = path.resolve(packageRoot, '../../output/cache/assets')
const withSizes = process.argv.includes('--sizes')

const download = async (md5ext) => {
  const cached = path.join(cacheDirectory, md5ext)
  try {
    const bytes = await readFile(cached)
    if (createHash('md5').update(bytes).digest('hex') === md5ext.slice(0, 32)) return bytes
  } catch {
    // Not cached yet.
  }
  const response = await fetch(`https://assets.scratch.mit.edu/internalapi/asset/${md5ext}/get/`)
  if (!response.ok) throw new Error(`${md5ext}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('md5').update(bytes).digest('hex') !== md5ext.slice(0, 32))
    throw new Error(`${md5ext}: MD5 mismatch`)
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(cached, bytes)
  return bytes
}

/**
 * Width and height in stage pixels: SVG width/height (or viewBox), PNG size divided by its bitmap resolution.
 * @param {string} md5ext - Asset file name.
 * @param {number} resolution - Bitmap resolution from the catalog (2 for most PNGs).
 * @returns {Promise<number[] | undefined>} [width, height], rounded.
 */
const measure = async (md5ext, resolution) => {
  const bytes = await download(md5ext)
  if (md5ext.endsWith('.png'))
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)].map((v) => Math.round(v / resolution))
  const text = bytes.toString('utf8', 0, Math.min(bytes.length, 4000))
  const number = (name) => Number(new RegExp(`<svg[^>]*\\s${name}="([0-9.]+)`).exec(text)?.[1])
  let [width, height] = [number('width'), number('height')]
  if (!(width > 0 && height > 0)) {
    const box = /viewBox="[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)"/.exec(text)
    ;[width, height] = [Number(box?.[1]), Number(box?.[2])]
  }
  return width > 0 && height > 0 ? [Math.round(width), Math.round(height)] : undefined
}

const sizes = new Map()
const measureAll = async (entries) => {
  const queue = [...entries]
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      try {
        const size = await measure(entry.md5ext, entry.bitmapResolution ?? 1)
        if (size) sizes.set(entry.md5ext, size)
      } catch (error) {
        console.warn(`size skipped: ${error.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
}

const costume = (entry) => [
  entry.name,
  entry.md5ext,
  entry.rotationCenterX,
  entry.rotationCenterY,
  entry.bitmapResolution ?? 1,
  ...(sizes.get(entry.md5ext) ?? []),
]
const sound = (entry) => [entry.name, entry.md5ext, entry.rate, entry.sampleCount]
const tags = (entry) => [...new Set((entry.tags ?? []).map((tag) => String(tag).toLowerCase()))]

const [sprites, backdrops, sounds] = await Promise.all([
  read('sprites.json'),
  read('backdrops.json'),
  read('sounds.json'),
])

if (withSizes) await measureAll([...sprites.flatMap((entry) => entry.costumes), ...backdrops])

const index = {
  source: 'scratch-gui/src/lib/libraries',
  sprites: sprites.map((entry) => ({
    name: entry.name.trim(),
    tags: tags(entry),
    costumes: entry.costumes.map(costume),
    sounds: entry.sounds.map(sound),
  })),
  backdrops: backdrops.map((entry) => ({ name: entry.name.trim(), tags: tags(entry), costume: costume(entry) })),
  sounds: sounds.map((entry) => ({ name: entry.name.trim(), tags: tags(entry), sound: sound(entry) })),
}

await writeFile(outputPath, `${JSON.stringify(index)}\n`)
console.log(
  `Wrote ${path.relative(packageRoot, outputPath)}: ${index.sprites.length} sprites, ${index.backdrops.length} backdrops, ${index.sounds.length} sounds${withSizes ? `, ${sizes.size} costume sizes` : ''}`,
)
