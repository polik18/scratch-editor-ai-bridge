import type { RubricCheck } from './rubric'

/** What the SB3 itself shows (read without running it). */
export interface StaticEvidence {
  /** Every opcode in the project with its count (scripts, procedures and loose blocks). */
  readonly opcodes: Readonly<Record<string, number>>
  readonly sprites: number
  /** Scripts that start with a hat block. */
  readonly scripts: number
  /** `sb3-static-v3` reference total; a diagnostic, never a grade. */
  readonly diagnosticScore: number | null
  /** Share of blocks the analyzer recognised (0–1). */
  readonly coverage: number
  /** Keys the project listens to with "when key pressed" or "key pressed?". */
  readonly keys: readonly string[]
  readonly clickable: boolean
}

/** What a real playtest in the Scratch renderer observed. */
export interface RuntimeEvidence {
  readonly status: 'passed' | 'failed' | 'not-run'
  readonly ready: boolean
  readonly error?: string
  readonly pageErrors: readonly string[]
  readonly autonomousMotion: boolean
  readonly controls: readonly { readonly key: string; readonly moved: boolean; readonly sprite?: string }[]
  readonly changedVariables: readonly string[]
  readonly executedOpcodes: Readonly<Record<string, number>>
  readonly maxClones: number
  readonly changedSprites: readonly string[]
  readonly durationMs: number
  /** What the automatic tester did, for the teacher report. */
  readonly scenario: readonly string[]
}

export const NOT_RUN: RuntimeEvidence = {
  status: 'not-run',
  ready: false,
  pageErrors: [],
  autonomousMotion: false,
  controls: [],
  changedVariables: [],
  executedOpcodes: {},
  maxClones: 0,
  changedSprites: [],
  durationMs: 0,
  scenario: [],
}

export interface CheckOutcome {
  /** `pending`: the check needs runtime evidence that was not collected. */
  readonly result: 'pass' | 'fail' | 'pending'
  readonly evidence: string
  /** The static code contains the feature but the automatic playtest never triggered it. */
  readonly suspectFalseNegative?: boolean
}

const count = (counts: Readonly<Record<string, number>>, opcodes: readonly string[]): number =>
  opcodes.reduce((sum, opcode) => sum + (counts[opcode] ?? 0), 0)

const staticHas = (evidence: StaticEvidence, opcodes: readonly string[]): boolean =>
  count(
    evidence.opcodes,
    opcodes.map((opcode) => opcode.replace(/:true$/, '')),
  ) > 0

/** Runtime event families that count as audience feedback (sound, looks, speech, visibility, clones, questions). */
export const FEEDBACK_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  聲音: ['sound_play', 'sound_playuntildone'],
  造型: ['looks_switchcostumeto', 'looks_nextcostume'],
  背景: ['looks_switchbackdropto', 'looks_switchbackdroptoandwait', 'looks_nextbackdrop'],
  對白: ['looks_say', 'looks_sayforsecs', 'looks_think', 'looks_thinkforsecs'],
  顯示隱藏: ['looks_hide', 'looks_show'],
  分身: ['control_create_clone_of'],
  提問: ['sensing_askandwait'],
}

/**
 * Evaluate one automatic check.
 * @param check Rubric check.
 * @param staticEvidence What the SB3 contains.
 * @param runtime What the playtest observed.
 * @returns Pass/fail/pending with a readable evidence line.
 */
