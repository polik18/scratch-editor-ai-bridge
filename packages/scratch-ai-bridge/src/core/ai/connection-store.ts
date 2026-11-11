/**
 * The local model connection (address, model and API key), kept in the browser only when the user ticks
 * 「記住在這台電腦」. Storage can be missing or throw (private windows, blocked site data), so every access is
 * guarded and the page works the same without it.
 */

export interface AiConnectionSettings {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
}

export type ConnectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_KEY = 'scratch-ai-bridge:local-ai-connection'

/**
 * @param storage - Usually `localStorage`; undefined when the browser offers none.
 * @returns The remembered connection, or undefined when nothing valid is stored.
 */
export const loadAiConnection = (storage: ConnectionStorage | undefined): AiConnectionSettings | undefined => {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return undefined
    const { baseUrl, model, apiKey } = value as Record<string, unknown>
    if (typeof baseUrl !== 'string' || typeof model !== 'string') return undefined
    return { baseUrl, model, apiKey: typeof apiKey === 'string' ? apiKey : '' }
  } catch {
    return undefined
  }
}

/**
 * @param storage - Usually `localStorage`.
 * @param settings - What to remember.
 * @returns Whether it was stored.
 */
export const saveAiConnection = (storage: ConnectionStorage | undefined, settings: AiConnectionSettings): boolean => {
  try {
    if (!storage) return false
    storage.setItem(STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

/**
 * @param storage - Usually `localStorage`.
 */
export const clearAiConnection = (storage: ConnectionStorage | undefined): void => {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing was stored, or the browser blocks site data; either way nothing is remembered.
  }
}

/**
 * Who else can read a remembered API key on this site, in plain words. Every project on a GitHub Pages user site
 * shares one origin, so their pages (and any analytics they load) can read this page's storage.
 * @param hostname - `location.hostname` of the page.
 * @returns The warning shown next to 「也記住 API key」.
 */
export const apiKeyStorageWarning = (hostname: string): string =>
  hostname.endsWith('.github.io')
    ? `${hostname} 底下的其他網頁（包含它們載入的 Google 統計等程式）也讀得到存起來的 key，所以預設不記。公用電腦不要勾。`
    : '存起來的 key，用這台電腦、這個瀏覽器的人都看得到。公用電腦不要勾。'
