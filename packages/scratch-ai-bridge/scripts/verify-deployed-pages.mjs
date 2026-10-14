const [pageUrl] = process.argv.slice(2)

if (!pageUrl) throw new Error('Usage: node scripts/verify-deployed-pages.mjs <deployed-page-url>')

const page = new URL(pageUrl)
if (!['http:', 'https:'].includes(page.protocol)) throw new Error('Deployed Pages URL must use HTTP or HTTPS')

const fetchOk = async (url, label) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${url}`)
  return response
}

const response = await fetchOk(page, 'Deployed Pages entrypoint')
const servedPage = new URL(response.url)
if (servedPage.origin !== page.origin || !servedPage.pathname.startsWith(page.pathname)) {
  throw new Error(`Deployed Pages entrypoint redirected outside its site path: ${servedPage}`)
}
const html = await response.text()
if (!html.includes('<title>AI × Scratch 作品轉換器</title>')) {
  throw new Error(`Deployed Pages entrypoint does not contain the expected app title: ${servedPage}`)
}
if (!html.includes('<main id="app">'))
  throw new Error(`Deployed Pages entrypoint has no app mount point: ${servedPage}`)

const assetPaths = [
  ...new Set([...html.matchAll(/(?:src|href)="([^"?#]+\.(?:m?js|css))"/g)].map((match) => match[1])),
]
if (!assetPaths.some((asset) => asset.endsWith('.js')))
  throw new Error('Deployed entrypoint has no JavaScript bundle')
if (!assetPaths.some((asset) => asset.endsWith('.css'))) throw new Error('Deployed entrypoint has no stylesheet')

const assets = await Promise.all(
  assetPaths.map(async (assetPath) => {
    const assetUrl = new URL(assetPath, servedPage)
    if (assetUrl.origin !== servedPage.origin || !assetUrl.pathname.startsWith(servedPage.pathname)) {
      throw new Error(`Deployed asset escapes the Pages site path: ${assetUrl}`)
    }
    const assetResponse = await fetchOk(assetUrl, 'Deployed asset')
    const servedAsset = new URL(assetResponse.url)
    if (servedAsset.origin !== servedPage.origin || !servedAsset.pathname.startsWith(servedPage.pathname)) {
      throw new Error(`Deployed asset redirected outside the Pages site path: ${servedAsset}`)
    }
    const body = await assetResponse.arrayBuffer()
    if (body.byteLength === 0) throw new Error(`Deployed asset is empty: ${assetUrl}`)
    return { path: servedAsset.pathname, bytes: body.byteLength }
  }),
)

const serviceWorkerUrl = new URL('service-worker.js', servedPage)
if (serviceWorkerUrl.origin !== servedPage.origin || !serviceWorkerUrl.pathname.startsWith(servedPage.pathname)) {
  throw new Error(`Deployed service worker escapes the Pages site path: ${serviceWorkerUrl}`)
}
const serviceWorkerResponse = await fetchOk(serviceWorkerUrl, 'Deployed service worker')
const servedServiceWorker = new URL(serviceWorkerResponse.url)
if (
  servedServiceWorker.origin !== servedPage.origin ||
  !servedServiceWorker.pathname.startsWith(servedPage.pathname)
) {
  throw new Error(`Deployed service worker redirected outside the Pages site path: ${servedServiceWorker}`)
}
const serviceWorkerBytes = await serviceWorkerResponse.arrayBuffer()
if (serviceWorkerBytes.byteLength === 0) throw new Error(`Deployed service worker is empty: ${serviceWorkerUrl}`)
const serviceWorkerSource = new TextDecoder().decode(serviceWorkerBytes)
if (!serviceWorkerSource.includes('addAll') || !serviceWorkerSource.includes("request.mode === 'navigate'")) {
  throw new Error(`Deployed service worker does not contain the expected precache and offline navigation fallback`)
}
assets.push({ path: servedServiceWorker.pathname, bytes: serviceWorkerBytes.byteLength, type: 'service-worker' })

console.log(
  JSON.stringify(
    { page: servedPage.href, status: response.status, title: 'AI × Scratch 作品轉換器', assets },
    null,
    2,
  ),
)
