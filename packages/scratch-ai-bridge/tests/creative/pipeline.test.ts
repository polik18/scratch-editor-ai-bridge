import { describe, expect, it } from 'vitest'
import {
  applyFragment,
  createFreeCreationPrompt,
  createProjectPlan,
  createTranslationPrompt,
  EMPTY_STATE,
  extractIntentAnchors,
  runCreativePipeline,
  undoFragment,
  type AskModel,
  type VerifyProject,
} from '../../src/core/creative'
import { NOT_RUN, type RuntimeEvidence } from '../../src/core/grading'

const request = '做一個大魚吃小魚的遊戲，用方向鍵控制大魚，小魚不斷出現，吃到加分並播放音效，30秒後結束'
const brief = `我想做給低年級玩的海底小遊戲。玩家用方向鍵控制一隻鯊魚，小魚會從四周不斷游出來，
碰到小魚就吃掉，分數加一，還會有咬一口的聲音。背景是海底，30 秒倒數結束時顯示分數。我也想讓玩家可以拖曳海草裝飾。`

const core = `sprite 鯊魚 (外觀: Shark 2; 音效: Chomp)
when green flag clicked
forever
  if <key [right arrow v] pressed?> then
    change x by (5)
  end
  if <key [left arrow v] pressed?> then
    change x by (-5)
  end
end`
const content = `// 近似：拖曳海草 → 點擊海草後跟著滑鼠
sprite 小魚 (外觀: Fish)
when green flag clicked
hide
forever
  create clone of [myself v]
  wait (1) seconds
end
when I start as a clone
go to [random position v]
show
repeat until <touching [鯊魚 v]?>
  move (3) steps
  if on edge, bounce
end
delete this clone`
const feedback = `stage (背景: Underwater 1)
sprite 鯊魚
when green flag clicked
forever
  if <touching [小魚 v]?> then
    play sound [Chomp v]
  end
end`
const progression = `stage
when green flag clicked
set [分數 v] to (0)
reset timer
wait until <(timer) > (30)>
stop [all v]`

const scripted = (
  replies: Record<string, string[]>,
): { ask: AskModel; prompts: { stage: string; prompt: string }[] } => {
  const prompts: { stage: string; prompt: string }[] = []
  const queues = Object.fromEntries(Object.entries(replies).map(([key, list]) => [key, [...list]]))
  return {
    prompts,
    ask: (prompt, stage) => {
      prompts.push({ stage, prompt })
      const next = (queues[stage] as string[] | undefined)?.shift()
      if (next === undefined) throw new Error(`no scripted reply for ${stage}`)
      return Promise.resolve(next)
    },
  }
}

const observed = (overrides: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  ...NOT_RUN,
  status: 'passed',
  ready: true,
  autonomousMotion: true,
  controls: [{ key: 'ArrowRight', moved: true, sprite: '鯊魚' }],
  changedVariables: ['分數'],
  executedOpcodes: {
    'sensing_touchingobject:true': 2,
    sound_play: 2,
    control_create_clone_of: 3,
    looks_switchbackdropto: 0,
  },
  maxClones: 3,
  changedSprites: ['鯊魚'],
  ...overrides,
})

describe('stage A: free creation', () => {
  it('asks for the idea only — no capability list, block syntax or schema', () => {
    const prompt = createFreeCreationPrompt(request)
    expect(prompt.length).toBeLessThan(400)
    for (const forbidden of [
      'when green flag clicked',
      'opcode',
      'requirementCoverage',
      'Game Spec',
      'sprite ',
      '【',
    ])
      expect(prompt).not.toContain(forbidden)
  })

  it('keeps any free-form reply verbatim, whatever its shape', async () => {
    const odd = '｛隨便寫的構想｝\n- 主角是貓\n```不是程式```'
    const { ask } = scripted({ A: [odd], B: ['sprite 貓\nwhen green flag clicked\nsay [嗨]'] })
    const result = await runCreativePipeline({ request: '做一個動畫', mode: 'a-b', ask })
    expect(result.brief).toBe(odd.trim())
  })
})

