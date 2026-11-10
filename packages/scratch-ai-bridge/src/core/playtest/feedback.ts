import type { CanonicalBlock, CanonicalProject } from '../ir/types'

export interface PlaytestControl {
  /** KeyboardEvent.key value. */
  readonly key: string
  readonly axis: 'x' | 'y'
  readonly sign: 1 | -1
  readonly label?: string
}

export interface PlaytestPlan {
  readonly controls: readonly PlaytestControl[]
  readonly clicks: boolean
  readonly checkAutonomousMotion: boolean
  readonly checkLoopMotion: boolean
}

export interface PlaytestTargetState {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly visible: boolean
  readonly currentCostume: number
}

export interface PlaytestVariableState {
  readonly targetName: string
  readonly name: string
  readonly type: string
  readonly value: unknown
}

export interface PlaytestSnapshot {
  readonly sprites: readonly PlaytestTargetState[]
  readonly variables: readonly PlaytestVariableState[]
}

export interface PlaytestControlResult {
  readonly key: string
  readonly expected: string
  readonly moved: boolean
  readonly sprite?: string
  readonly delta: number
}

export interface PlaytestObservation {
  readonly ready: boolean
  readonly error?: string
  readonly pageErrors: readonly string[]
  readonly autonomousMotion: boolean
  readonly controls: readonly PlaytestControlResult[]
  readonly changedVariables: readonly string[]
  readonly stateUnavailable?: string
}

export interface PlaytestFeedback {
  readonly passed: boolean
  readonly title: string
  readonly summary: string
  readonly issues: readonly string[]
  readonly repairPrompt?: string
}

const directionControls: readonly PlaytestControl[] = [
  { key: 'ArrowLeft', axis: 'x', sign: -1, label: '左鍵' },
  { key: 'ArrowRight', axis: 'x', sign: 1, label: '右鍵' },
  { key: 'ArrowUp', axis: 'y', sign: 1, label: '上鍵' },
  { key: 'ArrowDown', axis: 'y', sign: -1, label: '下鍵' },
]

const motionOpcodes = new Set([
  'motion_movesteps',
  'motion_glidesecstoxy',
  'motion_glideto',
  'motion_gotoxy',
  'motion_changexby',
  'motion_setx',
  'motion_changeyby',
  'motion_sety',
])

const loopOpcodes = new Set(['control_forever', 'control_repeat', 'control_repeat_until', 'control_while'])

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim().toLocaleLowerCase() : '')

const blockChildren = (block: CanonicalBlock): CanonicalBlock[] => {
  const children: CanonicalBlock[] = []
  for (const input of Object.values(block.inputs ?? {})) {
    if (input.type === 'block') children.push(input.block)
    if (input.type === 'stack') children.push(...input.blocks)
  }
  return children
}

const walkBlocks = (
  blocks: readonly CanonicalBlock[],
  visit: (block: CanonicalBlock, inLoop: boolean) => void,
): void => {
  const walk = (block: CanonicalBlock, inLoop: boolean): void => {
    visit(block, inLoop)
    for (const child of blockChildren(block)) walk(child, inLoop || loopOpcodes.has(block.opcode))
  }
  for (const block of blocks) walk(block, false)
}

const allProjectBlocks = (project: CanonicalProject): CanonicalBlock[] => {
  const blocks: CanonicalBlock[] = []
  for (const target of [project.stage, ...project.sprites]) {
    for (const script of target.scripts) blocks.push(...script.blocks)
    for (const procedure of target.procedures) blocks.push(...procedure.body)
  }
  return blocks
}

const hasText = (request: string, pattern: RegExp): boolean => pattern.test(request)

/**
 * Infer a short, bounded browser playtest from the student's natural-language request.
 * @param request Student's natural-language game request.
 * @returns Bounded controls and fallback checks for the browser playtest.
 */
