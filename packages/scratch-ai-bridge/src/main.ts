import { Buffer } from 'node:buffer'
import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { initializeScratchVM } from './bootstrap/vm-bootstrap'
import { analyzeCanonicalProject, type AnalysisIR } from './core/analyzer'
import {
  exportLosslessSb3,
  patchLosslessSb3BlockGraphs,
  type RawSb3ArchiveEntry,
  type RawSb3Project,
} from './core/archive'
import { createAuthoringInstruction, createStudentProjectInstruction } from './core/capabilities'
import { compileCanonicalProjectToSb3, ProjectCompileError } from './core/compiler'
import { decompileSb3WithBlockGraphs, normalizeThroughVm } from './core/decompiler'
import type { VmNormalizationReport } from './core/decompiler/normalization-report'
import type { ProcedureNormalizationReport } from './core/decompiler/project-json'
import {
  createPreservationEditPrompt,
  parsePreservationEditPatch,
  type CanonicalBlockMappingEntry,
  type ScratchTargetBlockGraph,
} from './core/graph'
import sampleProject from './core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from './core/ir/types'
import { addExtractionRepair, normalizeAiDraft, normalizeAiResponse, parseAiResponse } from './core/normalizer'
import { createAnalysisPrompt, type TutorMode } from './core/prompt'
import {
  createAiOutputValidationReport,
  createRepairPrompt,
  createRepairReport,
  type AiOutputValidationReport,
  type RepairReport,
} from './core/repair'
import {
  validateCanonicalProject,
  validateCanonicalSemantics,
  type CanonicalIRValidationIssue,
  type CanonicalSemanticIssue,
} from './core/validator'
import {
  resolveAutomaticVisual,
  summarizeAutomaticVisuals,
  type AutomaticVisualSummary,
} from './core/visuals/presets'
import { SCRATCH_LINK_HARDWARE_EXTENSION_IDS } from './scratch/extensions'
import { renderSb3Preview } from './scratch/vm'
import './style.css'

globalThis.Buffer = Buffer

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      const appRoot = new URL('../', import.meta.url)
      void navigator.serviceWorker
        .register(new URL('../service-worker.js', import.meta.url), { scope: appRoot.pathname })
        .catch((error: unknown) => console.warn('Offline app cache could not be installed', error))
    },
    { once: true },
  )
}

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Scratch AI Bridge app root was not found')

// Fail early if the official VM cannot initialize in this browser/build.
const bootstrapVm = initializeScratchVM()
window.addEventListener('pagehide', () => bootstrapVm.quit(), { once: true })
const studentStageCanvas = document.createElement('canvas')
studentStageCanvas.width = 480
studentStageCanvas.height = 360
studentStageCanvas.className = 'student-preview-canvas'
studentStageCanvas.setAttribute('aria-label', 'Scratch 靜態舞台預覽（積木尚未執行）')
studentStageCanvas.hidden = true
let studentPreviewGeneration = 0
let studentPreviewRenderQueue: Promise<void> = Promise.resolve()
interface ActiveStudentAnimation {
  frame: HTMLIFrameElement
  token: string
  consentDialogs: Map<HTMLDialogElement, () => void>
  finish(message: string): void
  onLoaded(): void
  onReady(): void
  onHardwareMessage(message: Record<string, unknown>): void
}
let activeStudentAnimation: ActiveStudentAnimation | null = null
let speechConsentPromptQueue: Promise<void> = Promise.resolve()

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const active = activeStudentAnimation
  if (!active || event.origin !== 'null' || typeof event.data !== 'object' || event.data === null) return
  const message = event.data as {
    type?: unknown
    detail?: unknown
    token?: unknown
    requestId?: unknown
    text?: unknown
    service?: unknown
    language?: unknown
  }
  if (message.token !== active.token) return
  if (typeof message.type === 'string' && message.type.startsWith('hardware-')) {
    if (event.source === active.frame.contentWindow) active.onHardwareMessage(message)
    return
  }
  if (message.type === 'extension-egress-consent-request') {
    const service = message.service
    const maxLength = service === 'speech' ? 128 : service === 'translation' ? 1024 : 0
    if (
      event.source !== active.frame.contentWindow ||
      typeof message.requestId !== 'string' ||
      typeof message.text !== 'string' ||
      maxLength === 0 ||
      message.text.length > maxLength ||
      (service === 'translation' && typeof message.language !== 'string')
    )
      return
    const requestId = message.requestId
    const speechText = message.text
    const targetLanguage = typeof message.language === 'string' ? message.language : ''
    speechConsentPromptQueue = speechConsentPromptQueue
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((finishPrompt) => {
            if (activeStudentAnimation !== active) {
              active.frame.contentWindow?.postMessage(
                {
                  type: 'tts-consent-response',
                  token: active.token,
                  requestId,
                  allowed: false,
                },
                '*',
              )
              finishPrompt()
              return
            }
            const dialog = document.createElement('dialog')
            dialog.setAttribute('aria-labelledby', 'speech-consent-title')
            const title = document.createElement('h2')
            title.id = 'speech-consent-title'
            title.textContent = service === 'speech' ? '允許 Scratch 文字轉語音？' : '允許 Scratch 翻譯文字？'
            const description = document.createElement('p')
            description.textContent =
              service === 'speech'
                ? '這次執行會把以下文字傳送到 Scratch 合成服務產生語音：'
                : `這次執行會把以下文字傳送到 Scratch 翻譯服務（目標語言：${targetLanguage}）：`
            const quote = document.createElement('blockquote')
            quote.textContent = speechText
            const actions = document.createElement('div')
            actions.className = 'student-preview-actions'
            const deny = document.createElement('button')
            deny.type = 'button'
            deny.className = 'button secondary'
            deny.textContent = '拒絕'
            const allow = document.createElement('button')
            allow.type = 'button'
            allow.className = 'button primary'
            allow.textContent = '只允許這次'
            actions.append(deny, allow)
            dialog.append(title, description, quote, actions)
            document.body.append(dialog)
            const settle = (allowed: boolean): void => {
              if (dialog.open) dialog.close()
              dialog.remove()
              active.consentDialogs.delete(dialog)
              if (activeStudentAnimation === active)
                active.frame.contentWindow?.postMessage(
                  {
                    type: 'tts-consent-response',
                    token: active.token,
                    requestId,
                    allowed,
                  },
                  '*',
                )
              finishPrompt()
            }
            active.consentDialogs.set(dialog, () => settle(false))
            deny.addEventListener('click', () => settle(false), { once: true })
            allow.addEventListener('click', () => settle(true), { once: true })
            dialog.addEventListener('cancel', (cancelEvent) => {
              cancelEvent.preventDefault()
              settle(false)
            })
            dialog.showModal()
          }),
      )
    return
  }
  if (message.type === 'loaded') active.onLoaded()
  else if (message.type === 'ready') active.onReady()
  else if (message.type === 'stopped') active.finish('動畫預覽已停止；舞台靜態畫面已恢復。')
  else if (message.type === 'error') {
    const detail = typeof message.detail === 'string' ? `：${message.detail}` : ''
    active.finish(`動畫預覽載入失敗${detail}`)
  }
})

const stopStudentAnimation = (message: string): void => {
  activeStudentAnimation?.finish(message)
}

