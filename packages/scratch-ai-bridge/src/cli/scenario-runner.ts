import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import { SPEC_NAMES } from '../spec/compile'
import type { BotStep, Expectation, SpecScenario, Subject } from '../spec/scenario'
import type { PlaytestRunner, PreviewMessage } from './playtest'

export interface ExpectationResult {
  readonly label: string
  readonly pass: boolean
  readonly actual: unknown
  readonly expected: string
  readonly hint?: string
}

export interface ScenarioResult {
  readonly name: string
  readonly ready: boolean
  readonly error?: string
  readonly pageErrors: readonly string[]
  readonly expectations: readonly ExpectationResult[]
  /** Bot trace, sampled, for explaining a failed run: [ms, x, y]. */
  readonly trace?: readonly (readonly [number, number, number])[]
}

interface State {
  readonly sprites: Readonly<
    Partial<Record<string, { x: number; y: number; visible: boolean; currentCostume: number }>>
  >
  readonly variables: readonly { targetName: string; name: string; value: unknown }[]
  /** Index of the stage's current backdrop. */
  readonly backdrop: number
  /** Seconds since the scenario started. */
  readonly seconds: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const read = (state: State, subject: Subject): number => {
  if ('stage' in subject) return state.backdrop
  if ('clock' in subject) return state.seconds
  if ('sprite' in subject) {
    const sprite = state.sprites[subject.sprite]
    if (!sprite) return Number.NaN
    if (subject.field === 'visible') return sprite.visible ? 1 : 0
    if (subject.field === 'costume') return sprite.currentCostume
    return sprite[subject.field]
  }
  const found = state.variables.find(
    (item) => item.name === subject.variable && (subject.target === undefined || item.targetName === subject.target),
  )
  return Number(found?.value)
}

/**
 * Drives spec scenarios in the real Scratch preview and evaluates their expectations.
 * @param runner - Runner that owns the preview server and browser.
 * @param archive - Compiled SB3 bytes.
 * @param scenario - Scenario generated from a spec.
 * @returns Expectation results, page errors and the bot trace.
 */
export const runSpecScenario = async (
  runner: PlaytestRunner,
  archive: Uint8Array,
  scenario: SpecScenario,
): Promise<ScenarioResult> => {
  const page: Page = await runner.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)))
  try {
    const opened = await runner.openPreview(page, archive)
    if ('error' in opened)
      return { name: scenario.name, ready: false, error: opened.error, pageErrors, expectations: [] }
    const { token } = opened
    const post = (message: Record<string, unknown>): Promise<void> =>
      page.evaluate((message) => document.querySelector('iframe')?.contentWindow?.postMessage(message, '*'), {
        ...message,
        token,
      })
    /**
     * Waits for the reply to a request and removes it, so the message log stays small during long bot runs.
     * @param type - Message type the preview answers with.
     * @param requestId - Request the reply answers.
     * @returns The matching preview message.
     */
    const takeReply = async (type: string, requestId: string): Promise<PreviewMessage> => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const reply = await page.evaluate(
          ({ type, requestId }) => {
            const log = (window as unknown as { __messages: PreviewMessage[] }).__messages
            const index = log.findIndex((item) => item.type === type && item.requestId === requestId)
            return index < 0 ? undefined : log.splice(index, 1)[0]
          },
          { type, requestId },
        )
        if (reply) return reply
        await sleep(10)
      }
      throw new Error(`runSpecScenario: no ${type} reply`)
    }
    // Runtime patches and state captures name the preview's current revision, which starts at 0.
    let revision = 0
    const scenarioStarted = Date.now()
    const state = async (): Promise<State> => {
      const requestId = randomUUID()
      await post({ type: 'capture-game-progress', requestId, baseRevision: revision })
      const reply = await takeReply('game-progress-result', requestId)
      if (!reply.ok) throw new Error(`state capture failed: ${reply.error ?? 'unknown'}`)
      const sprites: State['sprites'] = Object.fromEntries(
        (reply.targets ?? []).filter((target) => !target.isStage).map((target) => [target.name, target]),
      )
      const stage = (reply.targets ?? []).find((target) => target.isStage)
      return {
        sprites,
        variables: reply.snapshot ?? [],
        backdrop: stage?.currentCostume ?? Number.NaN,
        seconds: (Date.now() - scenarioStarted) / 1000,
      }
    }
    const clones = async (): Promise<readonly { name: string; x: number; y: number }[]> => {
      const requestId = randomUUID()
      await post({ type: 'playtest-clones', requestId })
      return (await takeReply('playtest-clones-result', requestId)).clones ?? []
    }
    const key = (name: string, isDown: boolean): Promise<void> => post({ type: 'playtest-key', key: name, isDown })

    const dismissIntro = async (): Promise<void> => {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        if ((await state()).sprites[SPEC_NAMES.intro]?.visible) break
        await sleep(50)
      }
      if (!(await state()).sprites[SPEC_NAMES.intro]?.visible) return
      await key(' ', true)
      await sleep(150)
      await key(' ', false)
      while (Date.now() < deadline + 3000) {
        if (!(await state()).sprites[SPEC_NAMES.intro]?.visible) return
        await sleep(50)
      }
    }

    const marks = new Map<string, State>()
    const expectations: ExpectationResult[] = []
    let trace: [number, number, number][] | undefined

    const evaluate = (step: Expectation, now: State): void => {
      const actual = read(now, step.subject)
      let base: number
      if (step.from) {
        const marked = marks.get(step.from.mark)
        if (!marked)
          throw new Error(`runSpecScenario: expectation "${step.label}" uses unknown mark "${step.from.mark}"`)
        base = read(marked, step.subject) + (step.from.plus ?? 0)
      } else {
        if (step.value === undefined)
          throw new Error(`runSpecScenario: expectation "${step.label}" has no value or mark`)
        base = step.value
      }
      const pass =
        step.op === '>'
          ? actual > base
          : step.op === '<'
            ? actual < base
            : step.op === '=='
              ? actual === base
              : Math.abs(actual - base) <= (step.tolerance ?? 0)
      const expected =
        step.op === 'within'
          ? `與 ${base.toFixed(1)} 相差 ≤ ${step.tolerance}`
          : `${step.op} ${Number(base.toFixed(1))}`
      expectations.push({
        label: step.label,
        pass,
        actual: Number.isFinite(actual) ? Number(actual.toFixed(1)) : actual,
        expected,
        ...(pass ? {} : { hint: step.hint }),
      })
    }

    const bot = async (step: BotStep): Promise<void> => {
      trace = []
      const started = Date.now()
      const held = new Set<string>()
      const hold = async (wanted: readonly string[]): Promise<void> => {
        for (const name of [...held]) {
          if (wanted.includes(name)) continue
          held.delete(name)
          await key(name, false)
        }
        for (const name of wanted) {
          if (held.has(name)) continue
          held.add(name)
          await key(name, true)
        }
      }
      let waypoint = 0
      let lastProgress = { at: started, x: Number.NaN }
      while (Date.now() - started < step.timeoutMs) {
        const now = await state()
        if (now.sprites[SPEC_NAMES.banner]?.visible) break
        const me = now.sprites[step.player]
        if (!me) break
        const elapsed = Date.now() - started
        if (trace.length === 0 || elapsed - trace[trace.length - 1][0] > 250)
          trace.push([elapsed, Number(me.x.toFixed(1)), Number(me.y.toFixed(1))])
        if (step.mode === 'topdown') {
          const path = step.path ?? [step.goal]
          let target = path[Math.min(waypoint, path.length - 1)]
          if (Math.abs(target.x - me.x) <= 2 && Math.abs(target.y - me.y) <= 2 && waypoint < path.length - 1) {
            waypoint += 1
            target = path[waypoint]
          }
          const keys: string[] = []
          // One axis at a time keeps the player centred in one-cell corridors.
          if (Math.abs(target.x - me.x) > 2) keys.push(target.x > me.x ? 'ArrowRight' : 'ArrowLeft')
          else if (Math.abs(target.y - me.y) > 2) keys.push(target.y > me.y ? 'ArrowUp' : 'ArrowDown')
          await hold(keys)
          await sleep(20)
          continue
        }
        const direction = step.goal.x >= me.x ? 1 : -1
        const onGround = read(now, { variable: 'onGround', target: step.player }) === 1
        const ahead = (x: number, y: number, distance: number): boolean =>
          (x - me.x) * direction > 0 && Math.abs(x - me.x) < distance && Math.abs(y - me.y) < 30
        const threat = (step.threats ?? []).some((name) => {
          const sprite = now.sprites[name]
          return sprite?.visible && ahead(sprite.x, sprite.y, 75)
        })
        const pit = (step.pits ?? []).some((x) => ahead(x, me.y, 40))
        if (Math.abs(me.x - lastProgress.x) > 4) lastProgress = { at: Date.now(), x: me.x }
        const stuck = Date.now() - lastProgress.at > 400
        const move = direction > 0 ? 'ArrowRight' : 'ArrowLeft'
        if (onGround && (threat || pit || stuck)) {
          await hold([move, 'ArrowUp'])
          await sleep(140)
          await hold([move])
          if (stuck) lastProgress = { at: Date.now(), x: me.x }
        } else {
          await hold([move])
          await sleep(30)
        }
      }
      await hold([])
    }

    // Spec games open on an instructions card; scenarios that test the game itself start by dismissing it.
    if (!scenario.keepIntro) await dismissIntro()

    for (const step of scenario.steps) {
      switch (step.kind) {
        case 'wait':
          await sleep(step.ms)
          break
        case 'until': {
          const deadline = Date.now() + step.ms
          while (Date.now() < deadline) {
            const value = read(await state(), step.subject)
            if (step.op === '==' ? value === step.value : step.op === '>' ? value > step.value : value < step.value)
              break
            await sleep(50)
          }
          break
        }
        case 'hold':
          for (const name of step.keys) await key(name, true)
          await sleep(step.ms)
          for (const name of step.keys) await key(name, false)
          break
        case 'set': {
          const requestId = randomUUID()
          await post({
            type: 'apply-runtime-patch',
            requestId,
            baseRevision: revision,
            revision: revision + 1,
            operations: [{ op: 'set-variable', target: 'Stage', name: step.variable, value: step.value }],
          })
          const reply = await takeReply('runtime-patch-result', requestId)
          if (!reply.ok)
            throw new Error(`runSpecScenario: could not set ${step.variable}: ${reply.error ?? 'unknown'}`)
          revision += 1
          break
        }
        case 'clicks': {
          const until = Date.now() + step.ms
          for (let index = 0; Date.now() < until; index += 1) {
            const live = step.entities ? (await clones()).filter((clone) => step.entities?.includes(clone.name)) : []
            const points = step.entities ? live.slice(0, 3) : (step.points ?? [])
            for (const point of points) await page.mouse.click(point.x + 240, 180 - point.y)
            await sleep(points.length > 0 ? 20 : 60)
          }
          break
        }
        case 'chase': {
          const until = Date.now() + step.ms
          const held = new Set<string>()
          const hold = async (wanted: readonly string[]): Promise<void> => {
            for (const name of [...held]) {
              if (wanted.includes(name)) continue
              held.delete(name)
              await key(name, false)
            }
            for (const name of wanted) {
              if (held.has(name)) continue
              held.add(name)
              await key(name, true)
            }
          }
          while (Date.now() < until) {
            const me = (await state()).sprites[step.player]
            if (!me) break
            const aim = (await clones())
              .filter((clone) => step.entities.includes(clone.name) && clone.y > me.y - 10)
              .reduce<{ x: number; y: number } | undefined>(
                (low, clone) => (!low || clone.y < low.y ? clone : low),
                undefined,
              )
            const keys = step.fire ? [step.fire] : []
            if (aim && Math.abs(aim.x - me.x) > 5) keys.push(aim.x > me.x ? 'ArrowRight' : 'ArrowLeft')
            await hold(keys)
            await sleep(20)
          }
          await hold([])
          break
        }
        case 'press':
        case 'release':
          for (const name of step.keys) await key(name, step.kind === 'press')
          break
        case 'mark':
          marks.set(step.name, await state())
          break
        case 'expect':
          evaluate(step, await state())
          break
        case 'bot':
          await bot(step)
          break
      }
    }
    return { name: scenario.name, ready: true, pageErrors, expectations, ...(trace ? { trace } : {}) }
  } catch (error) {
    return {
      name: scenario.name,
      ready: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      pageErrors,
      expectations: [],
    }
  } finally {
    await page.close()
  }
}
