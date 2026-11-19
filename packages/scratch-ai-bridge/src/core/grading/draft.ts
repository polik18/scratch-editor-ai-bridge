import type { EvidenceSource, ProjectType, Rubric, RubricCheck, RubricComponent, RubricCriterion } from './rubric'

interface FeatureRule {
  readonly key: string
  readonly pattern: RegExp
  readonly label: string
  readonly check: RubricCheck
  readonly evidence: EvidenceSource
}

/** Keywords a teacher commonly writes, mapped to the automatic check that can observe them. Order matters for display only. */
const FEATURES: readonly FeatureRule[] = [
  {
    key: 'collision',
    pattern: /碰到|碰觸|碰撞|撞到|接到|吃到|吃掉/,
    label: '碰觸事件',
    check: { kind: 'runtime-collision' },
    evidence: 'runtime',
  },
  {
    key: 'disappear',
    pattern: /消失|隱藏|不見/,
    label: '消失',
    check: { kind: 'runtime-opcode', opcodes: ['looks_hide', 'control_delete_this_clone'] },
    evidence: 'runtime',
  },
  {
    key: 'sound',
    pattern: /音效|聲音|音樂|播放.*音/,
    label: '音效',
    check: { kind: 'runtime-opcode', opcodes: ['sound_play', 'sound_playuntildone'] },
    evidence: 'audio',
  },
  {
    key: 'clone',
    pattern: /分身|複製|新的.*出現|重新出現|再出現/,
    label: '分身／重新出現',
    check: { kind: 'runtime-clones' },
    evidence: 'runtime',
  },
  {
    key: 'speech',
    pattern: /對白|說話|說出|講話|對話/,
    label: '對白',
    check: {
      kind: 'runtime-opcode',
      opcodes: ['looks_say', 'looks_sayforsecs', 'looks_think', 'looks_thinkforsecs'],
    },
    evidence: 'runtime',
  },
  {
    key: 'backdrop',
    pattern: /背景|場景|換景/,
    label: '背景／場景',
    check: {
      kind: 'runtime-opcode',
      opcodes: ['looks_switchbackdropto', 'looks_switchbackdroptoandwait', 'looks_nextbackdrop'],
    },
    evidence: 'visual',
  },
  {
    key: 'costume',
    pattern: /造型|換裝|動畫/,
    label: '造型變化',
    check: { kind: 'runtime-opcode', opcodes: ['looks_switchcostumeto', 'looks_nextcostume'] },
    evidence: 'visual',
  },
  {
    key: 'variable',
    pattern: /分數|計分|得分|變數|生命|計時/,
    label: '變數變化',
    check: { kind: 'runtime-variable-changed' },
    evidence: 'runtime',
  },
  {
    key: 'broadcast',
    pattern: /廣播|訊息/,
    label: '廣播',
    check: { kind: 'runtime-opcode', opcodes: ['event_broadcast', 'event_broadcastandwait'] },
    evidence: 'runtime',
  },
  {
    key: 'ask',
    pattern: /提問|詢問|問答|回答|題目/,
    label: '提問',
    check: { kind: 'runtime-opcode', opcodes: ['sensing_askandwait'] },
    evidence: 'runtime',
  },
  {
    key: 'control',
    pattern: /方向鍵|按鍵|鍵盤|操控|控制/,
    label: '按鍵控制',
    check: { kind: 'runtime-control' },
    evidence: 'runtime',
  },
  {
    key: 'motion',
    pattern: /游|移動|走|跑|飛|動起來|游泳/,
    label: '移動',
    check: { kind: 'runtime-motion' },
    evidence: 'runtime',
  },
]

const slug = (text: string, index: number): string => {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return ascii.length >= 2 ? ascii : `c${index + 1}`
}

const splitPoints = (total: number, parts: number): number[] => {
  const base = Math.floor(total / parts)
  return Array.from({ length: parts }, (_, index) => base + (index < total - base * parts ? 1 : 0))
}

/**
 * Turn a teacher's plain-language criteria (one per line, ending with "N 分") into a rubric draft. The draft keeps
 * the teacher's items and points exactly; it only proposes automatic checks and test steps. It is never approved —
 * the teacher must review it and run `rubric approve` before it produces formal grades.
 * @param text Lines such as "大魚碰到小魚，小魚消失並播放音效 30分".
 * @param options Rubric id, title and project type.
 * @param options.id Stable rubric identifier (letters, digits, - _ .).
 * @param options.title Title shown to teachers and students.
 * @param options.projectType Which project-type profile the assignment uses.
 * @returns The draft and the lines it could not read.
 */
export const draftRubricFromText = (
  text: string,
  options: { readonly id: string; readonly title: string; readonly projectType: ProjectType },
): { readonly rubric: Rubric; readonly unread: readonly string[] } => {
  const unread: string[] = []
  const criteria: RubricCriterion[] = []
  const usedIds = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim()
    if (!line) continue
    const match = /^(.*?)[\s:：,，(（]*(\d+(?:\.\d+)?)\s*分[)）]?\s*$/.exec(line)
    if (!match) {
      unread.push(rawLine)
      continue
    }
    const title = match[1].replace(/[\s:：,，]+$/, '').trim()
    const points = Number(match[2])
    if (!title || !(points > 0)) {
      unread.push(rawLine)
      continue
    }
    let id = slug(title, criteria.length)
    while (usedIds.has(id)) id = `${id}-${criteria.length + 1}`
    usedIds.add(id)
    const features = FEATURES.filter(({ pattern }) => pattern.test(title))
    const evidence = [...new Set<EvidenceSource>([...features.map((feature) => feature.evidence), 'teacher'])]
    const testPlan = features.length
      ? features.map(({ label }) => `自動試玩時記錄「${label}」是否發生`)
      : ['這一項沒有可自動觀察的關鍵字，請教師直接判定']
    if (features.length >= 2 && Number.isInteger(points) && points >= features.length) {
      const shares = splitPoints(points, features.length)
      const components: RubricComponent[] = features.map((feature, index) => ({
        id: feature.key,
        points: shares[index],
        description: feature.label,
        checks: [feature.check],
      }))
      criteria.push({ id, title, points, mode: 'components', evidence, components, testPlan })
    } else if (features.length >= 1) {
      criteria.push({
        id,
        title,
        points,
        mode: 'binary',
        evidence,
        checks: features.map(({ check }) => check),
        testPlan,
      })
    } else {
      criteria.push({
        id,
        title,
        points,
        mode: 'partial',
        evidence: ['teacher'],
        levels: [
          { ratio: 1, description: '完整達成' },
          { ratio: 0.5, description: '部分達成' },
          { ratio: 0, description: '未達成或無法觀察' },
        ],
        testPlan,
      })
    }
  }
  const totalPoints = criteria.reduce((sum, { points }) => sum + points, 0)
  return {
    rubric: {
      format: 'scratch-ai-bridge/rubric',
      version: 1,
      id: options.id,
      title: options.title,
      projectType: options.projectType,
      totalPoints,
      criteria,
      origin: 'draft',
    },
    unread,
  }
}
