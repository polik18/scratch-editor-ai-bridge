import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { fixtureByName } from '../compatibility/fixture-matrix'

describe('Text to Speech network boundary', () => {
  it('sends only the bounded speech text to the fixed Scratch synthesis endpoint', async () => {
    const originalFetch = globalThis.fetch
    const originalWindow = Reflect.get(globalThis, 'window') as Window | undefined
    const fetchWithTimeoutMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ status: 503 } as Response),
    )
    Reflect.set(globalThis, 'fetch', fetchWithTimeoutMock)
    let vm: { quit(): void } | undefined
    try {
      const { createVM, loadSb3 } = await import('../../src/scratch/vm')
      Reflect.set(globalThis, 'window', {
        AbortController: globalThis.AbortController,
        location: { hostname: 'localhost' },
      })
      vm = await createVM()
      await loadSb3(
        await readFile(fixtureByName('load-extensions/confirm-load/text2speech-simple-project.sb3').path),
        vm,
      )
      const runtime = (
        vm as unknown as {
          runtime: {
            getTargetForStage(): unknown
            getOpcodeFunction(opcode: string): (args: { WORDS: string }, util: { target: unknown }) => Promise<void>
          }
        }
      ).runtime
      const stage = runtime.getTargetForStage()
      const speakAndWait = runtime.getOpcodeFunction('text2speech_speakAndWait')
      expect(speakAndWait).toBeDefined()
      await speakAndWait({ WORDS: 'x'.repeat(200) }, { target: stage })

      expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchWithTimeoutMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
      const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      const request = new URL(requestUrl)
      expect(request.origin).toBe('https://synthesis-service.scratch.mit.edu')
      expect(request.pathname).toBe('/synth')
      expect(request.searchParams.get('text')).toBe('x'.repeat(128))
      expect(Object.keys(init)).toEqual(['signal'])
    } finally {
      vm?.quit()
      Reflect.set(globalThis, 'fetch', originalFetch)
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', originalWindow)
    }
  })
})