describe('stage B: anchors and on-demand cards', () => {
  it('extracts anchors and records a decision for every unsupported intent', () => {
    const anchors = extractIntentAnchors(request, brief)
    expect(anchors.projectType).toBe('game')
    expect(anchors.features).toEqual(
      expect.arrayContaining(['keys', 'collision', 'clones', 'score', 'sound', 'timer']),
    )
    // "背景是海底" sets a backdrop; it is not a request to switch scenes at runtime.
    expect(anchors.features).not.toContain('scenes')
    expect(anchors.scenes.length).toBeGreaterThan(0)
    expect(anchors.characters).toEqual(expect.arrayContaining(['鯊魚', '小魚']))
    expect(anchors.unsupported.map(({ id }) => id)).toEqual(['drag'])
    expect(anchors.audience).toBe('低年級')
  })

  it('only injects cards the idea needs', () => {
    const quiz = extractIntentAnchors('做一個國語問答測驗', '出三題問題，答對說答對了')
    const prompt = createTranslationPrompt('出三題問題，答對說答對了', quiz)
    expect(prompt).toContain('ask [問題] and wait')
    expect(prompt).not.toContain('create clone of')
    expect(prompt).not.toContain('key [right arrow v]')
    expect(prompt.length).toBeLessThan(1200)
  })

  it('plans the core experience first and verifies each slice at runtime', () => {
    const plan = createProjectPlan(extractIntentAnchors(request, brief))
    expect(plan.slices.map(({ id }) => id)).toEqual(['core', 'content', 'feedback', 'progression'])
    expect(plan.slices[0]?.features).toEqual(expect.arrayContaining(['keys', 'collision']))
    expect(plan.slices.every(({ acceptance }) => acceptance.length > 0)).toBe(true)
  })
})

describe('stage C: fragments with rollback', () => {
  it('merges fragments by target and rolls back without rewriting the work', () => {
    const first = applyFragment(EMPTY_STATE, core, 'fish').state
    const second = applyFragment(first, feedback, 'fish').state
    expect(second.project?.sprites.find(({ name }) => name === '鯊魚')?.scripts).toHaveLength(2)
    expect(second.project?.stage.costumes.map(({ name }) => name)).toEqual(['Underwater 1'])
    const replaced = applyFragment(second, 'sprite 鯊魚 (replace)\nwhen green flag clicked\nsay [新的]', 'fish').state
    expect(replaced.project?.sprites.find(({ name }) => name === '鯊魚')?.scripts).toHaveLength(1)
    expect(undoFragment(replaced).project).toEqual(second.project)
  })

  it('implements slice by slice, retries a failing slice with runtime feedback, and reports decisions', async () => {
    const { ask, prompts } = scripted({
      A: [brief],
      C: [core, content, 'sprite 鯊魚\nwhen green flag clicked\nsay [沒有音效]', feedback, progression],
    })
    let calls = 0
    const verify: VerifyProject = () => {
      calls += 1
      // The first feedback attempt plays no sound; the retry does.
      const silent = calls === 3
      return Promise.resolve({
        built: true,
        runtime: observed(
          silent
            ? { executedOpcodes: { 'sensing_touchingobject:true': 1, control_create_clone_of: 2 } }
            : {
                executedOpcodes: {
                  'sensing_touchingobject:true': 2,
                  sound_play: 2,
                  control_create_clone_of: 3,
                  looks_switchbackdropto: 1,
                },
              },
        ),
      })
    }
    const result = await runCreativePipeline({ request, mode: 'a-b-c', ask, verify })
    const cPrompts = prompts.filter(({ stage }) => stage === 'C')
    expect(cPrompts).toHaveLength(5)
    expect(cPrompts[3]?.prompt).toContain('上一次執行時發現')
    expect(result.project?.sprites.map(({ name }) => name)).toEqual(['鯊魚', '小魚'])
    expect(result.runtimeStatus).toBe('passed')
    expect(result.decisions.find(({ intent }) => intent === '拖曳')).toMatchObject({
      status: 'substituted',
      note: '拖曳海草 → 點擊海草後跟著滑鼠',
    })
    expect(result.done).toBe(true)
    expect(Math.max(...cPrompts.map(({ prompt }) => prompt.length))).toBeLessThan(2500)
  })
})