const AI_INSTRUCTION = createAuthoringInstruction()

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">不用安裝 · 專案不上傳；外送文字前會先徵求同意</div>
        <h1>AI × Scratch 作品轉換器</h1>
        <p class="lede">把你的遊戲想法交給 AI，再將 AI 回覆變成可在 Scratch 開啟的專案。</p>
      </div>
      <div class="status-pill"><span></span> Scratch 工具已準備好</div>
    </header>

    <nav class="tabs" role="tablist" aria-label="選擇功能">
      <button id="generate-tab" class="tab active" role="tab" aria-selected="true" aria-controls="generate-panel" data-tab="generate">用 AI 做 Scratch</button>
      <button id="analyze-tab" class="tab" role="tab" aria-selected="false" aria-controls="analyze-panel" data-tab="analyze">請 AI 幫我檢查作品</button>
    </nav>

    <div class="workspace">
      <section id="generate-panel" class="panel-grid" role="tabpanel" aria-labelledby="generate-tab">
        <ol class="progress-steps" aria-label="製作進度">
          <li class="current"><span>1</span>描述作品</li>
          <li><span>2</span>交給 AI</li>
          <li><span>3</span>貼回覆</li>
          <li><span>4</span>下載作品</li>
        </ol>
        <article class="card idea-card">
          <div class="step-heading"><span>1</span><div><h2>你想做什麼作品？</h2><p>用平常說話的方式描述角色、玩法和目標。</p></div></div>
          <label for="project-request" class="field-label">我的作品想法</label>
          <textarea id="project-request" class="request-input" maxlength="1000" placeholder="例如：做一個平台遊戲，角色可以左右移動和跳躍，收集金幣會加分。"></textarea>
          <div class="idea-examples" aria-label="作品想法範例">
            <span>試試看：</span>
            <button type="button" class="idea-chip" data-request="做一個平台遊戲：角色可以用方向鍵左右移動、按上鍵跳躍，收集金幣會加分，碰到敵人會失去生命。">平台遊戲</button>
            <button type="button" class="idea-chip" data-request="做一個方向鍵挑戰：按左右方向鍵移動角色，每移動一次就增加分數，達到 100 分時說出過關。">方向鍵挑戰</button>
            <button type="button" class="idea-chip" data-request="做一個動畫故事：點綠旗後，兩個角色輪流說話、移動，最後廣播結束訊息。">動畫故事</button>
          </div>
          <div class="button-row"><button id="copy-instruction" class="button primary" disabled>複製完整訊息給 AI</button></div>
          <p id="copy-status" class="inline-status" role="status" aria-live="polite">先寫下作品想法，或選一個範例。</p>
        </article>
        <article class="card wide">
          <div class="step-heading"><span>2</span><div><h2>把 AI 的完整回覆貼在這裡</h2><p>可以整段貼上，不需要刪除 AI 的說明或程式碼框。</p></div></div>
          <label for="json-editor" class="visually-hidden">AI 的完整回覆</label>
          <textarea id="json-editor" class="mono editor student-editor" spellcheck="false" placeholder="回到 AI 對話，複製完整回覆後貼在這裡。"></textarea>
          <div class="button-row student-actions"><button id="student-build" class="button primary">檢查並製作 Scratch</button><button id="load-sample" class="button secondary">試用平台遊戲範例</button></div>
          <div id="generate-status" class="status-box" role="status" aria-live="polite"></div>
          <section id="student-result" class="student-result" hidden>
            <strong id="student-result-title"></strong>
            <p id="student-result-message"></p>
            <div id="student-preview" class="student-preview" hidden aria-label="作品畫面預覽"></div>
            <button id="download-student-validation-report" class="button secondary" hidden>下載驗證報告.json</button>
          </section>
          <section id="repair-tools" class="repair-tools" aria-label="AI 修復回饋" hidden>
            <div class="repair-report-head"><strong id="repair-title">作品還有幾個地方需要確認</strong></div>
            <p id="repair-explanation"></p>
            <div class="button-row"><button id="copy-repair-prompt" class="button primary">複製修正訊息給 AI</button></div>
            <details class="technical-details">
              <summary>查看教師／技術資料</summary>
              <p id="repair-summary"></p>
              <div class="button-row">
                <button id="copy-repair-report" class="button secondary">複製錯誤報告</button>
                <button id="download-repair-report" class="button secondary">下載報告.json</button>
                <button id="undo-repair" class="button secondary">復原修復前內容</button>
              </div>
            </details>
            <div id="clipboard-fallback" class="clipboard-fallback" hidden>
              <label for="clipboard-fallback-text">瀏覽器拒絕剪貼簿存取，請從這裡全選複製：</label>
              <textarea id="clipboard-fallback-text" class="mono compact" readonly></textarea>
            </div>
          </section>
          <details id="advanced-tools" class="advanced-tools">
            <summary>教師／進階工具</summary>
            <div class="advanced-content">
              <div class="card-head"><h3>AI 格式規則</h3></div>
              <label for="instruction" class="field-label">完整 Canonical IR 指令</label>
              <textarea id="instruction" class="mono compact" readonly></textarea>
              <div class="button-row"><button id="repair" class="button secondary">擷取／修復回覆</button><button id="validate" class="button secondary">檢查技術格式</button><button id="compile" class="button secondary">直接編譯 .sb3</button></div>
            </div>
          </details>
        </article>
      </section>

      <section id="analyze-panel" class="panel-grid" role="tabpanel" aria-labelledby="analyze-tab" hidden>
        <article class="card">
          <h2>1. 選擇 Scratch 專案</h2>
          <label class="dropzone" id="dropzone"><strong>選擇或拖入 Scratch 專案</strong><span>專案檔不會上傳到伺服器；動畫預覽使用語音或翻譯積木時，會先詢問是否傳送文字。</span><input id="sb3-file" class="visually-hidden" type="file" accept=".sb3,application/zip"></label>
          <div id="file-status" class="status-box" role="status" aria-live="polite"></div>
        </article>
        <article class="card">
          <h2>2. 作品檢查結果</h2>
          <div id="stats" class="stats muted">尚未載入專案</div>
          <div id="diagnostics" class="diagnostics"></div>
          <details class="target-script-list"><summary>角色與程式清單</summary><div id="target-script-list"></div></details>
        </article>
        <article class="card wide">
          <h2>3. 請 AI 協助</h2>
          <div class="analysis-controls">
            <label>你想了解什麼？ <input id="question" type="text" placeholder="例如：為什麼角色沒有收到廣播？"></label>
            <label>回答方式 <select id="tutor-mode"><option value="student">給學生提示</option><option value="teacher">給老師建議</option></select></label>
            <label>提示程度 <select id="hint-level"><option value="1">簡短提示</option><option value="2" selected>逐步引導</option><option value="3">詳細說明</option><option value="4">完整解法</option></select></label>
          </div>
          <div class="button-row"><button id="copy-prompt" class="button primary" disabled>複製問題給 AI</button><button id="preview-imported-project" class="button secondary" disabled>預覽匯入作品</button></div>
          <details class="advanced-tools">
            <summary>查看教師／技術資料</summary>
            <div class="button-row"><button id="download-original-sb3" class="button secondary" disabled>下載保留原始資料副本 .sb3</button><button id="normalize-vm-sb3" class="button secondary" disabled>VM 正規化並下載 .sb3</button><button id="download-vm-normalization-report" class="button secondary" disabled>下載 VM 差異報告.json</button><button id="download-canonical" class="button secondary" disabled>下載 Canonical IR</button><button id="download-analysis" class="button secondary" disabled>下載 Analysis IR</button><button id="download-procedure-report" class="button secondary" disabled>下載程序正規化報告</button><button id="download-block-mapping" class="button secondary" disabled>下載 Canonical／Scratch 積木對照表</button></div>
            <section class="preservation-edit">
              <h3>保留原始資料的局部積木修改</h3>
              <p>只修改指定積木；未修改的未知積木、extension 欄位與素材會沿用上傳的原始 SB3。</p>
              <label class="field-label" for="preservation-request">希望 AI 修改什麼？</label>
              <textarea id="preservation-request" class="compact" maxlength="2000" placeholder="例如：修正玩家收到 game_over 廣播後仍繼續移動的問題。"></textarea>
              <div class="button-row"><button id="copy-preservation-prompt" class="button secondary" disabled>複製保留式修正指令</button></div>
              <div id="preservation-clipboard-fallback" class="clipboard-fallback" hidden>
                <label for="preservation-clipboard-fallback-text">無法直接複製時，請從這裡全選指令：</label>
                <textarea id="preservation-clipboard-fallback-text" class="mono compact" readonly></textarea>
              </div>
              <label class="field-label" for="preservation-patch">貼上 AI 回覆的 patch JSON</label>
              <textarea id="preservation-patch" class="mono compact" rows="8" placeholder="AI 回覆的 block-graph-patch JSON"></textarea>
              <div class="button-row"><button id="apply-preservation-patch" class="button secondary" disabled>驗證 patch 並下載保留原資料的 .sb3</button></div>
              <div id="preservation-status" class="status-box" role="status" aria-live="polite"></div>
            </section>
            <div class="output-grid">
              <div><h3>Analysis IR</h3><pre id="analysis-output">—</pre></div>
              <div><h3>Canonical IR</h3><pre id="canonical-output">—</pre></div>
              <div><h3>Procedure normalization report</h3><pre id="procedure-normalization-output">—</pre></div>
              <div><h3>VM normalization report</h3><pre id="vm-normalization-output">尚未執行 VM 正規化</pre></div>
            </div>
          </details>
        </article>
      </section>
    </div>
  </div>
`

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing element #${id}`)
  return element as T
}

const instruction = byId<HTMLTextAreaElement>('instruction')
const editor = byId<HTMLTextAreaElement>('json-editor')
const generateStatus = byId<HTMLDivElement>('generate-status')
const projectRequest = byId<HTMLTextAreaElement>('project-request')
const copyInstruction = byId<HTMLButtonElement>('copy-instruction')
const copyStatus = byId<HTMLParagraphElement>('copy-status')
const studentResult = byId<HTMLElement>('student-result')
const studentResultTitle = byId<HTMLElement>('student-result-title')
const studentResultMessage = byId<HTMLParagraphElement>('student-result-message')
const studentPreview = byId<HTMLDivElement>('student-preview')
const downloadStudentValidationReport = byId<HTMLButtonElement>('download-student-validation-report')
const progressSteps = [...document.querySelectorAll<HTMLElement>('.progress-steps li')]
instruction.value = AI_INSTRUCTION
editor.value = ''

const setStatus = (element: HTMLElement, text: string, kind: 'ok' | 'error' | 'neutral' = 'neutral') => {
  element.textContent = text
  element.dataset.kind = kind
}

const setProgress = (step: 1 | 2 | 3 | 4): void => {
  progressSteps.forEach((item, index) => {
    const itemStep = index + 1
    item.classList.toggle('current', itemStep === step)
    item.classList.toggle('completed', itemStep < step)
    if (itemStep === step) item.setAttribute('aria-current', 'step')
    else item.removeAttribute('aria-current')
  })
}

