import { Buffer } from 'node:buffer'
import { initializeScratchVM } from './bootstrap/vm-bootstrap'
import { analyzeCanonicalProject, type AnalysisIR } from './core/analyzer'
import { importLosslessSb3 } from './core/archive'
import { createAuthoringInstruction, createStudentProjectInstruction } from './core/capabilities'
import { compileCanonicalProjectToSb3 } from './core/compiler'
import { decompileSb3 } from './core/decompiler'
import sampleProject from './core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from './core/ir/types'
import { normalizeAiResponse } from './core/normalizer'
import { createAnalysisPrompt, type TutorMode } from './core/prompt'
import { createRepairPrompt, createRepairReport, type RepairReport } from './core/repair'
import {
  validateCanonicalProject,
  validateCanonicalSemantics,
  type CanonicalIRValidationIssue,
  type CanonicalSemanticIssue,
} from './core/validator'
import './style.css'

globalThis.Buffer = Buffer

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Scratch AI Bridge app root was not found')

// Fail early if the official VM cannot initialize in this browser/build.
const bootstrapVm = initializeScratchVM()
window.addEventListener('pagehide', () => bootstrapVm.quit(), { once: true })

const AI_INSTRUCTION = createAuthoringInstruction()

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">不用安裝 · 作品不會上傳</div>
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
          <label class="dropzone" id="dropzone"><strong>選擇或拖入 Scratch 專案</strong><span>檔名通常以 .sb3 結尾；作品不會上傳到伺服器。</span><input id="sb3-file" class="visually-hidden" type="file" accept=".sb3,application/zip"></label>
          <div id="file-status" class="status-box" role="status" aria-live="polite"></div>
        </article>
        <article class="card">
          <h2>2. 作品檢查結果</h2>
          <div id="stats" class="stats muted">尚未載入專案</div>
          <div id="diagnostics" class="diagnostics"></div>
        </article>
        <article class="card wide">
          <h2>3. 請 AI 協助</h2>
          <div class="analysis-controls">
            <label>你想了解什麼？ <input id="question" type="text" placeholder="例如：為什麼角色沒有收到廣播？"></label>
            <label>回答方式 <select id="tutor-mode"><option value="student">給學生提示</option><option value="teacher">給老師建議</option></select></label>
            <label>提示程度 <select id="hint-level"><option value="1">簡短提示</option><option value="2" selected>逐步引導</option><option value="3">詳細說明</option><option value="4">完整解法</option></select></label>
          </div>
          <div class="button-row"><button id="copy-prompt" class="button primary" disabled>複製問題給 AI</button></div>
          <details class="advanced-tools">
            <summary>查看教師／技術資料</summary>
            <div class="button-row"><button id="download-canonical" class="button secondary" disabled>下載 Canonical IR</button><button id="download-analysis" class="button secondary" disabled>下載 Analysis IR</button></div>
            <div class="output-grid">
              <div><h3>Analysis IR</h3><pre id="analysis-output">—</pre></div>
              <div><h3>Canonical IR</h3><pre id="canonical-output">—</pre></div>
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

