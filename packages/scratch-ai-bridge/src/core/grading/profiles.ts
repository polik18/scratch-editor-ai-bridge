import { approveRubric, type ProjectType, type Rubric, type RubricCheck, type RubricCriterion } from './rubric'

/** Facet weights per project type; each row adds up to 100. */
const WEIGHTS: Readonly<Record<ProjectType, readonly [number, number, number, number, number, number]>> = {
  game: [20, 25, 20, 15, 10, 10],
  animation: [20, 20, 20, 25, 5, 10],
  story: [25, 20, 25, 15, 5, 10],
  'interactive-art': [20, 25, 15, 25, 5, 10],
  music: [20, 25, 15, 25, 5, 10],
  quiz: [25, 25, 25, 10, 5, 10],
  tutorial: [25, 25, 25, 10, 5, 10],
  simulation: [20, 25, 25, 10, 10, 10],
  mixed: [20, 25, 20, 15, 10, 10],
  custom: [20, 25, 20, 15, 10, 10],
}

/** The observable core of each project type: what must happen at runtime for the main flow to count as working. */
const CORE: Readonly<Record<ProjectType, { readonly checks: readonly RubricCheck[]; readonly text: string }>> = {
  game: { checks: [{ kind: 'runtime-motion' }], text: '試玩時角色能被操作或自行移動' },
  animation: {
    checks: [{ kind: 'runtime-motion' }, { kind: 'runtime-feedback-kinds', min: 1 }],
    text: '播放時有動作與造型／背景／聲音等變化',
  },
  story: {
    checks: [
      { kind: 'runtime-opcode', opcodes: ['looks_say', 'looks_sayforsecs', 'looks_think', 'looks_thinkforsecs'] },
    ],
    text: '播放時角色會說出對白',
  },
  'interactive-art': { checks: [{ kind: 'runtime-motion' }], text: '輸入後畫面有可觀察的回應' },
  music: {
    checks: [{ kind: 'runtime-opcode', opcodes: ['sound_play', 'sound_playuntildone'] }],
    text: '執行時會播放聲音',
  },
  quiz: {
    checks: [{ kind: 'runtime-opcode', opcodes: ['sensing_askandwait', 'looks_say', 'looks_sayforsecs'] }],
    text: '執行時會出題或給提示',
  },
  tutorial: {
    checks: [{ kind: 'runtime-opcode', opcodes: ['looks_say', 'looks_sayforsecs', 'sensing_askandwait'] }],
    text: '執行時會呈現教學步驟',
  },
  simulation: { checks: [{ kind: 'runtime-variable-changed' }], text: '執行時模型狀態（變數）會改變' },
  mixed: { checks: [{ kind: 'runtime-sprite-changed' }], text: '執行時至少一個角色有變化' },
  custom: { checks: [{ kind: 'runtime-sprite-changed' }], text: '執行時至少一個角色有變化' },
}

const NOT_GAME_TEXT: Partial<Record<ProjectType, string>> = {
  animation: '不要求玩家操作或勝負',
  story: '不要求得分、碰撞或敵人',
  'interactive-art': '不要求傳統目標或通關',
  music: '不要求角色移動或故事',
  quiz: '不要求遊戲式勝負或複雜動畫',
  tutorial: '不要求遊戲式勝負或複雜動畫',
  simulation: '不要求固定答案或關卡',
  game: '不要求多關卡或多人',
}

/**
 * The built-in fallback rubric for a project type, used only when the teacher supplied none. Facets that need human
 * judgment (intent, depth, testing/reflection) have no automatic checks and stay pending until an AI provider or the
 * teacher grades them, so the fallback never invents a full score from structure alone.
 * @param projectType Project type from the assignment manifest.
 * @returns An approved built-in rubric.
 */
