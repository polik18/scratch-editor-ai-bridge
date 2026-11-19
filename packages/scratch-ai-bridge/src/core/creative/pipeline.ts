import { evaluateCheck, NOT_RUN, type RuntimeEvidence, type StaticEvidence } from '../grading/evidence'
import type { RubricCheck } from '../grading/rubric'
import type { CanonicalProject } from '../ir/types'
import { scratchblocksSectionTexts } from '../scratchblocks'
import { validateCanonicalProject, validateCanonicalSemantics } from '../validator'
import { extractIntentAnchors, type IntentAnchors, type UnsupportedIntent } from './anchors'
import { featureChecks } from './cards'
import { createProjectPlan, type ProjectPlan, type ProjectSlice } from './plan'
import { createFreeCreationPrompt, createRepairPrompt, createSlicePrompt, createTranslationPrompt } from './prompts'
import { applyFragment, approximationNotes, EMPTY_STATE, stripReply, undoFragment, type CreativeState } from './state'

export type CreativeMode = 'a-b' | 'a-b-c'

/** Asks the model. `stage` lets callers log or route prompts; the pipeline never depends on a provider. */
export type AskModel = (prompt: string, stage: 'A' | 'B' | 'C' | 'repair') => Promise<string>

/** Builds the project and runs it in the real Scratch preview. Without it every step is reported as `not-run`. */
export type VerifyProject = (project: CanonicalProject) => Promise<{
  readonly built: boolean
  readonly error?: string
  readonly staticEvidence?: StaticEvidence
  readonly runtime: RuntimeEvidence
}>

export interface CheckResult {
  readonly feature: string
  readonly result: 'pass' | 'fail' | 'pending'
  readonly evidence: string
}

export interface CreativeStep {
  readonly stage: 'A' | 'B' | 'C' | 'repair'
  readonly sliceId?: string
  readonly promptCharacters: number
  readonly replyCharacters: number
  readonly prompt: string
  readonly reply: string
  readonly parse?: {
    readonly recognizedLines: number
    readonly skippedLines: number
    readonly warnings: readonly string[]
  }
  readonly validationErrors?: readonly string[]
  readonly verification?: {
    readonly built: boolean
    readonly error?: string
    readonly runtimeStatus: RuntimeEvidence['status']
    readonly checks: readonly CheckResult[]
  }
}

/** Something from the idea the result does not (yet) show, with the decision made about it. Nothing is dropped silently. */
export interface IntentDecision {
  readonly intent: string
  readonly status: 'implemented' | 'approximated' | 'substituted' | 'deferred' | 'missing'
  readonly note: string
}

export interface CreativeResult {
  readonly format: 'scratch-ai-bridge/creative-run'
  readonly version: 1
  readonly mode: CreativeMode
  readonly request: string
  /** Stage A text, kept verbatim. */
  readonly brief: string
  readonly anchors: IntentAnchors
  readonly plan?: ProjectPlan
  readonly steps: readonly CreativeStep[]
  readonly project?: CanonicalProject
  readonly runtimeStatus: RuntimeEvidence['status']
  readonly checks: readonly CheckResult[]
  readonly decisions: readonly IntentDecision[]
  /** Slices rolled back because they broke a feature an earlier slice had proved at runtime. */
  readonly rolledBack: readonly string[]
  readonly promptCharacters: { readonly total: number; readonly max: number }
  /** True only when the work built, really ran, and every planned feature was observed. */
  readonly done: boolean
  readonly notDone: readonly string[]
}

const EMPTY_STATIC: StaticEvidence = {
  opcodes: {},
  sprites: 0,
  scripts: 0,
  diagnosticScore: null,
  coverage: 1,
  keys: [],
  clickable: false,
}

const validationErrors = (project: CanonicalProject): string[] => {
  const structural = validateCanonicalProject(project)
  if (!structural.valid)
    return structural.errors.slice(0, 8).map((error) => `${error.instancePath || '/'}：${error.message}`)
  return validateCanonicalSemantics(project)
    .filter(({ severity }) => severity === 'error')
    .slice(0, 8)
    .map(({ path, message }) => `${path}：${message}`)
}

