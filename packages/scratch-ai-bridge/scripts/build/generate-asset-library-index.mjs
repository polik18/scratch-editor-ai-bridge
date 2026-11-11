// Builds a compact index of the official Scratch asset library from the scratch-gui catalog files.
// Only names, tags and asset metadata are kept; asset bytes are fetched on demand from the Scratch asset server.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const libraryRoot = path.resolve(packageRoot, '../../scratch-gui/src/lib/libraries')
const outputPath = path.join(packageRoot, 'src/core/visuals/library-index.json')

const read = async (name) => JSON.parse(await readFile(path.join(libraryRoot, name), 'utf8'))

const costume = (entry) => [
  entry.name,
  entry.md5ext,
  entry.rotationCenterX,
  entry.rotationCenterY,
  entry.bitmapResolution ?? 1,
]
const sound = (entry) => [entry.name, entry.md5ext, entry.rate, entry.sampleCount]
const tags = (entry) => [...new Set((entry.tags ?? []).map((tag) => String(tag).toLowerCase()))]

const [sprites, backdrops, sounds] = await Promise.all([
  read('sprites.json'),
  read('backdrops.json'),
  read('sounds.json'),
])

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
  `Wrote ${path.relative(packageRoot, outputPath)}: ${index.sprites.length} sprites, ${index.backdrops.length} backdrops, ${index.sounds.length} sounds`,
)
