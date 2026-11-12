import { describe, expect, it } from 'vitest'
import { requestOpenAiCompatiblePatch, requestOpenAiCompatibleText } from '../../src/core/ai/openai-compatible'

const reply =
  (choice: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify({ choices: [choice] }), { status: 200 }))

describe('requestOpenAiCompatiblePatch', () => {
  it('says the reply was cut off when the model used up its length limit before answering', async () => {
    await expect(
      requestOpenAiCompatiblePatch({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'fake-model',
        instruction: '修改',
        request: '讓香魚游快一點，一開始多給 2 條命',
        fetchImpl: reply({
          finish_reason: 'length',
          message: { role: 'assistant', content: '', reasoning_content: '想…' },
        }),
        onToolCall: () => ({ output: 'unused' }),
      }),
    ).rejects.toThrow(/截斷.*一次只改一件事/)
  })
})

describe('requestOpenAiCompatiblePatch HTTP errors', () => {
  it('names the API key when the model service refuses it', async () => {
    await expect(
      requestOpenAiCompatiblePatch({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'fake-model',
        instruction: '修改',
        request: '修改速度',
        fetchImpl: () => Promise.resolve(new Response('{"detail":"Invalid API key"}', { status: 401 })),
        onToolCall: () => ({ output: 'unused' }),
      }),
    ).rejects.toThrow(/API key 不正確或沒有填/)
  })
})

describe('requestOpenAiCompatiblePatch when the request cannot be done', () => {
  const lookup = (id: string) => ({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name: 'inspect_project', arguments: '{}' } }],
    },
  })
  const recorder = (choices: unknown[]) => {
    const bodies: { messages: { role: string; content: string | null }[] }[] = []
    const fetchImpl: typeof fetch = (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as (typeof bodies)[number])
      const choice = choices[Math.min(bodies.length - 1, choices.length - 1)]
      return Promise.resolve(new Response(JSON.stringify({ choices: [choice] }), { status: 200 }))
    }
    return { bodies, fetchImpl }
  }
  const ask = (fetchImpl: typeof fetch) =>
    requestOpenAiCompatiblePatch({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'fake-model',
      instruction: '作品結構',
      request: '主角是香魚，請改成魚的造型',
      fetchImpl,
      onToolCall: () => ({ output: '{}' }),
    })

  it('tells the model what it cannot change and to say so instead of searching', async () => {
    const { bodies, fetchImpl } = recorder([{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }])
    await ask(fetchImpl)
    expect(bodies[0].messages[0].content).toMatch(/不能新增圖片、造型/)
  })

  it('sends both a stage image and a costume collage, and exposes ask_student', async () => {
    const { bodies, fetchImpl } = recorder([
      { finish_reason: 'stop', message: { role: 'assistant', content: '{}' } },
    ])
    await requestOpenAiCompatiblePatch({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'fake-model',
      instruction: '作品結構',
      request: '修改角色',
      imageDataUrl: ['data:image/png;base64,stage', 'data:image/png;base64,costumes'],
      fetchImpl,
      onToolCall: () => ({ output: '{}' }),
    })
    const body = bodies[0] as unknown as {
      messages: { content: unknown }[]
      tools: { function: { name: string } }[]
    }
    expect(body.messages[1]?.content).toEqual([
      { type: 'text', text: '修改角色' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,stage' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,costumes' } },
    ])
    expect(body.tools.some((tool) => tool.function.name === 'ask_student')).toBe(true)
  })

  it('shows the model explanation when it answers in words instead of a patch', async () => {
    const { fetchImpl } = recorder([
      { finish_reason: 'stop', message: { role: 'assistant', content: '作品裡沒有魚的造型，網頁不能新增圖片。' } },
    ])
    await expect(ask(fetchImpl)).rejects.toThrow('AI 沒有提出修改：作品裡沒有魚的造型，網頁不能新增圖片。')
  })

  it('warns the model before its lookups run out and explains the stop in plain words', async () => {
    const { bodies, fetchImpl } = recorder([
      lookup('a'),
      lookup('b'),
      lookup('c'),
      lookup('d'),
      lookup('e'),
      lookup('f'),
      lookup('g'),
      lookup('h'),
      lookup('i'),
    ])
    await expect(ask(fetchImpl)).rejects.toThrow(/AI 查了 8 次作品，還是沒有提出修改/)
    expect(bodies.at(-1)?.messages.at(-1)?.content).toMatch(/只剩 \d 次查詢/)
  })
})

describe('requestOpenAiCompatibleText', () => {
  it('returns the plain answer and explains a cut-off reply', async () => {
    const answer =
      (choice: unknown): typeof fetch =>
      () =>
        Promise.resolve(new Response(JSON.stringify({ choices: [choice] })))
    await expect(
      requestOpenAiCompatibleText({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'm',
        prompt: '生命是什麼？',
        fetchImpl: answer({ finish_reason: 'stop', message: { content: ' 香魚還能被撞幾次。 ' } }),
      }),
    ).resolves.toBe('香魚還能被撞幾次。')
    await expect(
      requestOpenAiCompatibleText({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'm',
        prompt: '生命是什麼？',
        fetchImpl: answer({ finish_reason: 'length', message: { content: '' } }),
      }),
    ).rejects.toThrow(/截斷/)
  })
})
