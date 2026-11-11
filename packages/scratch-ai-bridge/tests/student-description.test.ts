import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDescription,
  createDescriptionInstruction,
  createDescriptionRepairPrompt,
  createDescriptionRevisionPrompt,
  descriptionKind,
  playtestFeedbackLines,
} from '../src/student-description'

const read = (file: string): string => readFileSync(path.resolve(file), 'utf8')
const game = read('src/spec/examples/catch.json')
const story = read('src/story/examples/river-story.json')
const blocks = read('src/core/ir/examples/06-platformer-core.json')

describe('web description route', () => {
  it('tells game and animation descriptions from block-level replies, even inside a chat answer', () => {
    expect(descriptionKind(`好的！\n\`\`\`json\n${game}\n\`\`\``)).toBe('game')
    expect(descriptionKind(story)).toBe('story')
    expect(descriptionKind(blocks)).toBeUndefined()
    expect(descriptionKind('我不知道')).toBeUndefined()
  })

  it('builds a description into a project with no feedback', () => {
    expect(buildDescription(game, 'game')).toMatchObject({ kind: 'game', errors: 0, feedback: '' })
    expect(buildDescription(game, 'game').project?.format).toBe('scratch-ai-bridge/canonical-ir')
    expect(buildDescription(story, 'story').project?.sprites.length).toBeGreaterThan(0)
  })

  it('lists every problem at once, each with its fix', () => {
    const broken = JSON.stringify({
      標題: '壞掉的遊戲',
      地圖: ['P..x..G'],
      圖例: { P: '貓', G: '門' },
      角色: { 貓: ['飛天'], 門: ['終點'] },
      規則: ['碰到 狗 → 分數 +1'],
    })
    const built = buildDescription(broken, 'game')
    const lines = built.feedback.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.every((line) => line.includes('→'))).toBe(true)
    const prompt = createDescriptionRepairPrompt(broken, built.feedback)
    expect(prompt).toContain(built.feedback)
    expect(prompt).toContain('壞掉的遊戲')
  })

  it('writes the first message, the revision and the playtest lines in description terms', () => {
    expect(createDescriptionInstruction('game', '接蘋果', '用左右鍵')).toContain('已確認的玩法：\n用左右鍵')
    expect(createDescriptionInstruction('story', '河流的故事')).toContain('場景')
    expect(createDescriptionRevisionPrompt(game, '蘋果掉快一點')).toContain('蘋果掉快一點')
    expect(playtestFeedbackLines(['按右鍵角色沒有移動'])).toMatch(/^\[試玩發現\] 按右鍵角色沒有移動 → /)
  })
})
