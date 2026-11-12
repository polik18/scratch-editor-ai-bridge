import JSZip from 'jszip'

const SCRATCH_HOSTS = new Set(['scratch.mit.edu', 'www.scratch.mit.edu'])
const PROJECT_ID = /^\d{1,20}$/
const MAX_ASSETS = 2_048
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

export interface PublicScratchProject {
  readonly id: string
  readonly fileName: string
  readonly blob: Blob
  readonly title: string
  readonly author?: string
  readonly url: string
  readonly license: 'CC BY-SA 2.0'
  readonly instructions?: string
  readonly notes?: string
}

interface ScratchMetadata {
  readonly id?: unknown
  readonly title?: unknown
  readonly author?: { readonly username?: unknown }
  readonly project_token?: unknown
  readonly instructions?: unknown
  readonly description?: unknown
}

interface ScratchProjectJson {
  readonly targets?: unknown
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

const json = async (response: Response, label: string): Promise<unknown> => {
  if (!response.ok) throw new Error(`${label} 讀取失敗（HTTP ${response.status}）。`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${label} 回傳的不是有效 JSON。`)
  }
}

const bytes = async (response: Response, label: string): Promise<Uint8Array> => {
  if (!response.ok) throw new Error(`${label} 下載失敗（HTTP ${response.status}）。`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Parse a public Scratch project URL or numeric project ID.
 * @param input URL or ID supplied by the student.
 * @returns Numeric Scratch project ID.
 */
export const parseScratchProjectId = (input: string): string => {
  const source = input.trim()
  if (PROJECT_ID.test(source)) return source
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new Error('請貼上 Scratch 公開作品網址，或輸入數字作品編號。')
  }
  if (url.protocol !== 'https:' || !SCRATCH_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password)
    throw new Error('只接受 https://scratch.mit.edu/projects/作品編號/ 的公開作品網址。')
  const match = /^\/projects\/(\d{1,20})(?:\/|$)/.exec(url.pathname)
  if (!match?.[1]) throw new Error('網址裡找不到 Scratch 作品編號。請貼上作品頁網址。')
  return match[1]
}

const uniqueAssetNames = (project: ScratchProjectJson): string[] => {
  if (!Array.isArray(project.targets)) throw new Error('Scratch 回傳的作品不是 Scratch 3 格式。')
  const names = new Set<string>()
  for (const target of project.targets) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) continue
    for (const key of ['costumes', 'sounds']) {
      const assets = (target as Record<string, unknown>)[key]
      if (!Array.isArray(assets)) continue
      for (const asset of assets) {
        if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) continue
        const name = (asset as { md5ext?: unknown }).md5ext
        if (typeof name === 'string' && /^[a-f0-9]{32}\.[a-z0-9]+$/i.test(name)) names.add(name)
      }
    }
  }
  if (names.size > MAX_ASSETS) throw new Error(`作品素材太多（${names.size} 個），為了安全沒有直接下載。`)
  return [...names]
}

/**
 * Fetch a public Scratch project and package its metadata, project JSON, and referenced assets locally.
 * No Scratch login or account mutation is used.
 * @param input URL or numeric project ID.
 * @param fetchImpl Fetch implementation, replaceable for tests.
 * @returns A local SB3 blob and author metadata for the reader.
 */
export const fetchPublicScratchProject = async (
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicScratchProject> => {
  const id = parseScratchProjectId(input)
  const metadataResponse = await fetchImpl(`https://api.scratch.mit.edu/projects/${id}`, {
    headers: { Accept: 'application/json' },
  })
  const metadata = (await json(metadataResponse, 'Scratch 作品資料')) as ScratchMetadata
  const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : `Scratch ${id}`
  const token = typeof metadata.project_token === 'string' ? metadata.project_token : ''
  const projectUrl = `https://projects.scratch.mit.edu/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const projectResponse = await fetchImpl(projectUrl, { headers: { Accept: 'application/json' } })
  const project = (await json(projectResponse, 'Scratch 作品內容')) as ScratchProjectJson
  const assetNames = uniqueAssetNames(project)
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(project))
  for (const [index, name] of assetNames.entries()) {
    if (index > 0) await sleep(50)
    const response = await fetchImpl(`https://assets.scratch.mit.edu/internalapi/asset/${name}/get/`)
    zip.file(name, await bytes(response, `Scratch 素材 ${name}`))
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  if (blob.size > MAX_ARCHIVE_BYTES) throw new Error('下載後的作品超過 64 MiB 上限，沒有載入。')
  return {
    id,
    fileName: `${id}-${title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'scratch-project'}.sb3`,
    blob,
    title,
    ...(typeof metadata.author?.username === 'string' ? { author: metadata.author.username } : {}),
    url: `https://scratch.mit.edu/projects/${id}/`,
    license: 'CC BY-SA 2.0',
    ...(typeof metadata.instructions === 'string' && metadata.instructions.trim()
      ? { instructions: metadata.instructions }
      : {}),
    ...(typeof metadata.description === 'string' && metadata.description.trim()
      ? { notes: metadata.description }
      : {}),
  }
}
