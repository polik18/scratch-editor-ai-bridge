import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createScratchAssetFetcher, type LibraryAssetFetcher } from '../core/visuals/library'
import { outputRoot } from './output-layout'

/**
 * Official library fetcher for the command line, with a disk cache in `output/cache/assets/`: an asset is
 * downloaded once and verified against its MD5 name, so later builds work offline.
 * @param cacheDirectory - Where verified assets are kept.
 * @returns Fetcher for `resolveLibraryAssets`; cache hits are listed in `cacheHits`.
 */
export const createCachedAssetFetcher = (
  cacheDirectory = path.join(outputRoot(), 'cache', 'assets'),
): LibraryAssetFetcher => {
  const network = createScratchAssetFetcher()
  const cacheHits = new Set<string>()
  return Object.assign(
    async (md5ext: string): Promise<Uint8Array> => {
      const cached = path.join(cacheDirectory, md5ext)
      try {
        const bytes = new Uint8Array(await readFile(cached))
        if (createHash('md5').update(bytes).digest('hex') === md5ext.slice(0, 32)) {
          cacheHits.add(md5ext)
          return bytes
        }
      } catch {
        // Not cached yet.
      }
      const bytes = await network(md5ext)
      await mkdir(cacheDirectory, { recursive: true })
      await writeFile(cached, bytes)
      return bytes
    },
    { cacheHits },
  )
}
