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
        <div class="student-help-map">
          <h3>程式線索：可以從這裡開始找</h3>
          <p>角色名稱已改成代號。打開 Scratch 裡同一個角色，再找相同段落和積木。</p>
          <ul id="student-project-map" class="student-help-map-list"></ul>
          <button id="student-map-more" class="student-help-map-more" type="button" hidden></button>
        </div>
        <p class="student-help-note">這是程式積木的整理，沒有替作品打分，也沒有實際執行遊戲。</p>
      </div>
    </section>

    <section id="student-question-card" class="student-help-card" aria-labelledby="question-title" hidden>
      <div class="student-help-step">3</div>
      <div class="student-help-content">
        <h2 id="question-title">你想問什麼？</h2>
        <label for="student-question">用自己的話寫下問題</label>
        <textarea id="student-question" rows="3" maxlength="500" placeholder="例如：為什麼主角一開始就在右邊？"></textarea>
        <details class="student-help-context">
          <summary>補充作品原本和實際的樣子（可不填）</summary>
          <label for="student-expected">我原本想看到什麼？</label>
          <textarea id="student-expected" rows="2" maxlength="200" placeholder="例如：主角應該從舞台左邊開始"></textarea>
          <label for="student-actual">我實際看到什麼？</label>
          <textarea id="student-actual" rows="2" maxlength="200" placeholder="例如：按綠旗後，主角出現在右邊"></textarea>
        </details>
        <div id="student-first-hint" class="student-help-first-hint" aria-live="polite" hidden></div>
        <p class="student-help-privacy">不要寫姓名、班級或其他個人資料。按複製後，問題和你填寫的補充資料會放進提示；只有你把提示貼到 AI 並送出時，AI 才會收到。</p>
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
const projectMapList = requireElement<HTMLUListElement>('#student-project-map')
const projectMapMore = requireElement<HTMLButtonElement>('#student-map-more')
const questionCard = requireElement<HTMLElement>('#student-question-card')
const questionInput = requireElement<HTMLTextAreaElement>('#student-question')
const expectedInput = requireElement<HTMLTextAreaElement>('#student-expected')
const actualInput = requireElement<HTMLTextAreaElement>('#student-actual')
const firstHint = requireElement<HTMLElement>('#student-first-hint')
const copyButton = requireElement<HTMLButtonElement>('#student-copy-prompt')
const copyStatus = requireElement<HTMLElement>('#student-copy-status')
const copyFallback = requireElement<HTMLElement>('#student-copy-fallback')
const promptText = requireElement<HTMLTextAreaElement>('#student-prompt-text')

let currentProject: CanonicalProject | null = null
let currentAnalysis: ReturnType<typeof analyzeCanonicalProject> | null = null
let currentMap: ReturnType<typeof createProjectMap> | null = null
let isReadingProject = false
let projectMapLimit = 40

