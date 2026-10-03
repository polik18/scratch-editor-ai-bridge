import { Buffer } from 'node:buffer'
import { initializeScratchVM } from './bootstrap/vm-bootstrap'
import { analyzeCanonicalProject, type AnalysisIR } from './core/analyzer'
import { importLosslessSb3 } from './core/archive'
import { createAuthoringInstruction } from './core/capabilities'
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
        <div class="eyebrow">Browser-only · Official Scratch VM path</div>
        <h1>Scratch AI Bridge</h1>
        <p class="lede">保留完整 Scratch Editor monorepo 的 AI ↔ Scratch 轉譯工具。Generate 與 Analyze 都在瀏覽器執行。</p>
      </div>
      <div class="status-pill"><span></span> Scratch VM initialized</div>
    </header>

    <nav class="tabs" aria-label="Mode">
      <button class="tab active" data-tab="generate">建立 Scratch</button>
      <button class="tab" data-tab="analyze">分析 Scratch</button>
    </nav>

    <main>
      <section id="generate-panel" class="panel-grid">
        <article class="card">
          <div class="card-head"><h2>1. 複製 AI 指令</h2><button id="copy-instruction" class="button secondary">複製</button></div>
          <textarea id="instruction" class="mono compact" readonly></textarea>
        </article>
        <article class="card wide">
          <div class="card-head"><h2>2. Canonical IR JSON</h2><button id="load-sample" class="button secondary">載入範例</button></div>
          <textarea id="json-editor" class="mono editor" spellcheck="false"></textarea>
          <div class="button-row"><button id="repair" class="button secondary">擷取／修復 AI 回覆</button><button id="validate" class="button secondary">Validate</button><button id="compile" class="button primary">Compile & Download .sb3</button></div>
          <div id="generate-status" class="status-box" role="status" aria-live="polite"></div>
          <section id="repair-tools" class="repair-tools" aria-label="AI 修復回饋" hidden>
            <div class="repair-report-head"><strong>AI 修復報告</strong><span id="repair-summary"></span></div>
            <div class="button-row">
              <button id="copy-repair-prompt" class="button primary">複製給 AI 修正</button>
              <button id="copy-repair-report" class="button secondary">複製錯誤報告</button>
              <button id="download-repair-report" class="button secondary">下載報告.json</button>
              <button id="undo-repair" class="button secondary">復原修復前內容</button>
            </div>
            <div id="clipboard-fallback" class="clipboard-fallback" hidden>
              <label for="clipboard-fallback-text">瀏覽器拒絕剪貼簿存取，請從這裡全選複製：</label>
              <textarea id="clipboard-fallback-text" class="mono compact" readonly></textarea>
            </div>
          </section>
        </article>
      </section>

      <section id="analyze-panel" class="panel-grid" hidden>
        <article class="card">
          <h2>1. 上傳 .sb3</h2>
          <label class="dropzone" id="dropzone"><strong>拖入 Scratch .sb3</strong><span>或點此選擇檔案；不會上傳到伺服器。</span><input id="sb3-file" type="file" accept=".sb3,application/zip"></label>
          <div id="file-status" class="status-box"></div>
        </article>
        <article class="card">
          <h2>2. 專案摘要</h2>
          <div id="stats" class="stats muted">尚未載入專案</div>
          <div id="diagnostics" class="diagnostics"></div>
        </article>
        <article class="card wide">
          <div class="analysis-controls">
            <label>問題 <input id="question" type="text" placeholder="例如：為什麼角色沒有收到廣播？"></label>
            <label>模式 <select id="tutor-mode"><option value="student">學生</option><option value="teacher">老師</option></select></label>
            <label>提示 <select id="hint-level"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label>
          </div>
          <div class="button-row"><button id="copy-prompt" class="button primary" disabled>複製給 AI</button><button id="download-canonical" class="button secondary" disabled>下載 Canonical IR</button><button id="download-analysis" class="button secondary" disabled>下載 Analysis IR</button></div>
          <div class="output-grid">
            <div><h3>Analysis IR</h3><pre id="analysis-output">—</pre></div>
            <div><h3>Canonical IR</h3><pre id="canonical-output">—</pre></div>
          </div>
        </article>
      </section>
    </main>
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
instruction.value = AI_INSTRUCTION
editor.value = JSON.stringify(sampleProject, null, 2)

const setStatus = (element: HTMLElement, text: string, kind: 'ok' | 'error' | 'neutral' = 'neutral') => {
  element.textContent = text
  element.dataset.kind = kind
}

interface RepairContext {
  readonly report: RepairReport
  readonly currentProject: unknown
}

const repairTools = byId<HTMLElement>('repair-tools')
const repairSummary = byId<HTMLSpanElement>('repair-summary')
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

byId<HTMLButtonElement>('copy-instruction').addEventListener('click', () => {
  void navigator.clipboard.writeText(AI_INSTRUCTION).catch((error) => {
    setStatus(generateStatus, error instanceof Error ? error.message : String(error), 'error')
  })
})
byId<HTMLButtonElement>('load-sample').addEventListener('click', () => {
  editor.value = JSON.stringify(sampleProject, null, 2)
  repairUndoSnapshot = null
  clearRepairContext()
  setStatus(generateStatus, '已恢復內建範例。')
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
    const sb3 = await compileCanonicalProjectToSb3(project)
    download(sb3, `${project.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)
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

byId<HTMLButtonElement>('compile').addEventListener('click', () => {
  void compileProject()
})

copyRepairPrompt.addEventListener('click', () => {
  if (!latestRepairContext) return
  const prompt = createRepairPrompt(latestRepairContext.report, latestRepairContext.currentProject, AI_INSTRUCTION)
  void copyTextWithFallback(prompt, '已複製完整 AI 修正提示；可直接貼回 Gemini。')
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
})

for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.tab')) button.classList.remove('active')
    tab.classList.add('active')
    const mode = tab.dataset.tab
    byId<HTMLElement>('generate-panel').hidden = mode !== 'generate'
    byId<HTMLElement>('analyze-panel').hidden = mode !== 'analyze'
  })
}

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
    ['Sprites', summary.sprites],
    ['Scripts', summary.scripts],
    ['Blocks', summary.blocks],
    ['Variables', summary.variables],
    ['Lists', summary.lists],
    ['Broadcasts', summary.broadcasts],
  ]
    .map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`)
    .join('')
  if (analysis.diagnostics.length > 0) {
    diagnostics.replaceChildren(
      ...analysis.diagnostics.map((item) => {
        const diagnostic = document.createElement('div')
        diagnostic.className = `diagnostic ${item.severity}`
        const code = document.createElement('b')
        code.textContent = item.code
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
    code.textContent = 'No diagnostics'
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
      `完成：${analysis.summary.blocks} blocks / ${analysis.summary.scripts} scripts。${warning}`,
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
    .catch((error) => {
      setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
    })
})
downloadCanonical.addEventListener('click', () => canonical && downloadJson(canonical, 'canonical-ir.json'))
downloadAnalysis.addEventListener('click', () => analysis && downloadJson(analysis, 'analysis-ir.json'))