export const inferPlaytestPlan = (request: string): PlaytestPlan => {
  const text = normalize(request)
  const controls: PlaytestControl[] = []
  const add = (control: PlaytestControl): void => {
    if (!controls.some(({ key }) => key === control.key)) controls.push(control)
  }

  if (hasText(text, /左右鍵|左右方向鍵|左和右|左、右|左鍵.*右鍵|左.*右.*移/u)) {
    add(directionControls[0])
    add(directionControls[1])
  } else {
    if (hasText(text, /左鍵|左方向鍵|向左/u)) add(directionControls[0])
    if (hasText(text, /右鍵|右方向鍵|向右/u)) add(directionControls[1])
  }
  if (hasText(text, /上下鍵|上下方向鍵|上和下|上、下/u)) {
    add(directionControls[2])
    add(directionControls[3])
  } else {
    if (hasText(text, /上鍵|上方向鍵|跳躍|向上/u)) add(directionControls[2])
    if (hasText(text, /下鍵|下方向鍵|向下/u)) add(directionControls[3])
  }
  if (hasText(text, /空白鍵|空格|space/u)) add({ key: ' ', axis: 'y', sign: 1, label: '空白鍵' })
  if (hasText(text, /按下\s*[wasd]|\b[wasd]鍵\b/u)) {
    if (hasText(text, /a鍵|左/u)) add({ key: 'a', axis: 'x', sign: -1, label: 'A 鍵' })
    if (hasText(text, /d鍵|右/u)) add({ key: 'd', axis: 'x', sign: 1, label: 'D 鍵' })
    if (hasText(text, /w鍵|上/u)) add({ key: 'w', axis: 'y', sign: 1, label: 'W 鍵' })
    if (hasText(text, /s鍵|下/u)) add({ key: 's', axis: 'y', sign: -1, label: 'S 鍵' })
  }

  return {
    controls,
    clicks: hasText(text, /滑鼠|點擊|點一下|按角色/u),
    checkAutonomousMotion: controls.length === 0,
    checkLoopMotion: hasText(text, /迴圈|循環|一直|自動|重複|下落|巡邏/u),
  }
}

const scratchKeyNames = (key: string): readonly string[] => {
  const aliases: Record<string, readonly string[]> = {
    ArrowLeft: ['left arrow', 'arrowleft'],
    ArrowRight: ['right arrow', 'arrowright'],
    ArrowUp: ['up arrow', 'arrowup'],
    ArrowDown: ['down arrow', 'arrowdown'],
    ' ': ['space', ' '],
  }
  return aliases[key] ?? [normalize(key)]
}

const projectHasKeyBinding = (project: CanonicalProject, key: string): boolean => {
  const names = new Set(scratchKeyNames(key))
  let found = false
  walkBlocks(allProjectBlocks(project), (block) => {
    if (found || block.opcode !== 'event_whenkeypressed') return
    const option = normalize(block.fields?.KEY_OPTION)
    found = names.has(option)
  })
  return found
}

const containsMotion = (block: CanonicalBlock): boolean =>
  motionOpcodes.has(block.opcode) || blockChildren(block).some((child) => containsMotion(child))

const projectLoopMotion = (project: CanonicalProject): { loops: number; movingLoops: number } => {
  let loops = 0
  let movingLoops = 0
  walkBlocks(allProjectBlocks(project), (block) => {
    if (!loopOpcodes.has(block.opcode)) return
    loops += 1
    if (blockChildren(block).some((child) => containsMotion(child))) movingLoops += 1
  })
  return { loops, movingLoops }
}

const staticIssues = (project: CanonicalProject, plan: PlaytestPlan): string[] => {
  const issues: string[] = []
  for (const control of plan.controls) {
    if (!projectHasKeyBinding(project, control.key))
      issues.push(
        `找不到「${control.label ?? control.key}」對應的按鍵事件；請把 KEY_OPTION 設為正確按鍵，並在事件下接上移動積木。`,
      )
  }
  if (plan.checkLoopMotion) {
    const loops = projectLoopMotion(project)
    if (loops.loops === 0) issues.push('需求提到持續或自動運動，但作品沒有 control_forever／重複迴圈。')
    else if (loops.movingLoops === 0)
      issues.push('找到迴圈，但迴圈裡沒有 motion_* 移動積木；請把移動或狀態更新放進迴圈。')
  }
  return issues
}