interface RepairContext {
  readonly report: RepairReport
  readonly currentProject: unknown
  readonly validationReport?: AiOutputValidationReport
}

const repairTools = byId<HTMLElement>('repair-tools')
const repairTitle = byId<HTMLElement>('repair-title')
const repairSummary = byId<HTMLParagraphElement>('repair-summary')
const repairExplanation = byId<HTMLParagraphElement>('repair-explanation')
const copyRepairPrompt = byId<HTMLButtonElement>('copy-repair-prompt')
const copyRepairReport = byId<HTMLButtonElement>('copy-repair-report')
const downloadRepairReport = byId<HTMLButtonElement>('download-repair-report')
const undoRepair = byId<HTMLButtonElement>('undo-repair')
const clipboardFallback = byId<HTMLElement>('clipboard-fallback')
const clipboardFallbackText = byId<HTMLTextAreaElement>('clipboard-fallback-text')
let latestRepairContext: RepairContext | null = null
let repairUndoSnapshot: string | null = null
let latestStudentValidationReport: AiOutputValidationReport | null = null

const renderRepairTools = (): void => {
  const report = latestRepairContext?.report
  const hasIssues = (report?.issues.length ?? 0) > 0
  const actionable = (report?.summary.errors ?? 0) + (report?.summary.warnings ?? 0)
  repairTools.hidden = !hasIssues && repairUndoSnapshot === null
  copyRepairPrompt.disabled = actionable === 0
  copyRepairReport.disabled = !hasIssues
  downloadRepairReport.disabled = !hasIssues
  undoRepair.disabled = repairUndoSnapshot === null
  const phaseSummary = report
    ? Object.entries(
        report.issues.reduce<Partial<Record<(typeof report.issues)[number]['phase'], number>>>((counts, issue) => {
          counts[issue.phase] = (counts[issue.phase] ?? 0) + 1
          return counts
        }, {}),
      )
        .map(([phase, count]) => `${phase} ${count}`)
        .join('、')
    : ''
  repairSummary.textContent = report
    ? `自動修復 ${report.summary.autoRepaired} · 必須修正 ${report.summary.errors} · 需要確認 ${report.summary.warnings}${phaseSummary ? ` · ${phaseSummary}` : ''}`
    : '沒有目前診斷'
  repairTitle.textContent = report
    ? report.summary.errors > 0
      ? '作品資料還不完整'
      : report.summary.warnings > 0
        ? '作品還有幾個地方需要確認'
        : '格式已自動整理完成'
    : '作品檢查結果'
  repairExplanation.textContent = report
    ? report.summary.errors > 0
      ? `AI 回覆還缺少 ${report.summary.errors} 個製作作品需要的資料。請複製修正訊息，貼回 AI 後再試一次。`
      : report.summary.warnings > 0
        ? `有 ${report.summary.warnings} 個遊戲規則不夠清楚。Bridge 不會自行猜測，以免改變你的作品。`
        : `已自動整理 ${report.summary.autoRepaired} 個格式問題；作品內容沒有需要確認的地方。`
    : ''
}

const publishRepairContext = (
  report: RepairReport,
  currentProject: unknown,
  validationReport?: AiOutputValidationReport,
): void => {
  latestRepairContext = { report, currentProject, ...(validationReport ? { validationReport } : {}) }
  clipboardFallback.hidden = true
  renderRepairTools()
}

const clearRepairContext = (): void => {
  latestRepairContext = null
  clipboardFallback.hidden = true
  renderRepairTools()
}

const setStudentResult = (title: string, message: string, kind: 'success' | 'attention'): void => {
  studentResult.hidden = false
  studentResult.dataset.kind = kind
  studentResultTitle.textContent = title
  studentResultMessage.textContent = message
}