export const evaluateCheck = (
  check: RubricCheck,
  staticEvidence: StaticEvidence,
  runtime: RuntimeEvidence,
): CheckOutcome => {
  if (check.kind.startsWith('runtime-') && runtime.status === 'not-run')
    return { result: 'pending', evidence: '尚未實際執行作品，無法判定。' }
  const verdict = (passed: boolean, evidence: string, falseNegative = false): CheckOutcome => ({
    result: passed ? 'pass' : 'fail',
    evidence,
    ...(!passed && falseNegative ? { suspectFalseNegative: true } : {}),
  })
  switch (check.kind) {
    case 'runtime-ready':
      return verdict(
        runtime.ready,
        runtime.ready ? '作品能在 Scratch 中啟動。' : `作品無法啟動：${runtime.error ?? '未知原因'}`,
      )
    case 'runtime-no-errors':
      return verdict(
        runtime.ready && runtime.pageErrors.length === 0,
        runtime.pageErrors.length === 0 ? '執行期間沒有錯誤。' : `執行期間出現 ${runtime.pageErrors.length} 個錯誤。`,
      )
    case 'runtime-opcode': {
      const min = check.min ?? 1
      const seen = count(runtime.executedOpcodes, check.opcodes)
      return verdict(
        seen >= min,
        `試玩時 ${check.opcodes.join('／')} 執行 ${seen} 次（需要 ${min} 次）。`,
        staticHas(staticEvidence, check.opcodes),
      )
    }
    case 'runtime-collision': {
      const opcodes = [
        'sensing_touchingobject:true',
        'sensing_touchingcolor:true',
        'sensing_coloristouchingcolor:true',
      ]
      const seen = count(runtime.executedOpcodes, opcodes)
      return verdict(seen > 0, `試玩時偵測到 ${seen} 次碰觸成立。`, staticHas(staticEvidence, opcodes))
    }
    case 'runtime-motion': {
      const moved = check.sprite
        ? runtime.changedSprites.includes(check.sprite) ||
          runtime.controls.some(({ sprite, moved }) => moved && sprite === check.sprite)
        : runtime.autonomousMotion || runtime.changedSprites.length > 0 || runtime.controls.some(({ moved }) => moved)
      return verdict(
        moved,
        moved ? `試玩時${check.sprite ? `「${check.sprite}」` : '角色'}有移動或變化。` : '試玩時沒有觀察到移動。',
      )
    }
    case 'runtime-sprite-changed': {
      const min = check.min ?? 1
      const matched = check.sprite
        ? runtime.changedSprites.filter((name) => name === check.sprite).length
        : runtime.changedSprites.length
      return verdict(matched >= min, `試玩時有 ${matched} 個角色改變位置、造型或顯示狀態（需要 ${min}）。`)
    }
    case 'runtime-variable-changed': {
      const changed = check.variable
        ? runtime.changedVariables.includes(check.variable)
        : runtime.changedVariables.length > 0
      return verdict(
        changed,
        changed ? `變數有變化：${runtime.changedVariables.slice(0, 5).join('、')}` : '試玩時變數沒有變化。',
        staticHas(staticEvidence, ['data_setvariableto', 'data_changevariableby']),
      )
    }
    case 'runtime-clones': {
      const min = check.min ?? 1
      const created = count(runtime.executedOpcodes, ['control_create_clone_of'])
      return verdict(
        created >= min || runtime.maxClones >= min,
        `試玩時建立分身 ${created} 次，同時最多 ${runtime.maxClones} 個。`,
        staticHas(staticEvidence, ['control_create_clone_of']),
      )
    }
    case 'runtime-control': {
      const controls = check.key ? runtime.controls.filter(({ key }) => key === check.key) : runtime.controls
      const moved = controls.some(({ moved }) => moved)
      return verdict(
        moved,
        controls.length === 0
          ? '沒有可測試的按鍵控制。'
          : moved
            ? '按鍵能控制角色移動。'
            : '按下按鍵後角色沒有移動。',
        staticEvidence.keys.length > 0,
      )
    }
    case 'runtime-feedback-kinds': {
      const kinds = Object.entries(FEEDBACK_FAMILIES)
        .filter(([, opcodes]) => count(runtime.executedOpcodes, opcodes) > 0)
        .map(([name]) => name)
      return verdict(
        kinds.length >= check.min,
        kinds.length
          ? `試玩時出現 ${kinds.length} 種回饋：${kinds.join('、')}。`
          : '試玩時沒有聲音、造型、對白等回饋。',
      )
    }
    case 'static-opcode': {
      const min = check.min ?? 1
      const found = count(staticEvidence.opcodes, check.opcodes)
      return verdict(found >= min, `程式中有 ${found} 個 ${check.opcodes.join('／')}（需要 ${min}）。`)
    }
    case 'static-sprites':
      return verdict(staticEvidence.sprites >= check.min, `作品有 ${staticEvidence.sprites} 個角色。`)
    case 'static-scripts':
      return verdict(staticEvidence.scripts >= check.min, `作品有 ${staticEvidence.scripts} 段會被觸發的程式。`)
    case 'static-diagnostic':
      return verdict(
        staticEvidence.diagnosticScore !== null && staticEvidence.diagnosticScore >= check.min,
        `靜態結構診斷分 ${staticEvidence.diagnosticScore ?? '無法計算'}（門檻 ${check.min}）。`,
      )
  }
}

/**
 * Combine several checks (all must pass). Pending wins over fail, so missing runtime evidence never becomes a zero.
 * @param checks Checks of one level, component or binary criterion.
 * @param staticEvidence What the SB3 contains.
 * @param runtime What the playtest observed.
 * @returns Combined outcome and per-check evidence lines.
 */
export const evaluateChecks = (
  checks: readonly RubricCheck[],
  staticEvidence: StaticEvidence,
  runtime: RuntimeEvidence,
): {
  readonly result: CheckOutcome['result']
  readonly evidence: readonly string[]
  readonly suspectFalseNegative: boolean
} => {
  const outcomes = checks.map((check) => evaluateCheck(check, staticEvidence, runtime))
  const result = outcomes.some(({ result }) => result === 'pending')
    ? 'pending'
    : outcomes.every(({ result }) => result === 'pass')
      ? 'pass'
      : 'fail'
  return {
    result,
    evidence: outcomes.map(({ evidence }) => evidence),
    suspectFalseNegative: outcomes.some(({ suspectFalseNegative }) => suspectFalseNegative === true),
  }
}