export const createFallbackRubric = (projectType: ProjectType): Rubric => {
  const [intent, reliability, depth, expression, structure, testing] = WEIGHTS[projectType]
  const core = CORE[projectType]
  const note = NOT_GAME_TEXT[projectType]
  const criteria: RubricCriterion[] = [
    {
      id: 'intent',
      title: '作業意圖與核心目標',
      points: intent,
      mode: 'partial',
      evidence: ['ai', 'teacher'],
      description: '是否實現作業或學生宣稱的作品目標、受眾、內容、互動、敘事或教學目的。',
      levels: [
        { ratio: 1, description: '核心目標完整實現且清楚可辨' },
        { ratio: 0.6, description: '大致實現，部分目標缺漏' },
        { ratio: 0.3, description: '只看得出部分意圖' },
        { ratio: 0, description: '看不出與作業目標的關聯' },
      ],
      testPlan: ['對照作業說明或學生 brief，檢查作品主要內容是否對應'],
    },
    {
      id: 'reliability',
      title: '可執行性與可靠度',
      points: reliability,
      mode: 'partial',
      evidence: ['runtime'],
      description: `能否啟動並穩定完成主要流程：${core.text}。`,
      levels: [
        {
          ratio: 1,
          description: `能啟動、沒有錯誤，且${core.text}`,
          checks: [{ kind: 'runtime-ready' }, { kind: 'runtime-no-errors' }, ...core.checks],
        },
        {
          ratio: 0.6,
          description: `能啟動且${core.text}，但有執行錯誤`,
          checks: [{ kind: 'runtime-ready' }, ...core.checks],
        },
        { ratio: 0.3, description: '能啟動，但看不到主要流程的結果', checks: [{ kind: 'runtime-ready' }] },
        { ratio: 0, description: '無法啟動' },
      ],
      testPlan: ['按下綠旗啟動', '依作品偵測到的按鍵與點擊自動試玩', '記錄角色、變數、聲音、造型與分身事件'],
    },
    {
      id: 'depth',
      title: '內容深度與結構',
      points: depth,
      mode: 'partial',
      evidence: ['ai', 'teacher'],
      description: `故事、資訊、互動、模擬或教學層次是否有意義；不按積木數或角色數加分（${note ?? '依教師規準'}）。`,
      levels: [
        { ratio: 1, description: '有多段有意義的流程或變化' },
        { ratio: 0.6, description: '有基本流程，變化有限' },
        { ratio: 0.3, description: '只有單一動作或片段' },
        { ratio: 0, description: '沒有可辨識的內容流程' },
      ],
      testPlan: ['依試玩紀錄和作品地圖，列出實際可觀察的段落與變化'],
    },
    {
      id: 'expression',
      title: '互動回饋與視覺／聲音表達',
      points: expression,
      mode: 'partial',
      evidence: ['runtime', 'audio', 'visual'],
      description: '執行時實際出現的聲音、造型、背景、對白、顯示變化與分身；素材多不等於高分。',
      levels: [
        { ratio: 1, description: '執行時出現三種以上回饋', checks: [{ kind: 'runtime-feedback-kinds', min: 3 }] },
        { ratio: 0.6, description: '執行時出現兩種回饋', checks: [{ kind: 'runtime-feedback-kinds', min: 2 }] },
        { ratio: 0.3, description: '執行時出現一種回饋', checks: [{ kind: 'runtime-feedback-kinds', min: 1 }] },
        { ratio: 0, description: '執行時沒有可觀察的回饋' },
      ],
      testPlan: ['試玩期間記錄實際執行的聲音、造型、背景、對白、顯示與分身積木'],
    },
    {
      id: 'structure',
      title: '程式結構與可維護性',
      points: structure,
      mode: 'partial',
      evidence: ['static'],
      description: '沿用 sb3-static-v3 靜態診斷；只評功能性結構，Bridge 看不懂的 extension 不當作學生錯誤。',
      levels: [
        { ratio: 1, description: '靜態結構診斷 80 分以上', checks: [{ kind: 'static-diagnostic', min: 80 }] },
        { ratio: 0.6, description: '靜態結構診斷 50 分以上', checks: [{ kind: 'static-diagnostic', min: 50 }] },
        { ratio: 0.3, description: '靜態結構診斷 20 分以上', checks: [{ kind: 'static-diagnostic', min: 20 }] },
        { ratio: 0, description: '結構無法辨識或幾乎沒有程式' },
      ],
      testPlan: ['讀取 SB3 的事件、流程、資料與組織結構'],
    },
    {
      id: 'testing',
      title: '測試、反思與完成度',
      points: testing,
      mode: 'partial',
      evidence: ['teacher', 'ai'],
      description: '是否測過核心路徑、修正問題、說明限制與設計取捨。',
      levels: [
        { ratio: 1, description: '有測試紀錄與清楚反思' },
        { ratio: 0.5, description: '有部分說明' },
        { ratio: 0, description: '沒有測試或反思' },
      ],
      testPlan: ['閱讀學生的說明或反思'],
    },
  ]
  const rubric: Rubric = {
    format: 'scratch-ai-bridge/rubric',
    version: 1,
    id: `fallback-${projectType}-v1`,
    title: `通用 Scratch 專案評量（${projectType}）`,
    projectType,
    totalPoints: 100,
    criteria:
      projectType === 'mixed' || projectType === 'custom'
        ? criteria.map((item) => ({ ...item, reviewRequired: true }))
        : criteria,
    origin: 'fallback',
  }
  return approveRubric(rubric, 'built-in', '2026-11-19T00:00:00.000Z')
}