/**
 * Compare a runtime observation with the request and turn failures into an AI handoff.
 * @param request Student's natural-language game request.
 * @param project Canonical project to inspect for static wiring errors.
 * @param observation Bounded runtime observation from the preview.
 * @returns Human-readable feedback and, on failure, a repair prompt.
 */
export const createPlaytestFeedback = (
  request: string,
  project: CanonicalProject,
  observation: PlaytestObservation,
): PlaytestFeedback => {
  const plan = inferPlaytestPlan(request)
  const issues = staticIssues(project, plan)
  if (!observation.ready) issues.push(`作品沒有成功啟動試玩：${observation.error ?? '預覽未回報 ready。'}`)
  if (observation.pageErrors.length > 0) issues.push(`試玩時發生執行錯誤：${observation.pageErrors[0]}`)

  for (const control of plan.controls) {
    const result = observation.controls.find(({ key }) => key === control.key)
    if (!result?.moved)
      issues.push(
        `按${control.label ?? control.key}沒有偵測到角色往正確方向移動；請檢查按鍵事件與 motion_changexby／motion_changeyby 的方向。`,
      )
  }
  if (plan.checkAutonomousMotion && !observation.autonomousMotion && observation.changedVariables.length === 0)
    issues.push('沒有觀察到角色、造型或變數自行變化；請確認綠旗事件有啟動，並讓迴圈內真的改變遊戲狀態。')

  const uniqueIssues = [...new Set(issues)]
  if (uniqueIssues.length === 0)
    return {
      passed: true,
      title: '自動試玩通過',
      summary: '已在瀏覽器內啟動作品並檢查按鍵與遊戲狀態，暫時沒有抓到明顯的「按了沒反應」或「完全不動」。',
      issues: [],
    }

  const repairPrompt = [
    '請修正 Scratch 作品的實際玩法，不要只修改功能說明或回覆文字。',
    request.trim() ? `學生原本的需求：${request.trim()}` : '學生沒有提供額外需求文字。',
    '',
    'Bridge 在瀏覽器自動試玩時發現：',
    ...uniqueIssues.map((issue) => `- ${issue}`),
    '',
    '請保留原本角色、素材與已經正常的功能，只補上上述缺失的事件、移動或狀態更新；修正後請輸出完整可編譯的 scratch-ai-bridge/canonical-ir JSON。',
  ].join('\n')
  return {
    passed: false,
    title: '自動試玩發現需要修正的地方',
    summary: uniqueIssues.join(' '),
    issues: uniqueIssues,
    repairPrompt,
  }
}

export const snapshotsChanged = (
  before: PlaytestSnapshot | undefined,
  after: PlaytestSnapshot | undefined,
): boolean => {
  if (!before || !after) return false
  return JSON.stringify(before) !== JSON.stringify(after)
}

export const changedVariableNames = (
  before: PlaytestSnapshot | undefined,
  after: PlaytestSnapshot | undefined,
): readonly string[] => {
  if (!before || !after) return []
  return after.variables
    .filter((variable) => {
      const initial = before.variables.find(
        ({ targetName, name }) => targetName === variable.targetName && name === variable.name,
      )
      return initial !== undefined && JSON.stringify(initial.value) !== JSON.stringify(variable.value)
    })
    .map(({ targetName, name }) => `${targetName}/${name}`)
}

export const controlMovement = (
  before: PlaytestSnapshot | undefined,
  after: PlaytestSnapshot | undefined,
  control: PlaytestControl,
  threshold = 4,
): PlaytestControlResult => {
  let best: { sprite: string; delta: number } | undefined
  for (const sprite of after?.sprites ?? []) {
    const previous = before?.sprites.find(({ name }) => name === sprite.name)
    if (!previous) continue
    const delta = (sprite[control.axis] - previous[control.axis]) * control.sign
    if (!best || delta > best.delta) best = { sprite: sprite.name, delta }
  }
  return {
    key: control.key,
    expected: `${control.axis}${control.sign > 0 ? '+' : '-'}`,
    moved: (best?.delta ?? 0) >= threshold,
    ...(best ? { sprite: best.sprite, delta: Math.round(best.delta * 10) / 10 } : { delta: 0 }),
  }
}
