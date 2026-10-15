import { Buffer } from 'node:buffer'
import { analyzeCanonicalProject, createProjectMap } from './core/analyzer'
import { decompileSb3WithBlockGraphs } from './core/decompiler'
import type { CanonicalProject } from './core/ir/types'
import { createAnalysisPrompt } from './core/prompt'
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

const app = document.querySelector<HTMLElement>('#student-help-app')
if (!app) throw new Error('Scratch student help app root was not found')

app.innerHTML = `
  <a class="skip-link" href="#student-help-main">跳到提問區</a>
  <div class="student-help-shell">
    <header class="student-help-heading">
      <div class="student-help-mark" aria-hidden="true">Scratch</div>
      <p class="student-help-eyebrow">作品解惑小幫手</p>
      <h1>Scratch 學習小幫手</h1>
      <p>上傳你的作品，帶著程式線索去問 AI，一起找出答案。</p>
    </header>

    <section class="student-help-card" aria-labelledby="upload-title">
      <div class="student-help-step">1</div>
      <div class="student-help-content">
        <h2 id="upload-title">選擇你的 Scratch 作品</h2>
        <p>請選擇從 Scratch 下載的 <strong>.sb3</strong> 專案檔。</p>
        <label class="student-help-upload" for="student-sb3-file">
          <span class="student-help-upload-icon" aria-hidden="true">↑</span>
          <strong>選擇或拖曳 .sb3 檔案到這裡</strong>
          <span>作品會留在這台裝置裡分析，不會上傳到這個網站。</span>
          <input id="student-sb3-file" class="visually-hidden" type="file" accept=".sb3,application/zip" />
        </label>
        <p id="student-file-status" class="student-help-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <section id="student-project-result" class="student-help-card" aria-labelledby="project-title" hidden>
      <div class="student-help-step">2</div>
      <div class="student-help-content">
        <h2 id="project-title">作品分析完成</h2>
        <p id="student-project-summary" class="student-help-summary"></p>
        <p class="student-help-note">這是程式積木的整理，沒有替作品打分，也沒有實際執行遊戲。</p>
      </div>
    </section>

    <section id="student-question-card" class="student-help-card" aria-labelledby="question-title" hidden>
      <div class="student-help-step">3</div>
      <div class="student-help-content">
        <h2 id="question-title">你想問什麼？</h2>
        <label for="student-question">用自己的話寫下問題</label>
        <textarea id="student-question" rows="3" maxlength="500" placeholder="例如：為什麼主角一開始就在右邊？"></textarea>
        <p class="student-help-privacy">不要寫姓名、班級或其他個人資料。按複製後，作品線索會放進提示；只有你把提示貼到 AI 並送出時，AI 才會收到。</p>
        <div class="student-help-actions">
          <button id="student-copy-prompt" class="button primary" type="button" disabled>複製問題和作品線索</button>
        </div>
        <p id="student-copy-status" class="student-help-status" role="status" aria-live="polite"></p>
        <div class="student-help-howto">
          <strong>接下來這樣做</strong>
          <ol>
            <li>按上面的按鈕複製提示。</li>
            <li>打開老師允許使用的 AI，貼上提示並送出。</li>
            <li>請 AI 用提示帶你找答案；不懂的地方可以再問老師。</li>
          </ol>
        </div>
        <div id="student-copy-fallback" class="student-help-fallback" hidden>
          <label for="student-prompt-text">無法自動複製時，點一下文字框後全選並複製：</label>
          <textarea id="student-prompt-text" rows="8" readonly></textarea>
        </div>
      </div>
    </section>

    <footer class="student-help-footer">有問題時，請找老師一起看你的作品。</footer>
  </div>
`

const requireElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Scratch student help element is missing: ${selector}`)
  return element
}

const fileInput = requireElement<HTMLInputElement>('#student-sb3-file')
const upload = requireElement<HTMLLabelElement>('.student-help-upload')
const fileStatus = requireElement<HTMLElement>('#student-file-status')
const projectResult = requireElement<HTMLElement>('#student-project-result')
const projectSummary = requireElement<HTMLElement>('#student-project-summary')
const questionCard = requireElement<HTMLElement>('#student-question-card')
const questionInput = requireElement<HTMLTextAreaElement>('#student-question')
const copyButton = requireElement<HTMLButtonElement>('#student-copy-prompt')
const copyStatus = requireElement<HTMLElement>('#student-copy-status')
const copyFallback = requireElement<HTMLElement>('#student-copy-fallback')
const promptText = requireElement<HTMLTextAreaElement>('#student-prompt-text')

let currentProject: CanonicalProject | null = null
let currentAnalysis: ReturnType<typeof analyzeCanonicalProject> | null = null
let currentMap: ReturnType<typeof createProjectMap> | null = null
let isReadingProject = false

const setStatus = (element: HTMLElement, message: string, kind: 'success' | 'error' | 'neutral' = 'neutral') => {
  element.textContent = message
  element.dataset.kind = kind
}

const readProject = async (file: File): Promise<void> => {
  currentProject = null
  currentAnalysis = null
  currentMap = null
  projectResult.hidden = true
  questionCard.hidden = true
  copyButton.disabled = true
  copyFallback.hidden = true
  copyStatus.textContent = ''

  if (!file.name.toLocaleLowerCase().endsWith('.sb3')) {
    setStatus(fileStatus, '請選擇 Scratch 3 的 .sb3 專案檔。', 'error')
    return
  }

  isReadingProject = true
  upload.setAttribute('aria-busy', 'true')
  setStatus(fileStatus, '正在讀取作品，請稍等一下……')
  try {
    const projectName = file.name.replace(/\.sb3$/i, '') || 'Scratch 專案'
    const result = await decompileSb3WithBlockGraphs(file, projectName)
    currentProject = result.canonical
    currentAnalysis = analyzeCanonicalProject(result.canonical, result.rawBlockGraphs)
    currentMap = createProjectMap(
      result.canonical,
      currentAnalysis,
      result.rawBlockGraphs,
      result.canonicalBlockMappings,
    )
    const spriteCount = result.canonical.sprites.length
    projectSummary.textContent = `找到 ${spriteCount} 個角色、${currentAnalysis.summary.scripts} 段程式和 ${currentAnalysis.summary.blocks} 個積木。現在可以寫下想問的問題。`
    projectResult.hidden = false
    questionCard.hidden = false
    copyButton.disabled = questionInput.value.trim().length === 0
    setStatus(fileStatus, '作品讀取完成。', 'success')
    questionInput.focus()
  } catch {
    setStatus(fileStatus, '讀不到這個作品。請確認檔案是 Scratch 3 的 .sb3 專案，再試一次。', 'error')
  } finally {
    isReadingProject = false
    upload.removeAttribute('aria-busy')
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file && !isReadingProject) void readProject(file)
})

for (const eventName of ['dragenter', 'dragover']) {
  upload.addEventListener(eventName, (event) => {
    event.preventDefault()
    upload.classList.add('is-dragging')
  })
}
for (const eventName of ['dragleave', 'drop']) {
  upload.addEventListener(eventName, (event) => {
    event.preventDefault()
    upload.classList.remove('is-dragging')
  })
}
upload.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0]
  if (file && !isReadingProject) void readProject(file)
})

questionInput.addEventListener('input', () => {
  copyButton.disabled = !currentProject || !currentAnalysis || !currentMap || questionInput.value.trim().length === 0
})

const copyAnalysisPrompt = async (): Promise<void> => {
  if (!currentProject || !currentAnalysis || !currentMap) return
  const prompt = createAnalysisPrompt({
    analysis: currentAnalysis,
    canonical: currentProject,
    projectMap: currentMap,
    question: questionInput.value.trim(),
    mode: 'student',
    hintLevel: 2,
  })

  try {
    await navigator.clipboard.writeText(prompt)
    copyFallback.hidden = true
    setStatus(copyStatus, '已複製！請打開老師允許使用的 AI，貼上提示開始提問。', 'success')
  } catch {
    promptText.value = prompt
    copyFallback.hidden = false
    promptText.focus()
    promptText.select()
    setStatus(copyStatus, '瀏覽器不允許自動複製，請從下方文字框全選並複製。')
  }
}

copyButton.addEventListener('click', () => {
  void copyAnalysisPrompt()
})
