import type { Rubric, RuntimeEvidence, StaticEvidence } from '../../src/core/grading'

/**
 * The plan's 30/30/40 "big fish eats small fish" teacher rubric, with automatic checks.
 * @returns An unapproved teacher rubric.
 */
export const bigFishRubric = (): Rubric => ({
  format: 'scratch-ai-bridge/rubric',
  version: 1,
  id: 'big-fish-small-fish-animation-v1',
  title: '大魚吃小魚 Scratch 動畫',
  projectType: 'animation',
  totalPoints: 100,
  origin: 'teacher',
  criteria: [
    {
      id: 'swimming',
      title: '大魚、小魚的游泳方式正確',
      points: 30,
      mode: 'partial',
      evidence: ['runtime', 'visual'],
      levels: [
        { ratio: 1, description: '大魚和小魚都持續游泳', checks: [{ kind: 'runtime-sprite-changed', min: 2 }] },
        { ratio: 0.5, description: '只有一種魚游泳', checks: [{ kind: 'runtime-sprite-changed', min: 1 }] },
        { ratio: 0, description: '沒有依要求游泳或無法觀察' },
      ],
      testPlan: ['觀察大魚與小魚的移動'],
    },
    {
      id: 'eat-feedback',
      title: '大魚碰到小魚，小魚消失並播放吃掉的音效',
      points: 30,
      mode: 'components',
      evidence: ['runtime', 'audio'],
      components: [
        { id: 'collision', points: 10, description: '碰撞事件', checks: [{ kind: 'runtime-collision' }] },
        {
          id: 'disappear',
          points: 10,
          description: '小魚消失',
          checks: [{ kind: 'runtime-opcode', opcodes: ['looks_hide', 'control_delete_this_clone'] }],
        },
        {
          id: 'sound',
          points: 10,
          description: '播放音效',
          checks: [{ kind: 'runtime-opcode', opcodes: ['sound_play', 'sound_playuntildone'] }],
        },
      ],
      testPlan: ['記錄碰撞、可見性和聲音事件'],
    },
    {
      id: 'clone-respawn',
      title: '小魚被吃掉後，新的小魚分身在別處出現',
      points: 40,
      mode: 'partial',
      evidence: ['runtime', 'static'],
      levels: [
        { ratio: 1, description: '會出現新的小魚分身', checks: [{ kind: 'runtime-clones', min: 1 }] },
        {
          ratio: 0.5,
          description: '有重新出現但不是分身',
          checks: [{ kind: 'runtime-opcode', opcodes: ['looks_show'] }],
        },
        { ratio: 0, description: '沒有新的小魚出現或無法驗證' },
      ],
      testPlan: ['連續觸發吃魚事件，觀察新小魚'],
    },
  ],
})

export const staticEvidence = (overrides: Partial<StaticEvidence> = {}): StaticEvidence => ({
  opcodes: {
    event_whenflagclicked: 2,
    sensing_touchingobject: 1,
    looks_hide: 1,
    sound_play: 1,
    control_create_clone_of: 1,
  },
  sprites: 2,
  scripts: 3,
  diagnosticScore: 70,
  coverage: 1,
  keys: [],
  clickable: false,
  ...overrides,
})

export const runtimeEvidence = (overrides: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  status: 'passed',
  ready: true,
  pageErrors: [],
  autonomousMotion: true,
  controls: [],
  changedVariables: [],
  executedOpcodes: {
    'sensing_touchingobject:true': 2,
    sensing_touchingobject: 40,
    looks_hide: 2,
    control_create_clone_of: 2,
  },
  maxClones: 1,
  changedSprites: ['大魚', '小魚'],
  durationMs: 9000,
  scenario: ['綠旗啟動'],
  ...overrides,
})