const costumeImageSource = (costume: CanonicalProject['stage']['costumes'][number] | undefined): string | null => {
  if (!costume?.data || costume.assetIssue) return null
  if (costume.data.startsWith('data:')) return costume.data
  if (costume.dataFormat === 'svg' && costume.data.trimStart().startsWith('<svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(costume.data)}`
  }
  return null
}

const createAnimationPreviewArchive = async (
  project: CanonicalProject,
  source: RawSb3Project | undefined,
): Promise<{ archive: Blob | null; fallbackCount: number }> => {
  if (!source) return { archive: null, fallbackCount: 0 }
  const previewProject = structuredClone(source.projectJson)
  if (!Array.isArray(previewProject.targets)) return { archive: null, fallbackCount: 0 }
  const rawTargets: unknown[] = previewProject.targets
  const canonicalTargets = [project.stage, ...project.sprites]
  const usedPaths = new Set(source.entries.map((entry) => entry.name))
  const addedEntries: RawSb3ArchiveEntry[] = []
  let fallbackCount = 0

  for (const [targetIndex, canonicalTarget] of canonicalTargets.entries()) {
    const rawTarget = rawTargets[targetIndex]
    if (typeof rawTarget !== 'object' || rawTarget === null || Array.isArray(rawTarget)) continue
    const rawTargetRecord = rawTarget as Record<string, unknown>
    const rawCostumes: unknown[] = Array.isArray(rawTargetRecord.costumes) ? rawTargetRecord.costumes : []
    rawTargetRecord.costumes = rawCostumes

    for (const [costumeIndex, canonicalCostume] of canonicalTarget.costumes.entries()) {
      if (canonicalCostume.data && !canonicalCostume.assetIssue) continue
      const visual = resolveAutomaticVisual({
        isStage: targetIndex === 0,
        projectName: project.name,
        targetName: canonicalTarget.name,
        costumeName: canonicalCostume.name,
      })
      let bytes = new TextEncoder().encode(visual.data)
      let assetId = bytesToHex(md5(bytes))
      let path = `${assetId}.svg`
      let collisionIndex = 0
      while (usedPaths.has(path)) {
        collisionIndex += 1
        bytes = new TextEncoder().encode(`${visual.data}\n<!-- Scratch AI Bridge preview ${collisionIndex} -->`)
        assetId = bytesToHex(md5(bytes))
        path = `${assetId}.svg`
      }
      usedPaths.add(path)
      const rawCostume = rawCostumes[costumeIndex]
      const costumeRecord =
        typeof rawCostume === 'object' && rawCostume !== null && !Array.isArray(rawCostume)
          ? (rawCostume as Record<string, unknown>)
          : {}
      Object.assign(costumeRecord, {
        assetId,
        dataFormat: 'svg',
        md5ext: path,
        bitmapResolution: 1,
        rotationCenterX: visual.rotationCenterX,
        rotationCenterY: visual.rotationCenterY,
      })
      rawCostumes[costumeIndex] = costumeRecord
      addedEntries.push({
        centralDirectoryIndex: source.entries.length + addedEntries.length,
        name: path,
        filenameBytes: new TextEncoder().encode(path),
        filenameEncoding: 'utf-8',
        isDirectory: false,
        bytes,
        sha256: '',
        compressionMethod: 8,
        crc32: '',
        compressedSize: 0,
        uncompressedSize: bytes.byteLength,
        flags: 0,
        externalAttributes: 0,
        localHeaderOffset: 0,
        date:
          source.entries.find((entry) => entry.name === source.projectEntryName)?.date ?? new Date(0).toISOString(),
      })
      fallbackCount += 1
    }
  }

  if (fallbackCount === 0) return { archive: null, fallbackCount }
  const projectJsonBytes = new TextEncoder().encode(JSON.stringify(previewProject))
  const archive = await exportLosslessSb3({
    ...source,
    projectJson: previewProject,
    projectJsonBytes,
    entries: [...source.entries, ...addedEntries],
  })
  return { archive, fallbackCount }
}

const renderStudentPreview = (project: CanonicalProject, sb3: Blob, rawSource?: RawSb3Project): void => {
  stopStudentAnimation('動畫預覽已停止；舞台靜態畫面已恢復。')
  const generation = ++studentPreviewGeneration
  studentPreview.replaceChildren()
  const previewCostume = (
    costume: CanonicalProject['stage']['costumes'][number] | undefined,
    isStage: boolean,
    targetName: string,
  ): CanonicalProject['stage']['costumes'][number] => {
    if (costume?.data && !costume.assetIssue) return costume
    const name = costume?.name ?? (isStage ? 'backdrop1' : 'costume1')
    const visual = resolveAutomaticVisual({
      isStage,
      projectName: project.name,
      targetName,
      costumeName: name,
    })
    return { name, dataFormat: 'svg', data: visual.data }
  }
  const stageCostumes = project.stage.costumes
  const sourceStageCostume = stageCostumes.at(project.stage.currentCostume ?? 0) ?? stageCostumes.at(0)
  const stageCostume = previewCostume(sourceStageCostume, true, project.stage.name)
  const stageSource = costumeImageSource(stageCostume)
  if (!stageSource) {
    studentPreview.hidden = true
    return
  }

  const background = document.createElement('img')
  background.className = 'student-preview-background'
  background.alt = `${stageCostume.name}預覽`
  background.src = stageSource
  const stageFrame = document.createElement('div')
  stageFrame.className = 'student-preview-stage'
  const stageStatus = document.createElement('p')
  stageStatus.className = 'student-preview-stage-status'
  const stageAssetFallback = Boolean(sourceStageCostume?.assetIssue)
  stageStatus.textContent = stageAssetFallback
    ? `背景素材「${stageCostume.name}」無法使用；目前顯示示意背景。`
    : '積木尚未執行；預覽顯示作品儲存時的舞台狀態。'
  stageStatus.hidden = false
  stageFrame.append(background, studentStageCanvas, stageStatus)
  const previewColumn = document.createElement('div')
  previewColumn.className = 'student-preview-main'
  previewColumn.append(stageFrame)

  const previewActions = document.createElement('div')
  previewActions.className = 'student-preview-actions'
  const hardwareControls = document.createElement('div')
  hardwareControls.className = 'student-preview-hardware'
  hardwareControls.hidden = true
  const hardwareNotice = document.createElement('p')
  hardwareNotice.textContent =
    '搜尋裝置會連線本機 Scratch Link；若無法使用，Scratch VM 會嘗試 Scratch Device Manager。搜尋後，裝置資料與積木控制指令會經該連線傳輸。'
  hardwareControls.append(hardwareNotice)
  const hardwareExtensions = (project.extensions ?? []).filter((id) => SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(id))
  const hardwareRows = new Map<
    string,
    { status: HTMLSpanElement; devices: HTMLDivElement; scan: HTMLButtonElement; disconnect: HTMLButtonElement }
  >()
  const sendHardwareCommand = (command: Record<string, unknown>): void => {
    const active = activeStudentAnimation
    if (!active) return
    active.frame.contentWindow?.postMessage({ ...command, token: active.token }, '*')
  }
  const hardwareLabels: Record<string, string> = {
    wedo2: 'WeDo 2.0',
    microbit: 'micro:bit',
    ev3: 'EV3',
    boost: 'Boost',
    gdxfor: 'GDX for',
  }
  for (const extensionId of hardwareExtensions) {
    const row = document.createElement('div')
    row.className = 'student-preview-hardware-row'
    const title = document.createElement('strong')
    title.textContent = hardwareLabels[extensionId] ?? extensionId
    const status = document.createElement('span')
    status.textContent = '尚未搜尋裝置'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    const scan = document.createElement('button')
    scan.type = 'button'
    scan.className = 'button secondary'
    scan.textContent = '搜尋裝置'
    const disconnect = document.createElement('button')
    disconnect.type = 'button'
    disconnect.className = 'button secondary'
    disconnect.textContent = '中斷連線'
    disconnect.hidden = true
    const devices = document.createElement('div')
    devices.className = 'student-preview-hardware-devices'
    scan.addEventListener('click', () => {
      status.textContent = '正在搜尋；請確認 Scratch Link 已啟動。'
      devices.replaceChildren()
      scan.disabled = true
      sendHardwareCommand({ type: 'scan-peripheral', extensionId })
    })
    disconnect.addEventListener('click', () => {
      sendHardwareCommand({ type: 'disconnect-peripheral', extensionId })
    })
    row.append(title, status, scan, disconnect, devices)
    hardwareControls.append(row)
    hardwareRows.set(extensionId, { status, devices, scan, disconnect })
  }
  if (hardwareExtensions.length > 0) previewColumn.append(hardwareControls)
  const startAnimation = document.createElement('button')
  startAnimation.type = 'button'
  startAnimation.className = 'button secondary'
  startAnimation.textContent = '執行作品（最多 15 秒）'
  const stopAnimation = document.createElement('button')
  stopAnimation.type = 'button'
  stopAnimation.className = 'button secondary'
  stopAnimation.textContent = '停止預覽'
  stopAnimation.hidden = true
  previewActions.append(startAnimation, stopAnimation)
  previewColumn.append(previewActions)
  studentPreview.append(previewColumn)

  const animationArchivePromise: Promise<{ archive: Blob | null; fallbackCount: number; error?: Error }> =
    createAnimationPreviewArchive(project, rawSource).catch((error: unknown) => ({
      archive: null,
      fallbackCount: 0,
      error: error instanceof Error ? error : new Error('無法準備損壞素材的動畫示意圖。'),
    }))

  let animationStarting = false
  startAnimation.addEventListener('click', () => {
    if (activeStudentAnimation || animationStarting || generation !== studentPreviewGeneration) return
    animationStarting = true
    startAnimation.disabled = true
    stageStatus.hidden = false
    stageStatus.textContent = '正在安全預覽中；可點擊舞台並使用鍵盤控制。'

    void (async () => {
      const prepared = await animationArchivePromise
      if (generation !== studentPreviewGeneration) return
      animationStarting = false
      if (prepared.error) throw prepared.error
      if (prepared.fallbackCount > 0) {
        stageStatus.textContent = `正在安全預覽中；已為 ${prepared.fallbackCount} 個損壞造型準備示意素材。`
      }

      const frame = document.createElement('iframe')
      const token = crypto.randomUUID()
      frame.className = 'student-preview-animation'
      frame.title = 'Scratch 作品動畫預覽（隔離執行）'
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('allow', 'autoplay')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.style.opacity = '0'
      frame.style.pointerEvents = 'none'
      frame.setAttribute('aria-hidden', 'true')

      let timer: number | null = null
      const animation: ActiveStudentAnimation = {
        frame,
        token,
        consentDialogs: new Map(),
        onLoaded: () => {
          if (generation !== studentPreviewGeneration) return
          stageStatus.textContent = '預覽環境已載入，正在匯入作品。'
          frame.contentWindow?.postMessage(
            { type: 'start-preview', archive: prepared.archive ?? sb3, extensions: hardwareExtensions, token },
            '*',
          )
        },
        onReady: () => {
          if (generation !== studentPreviewGeneration) return
          if (timer !== null) window.clearTimeout(timer)
          timer = window.setTimeout(() => animation.finish('動畫預覽已達 15 秒上限，已自動停止。'), 15_000)
          frame.style.opacity = '1'
          frame.style.pointerEvents = ''
          frame.removeAttribute('aria-hidden')
          studentStageCanvas.hidden = true
          background.hidden = true
          stageStatus.hidden = false
          stageStatus.textContent = `動畫執行中。${prepared.fallbackCount > 0 ? `已將 ${prepared.fallbackCount} 個損壞造型替換為示意素材。` : ''}點擊舞台後可用方向鍵、空白鍵或作品中的滑鼠操作；預覽最多 15 秒。`
          if (hardwareExtensions.length > 0) hardwareControls.hidden = false
          startAnimation.hidden = true
          startAnimation.disabled = false
          stopAnimation.hidden = false
        },
        onHardwareMessage: (message) => {
          const extensionId = message.extensionId
          if (typeof extensionId !== 'string') return
          const row = hardwareRows.get(extensionId)
          if (!row) return
          if (message.type === 'hardware-status' && typeof message.status === 'string') {
            row.status.textContent = typeof message.detail === 'string' ? message.detail : message.status
            row.disconnect.hidden = message.status !== 'connected'
            const operationInProgress = message.status === 'searching' || message.status === 'connecting'
            for (const hardwareRow of hardwareRows.values()) hardwareRow.scan.disabled = operationInProgress
            if (message.status === 'connected') row.devices.replaceChildren()
          } else if (message.type === 'hardware-peripherals' && Array.isArray(message.peripherals)) {
            row.devices.replaceChildren()
            for (const hardwareRow of hardwareRows.values()) hardwareRow.scan.disabled = false
            row.status.textContent =
              message.peripherals.length > 0 ? '找到裝置，選擇要連線的項目：' : '沒有找到裝置。'
            for (const peripheral of message.peripherals.slice(0, 20)) {
              if (typeof peripheral !== 'object' || peripheral === null) continue
              const item = peripheral as { id?: unknown; name?: unknown }
              if (
                !(typeof item.id === 'string' || typeof item.id === 'number') ||
                String(item.id).length === 0 ||
                String(item.id).length > 128 ||
                (typeof item.id === 'number' && !Number.isFinite(item.id))
              )
                continue
              const connect = document.createElement('button')
              connect.type = 'button'
              connect.className = 'button secondary'
              connect.textContent = `連線：${typeof item.name === 'string' ? item.name.slice(0, 100) : 'Scratch 裝置'}`
              connect.addEventListener('click', () => {
                row.status.textContent = '正在連線…'
                row.scan.disabled = true
                sendHardwareCommand({ type: 'connect-peripheral', extensionId, peripheralId: item.id })
              })
              row.devices.append(connect)
            }
          }
        },
        finish: (message: string) => {
          if (activeStudentAnimation === animation) activeStudentAnimation = null
          if (timer !== null) window.clearTimeout(timer)
          for (const closeConsent of animation.consentDialogs.values()) closeConsent()
          frame.remove()
          if (generation !== studentPreviewGeneration) return
          studentStageCanvas.hidden = false
          background.hidden = true
          stageStatus.hidden = false
          stageStatus.textContent = message
          hardwareControls.hidden = true
          for (const row of hardwareRows.values()) {
            row.scan.disabled = false
            row.disconnect.hidden = true
            row.devices.replaceChildren()
            row.status.textContent = '尚未搜尋裝置'
          }
          startAnimation.hidden = false
          startAnimation.disabled = false
          stopAnimation.hidden = true
        },
      }
      activeStudentAnimation = animation
      timer = window.setTimeout(() => animation.finish('動畫預覽載入超過 60 秒，已停止以釋放資源。'), 60_000)
      stopAnimation.addEventListener('click', () => {
        frame.contentWindow?.postMessage({ type: 'stop-preview', token }, '*')
        animation.finish('已手動停止動畫預覽；舞台靜態畫面已恢復。')
      })
      const previewUrl = new URL('preview.html', document.baseURI)
      previewUrl.searchParams.set('token', token)
      previewUrl.searchParams.set('scratchSvgRendererOpaquePreview', '1')
      frame.src = previewUrl.toString()
      stageFrame.append(frame)
    })().catch((error: unknown) => {
      animationStarting = false
      startAnimation.disabled = false
      stageStatus.textContent = error instanceof Error ? error.message : '無法準備動畫預覽。'
      stageStatus.dataset.kind = 'warning'
    })
  })

  const spriteList = document.createElement('div')
  spriteList.className = 'student-preview-sprites'

  for (const sprite of project.sprites) {
    if (!sprite.visible) continue
    const costumes = sprite.costumes
    const sourceCostume = costumes.at(sprite.currentCostume ?? 0) ?? costumes.at(0)
    const costume = previewCostume(sourceCostume, false, sprite.name)
    const source = costumeImageSource(costume)
    if (!source) continue
    const image = document.createElement('img')
    image.className = 'student-preview-sprite'
    image.alt = `${sprite.name}預覽`
    image.src = source
    const tile = document.createElement('figure')
    tile.className = 'student-preview-tile'
    const caption = document.createElement('figcaption')
    caption.textContent = sourceCostume?.assetIssue ? `${sprite.name}（素材示意）` : sprite.name
    tile.append(image, caption)
    spriteList.append(tile)
  }
  if (spriteList.childElementCount > 0) studentPreview.append(spriteList)
  studentPreview.hidden = false

  studentPreviewRenderQueue = studentPreviewRenderQueue
    .catch(() => undefined)
    .then(async () => {
      const prepared = await animationArchivePromise
      if (prepared.error) throw prepared.error
      await renderSb3Preview(prepared.archive ?? sb3, bootstrapVm, studentStageCanvas)
    })
    .then(() => {
      if (generation !== studentPreviewGeneration) return
      studentStageCanvas.hidden = false
      background.hidden = !stageAssetFallback
      stageStatus.hidden = !stageAssetFallback
      if (stageAssetFallback) stageStatus.dataset.kind = 'warning'
    })
    .catch(() => {
      if (generation !== studentPreviewGeneration) return
      studentStageCanvas.hidden = true
      stageStatus.textContent = '舞台預覽無法顯示；仍可檢視右側的角色造型縮圖。'
      stageStatus.dataset.kind = 'warning'
    })
}

const clearStudentResult = (): void => {
  stopStudentAnimation('動畫預覽已停止；作品結果已清除。')
  studentPreviewGeneration += 1
  latestStudentValidationReport = null
  downloadStudentValidationReport.hidden = true
  studentResult.hidden = true
  studentResult.removeAttribute('data-kind')
  studentResultTitle.textContent = ''
  studentResultMessage.textContent = ''
  studentPreview.replaceChildren()
  studentPreview.hidden = true
}

const diagnoseEditor = (compileError?: unknown): RepairContext => {
  try {
    const normalized = normalizeAiResponse(editor.value)
    const validation = validateCanonicalProject(normalized.data)
    if (!validation.valid) {
      return {
        report: createRepairReport({
          data: normalized.data,
          repairs: normalized.repairs,
          normalizationWarnings: normalized.warnings,
          schemaIssues: validation.errors,
        }),
        currentProject: normalized.data,
      }
    }
    const semanticIssues = validateCanonicalSemantics(validation.data)
    return {
      report: createRepairReport({
        data: validation.data,
        repairs: normalized.repairs,
        normalizationWarnings: normalized.warnings,
        semanticIssues,
        ...(compileError === undefined ? {} : { compileError }),
      }),
      currentProject: validation.data,
    }
  } catch (parseError) {
    return {
      report: createRepairReport({ parseError }),
      currentProject: editor.value,
    }
  }
}

const publishEditorDiagnostics = (compileError?: unknown): void => {
  const context = diagnoseEditor(compileError)
  publishRepairContext(context.report, context.currentProject)
}

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const downloadJson = (value: unknown, filename: string) => {
  download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename)
}