const runChecks = (
  checks: readonly { readonly feature: string; readonly check: RubricCheck }[],
  staticEvidence: StaticEvidence,
  runtime: RuntimeEvidence,
): CheckResult[] =>
  checks.map(({ feature, check }) => {
    const outcome = evaluateCheck(check, staticEvidence, runtime)
    return { feature, result: outcome.result, evidence: outcome.evidence }
  })

const decisionsFor = (unsupported: readonly UnsupportedIntent[], notes: readonly string[]): IntentDecision[] =>
  unsupported.map(({ phrase, decision, suggestion }) => {
    const note = notes.find((line) => line.includes(phrase))
    return {
      intent: phrase,
      status: decision === 'approximate' ? 'approximated' : decision === 'substitute' ? 'substituted' : 'deferred',
      note: note ?? `${suggestion}（AI 沒有註明採用的做法）`,
    }
  })

/**
 * The generation pipeline v2: free creation (A), translation with on-demand capability cards (B), and — in `a-b-c` —
 * slice-by-slice implementation where each slice is built, run and checked before the next (C/D).
 * @param input Request, mode, model and optional build/run hook.
 * @param input.request The user's idea.
 * @param input.mode `a-b` translates in one shot; `a-b-c` implements slice by slice.
 * @param input.ask Model call.
 * @param input.verify Build-and-run hook; without it nothing counts as done.
 * @param input.maxRepairs Repair attempts per step (default 1).
 * @param input.name Project name.
 * @returns Every prompt, reply, check and decision, plus the final project.
 */
