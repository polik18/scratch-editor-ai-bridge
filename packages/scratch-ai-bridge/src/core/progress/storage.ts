import { parseProgressTargets } from './target-state'

export interface ProgressSave {
  readonly format: 'scratch-ai-bridge/progress'
  readonly version: 1
  readonly projectRevision: string
  readonly slot: string
  readonly savedAt: string
  readonly variables: unknown
  readonly targets?: unknown
}

/**
 * Check an untrusted imported save before adding it to local storage.
 * @param value Parsed save data.
 * @param revision Expected project content revision.
 * @param slot Destination slot.
 * @returns Validated save bound to the selected slot.
 */
export const parseProgressSave = (value: unknown, revision: string, slot: string): ProgressSave => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('存檔格式無效。')
  const save = value as Record<string, unknown>
  if (
    save.format !== 'scratch-ai-bridge/progress' ||
    save.version !== 1 ||
    save.projectRevision !== revision ||
    typeof save.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(save.savedAt)) ||
    !Array.isArray(save.variables) ||
    save.variables.length > 200 ||
    new TextEncoder().encode(JSON.stringify(save)).byteLength > 160 * 1024
  )
    throw new Error('存檔格式無效、過大或與作品版本不符。')
  const seen = new Set<string>()
  const scalar = (item: unknown): boolean =>
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000_000) ||
    (typeof item === 'string' && item.length <= 512)
  for (const item of save.variables as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('存檔項目無效。')
    const entry = item as Record<string, unknown>
    if (
      Object.keys(entry).some((key) => !['targetName', 'isStage', 'id', 'name', 'type', 'value'].includes(key)) ||
      typeof entry.targetName !== 'string' ||
      typeof entry.isStage !== 'boolean' ||
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      (entry.type !== '' && entry.type !== 'list')
    )
      throw new Error('存檔項目欄位無效。')
    const key = JSON.stringify([entry.targetName, entry.id])
    if (seen.has(key)) throw new Error('存檔含有重複項目。')
    seen.add(key)
    if (
      entry.type === ''
        ? !scalar(entry.value)
        : !Array.isArray(entry.value) || entry.value.length > 1000 || !entry.value.every(scalar)
    )
      throw new Error('存檔項目值無效。')
  }
  const targets = save.targets === undefined ? undefined : parseProgressTargets(save.targets)
  return {
    format: 'scratch-ai-bridge/progress',
    version: 1,
    projectRevision: revision,
    slot,
    savedAt: save.savedAt,
    variables: save.variables,
    ...(targets === undefined ? {} : { targets }),
  }
}

const openProgressDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('scratch-ai-bridge-progress', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('saves')
    }
    request.onerror = () => reject(request.error ?? new Error('無法開啟本機存檔。'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('本機存檔資料庫被其他頁面阻擋。'))
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) db.close()
      else {
        db.onversionchange = () => db.close()
        resolve(db)
      }
    }
  })

const saveKey = (revision: string, slot: string): string => {
  if (!/^sha256:[a-f0-9]{64}$/.test(revision) || !slot.trim() || slot.length > 40)
    throw new Error('作品版本或存檔名稱無效。')
  return JSON.stringify([revision, slot])
}

/**
 * Access one slot and wait for the IndexedDB transaction to finish.
 * @param revision Exact project content revision.
 * @param slot User-selected slot name.
 * @param operation Requested operation.
 * @param save Value for a write operation.
 * @param expected Previously observed value for conditional writes and deletion.
 * @returns The stored value for reads.
 */
export const accessProgressSave = async (
  revision: string,
  slot: string,
  operation: 'get' | 'put' | 'delete',
  save?: ProgressSave,
  expected?: unknown,
): Promise<unknown> => {
  const key = saveKey(revision, slot)
  if (
    operation === 'put' &&
    (save?.projectRevision !== revision ||
      save.slot !== slot ||
      new TextEncoder().encode(JSON.stringify(save)).byteLength > 160 * 1024)
  )
    throw new Error('存檔資料無效或超過上限。')
  const db = await openProgressDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('saves', operation === 'get' ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('saves')
      const request = store.get(key)
      let result: unknown
      let conflict = false
      request.onsuccess = () => {
        result = request.result as unknown
        if (operation !== 'get') {
          let matches = false
          try {
            matches = JSON.stringify(result) === JSON.stringify(expected)
          } catch {
            matches = false
          }
          if (!matches) {
            conflict = true
            transaction.abort()
            return
          }
          if (operation === 'put') store.put(save, key)
          else store.delete(key)
        }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error ?? new Error('本機存檔操作失敗。'))
      transaction.onabort = () =>
        reject(
          conflict
            ? new Error('存檔已被其他頁面變更，請重新操作。')
            : (transaction.error ?? new Error('本機存檔操作已取消。')),
        )
    })
  } finally {
    db.close()
  }
}