const copyTextWithFallback = async (text: string, successMessage: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    clipboardFallback.hidden = true
    setStatus(generateStatus, successMessage, 'ok')
  } catch {
    clipboardFallbackText.value = text
    clipboardFallback.hidden = false
    clipboardFallbackText.focus()
    clipboardFallbackText.select()
    setStatus(generateStatus, '瀏覽器拒絕剪貼簿存取；已在下方提供可全選複製的完整內容。', 'error')
  }
}

const formatValidationErrors = (errors: readonly CanonicalIRValidationIssue[]): string => {
  const visible = errors.slice(0, 12).map((error) => `${error.instancePath || '/'} ${error.message}`)
  const remaining = errors.length - visible.length
  return [...visible, ...(remaining > 0 ? [`…另有 ${remaining} 項格式錯誤`] : [])].join('\n')
}

const formatSemanticIssues = (issues: readonly CanonicalSemanticIssue[]): string => {
  const visible = issues.slice(0, 12).map((issue) => `${issue.path} [${issue.code}] ${issue.message}`)
  const remaining = issues.length - visible.length
  return [...visible, ...(remaining > 0 ? [`…另有 ${remaining} 項語意問題`] : [])].join('\n')
}

const inspectSemantics = (project: CanonicalProject): readonly CanonicalSemanticIssue[] => {
  const issues = validateCanonicalSemantics(project)
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`JSON 格式合法，但有 ${errors.length} 項無法編譯的語意錯誤：\n${formatSemanticIssues(errors)}`)
  }
  return issues
}

const parseEditor = (): CanonicalProject => {
  const normalized = normalizeAiResponse(editor.value)
  const validation = validateCanonicalProject(normalized.data)
  if (normalized.repairs.length > 0 && validation.valid) {
    throw new Error(`偵測到 ${normalized.repairs.length} 項可自動修復的 AI 回覆格式。請先按「擷取／修復 AI 回覆」。`)
  }
  if (!validation.valid) {
    throw new Error(formatValidationErrors(validation.errors))
  }
  return validation.data
}

const updateStudentInstruction = (): void => {
  const request = projectRequest.value.trim()
  copyInstruction.disabled = request.length === 0
  instruction.value = request ? createStudentProjectInstruction(request) : AI_INSTRUCTION
  copyStatus.removeAttribute('data-kind')
  copyStatus.textContent = request ? '準備好了。複製後，貼到你使用的 AI 對話。' : '先寫下作品想法，或選一個範例。'
}

projectRequest.addEventListener('input', () => {
  updateStudentInstruction()
  setProgress(1)
})
for (const example of document.querySelectorAll<HTMLButtonElement>('.idea-chip')) {
  example.addEventListener('click', () => {
    projectRequest.value = example.dataset.request ?? ''
    updateStudentInstruction()
    setProgress(1)
    projectRequest.focus()
  })
}