export const runCreativePipeline = async (input: {
  readonly request: string
  readonly mode: CreativeMode
  readonly ask: AskModel
  readonly verify?: VerifyProject
  readonly maxRepairs?: number
  readonly name?: string
}): Promise<CreativeResult> => {
  const name = input.name ?? input.request.slice(0, 40)
  const maxRepairs = input.maxRepairs ?? 1
  const steps: CreativeStep[] = []
  const notes: string[] = []
  const modelErrors: string[] = []
  const rolledBack: string[] = []
  const tryAsk = async (prompt: string, stage: 'B' | 'C' | 'repair'): Promise<string | undefined> => {
    try {
      return await input.ask(prompt, stage)
    } catch (error) {
      modelErrors.push(`${stage} 階段模型沒有回覆：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  const record = (step: CreativeStep): void => {
    steps.push(step)
  }

  const promptA = createFreeCreationPrompt(input.request)
  const brief = (await input.ask(promptA, 'A')).trim()
  record({
    stage: 'A',
    prompt: promptA,
    reply: brief,
    promptCharacters: promptA.length,
    replyCharacters: brief.length,
  })
  const anchors = extractIntentAnchors(input.request, brief)

  let state: CreativeState = EMPTY_STATE
  let lastStatic = EMPTY_STATIC
  let lastRuntime: RuntimeEvidence = NOT_RUN
  // Assigned inside `implement`; widen so control-flow narrowing does not pin the initial value.
  let lastBuilt = false as boolean
  let lastError = undefined as string | undefined

  // Ask, parse, validate (with minimal repairs), merge and verify one fragment.
  const implement = async (
    prompt: string,
    stage: 'B' | 'C',
    slice: ProjectSlice | undefined,
    acceptance: readonly { readonly feature: string; readonly check: RubricCheck }[],
  ): Promise<{ readonly checks: CheckResult[]; readonly merged: boolean }> => {
    const unanswered = (): { checks: CheckResult[]; merged: boolean } => ({
      checks: acceptance.map(({ feature }) => ({ feature, result: 'fail', evidence: '模型沒有回覆這一段。' })),
      merged: false,
    })
    const first = await tryAsk(prompt, stage)
    if (first === undefined) return unanswered()
    let reply = first
    let promptUsed = prompt
    let stepStage: CreativeStep['stage'] = stage
    for (let attempt = 0; ; attempt += 1) {
      notes.push(...approximationNotes(reply))
      const applied = applyFragment(state, reply, name)
      const errors = applied.state.project ? validationErrors(applied.state.project) : ['沒有產生任何角色或程式。']
      const problems = [...applied.warnings.filter((warning) => warning.includes('未支援')), ...errors]
      const parse = {
        recognizedLines: applied.parsed.recognizedLines,
        skippedLines: applied.parsed.skippedLines,
        warnings: applied.warnings,
      }
      if (problems.length > 0 && attempt < maxRepairs) {
        record({
          stage: stepStage,
          ...(slice ? { sliceId: slice.id } : {}),
          prompt: promptUsed,
          reply,
          promptCharacters: promptUsed.length,
          replyCharacters: reply.length,
          parse,
          validationErrors: errors,
        })
        // Send only the failing sections (smaller context); the fixed sections replace them in the original reply.
        const sections = scratchblocksSectionTexts(stripReply(reply), state.project?.sprites[0]?.name)
        const failing = new Set(
          problems.flatMap((problem) => {
            const sprite = /^\/sprites\/(\d+)\//.exec(problem)
            if (sprite) return [applied.parsed.project.sprites[Number(sprite[1])]?.name ?? '']
            if (problem.startsWith('/stage/')) return ['Stage']
            const owner = /^([^：]+)：/.exec(problem)?.[1]
            return owner ? [owner === '舞台' ? 'Stage' : owner] : []
          }),
        )
        const partial =
          sections.length > 1 && sections.some((section) => !failing.has(section.name)) && failing.size > 0
        const failingText = sections
          .filter((section) => failing.has(section.name))
          .map(({ text }) => text)
          .join('\n\n')
        promptUsed = createRepairPrompt(partial ? failingText : reply, problems)
        stepStage = 'repair'
        const repaired = await tryAsk(promptUsed, 'repair')
        if (repaired === undefined) return unanswered()
        if (partial) {
          const fixed = scratchblocksSectionTexts(stripReply(repaired), state.project?.sprites[0]?.name)
          reply = [
            ...sections.map((section) =>
              failing.has(section.name)
                ? (fixed.find((candidate) => candidate.name === section.name)?.text ?? section.text)
                : section.text,
            ),
            ...fixed
              .filter((candidate) => !sections.some((section) => section.name === candidate.name))
              .map(({ text }) => text),
          ].join('\n\n')
        } else reply = repaired
        continue
      }
      if (errors.length > 0) {
        record({
          stage: stepStage,
          ...(slice ? { sliceId: slice.id } : {}),
          prompt: promptUsed,
          reply,
          promptCharacters: promptUsed.length,
          replyCharacters: reply.length,
          parse,
          validationErrors: errors,
        })
        lastBuilt = false
        lastError = errors.join('；')
        return {
          checks: acceptance.map(({ feature }) => ({
            feature,
            result: 'fail',
            evidence: '這一段無法通過格式檢查，沒有合併。',
          })),
          merged: false,
        }
      }
      state = applied.state
      let checks: CheckResult[] = acceptance.map(({ feature }) => ({
        feature,
        result: 'pending',
        evidence: '尚未實際執行。',
      }))
      let verification: CreativeStep['verification']
      if (input.verify && state.project) {
        const verified = await input.verify(state.project)
        lastBuilt = verified.built
        lastError = verified.error
        lastRuntime = verified.runtime
        lastStatic = verified.staticEvidence ?? EMPTY_STATIC
        checks = verified.built
          ? runChecks(acceptance, lastStatic, lastRuntime)
          : checks.map((check) => ({ ...check, result: 'fail', evidence: verified.error ?? '建置失敗' }))
        verification = {
          built: verified.built,
          ...(verified.error ? { error: verified.error } : {}),
          runtimeStatus: verified.runtime.status,
          checks,
        }
      } else lastBuilt = true
      record({
        stage: stepStage,
        ...(slice ? { sliceId: slice.id } : {}),
        prompt: promptUsed,
        reply,
        promptCharacters: promptUsed.length,
        replyCharacters: reply.length,
        parse,
        ...(verification ? { verification } : {}),
      })
      return { checks, merged: true }
    }
  }

  let plan: ProjectPlan | undefined
  if (input.mode === 'a-b') {
    await implement(createTranslationPrompt(brief, anchors), 'B', undefined, featureChecks(anchors))
  } else {
    plan = createProjectPlan(anchors)
    // Features earlier slices proved at runtime. Every later slice must keep them; a slice that breaks one is
    // retried once and, if it still breaks it, rolled back so the work never loses verified behavior.
    const guards: { readonly feature: string; readonly check: RubricCheck }[] = []
    const refresh = async (): Promise<void> => {
      if (!input.verify || !state.project) return
      const verified = await input.verify(state.project)
      lastBuilt = verified.built
      lastError = verified.error
      lastRuntime = verified.runtime
      lastStatic = verified.staticEvidence ?? EMPTY_STATIC
    }
    for (const slice of plan.slices) {
      const acceptance = [
        ...slice.acceptance,
        ...guards.filter((guard) => !slice.acceptance.some(({ feature }) => feature === guard.feature)),
      ]
      const isGuard = (feature: string): boolean => guards.some((guard) => guard.feature === feature)
      let attempt = await implement(
        createSlicePrompt({ brief, anchors, slice, ...(state.project ? { project: state.project } : {}) }),
        'C',
        slice,
        acceptance,
      )
      let failed = attempt.checks.filter(({ result }) => result === 'fail')
      if (failed.length > 0 && maxRepairs > 0 && modelErrors.length === 0) {
        // Roll back this slice (only if it was merged) and retry once with the findings instead of patching on top.
        if (attempt.merged) state = undoFragment(state)
        attempt = await implement(
          createSlicePrompt({
            brief,
            anchors,
            slice,
            ...(state.project ? { project: state.project } : {}),
            feedback: failed.map(({ feature, evidence }) =>
              isGuard(feature)
                ? `${feature}：${evidence}（這是之前已經做好的功能，這一段不可以刪掉或改壞它）`
                : `${feature}：${evidence}`,
            ),
          }),
          'C',
          slice,
          acceptance,
        )
        failed = attempt.checks.filter(({ result }) => result === 'fail')
        if (!attempt.merged) await refresh()
      }
      if (attempt.merged && failed.some(({ feature }) => isGuard(feature))) {
        state = undoFragment(state)
        await refresh()
        rolledBack.push(
          `${slice.id}：會破壞已完成的 ${failed
            .filter(({ feature }) => isGuard(feature))
            .map(({ feature }) => feature)
            .join('、')}，已退回這一段`,
        )
        continue
      }
      if (attempt.merged)
        for (const check of attempt.checks)
          if (check.result === 'pass' && !isGuard(check.feature)) {
            const source = acceptance.find(({ feature }) => feature === check.feature)
            if (source) guards.push(source)
          }
    }
  }

  const finalChecks =
    state.project && input.verify && lastBuilt
      ? runChecks(featureChecks(anchors), lastStatic, lastRuntime)
      : featureChecks(anchors).map(({ feature }) => ({
          feature,
          result: 'pending' as const,
          evidence: '尚未實際執行。',
        }))
  const decisions: IntentDecision[] = [
    ...finalChecks.map((check): IntentDecision => ({
      intent: check.feature,
      status: check.result === 'pass' ? 'implemented' : 'missing',
      note: check.result === 'pass' ? check.evidence : `待實作或待確認：${check.evidence}`,
    })),
    ...decisionsFor(anchors.unsupported, notes),
  ]
  const runtimeStatus = input.verify && state.project && lastBuilt ? lastRuntime.status : 'not-run'
  const notDone = [
    ...modelErrors,
    ...(!state.project ? ['沒有產生作品。'] : []),
    ...(state.project && !lastBuilt ? [`無法建置：${lastError ?? '格式錯誤'}`] : []),
    ...(runtimeStatus === 'not-run' ? ['作品尚未實際執行（完成作品不能以 not-run 收尾）。'] : []),
    ...(runtimeStatus === 'failed' ? [`作品無法在 Scratch 中啟動：${lastRuntime.error ?? ''}`] : []),
    ...finalChecks
      .filter(({ result }) => result !== 'pass')
      .map(({ feature, evidence }) => `${feature}：${evidence}`),
  ]
  const promptSizes = steps.map(({ promptCharacters }) => promptCharacters)
  return {
    format: 'scratch-ai-bridge/creative-run',
    version: 1,
    mode: input.mode,
    request: input.request,
    brief,
    anchors,
    ...(plan ? { plan } : {}),
    steps,
    ...(state.project ? { project: state.project } : {}),
    runtimeStatus,
    checks: finalChecks,
    decisions,
    rolledBack,
    promptCharacters: { total: promptSizes.reduce((sum, size) => sum + size, 0), max: Math.max(0, ...promptSizes) },
    done: notDone.length === 0,
    notDone,
  }
}