const targetAlias = (targetIndex: number): string => {
  if (targetIndex === 0) return '舞台'
  const index = targetIndex - 1
  let suffix = ''
  let value = index
  do {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return `角色 ${suffix}`
}

const renderProjectMap = (map: NonNullable<typeof currentMap>): void => {
  const visibleEvidence = map.evidence.slice(0, projectMapLimit)
  const groups = new Map<string, { target: string; script: number | null; labels: string[] }>()
  for (const item of visibleEvidence) {
    const key = `${item.targetIndex}:${item.scriptIndex ?? 'other'}`
    const group = groups.get(key) ?? {
      target: targetAlias(item.targetIndex),
      script: item.scriptIndex,
      labels: [],
    }
    if (!group.labels.includes(item.studentLabel)) group.labels.push(item.studentLabel)
    groups.set(key, group)
  }
  projectMapList.replaceChildren()
  for (const group of groups.values()) {
    const item = document.createElement('li')
    const heading = document.createElement('strong')
    heading.textContent = group.script === null ? group.target : `${group.target}・第 ${group.script + 1} 段程式`
    const labels = document.createElement('span')
    labels.textContent = group.labels.join('、')
    item.append(heading, labels)
    projectMapList.append(item)
  }
  const remaining = Math.max(0, map.evidence.length - visibleEvidence.length)
  projectMapMore.hidden = remaining === 0
  projectMapMore.textContent = remaining > 0 ? `查看更多 ${remaining} 個線索` : ''
}

const renderFirstHint = (question: string): void => {
  firstHint.replaceChildren()
  if (!question.trim() || !currentMap) {
    firstHint.hidden = true
    return
  }

  const lowerQuestion = question.toLocaleLowerCase()
  const categories: { keywords: string[]; opcodes: string[]; nextStep: (label: string) => string }[] = [
    {
      keywords: ['位置', '右邊', '左邊', '座標', '一開始', '出現在哪', '跑到哪'],
      opcodes: ['motion_gotoxy', 'motion_setx', 'motion_changexby'],
      nextStep: (label) =>
        `先在 Scratch 找到「${label}」，看看 x 旁的數字；再看積木寫的是「定位」還是「改變」，想一想它會設定位置還是移動多少。`,
    },
    {
      keywords: ['按鍵', '方向鍵', '按下', '不能動', '移動不了', '控制'],
      opcodes: ['event_whenkeypressed', 'sensing_keypressed'],
      nextStep: (label) => `先在 Scratch 找到「${label}」，確認它等的是哪個按鍵，再試著按一次那個鍵。`,
    },
    {
      keywords: ['碰到', '撞到', '碰撞', '接觸'],
      opcodes: ['sensing_touchingobject', 'event_whentouchingobject'],
      nextStep: (label) =>
        `先在 Scratch 找到「${label}」，看看它正在檢查哪個角色；再觀察遊戲中兩個角色有沒有真的碰在一起。`,
    },
    {
      keywords: ['分數', '加分', '得分', '分數沒有'],
      opcodes: ['data_changevariableby', 'data_setvariableto'],
      nextStep: (label) =>
        `先在 Scratch 找到「${label}」，看看它在什麼程式段裡；再找同一段前面的條件，想想什麼時候才會加分。`,
    },
    {
      keywords: ['聲音', '音樂', '沒有聲音'],
      opcodes: ['sound_play', 'sound_playuntildone', 'music_playDrumForBeats', 'text2speech_speakAndWait'],
      nextStep: (label) =>
        `先在 Scratch 找到「${label}」，看看它前面接著什麼開始積木或條件。若使用擴充積木，請也確認 Scratch 有啟用對應擴充功能。`,
    },
  ]
  const category = categories.find(({ keywords }) => keywords.some((keyword) => lowerQuestion.includes(keyword)))
  const evidence = category ? currentMap.evidence.find(({ opcode }) => category.opcodes.includes(opcode)) : undefined
  const heading = document.createElement('strong')
  const body = document.createElement('p')
  const location = evidence
    ? `${targetAlias(evidence.targetIndex)}${evidence.scriptIndex === null ? '' : `・第 ${evidence.scriptIndex + 1} 段程式`}`
    : ''
  if (category && evidence) {
    heading.textContent = '先試一個小提示'
    body.textContent = `${location}：${category.nextStep(evidence.studentLabel)}`
  } else {
    heading.textContent = '先從作品線索開始'
    body.textContent =
      '我目前找不到能直接回答這個問題的積木線索，所以先不猜原因。可以在上面的程式線索中找最像的積木，或請老師陪你一起看。'
  }
  firstHint.append(heading, body)
  firstHint.hidden = false
}

const setStatus = (element: HTMLElement, message: string, kind: 'success' | 'error' | 'neutral' = 'neutral') => {
  element.textContent = message
  element.dataset.kind = kind
}

const readProject = async (file: File): Promise<void> => {
  currentProject = null
  currentAnalysis = null
  currentMap = null
  projectMapLimit = 40
  expectedInput.value = ''
  actualInput.value = ''
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
    renderProjectMap(currentMap)
    renderFirstHint(questionInput.value)
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

projectMapMore.addEventListener('click', () => {
  if (!currentMap) return
  projectMapLimit += 40
  renderProjectMap(currentMap)
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
  renderFirstHint(questionInput.value)
})

const copyAnalysisPrompt = async (): Promise<void> => {
  if (!currentProject || !currentAnalysis || !currentMap) return
  const studentQuestion = [
    `學生問題：${questionInput.value.trim()}`,
    ...(expectedInput.value.trim() ? [`原本想看到：${expectedInput.value.trim()}`] : []),
    ...(actualInput.value.trim() ? [`實際看到：${actualInput.value.trim()}`] : []),
  ].join('\n')
  const prompt = createAnalysisPrompt({
    analysis: currentAnalysis,
    canonical: currentProject,
    projectMap: currentMap,
    question: studentQuestion,
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