copyInstruction.addEventListener('click', () => {
  const request = projectRequest.value.trim()
  if (!request) return
  const completeInstruction = createStudentProjectInstruction(request)
  void navigator.clipboard
    .writeText(completeInstruction)
    .then(() => {
      copyStatus.textContent = '已複製！下一步：到 AI 對話貼上，取得回覆後再回到這裡。'
      copyStatus.dataset.kind = 'ok'
      setProgress(2)
    })
    .catch(() => {
      const advancedTools = byId<HTMLDetailsElement>('advanced-tools')
      advancedTools.open = true
      instruction.value = completeInstruction
      instruction.focus()
      instruction.select()
      copyStatus.textContent = '瀏覽器無法自動複製；已選取下方完整訊息，請手動複製。'
      copyStatus.dataset.kind = 'error'
    })
})
byId<HTMLButtonElement>('load-sample').addEventListener('click', () => {
  editor.value = JSON.stringify(sampleProject, null, 2)
  repairUndoSnapshot = null
  clearRepairContext()
  clearStudentResult()
  setProgress(3)
  setStatus(generateStatus, '已載入平台遊戲範例。按「檢查並製作 Scratch」即可試用。', 'ok')
})
byId<HTMLButtonElement>('repair').addEventListener('click', () => {
  const source = editor.value
  try {
    const normalized = normalizeAiResponse(source)
    if (normalized.repairs.length === 0) {
      publishEditorDiagnostics()
      setStatus(generateStatus, '沒有偵測到可安全自動修復的格式。')
      return
    }
    editor.value = JSON.stringify(normalized.data, null, 2)
    repairUndoSnapshot = source
    const validation = validateCanonicalProject(normalized.data)
    if (!validation.valid) {
      publishRepairContext(
        createRepairReport({
          data: normalized.data,
          repairs: normalized.repairs,
          normalizationWarnings: normalized.warnings,
          schemaIssues: validation.errors,
        }),
        normalized.data,
      )
      setStatus(
        generateStatus,
        `已完成 ${normalized.repairs.length} 項結構修復，但仍有問題：\n${formatValidationErrors(validation.errors)}`,
        'error',
      )
      return
    }
    const semanticIssues = validateCanonicalSemantics(validation.data)
    const semanticErrors = semanticIssues.filter((issue) => issue.severity === 'error')
    const semanticWarnings = semanticIssues.filter((issue) => issue.severity === 'warning')
    publishRepairContext(
      createRepairReport({
        data: validation.data,
        repairs: normalized.repairs,
        normalizationWarnings: normalized.warnings,
        semanticIssues,
      }),
      validation.data,
    )
    if (semanticErrors.length > 0) {
      setStatus(
        generateStatus,
        `已完成 ${normalized.repairs.length} 項結構修復，但仍有 ${semanticErrors.length} 項語意錯誤：\n${formatSemanticIssues(semanticErrors)}`,
        'error',
      )
      return
    }
    const warningText = formatSemanticIssues(semanticWarnings)
    setStatus(
      generateStatus,
      `已完成 ${normalized.repairs.length} 項結構修復。${warningText ? `\n仍需人工確認 ${semanticWarnings.length} 項語意警告：\n${warningText}` : ''}`,
      semanticWarnings.length > 0 ? 'neutral' : 'ok',
    )
  } catch (error) {
    publishRepairContext(createRepairReport({ parseError: error }), source)
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
  }
})
byId<HTMLButtonElement>('validate').addEventListener('click', () => {
  try {
    const project = parseEditor()
    const issues = inspectSemantics(project)
    publishRepairContext(createRepairReport({ data: project, semanticIssues: issues }), project)
    if (issues.length > 0) {
      setStatus(
        generateStatus,
        `Canonical IR 格式與參照合法，但有 ${issues.length} 項語意警告：\n${formatSemanticIssues(issues)}`,
      )
      return
    }
    setStatus(generateStatus, `Canonical IR 格式與語意合法：${project.sprites.length} 個角色。`, 'ok')
  } catch (error) {
    publishEditorDiagnostics()
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
  }
})
const compileProjectToBlob = async (project: CanonicalProject): Promise<Blob> => compileCanonicalProjectToSb3(project)

const describeAutomaticVisuals = (summary: AutomaticVisualSummary): string => {
  const additions: string[] = []
  if (summary.backdropCostumes > 0) additions.push(`${summary.backdropCostumes} 個背景`)
  if (summary.spriteCostumes > 0) additions.push(`${summary.spriteCostumes} 個角色造型`)
  return additions.length > 0 ? `已自動補上 ${additions.join('、')}。` : ''
}

const describeOfflineCloudVariables = (project: CanonicalProject): string => {
  const cloudVariables = [project.stage, ...project.sprites].flatMap((target) =>
    target.variables.filter(({ cloud }) => cloud === true).map(({ name }) => `「${target.name}／${name}」`),
  )
  if (cloudVariables.length === 0) return ''
  const visible = cloudVariables.slice(0, 3).join('、')
  const remainder = cloudVariables.length > 3 ? `${visible}等另外 ${cloudVariables.length - 3} 個` : visible
  return `雲端變數${remainder}已保留宣告；目前 Bridge 預覽不會同步至 Scratch 雲端。`
}

const compileProject = async () => {
  let project: CanonicalProject
  let semanticIssues: readonly CanonicalSemanticIssue[]
  try {
    project = parseEditor()
    semanticIssues = inspectSemantics(project)
  } catch (error) {
    publishEditorDiagnostics()
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
    return
  }
  try {
    const automaticVisuals = summarizeAutomaticVisuals(project)
    setStatus(generateStatus, '正在透過 Scratch VM 編譯…')
    const sb3 = await compileProjectToBlob(project)
    download(sb3, `${project.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)
    publishRepairContext(createRepairReport({ data: project, semanticIssues }), project)
    const cloudWarning = describeOfflineCloudVariables(project)
    const semanticWarning = semanticIssues.length > 0 ? `（保留 ${semanticIssues.length} 項語意警告）` : ''
    setStatus(
      generateStatus,
      `完成：.sb3 已由 Scratch VM 產生。${describeAutomaticVisuals(automaticVisuals)}${semanticWarning}${cloudWarning ? `\n${cloudWarning}` : ''}`,
      'ok',
    )
  } catch (error) {
    publishEditorDiagnostics(error)
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

const buildStudentProject = async (): Promise<void> => {
  clearStudentResult()
  const sourceResponse = editor.value
  const source = sourceResponse.trim()
  if (!source) {
    setStatus(generateStatus, '請先把 AI 的完整回覆貼在上方。', 'error')
    setStudentResult('還沒有收到 AI 回覆', '回到 AI 對話複製完整回覆，再貼到上方文字框。', 'attention')
    editor.focus()
    return
  }

  let parsed: ReturnType<typeof parseAiResponse>
  try {
    parsed = parseAiResponse(source)
  } catch (parseError) {
    const report = createRepairReport({ parseError })
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,
      repairReport: report,
      checks: {
        responseParsed: 'failed',
        normalization: 'skipped',
        canonicalSchema: 'skipped',
        semanticValidation: 'skipped',
        scratchVmCompile: 'skipped',
      },
    })
    publishRepairContext(report, source, validationReport)
    setStatus(generateStatus, '找不到完整的 Scratch 作品資料。請讓 AI 重新輸出一次。', 'error')
    setProgress(3)
    return
  }

  let normalized: ReturnType<typeof normalizeAiDraft>
  try {
    normalized = addExtractionRepair(normalizeAiDraft(parsed.data), parsed)
  } catch (normalizationError) {
    const report = createRepairReport({ normalizationError })
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,
      repairReport: report,
      checks: {
        responseParsed: 'passed',
        normalization: 'failed',
        canonicalSchema: 'skipped',
        semanticValidation: 'skipped',
        scratchVmCompile: 'skipped',
      },
    })
    publishRepairContext(report, source, validationReport)
    setStatus(generateStatus, 'AI 回覆資料超出可安全整理的範圍，請縮小內容後再試。', 'error')
    setProgress(3)
    return
  }

  if (normalized.repairs.length > 0) {
    repairUndoSnapshot = source
    editor.value = JSON.stringify(normalized.data, null, 2)
  }

  const validation = validateCanonicalProject(normalized.data)
  if (!validation.valid) {
    const report = createRepairReport({
      data: normalized.data,
      repairs: normalized.repairs,
      normalizationWarnings: normalized.warnings,
      schemaIssues: validation.errors,
    })
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,
      canonicalProject: normalized.data,
      repairReport: report,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'failed',
        semanticValidation: 'skipped',
        scratchVmCompile: 'skipped',
      },
    })
    publishRepairContext(report, normalized.data, validationReport)
    setStatus(generateStatus, `AI 回覆還缺少 ${report.summary.errors} 個製作作品需要的資料。`, 'error')
    setProgress(3)
    return
  }

  const semanticIssues = validateCanonicalSemantics(validation.data)
  const report = createRepairReport({
    data: validation.data,
    repairs: normalized.repairs,
    normalizationWarnings: normalized.warnings,
    semanticIssues,
  })
  if (report.summary.errors > 0 || report.summary.warnings > 0) {
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,
      canonicalProject: validation.data,
      repairReport: report,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: report.summary.errors > 0 ? 'failed' : 'review',
        scratchVmCompile: 'skipped',
      },
    })
    publishRepairContext(report, validation.data, validationReport)
    const message =
      report.summary.errors > 0
        ? `還有 ${report.summary.errors} 個必要問題需要 AI 修正。`
        : `有 ${report.summary.warnings} 個遊戲規則需要確認。`
    setStatus(generateStatus, message, report.summary.errors > 0 ? 'error' : 'neutral')
    setProgress(3)
    return
  }

  try {
    const automaticVisuals = summarizeAutomaticVisuals(validation.data)
    setStatus(generateStatus, '正在製作 Scratch 專案，請稍候…')
    setProgress(4)
    const sb3 = await compileProjectToBlob(validation.data)
    latestStudentValidationReport = await createAiOutputValidationReport({
      sourceResponse,
      canonicalProject: validation.data,
      repairReport: report,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: 'passed',
        scratchVmCompile: 'passed',
      },
    })
    downloadStudentValidationReport.hidden = false
    download(sb3, `${validation.data.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)
    repairUndoSnapshot = null
    clearRepairContext()
    setStatus(generateStatus, '完成！Scratch 專案已開始下載。', 'ok')
    setStudentResult(
      `已完成「${validation.data.name}」`,
      `作品包含 ${validation.data.sprites.length} 個角色。${describeAutomaticVisuals(automaticVisuals)}${describeOfflineCloudVariables(validation.data)}請開啟下載的 .sb3 檔案繼續創作；本次驗證報告也可以下載。`,
      'success',
    )
    renderStudentPreview(validation.data, sb3)
  } catch (compileError) {
    const compileFailureStage = compileError instanceof ProjectCompileError ? compileError.stage : 'unknown'
    const scratchVmCompile =
      compileFailureStage === 'scratch-vm-load' || compileFailureStage === 'scratch-vm-save' ? 'failed' : 'skipped'
    const compileReport = createRepairReport({ data: validation.data, compileError })
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,
      canonicalProject: validation.data,
      repairReport: compileReport,
      compileFailureStage,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: 'passed',
        scratchVmCompile,
      },
    })
    publishRepairContext(compileReport, validation.data, validationReport)
    setStatus(generateStatus, 'Scratch 工具無法完成這份作品，請讓 AI 修正後再試一次。', 'error')
    setProgress(3)
  }
}

