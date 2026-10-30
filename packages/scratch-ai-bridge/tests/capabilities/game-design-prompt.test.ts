import { describe, expect, it } from 'vitest'
import {
  createGameDesignDiscussionInstruction,
  createProjectFragmentInstruction,
  createStudentProjectInstruction,
  estimatePromptSize,
} from '../../src/core/capabilities/registry'

describe('game design and production prompt stages', () => {
  it('keeps the design discussion compact and focused on playable mechanics', () => {
    const prompt = createGameDesignDiscussionInstruction('做一個好玩的深海遊戲')

    expect(prompt).toContain('核心循環')
    expect(prompt).toContain('挑戰')
    expect(prompt).toContain('成功/失敗/重玩方式')
    expect(prompt).not.toContain('scratch-ai-bridge/canonical-ir')
    expect(prompt).not.toContain('可用積木與必要參數')
    expect(estimatePromptSize(prompt).characters).toBeLessThan(1800)
  })

  it('carries the confirmed brief into a fresh production prompt with a full authoring contract', () => {
    const prompt = createStudentProjectInstruction('做一個深海救援遊戲', {
      genre: 'arcade',
      confirmedBrief: '小魚收集氧氣泡泡、躲避水母並逐關救出海龜。',
    })

    expect(prompt).toContain('不需要讀取前一段聊天紀錄')
    expect(prompt).toContain('小魚收集氧氣泡泡、躲避水母並逐關救出海龜。')
    expect(prompt).toContain('街機射擊/閃避')
    expect(prompt).toContain('scratch-ai-bridge/ai-response')
    expect(prompt).toContain('event_whenkeypressed')
    expect(prompt).toContain('不可靜默省略')
  })

  it('estimates mixed Chinese and ASCII prompt size without claiming provider-exact tokens', () => {
    expect(estimatePromptSize('遊戲 A')).toEqual({ characters: 4, estimatedTokens: 3 })
  })

  it('allows a full standalone fragment contract or a same-conversation follow-up without the repeated catalog', () => {
    const base = {
      projectName: '深海救援',
      fragmentId: 'player-1',
      targetKind: 'sprite' as const,
      targetName: '小魚',
      designBrief: '收集氧氣並救出海龜。',
    }
    const standalone = createProjectFragmentInstruction(base)
    const followUp = createProjectFragmentInstruction({ ...base, reuseCapabilityContract: true })

    expect(standalone).toContain('event_whenkeypressed')
    expect(standalone).toContain('underwater')
    expect(standalone).toContain('TOUCHINGOBJECTMENU')
    expect(followUp).toContain('沿用本 AI 對話前文')
    expect(followUp).not.toContain('event_whenkeypressed')
    expect(followUp.length).toBeLessThan(standalone.length / 2)
  })
})
