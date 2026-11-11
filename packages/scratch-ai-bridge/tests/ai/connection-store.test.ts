import { describe, expect, it } from 'vitest'
import { clearAiConnection, loadAiConnection, saveAiConnection } from '../../src/core/ai/connection-store'
import { listOpenAiCompatibleModels } from '../../src/core/ai/openai-compatible'

const memory = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

describe('remembered local model connection', () => {
  it('stores, reads back and clears the connection', () => {
    const storage = memory()
    const settings = { baseUrl: 'http://127.0.0.1:8000/v1', model: 'm', apiKey: 'k' }
    expect(saveAiConnection(storage, settings)).toBe(true)
    expect(loadAiConnection(storage)).toEqual(settings)
    clearAiConnection(storage)
    expect(loadAiConnection(storage)).toBeUndefined()
  })

  it('works without storage and ignores broken data', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(saveAiConnection(throwing, { baseUrl: 'x', model: 'y', apiKey: '' })).toBe(false)
    expect(loadAiConnection(throwing)).toBeUndefined()
    expect(() => clearAiConnection(throwing)).not.toThrow()
    expect(loadAiConnection(undefined)).toBeUndefined()
    const broken = memory()
    broken.setItem('scratch-ai-bridge:local-ai-connection', '{not json')
    expect(loadAiConnection(broken)).toBeUndefined()
  })
})

describe('listOpenAiCompatibleModels', () => {
  it('reads model IDs from the models endpoint with the API key', async () => {
    let seen: { url: string; auth: string | null } | undefined
    const fetchImpl: typeof fetch = (url, init) => {
      seen = {
        url: url instanceof Request ? url.url : url.toString(),
        auth: new Headers(init?.headers).get('Authorization'),
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })))
    }
    await expect(
      listOpenAiCompatibleModels({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'k', fetchImpl }),
    ).resolves.toEqual(['a', 'b'])
    expect(seen).toEqual({ url: 'http://127.0.0.1:8000/v1/models', auth: 'Bearer k' })
  })

  it('explains an unreachable service and a refused key in plain words', async () => {
    const down: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    await expect(listOpenAiCompatibleModels({ baseUrl: 'http://127.0.0.1:9/v1', fetchImpl: down })).rejects.toThrow(
      /連不上/,
    )
    const refused: typeof fetch = () => Promise.resolve(new Response('no', { status: 401 }))
    await expect(
      listOpenAiCompatibleModels({ baseUrl: 'http://127.0.0.1:8000/v1', fetchImpl: refused }),
    ).rejects.toThrow(/API key 不正確/)
  })
})