byId<HTMLButtonElement>('compile').addEventListener('click', () => {
  void compileProject()
})

byId<HTMLButtonElement>('student-build').addEventListener('click', () => {
  void buildStudentProject()
})

downloadStudentValidationReport.addEventListener('click', () => {
  if (!latestStudentValidationReport) return
  const filename = `${latestStudentValidationReport.projectName.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}-validation-report.json`
  downloadJson(latestStudentValidationReport, filename)
})

copyRepairPrompt.addEventListener('click', () => {
  if (!latestRepairContext) return
  const request = projectRequest.value.trim()
  const capabilityGuide = request ? createStudentProjectInstruction(request) : AI_INSTRUCTION
  const prompt = createRepairPrompt(latestRepairContext.report, latestRepairContext.currentProject, capabilityGuide)
  void copyTextWithFallback(prompt, '已複製修正訊息；請貼回 AI 對話。')
})

copyRepairReport.addEventListener('click', () => {
  if (!latestRepairContext) return
  const report = latestRepairContext.validationReport ?? latestRepairContext.report
  void copyTextWithFallback(
    JSON.stringify(report, null, 2),
    latestRepairContext.validationReport ? '已複製含原始回覆雜湊的驗證報告。' : '已複製完整 Repair Report JSON。',
  )
})

downloadRepairReport.addEventListener('click', () => {
  if (!latestRepairContext) return
  const validationReport = latestRepairContext.validationReport
  const filename = `${latestRepairContext.report.projectName.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}-${validationReport ? 'validation' : 'repair'}-report.json`
  downloadJson(validationReport ?? latestRepairContext.report, filename)
  setStatus(
    generateStatus,
    validationReport ? '已下載含原始回覆雜湊的驗證報告。' : '已下載完整 Repair Report JSON。',
    'ok',
  )
})

undoRepair.addEventListener('click', () => {
  if (repairUndoSnapshot === null) return
  editor.value = repairUndoSnapshot
  repairUndoSnapshot = null
  clearRepairContext()
  setStatus(generateStatus, '已復原修復前的 AI 原始回覆。')
})

editor.addEventListener('input', () => {
  repairUndoSnapshot = null
  clearRepairContext()
  clearStudentResult()
  setStatus(generateStatus, '')
  setProgress(editor.value.trim() ? 3 : projectRequest.value.trim() ? 2 : 1)
})

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')]
const activateTab = (tab: HTMLButtonElement): void => {
  for (const button of tabs) {
    const selected = button === tab
    button.classList.toggle('active', selected)
    button.setAttribute('aria-selected', String(selected))
    button.tabIndex = selected ? 0 : -1
  }
  const mode = tab.dataset.tab
  byId<HTMLElement>('generate-panel').hidden = mode !== 'generate'
  byId<HTMLElement>('analyze-panel').hidden = mode !== 'analyze'
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    activateTab(tab)
  })
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length]
    activateTab(next)
    next.focus()
  })
}
const initialTab = tabs.find((tab) => tab.classList.contains('active'))
if (!initialTab) throw new Error('Missing initial mode tab')
activateTab(initialTab)

let canonical: CanonicalProject | null = null
let analysis: AnalysisIR | null = null
let procedureNormalizationReport: ProcedureNormalizationReport | null = null
let vmNormalizationReport: VmNormalizationReport | null = null
let vmNormalizationGeneration = 0
let canonicalBlockMappings: CanonicalBlockMappingEntry[] = []
let rawArchive: RawSb3Project | null = null
let sourceArchiveFilename = 'scratch-project.sb3'
let sourceBlockGraphs: ScratchTargetBlockGraph[] = []
const fileStatus = byId<HTMLDivElement>('file-status')
const stats = byId<HTMLDivElement>('stats')
const diagnostics = byId<HTMLDivElement>('diagnostics')
const targetScriptList = byId<HTMLDivElement>('target-script-list')
const canonicalOutput = byId<HTMLElement>('canonical-output')
const analysisOutput = byId<HTMLElement>('analysis-output')
const procedureNormalizationOutput = byId<HTMLElement>('procedure-normalization-output')
const copyPrompt = byId<HTMLButtonElement>('copy-prompt')
const previewImportedProject = byId<HTMLButtonElement>('preview-imported-project')
const downloadCanonical = byId<HTMLButtonElement>('download-canonical')
const downloadAnalysis = byId<HTMLButtonElement>('download-analysis')
const downloadProcedureReport = byId<HTMLButtonElement>('download-procedure-report')
const downloadBlockMapping = byId<HTMLButtonElement>('download-block-mapping')
const downloadOriginalSb3 = byId<HTMLButtonElement>('download-original-sb3')
const normalizeVmSb3 = byId<HTMLButtonElement>('normalize-vm-sb3')
const downloadVmNormalizationReport = byId<HTMLButtonElement>('download-vm-normalization-report')
const vmNormalizationOutput = byId<HTMLElement>('vm-normalization-output')
const preservationRequest = byId<HTMLTextAreaElement>('preservation-request')
const preservationPatch = byId<HTMLTextAreaElement>('preservation-patch')
const preservationClipboardFallback = byId<HTMLDivElement>('preservation-clipboard-fallback')
const preservationClipboardFallbackText = byId<HTMLTextAreaElement>('preservation-clipboard-fallback-text')
const copyPreservationPrompt = byId<HTMLButtonElement>('copy-preservation-prompt')
const applyPreservationPatch = byId<HTMLButtonElement>('apply-preservation-patch')
const preservationStatus = byId<HTMLDivElement>('preservation-status')

