import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(path) : entry.isFile() ? [path] : []
    }),
  )
  return nested.flat()
}

const files = (await collectFiles(dist))
  .filter((path) => !path.endsWith('.map') && !path.endsWith('.gitkeep') && !path.endsWith('/service-worker.js'))
  .sort()
if (
  !files.some((path) => path === join(dist, 'index.html')) ||
  !files.some((path) => path === join(dist, 'preview.html'))
) {
  throw new Error('Cannot generate the offline cache without both application entrypoints')
}

const manifest = []
const hash = createHash('sha256')
for (const path of files) {
  const bytes = await readFile(path)
  const relativePath = relative(dist, path).split(sep).join('/')
  manifest.push(`./${relativePath}`)
  hash.update(relativePath).update('\0').update(bytes)
}
const cacheName = `scratch-ai-bridge-${hash.digest('hex').slice(0, 20)}`
const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(manifest)};
const CACHE_PREFIX = 'scratch-ai-bridge-';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const scopePath = new URL('./', self.registration.scope).pathname;
  if (!new URL(request.url).pathname.startsWith(scopePath)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (error) {
      if (request.mode === 'navigate') {
        const appShell = await cache.match(new URL('./index.html', self.registration.scope));
        if (appShell) return appShell;
      }
      throw error;
    }
  })());
});
`

await writeFile(join(dist, 'service-worker.js'), source)
console.log(`Generated ${join(dist, 'service-worker.js')} with ${manifest.length} cached files (${cacheName})`)