const publishRepairContext = (report: RepairReport, currentProject: unknown): void => {
  latestRepairContext = { report, currentProject }
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

const clearStudentResult = (): void => {
  studentResult.hidden = true
  studentResult.removeAttribute('data-kind')
  studentResultTitle.textContent = ''
  studentResultMessage.textContent = ''
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
  anchor.click()
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
const compileAndDownload = async (project: CanonicalProject): Promise<void> => {
  const sb3 = await compileCanonicalProjectToSb3(project)
  download(sb3, `${project.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)
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
    setStatus(generateStatus, '正在透過 Scratch VM 編譯…')
    await compileAndDownload(project)
    publishRepairContext(createRepairReport({ data: project, semanticIssues }), project)
    setStatus(
      generateStatus,
      `完成：.sb3 已由 Scratch VM 產生。${semanticIssues.length > 0 ? `（保留 ${semanticIssues.length} 項語意警告）` : ''}`,
      'ok',
    )
  } catch (error) {
    publishEditorDiagnostics(error)
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

const buildStudentProject = async (): Promise<void> => {
  clearStudentResult()
  const source = editor.value.trim()
  if (!source) {
    setStatus(generateStatus, '請先把 AI 的完整回覆貼在上方。', 'error')
    setStudentResult('還沒有收到 AI 回覆', '回到 AI 對話複製完整回覆，再貼到上方文字框。', 'attention')
    editor.focus()
    return
  }

  let normalized: ReturnType<typeof normalizeAiResponse>
  try {
    normalized = normalizeAiResponse(source)
  } catch (parseError) {
    const report = createRepairReport({ parseError })
    publishRepairContext(report, source)
    setStatus(generateStatus, '找不到完整的 Scratch 作品資料。請讓 AI 重新輸出一次。', 'error')
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
    publishRepairContext(report, normalized.data)
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
    publishRepairContext(report, validation.data)
    const message =
      report.summary.errors > 0
        ? `還有 ${report.summary.errors} 個必要問題需要 AI 修正。`
        : `有 ${report.summary.warnings} 個遊戲規則需要確認。`
    setStatus(generateStatus, message, report.summary.errors > 0 ? 'error' : 'neutral')
    setProgress(3)
    return
  }

  try {
    setStatus(generateStatus, '正在製作 Scratch 專案，請稍候…')
    setProgress(4)
    await compileAndDownload(validation.data)
    repairUndoSnapshot = null
    clearRepairContext()
    setStatus(generateStatus, '完成！Scratch 專案已開始下載。', 'ok')
    setStudentResult(
      `已完成「${validation.data.name}」`,
      `作品包含 ${validation.data.sprites.length} 個角色。請開啟下載的 .sb3 檔案繼續創作。`,
      'success',
    )
  } catch (compileError) {
    const compileReport = createRepairReport({ data: validation.data, compileError })
    publishRepairContext(compileReport, validation.data)
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

copyRepairPrompt.addEventListener('click', () => {
  if (!latestRepairContext) return
  const request = projectRequest.value.trim()
  const capabilityGuide = request ? createStudentProjectInstruction(request) : AI_INSTRUCTION
  const prompt = createRepairPrompt(latestRepairContext.report, latestRepairContext.currentProject, capabilityGuide)
  void copyTextWithFallback(prompt, '已複製修正訊息；請貼回 AI 對話。')
})

copyRepairReport.addEventListener('click', () => {
  if (!latestRepairContext) return
  void copyTextWithFallback(JSON.stringify(latestRepairContext.report, null, 2), '已複製完整 Repair Report JSON。')
})

downloadRepairReport.addEventListener('click', () => {
  if (!latestRepairContext) return
  const filename = `${latestRepairContext.report.projectName.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}-repair-report.json`
  downloadJson(latestRepairContext.report, filename)
  setStatus(generateStatus, '已下載完整 Repair Report JSON。', 'ok')
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
const fileStatus = byId<HTMLDivElement>('file-status')
const stats = byId<HTMLDivElement>('stats')
const diagnostics = byId<HTMLDivElement>('diagnostics')
const canonicalOutput = byId<HTMLElement>('canonical-output')
const analysisOutput = byId<HTMLElement>('analysis-output')
const copyPrompt = byId<HTMLButtonElement>('copy-prompt')
const downloadCanonical = byId<HTMLButtonElement>('download-canonical')
const downloadAnalysis = byId<HTMLButtonElement>('download-analysis')

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
  canonicalOutput.textContent = JSON.stringify(canonical, null, 2)
  analysisOutput.textContent = JSON.stringify(analysis, null, 2)
  copyPrompt.disabled = false
  downloadCanonical.disabled = false
  downloadAnalysis.disabled = false
}

const analyzeFile = async (file: File) => {
  try {
    setStatus(fileStatus, `正在解析 ${file.name}…`)
    const rawArchive = await importLosslessSb3(file)
    canonical = await decompileSb3(file, file.name.replace(/\.sb3$/i, ''))
    analysis = analyzeCanonicalProject(canonical)
    renderAnalysis()
    const warning = rawArchive.warnings.length > 0 ? `（${rawArchive.warnings.join('；')}）` : ''
    setStatus(
      fileStatus,
      `檢查完成：${analysis.summary.blocks} 個積木、${analysis.summary.scripts} 組程式。${warning}`,
      'ok',
    )
  } catch (error) {
    canonical = null
    analysis = null
    setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

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
downloadCanonical.addEventListener('click', () => canonical && downloadJson(canonical, 'canonical-ir.json'))
downloadAnalysis.addEventListener('click', () => analysis && downloadJson(analysis, 'analysis-ir.json'))
