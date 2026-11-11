import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { addExtractionRepair, normalizeAiDraft, parseAiResponse } from '../../src/core/normalizer/ai-draft'
import { repairJson } from '../../src/core/normalizer/json-repair'

const project = JSON.parse(readFileSync(path.resolve('src/core/ir/examples/06-platformer-core.json'), 'utf8')) as {
  name: string
}
const good = JSON.stringify(project, null, 2)

describe('JSON syntax repair', () => {
  it.each([
    ['a trailing comma', good.replace(/\n(\s*)\]/, ',\n$1]'), '刪掉結尾多餘的逗號'],
    ['a missing comma', good.replace('",\n', '"\n'), '補上漏掉的逗號'],
    ['a comment', good.replace('{\n', '{\n  // 這是作品\n'), '刪掉 JSON 不允許的註解'],
    ['single-quoted keys', good.replace('"format"', "'format'"), '單引號改成雙引號'],
    ['a cut-off ending', good.slice(0, good.lastIndexOf('}')), '回覆被截斷'],
  ])('repairs %s without changing any value', (_, text, fix) => {
    const parsed = parseAiResponse(`好的，作品如下：\n\`\`\`json\n${text}\n\`\`\`\n祝你玩得開心！`)
    expect(parsed.data).toEqual(project)
    expect(parsed.syntaxFixes?.join('、')).toContain(fix)
  })

  it('repairs a project followed by prose without a code fence', () => {
    const broken = good.replace('",\n', '"\n')
    expect(parseAiResponse(`作品如下 ${broken}\nHope you like it, enjoy!`).data).toEqual(project)
  })

  it('escapes a line break typed inside a string', () => {
    const parsed = parseAiResponse(good.replace(`"name": "${project.name}"`, '"name": "第一行\n第二行"'))
    expect((parsed.data as { name: string }).name).toBe('第一行\n第二行')
  })

  it('leaves strings that look like comments or contain quotes alone', () => {
    expect(JSON.parse(repairJson('{"url": "https://a.b/c", "say": \'他說"好"\', "x": True,}').text)).toEqual({
      url: 'https://a.b/c',
      say: '他說"好"',
      x: true,
    })
  })

  it('records the repair so the report says what was changed', () => {
    const parsed = parseAiResponse(good.replace('",\n', '"\n'))
    const normalized = addExtractionRepair(normalizeAiDraft(parsed.data), parsed)
    expect(normalized.repairs[0]).toMatchObject({ code: 'repair-json-syntax' })
  })

  it('still rejects text that is not a project', () => {
    expect(() => parseAiResponse('{"a": 1 "b": 2}')).toThrow(SyntaxError)
  })
})