const renderAnalysis = () => {
  if (!canonical || !analysis) return
  const summary = analysis.summary
  stats.classList.remove('muted')
  stats.innerHTML = [
    ['角色', summary.sprites],
    ['程式', summary.scripts],
    ['積木', summary.blocks],
    ['變數', summary.variables],
    ['清單', summary.lists],
    ['廣播', summary.broadcasts],
  ]
    .map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`)
    .join('')
  if (analysis.diagnostics.length > 0) {
    diagnostics.replaceChildren(
      ...analysis.diagnostics.map((item) => {
        const diagnostic = document.createElement('div')
        diagnostic.className = `diagnostic ${item.severity}`
        const code = document.createElement('b')
        code.textContent = item.severity === 'warning' ? '需要注意' : '建議'
        const message = document.createElement('span')
        message.textContent = item.message
        diagnostic.append(code, message)
        return diagnostic
      }),
    )
  } else {
    const diagnostic = document.createElement('div')
    diagnostic.className = 'diagnostic ok'
    const code = document.createElement('b')
    code.textContent = '檢查完成'
    const message = document.createElement('span')
    message.textContent = '目前沒有偵測到規則型問題。'
    diagnostic.append(code, message)
    diagnostics.replaceChildren(diagnostic)
  }
  targetScriptList.replaceChildren(
    ...[canonical.stage, ...canonical.sprites].map((target) => {
      const section = document.createElement('section')
      section.className = 'target-script-entry'
      const heading = document.createElement('h3')
      heading.textContent = `${target.kind === 'stage' ? '舞台' : '角色'}：${target.name}`
      const summary = document.createElement('p')
      summary.textContent = `${target.scripts.length} 組程式 · ${target.procedures.length} 個自訂積木`
      section.append(heading, summary)
      if (target.scripts.length > 0) {
        const list = document.createElement('ol')
        target.scripts.forEach((script, index) => {
          const item = document.createElement('li')
          item.textContent = `程式 ${index + 1}（${script.blocks.length} 個頂層積木）`
          list.append(item)
        })
        section.append(list)
      }
      if (target.procedures.length > 0) {
        const procedures = document.createElement('p')
        procedures.textContent = `自訂積木：${target.procedures.map(({ name }) => name).join('、')}`
        section.append(procedures)
      }
      return section
    }),
  )
  canonicalOutput.textContent = JSON.stringify(canonical, null, 2)
  analysisOutput.textContent = JSON.stringify(analysis, null, 2)
  procedureNormalizationOutput.textContent = JSON.stringify(procedureNormalizationReport, null, 2)
  copyPrompt.disabled = false
  previewImportedProject.disabled = rawArchive === null
  copyPreservationPrompt.disabled = rawArchive === null
  applyPreservationPatch.disabled = rawArchive === null
  downloadCanonical.disabled = false
  downloadAnalysis.disabled = false
  downloadProcedureReport.disabled = false
  downloadBlockMapping.disabled = canonicalBlockMappings.length === 0
  downloadOriginalSb3.disabled = rawArchive === null
  normalizeVmSb3.disabled = rawArchive === null
}

const analyzeFile = async (file: File) => {
  vmNormalizationGeneration += 1
  rawArchive = null
  vmNormalizationReport = null
  downloadVmNormalizationReport.disabled = true
  vmNormalizationOutput.textContent = '尚未執行 VM 正規化'
  sourceArchiveFilename = file.name.replace(/\.sb3$/i, '') || 'scratch-project'
  sourceBlockGraphs = []
  canonicalBlockMappings = []
  downloadBlockMapping.disabled = true
  previewImportedProject.disabled = true
  downloadOriginalSb3.disabled = true
  normalizeVmSb3.disabled = true
  copyPreservationPrompt.disabled = true
  applyPreservationPatch.disabled = true
  try {
    setStatus(fileStatus, `正在解析 ${file.name}…`)
    const decompiled = await decompileSb3WithBlockGraphs(file, file.name.replace(/\.sb3$/i, ''))
    canonical = decompiled.canonical
    procedureNormalizationReport = decompiled.procedureNormalizationReport
    canonicalBlockMappings = decompiled.canonicalBlockMappings
    rawArchive = decompiled.rawArchive
    sourceBlockGraphs = decompiled.rawBlockGraphs
    analysis = analyzeCanonicalProject(canonical, decompiled.rawBlockGraphs)
    renderAnalysis()
    const warning = decompiled.archiveWarnings.length > 0 ? `（${decompiled.archiveWarnings.join('；')}）` : ''
    setStatus(
      fileStatus,
      `檢查完成：${analysis.summary.blocks} 個積木、${analysis.summary.scripts} 組程式。${warning}`,
      'ok',
    )
  } catch (error) {
    canonical = null
    analysis = null
    procedureNormalizationReport = null
    canonicalBlockMappings = []
    rawArchive = null
    sourceBlockGraphs = []
    previewImportedProject.disabled = true
    copyPreservationPrompt.disabled = true
    applyPreservationPatch.disabled = true
    setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

const previewImported = async (): Promise<void> => {
  const project = canonical
  const archive = rawArchive
  if (!project || !archive) return
  previewImportedProject.disabled = true
  try {
    const sb3 = await exportLosslessSb3(archive)
    if (canonical !== project || rawArchive !== archive) return
    const damagedCostumeCount = [project.stage, ...project.sprites].reduce(
      (count, target) => count + target.costumes.filter((costume) => !costume.data || costume.assetIssue).length,
      0,
    )
    latestStudentValidationReport = null
    downloadStudentValidationReport.hidden = true
    clearStudentResult()
    setStudentResult(
      `匯入作品「${project.name}」的預覽`,
      `預覽顯示作品儲存時的初始舞台狀態；積木尚未執行。${damagedCostumeCount > 0 ? `有 ${damagedCostumeCount} 個缺失或 checksum 不符的造型，畫面會以示意圖代替。` : ''}預覽不會改寫或下載原始作品。`,
      damagedCostumeCount > 0 ? 'attention' : 'success',
    )
    activateTab(byId<HTMLButtonElement>('generate-tab'))
    renderStudentPreview(project, sb3, archive)
  } catch (error) {
    setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
  } finally {
    previewImportedProject.disabled = canonical === null || rawArchive === null
  }
}

previewImportedProject.addEventListener('click', () => {
  void previewImported()
})

const fileInput = byId<HTMLInputElement>('sb3-file')
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void analyzeFile(file)
})
const dropzone = byId<HTMLLabelElement>('dropzone')
for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropzone.classList.add('drag')
  })
}
for (const eventName of ['dragleave', 'drop']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropzone.classList.remove('drag')
  })
}
dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0]
  if (file) void analyzeFile(file)
})

copyPrompt.addEventListener('click', () => {
  if (!canonical || !analysis) return
  const mode = byId<HTMLSelectElement>('tutor-mode').value as TutorMode
  const hintLevel = Number(byId<HTMLSelectElement>('hint-level').value) as 1 | 2 | 3 | 4
  const question = byId<HTMLInputElement>('question').value
  void navigator.clipboard
    .writeText(createAnalysisPrompt({ analysis, canonical, mode, hintLevel, question }))
    .then(() => setStatus(fileStatus, '已複製問題與作品資料；可以直接貼到 AI 對話。', 'ok'))
    .catch((error) => {
      setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
    })
})
copyPreservationPrompt.addEventListener('click', () => {
  if (!rawArchive) return
  try {
    const prompt = createPreservationEditPrompt(sourceBlockGraphs, preservationRequest.value)
    const copyPromise = navigator.clipboard.writeText(prompt)
    void copyPromise
      .then(() => {
        preservationClipboardFallback.hidden = true
        setStatus(preservationStatus, '已複製局部修改指令與原始積木圖；請貼到 AI 對話。', 'ok')
      })
      .catch(() => {
        preservationClipboardFallbackText.value = prompt
        preservationClipboardFallback.hidden = false
        preservationClipboardFallbackText.focus()
        preservationClipboardFallbackText.select()
        setStatus(preservationStatus, '瀏覽器拒絕剪貼簿存取；已提供可全選複製的完整指令。', 'neutral')
      })
  } catch (error) {
    setStatus(preservationStatus, error instanceof Error ? error.message : String(error), 'error')
  }
})
applyPreservationPatch.addEventListener('click', () => {
  if (!rawArchive) return
  void (async () => {
    try {
      setStatus(preservationStatus, '正在驗證局部積木圖 patch…')
      const patches = parsePreservationEditPatch(preservationPatch.value, sourceBlockGraphs)
      const patchedArchive = patchLosslessSb3BlockGraphs(rawArchive, patches)
      const output = await exportLosslessSb3(patchedArchive)
      const projectName = canonical?.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') ?? 'scratch-project'
      download(output, `${projectName}-preserved-edit.sb3`)
      setStatus(preservationStatus, 'Patch 結構有效，已保留未修改積木與素材並下載 SB3。', 'ok')
    } catch (error) {
      setStatus(preservationStatus, error instanceof Error ? error.message : String(error), 'error')
    }
  })()
})
downloadCanonical.addEventListener('click', () => canonical && downloadJson(canonical, 'canonical-ir.json'))
downloadOriginalSb3.addEventListener('click', () => {
  if (!rawArchive) return
  void exportLosslessSb3(rawArchive)
    .then((archive) => download(archive, `${sourceArchiveFilename}-preserved.sb3`))
    .catch((error: unknown) => {
      setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
    })
})
normalizeVmSb3.addEventListener('click', () => {
  if (!rawArchive) return
  const sourceArchive = rawArchive
  const generation = vmNormalizationGeneration
  vmNormalizationReport = null
  normalizeVmSb3.disabled = true
  downloadVmNormalizationReport.disabled = true
  vmNormalizationOutput.textContent = '正在透過官方 Scratch VM 正規化…'
  void (async () => {
    try {
      setStatus(fileStatus, '正在透過官方 Scratch VM 正規化專案…')
      const source = await exportLosslessSb3(sourceArchive)
      const result = await normalizeThroughVm(source)
      if (generation !== vmNormalizationGeneration) return
      vmNormalizationReport = result.report
      vmNormalizationOutput.textContent = JSON.stringify(result.report, null, 2)
      download(result.archive, `${sourceArchiveFilename}-vm-normalized.sb3`)
      downloadVmNormalizationReport.disabled = false
      const changedEntries = result.report.archiveEntryChanges.filter(({ kind }) => kind !== 'unchanged').length
      setStatus(
        fileStatus,
        `VM 正規化完成：${result.report.projectJsonChanges.length} 項 project.json 差異、${changedEntries} 個 archive entries 新增／移除／內容變更；已下載作品與差異報告。`,
        'ok',
      )
    } catch (error) {
      if (generation === vmNormalizationGeneration) {
        vmNormalizationOutput.textContent = 'VM 正規化失敗，未產生差異報告。'
        setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
      }
    } finally {
      if (generation === vmNormalizationGeneration) normalizeVmSb3.disabled = false
    }
  })()
})
downloadVmNormalizationReport.addEventListener('click', () => {
  if (vmNormalizationReport)
    downloadJson(vmNormalizationReport, `${sourceArchiveFilename}-vm-normalization-report.json`)
})
downloadAnalysis.addEventListener('click', () => analysis && downloadJson(analysis, 'analysis-ir.json'))
downloadProcedureReport.addEventListener(
  'click',
  () =>
    procedureNormalizationReport && downloadJson(procedureNormalizationReport, 'procedure-normalization-report.json'),
)
downloadBlockMapping.addEventListener('click', () => {
  if (!canonical) return
  downloadJson(
    {
      format: 'scratch-ai-bridge/canonical-block-mapping',
      version: 1,
      projectName: canonical.name,
      entries: canonicalBlockMappings,
    },
    'canonical-block-mapping.json',
  )
})