describe('stage D: runtime gate', () => {
  it('never reports done without really running the work', async () => {
    const { ask } = scripted({ A: [brief], B: [`${core}\n${content}`] })
    const result = await runCreativePipeline({ request, mode: 'a-b', ask })
    expect(result.runtimeStatus).toBe('not-run')
    expect(result.done).toBe(false)
    expect(result.notDone.join()).toContain('not-run')
  })

  it('repairs unsupported lines with a minimal prompt and lists features it could not observe', async () => {
    const { ask, prompts } = scripted({
      A: [brief],
      B: ['sprite 鯊魚\nwhen green flag clicked\nfly to the moon'],
      repair: [core],
    })
    const result = await runCreativePipeline({
      request,
      mode: 'a-b',
      ask,
      verify: () =>
        Promise.resolve({
          built: true,
          runtime: observed({ executedOpcodes: {}, changedVariables: [], maxClones: 0 }),
        }),
    })
    const repair = prompts.find(({ stage }) => stage === 'repair')?.prompt ?? ''
    expect(repair).toContain('fly to the moon')
    expect(repair.length).toBeLessThan(1500)
    expect(result.done).toBe(false)
    expect(result.decisions.filter(({ status }) => status === 'missing').length).toBeGreaterThan(0)
  })
})

describe('section-limited repair', () => {
  it('sends only the failing section and splices the fix back', async () => {
    const good = `sprite 鯊魚\nwhen green flag clicked\n${'say [很長的台詞讓這一段變大] for (1) seconds\n'.repeat(30)}`
    const bad = 'sprite 小魚\nwhen green flag clicked\nfly to the moon'
    const { ask, prompts } = scripted({
      A: [brief],
      B: [`${good}\n${bad}`],
      repair: ['sprite 小魚\nwhen green flag clicked\nmove (3) steps'],
    })
    const result = await runCreativePipeline({ request, mode: 'a-b', ask })
    const repair = prompts.find(({ stage }) => stage === 'repair')?.prompt ?? ''
    expect(repair).toContain('fly to the moon')
    expect(repair).not.toContain('很長的台詞')
    expect(result.project?.sprites.map(({ name }) => name)).toEqual(['鯊魚', '小魚'])
    expect(result.project?.sprites[0]?.scripts[0]?.blocks.length).toBe(31)
  })
})

describe('regression guard between slices', () => {
  it('rolls back a slice that breaks a feature an earlier slice proved', async () => {
    const keysSlice = core
    const breaking = 'sprite 鯊魚 (replace)\nwhen green flag clicked\nsay [我不會動了]'
    const { ask } = scripted({ A: [brief], C: [keysSlice, content, breaking, breaking, progression, progression] })
    const verify: VerifyProject = (project) => {
      const shark = project.sprites.find(({ name }) => name === '鯊魚')
      const moves = JSON.stringify(shark?.scripts ?? []).includes('sensing_keypressed')
      return Promise.resolve({
        built: true,
        runtime: observed({
          controls: moves ? [{ key: 'ArrowRight', moved: true, sprite: '鯊魚' }] : [],
          executedOpcodes: { 'sensing_touchingobject:true': 2, sound_play: 2, control_create_clone_of: 3 },
        }),
      })
    }
    const result = await runCreativePipeline({ request, mode: 'a-b-c', ask, verify })
    expect(result.rolledBack.join()).toContain('按鍵控制')
    expect(JSON.stringify(result.project?.sprites.find(({ name }) => name === '鯊魚'))).toContain(
      'sensing_keypressed',
    )
  })
})
