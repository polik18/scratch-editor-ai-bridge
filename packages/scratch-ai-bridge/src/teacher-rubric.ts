import {
  approveRubric,
  draftRubricFromText,
  PROJECT_TYPES,
  validateRubric,
  type Rubric,
  type RubricCriterion,
} from './core/grading'
import './style.css'

const app = document.querySelector<HTMLElement>('#teacher-rubric-app')
if (!app) throw new Error('Teacher rubric app root was not found')

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  )

const EXAMPLE = `1. 大魚、小魚的游泳方式正確 30分
2. 大魚碰到小魚，小魚消失並播放吃掉的音效 30分
3. 小魚被吃掉後，新的小魚分身在別處出現 40分`

app.innerHTML = `
  <div class="student-help-shell teacher-rubric">
    <header class="card wide">
      <h1>課堂評量規準</h1>
      <p>用老師自己的評量項目與配分評 Scratch 作業。系統只照這份規準計分，不會自行增加項目；核准前不會產生正式成績。</p>
    </header>
    <section class="card wide">
      <h2>1. 寫下評量項目</h2>
      <p>每行一項，結尾寫「N 分」。系統會建議自動檢查與測試步驟，配分完全照你寫的。</p>
      <div class="panel-grid">
        <label class="field-label">作業名稱 <input id="rubric-title" value="大魚吃小魚 Scratch 動畫" /></label>
        <label class="field-label">代碼（英數字） <input id="rubric-id" value="big-fish-v1" /></label>
        <label class="field-label">作品類型
          <select id="rubric-type">${PROJECT_TYPES.map((type) => `<option value="${type}"${type === 'animation' ? ' selected' : ''}>${type}</option>`).join('')}</select>
        </label>
      </div>
      <textarea id="rubric-text" rows="6">${EXAMPLE}</textarea>
      <div class="button-row">
        <button id="rubric-draft" class="button primary" type="button">產生草案</button>
        <label class="button secondary">讀取 rubric.json <input id="rubric-file" type="file" accept=".json,application/json" hidden /></label>
      </div>
      <p id="rubric-unread" role="status"></p>
    </section>
    <section class="card wide">
      <h2>2. 檢查與調整</h2>
      <div id="rubric-editor"></div>
      <div id="rubric-validation" role="status" aria-live="polite"></div>
      <details>
        <summary>進階：直接編輯 JSON</summary>
        <textarea id="rubric-json" rows="16" spellcheck="false"></textarea>
        <button id="rubric-json-apply" class="button secondary" type="button">套用 JSON</button>
      </details>
    </section>
    <section class="card wide">
      <h2>3. 核准並下載</h2>
      <p>核准會記錄這份規準的內容指紋（hash）；之後只要改過任何內容就必須重新核准，整班作品都會用同一個版本評分。</p>
      <label class="field-label">核准者（姓名縮寫或職稱即可） <input id="rubric-reviewer" placeholder="例如 T1" /></label>
      <div class="button-row">
        <button id="rubric-approve" class="button primary" type="button">核准</button>
        <button id="rubric-download" class="button secondary" type="button">下載 rubric.json</button>
      </div>
      <p>接著在電腦上執行：<code>npm run --silent bridge -- grade &lt;班級資料夾&gt; --rubric rubric.json --playtest</code></p>
    </section>
  </div>
`

const element = <T extends HTMLElement>(selector: string): T => {
  const found = app.querySelector<T>(selector)
  if (!found) throw new Error(`Teacher rubric page is missing ${selector}`)
  return found
}

let rubric: Rubric | undefined

const describeChecks = (criterion: RubricCriterion): string => {
  const checks = [
    ...(criterion.checks ?? []),
    ...(criterion.levels ?? []).flatMap(({ checks }) => checks ?? []),
    ...(criterion.components ?? []).flatMap(({ checks }) => checks ?? []),
  ]
  return checks.length ? checks.map(({ kind }) => kind).join('、') : '沒有自動檢查（需教師或 AI 判定）'
}

const render = (): void => {
  const editor = element<HTMLElement>('#rubric-editor')
  const validationBox = element<HTMLElement>('#rubric-validation')
  if (!rubric) {
    editor.innerHTML = '<p>先產生或讀取一份規準。</p>'
    validationBox.innerHTML = ''
    return
  }
  editor.innerHTML = rubric.criteria
    .map(
      (criterion, index) => `
      <fieldset class="card" data-index="${index}">
        <legend>項目 ${index + 1}（${criterion.mode}）</legend>
        <label class="field-label">名稱 <input data-field="title" value="${escapeHtml(criterion.title)}" /></label>
        <label class="field-label">配分 <input data-field="points" type="number" min="0" step="1" value="${criterion.points}" /></label>
        ${(criterion.components ?? [])
          .map(
            (component, componentIndex) =>
              `<label class="field-label">子項目「${escapeHtml(component.description)}」配分 <input data-component="${componentIndex}" type="number" min="0" step="1" value="${component.points}" /></label>`,
          )
          .join('')}
        ${(criterion.levels ?? [])
          .map(
            (level, levelIndex) =>
              `<label class="field-label">級距 ${Math.round(level.ratio * 100)}% 說明 <input data-level="${levelIndex}" value="${escapeHtml(level.description)}" /></label>`,
          )
          .join('')}
        <p>自動檢查：${escapeHtml(describeChecks(criterion))}</p>
        <p>測試步驟：${escapeHtml((criterion.testPlan ?? []).join('；'))}</p>
      </fieldset>`,
    )
    .join('')
  const validation = validateRubric(rubric)
  const total = rubric.criteria.reduce((sum, { points }) => sum + points, 0)
  validationBox.innerHTML = `
    <p><strong>${validation.ok ? '格式正確' : '還有錯誤'}</strong>：配分合計 ${total}／${rubric.totalPoints}；${validation.approved ? `已由 ${escapeHtml(rubric.approval?.by ?? '')} 核准` : '尚未核准'}${validation.rubricHash ? `；版本 ${validation.rubricHash.slice(0, 12)}` : ''}</p>
    ${validation.errors.length ? `<ul>${validation.errors.map(({ path, message }) => `<li>❌ ${escapeHtml(path)}：${escapeHtml(message)}</li>`).join('')}</ul>` : ''}
    ${validation.warnings.length ? `<ul>${validation.warnings.map(({ message }) => `<li>⚠️ ${escapeHtml(message)}</li>`).join('')}</ul>` : ''}`
  element<HTMLTextAreaElement>('#rubric-json').value = JSON.stringify(rubric, null, 2)
}

const update = (change: (current: Rubric) => Rubric): void => {
  if (!rubric) return
  const { approval: _stale, ...content } = change(rubric)
  const next = content as Rubric
  rubric = { ...next, totalPoints: next.criteria.reduce((sum, { points }) => sum + points, 0) }
  render()
}

element<HTMLButtonElement>('#rubric-draft').addEventListener('click', () => {
  const type = element<HTMLSelectElement>('#rubric-type').value as Rubric['projectType']
  const { rubric: draft, unread } = draftRubricFromText(element<HTMLTextAreaElement>('#rubric-text').value, {
    id: element<HTMLInputElement>('#rubric-id').value.trim(),
    title: element<HTMLInputElement>('#rubric-title').value.trim(),
    projectType: type,
  })
  rubric = draft
  element<HTMLElement>('#rubric-unread').textContent = unread.length ? `沒有讀到配分的行：${unread.join('、')}` : ''
  render()
})

element<HTMLElement>('#rubric-editor').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement
  const index = Number(input.closest<HTMLElement>('[data-index]')?.dataset.index)
  if (!Number.isInteger(index)) return
  update((current) => ({
    ...current,
    criteria: current.criteria.map((criterion, criterionIndex) => {
      if (criterionIndex !== index) return criterion
      if (input.dataset.field === 'title') return { ...criterion, title: input.value }
      if (input.dataset.field === 'points') return { ...criterion, points: Number(input.value) }
      if (input.dataset.component !== undefined) {
        const components = (criterion.components ?? []).map((component, componentIndex) =>
          componentIndex === Number(input.dataset.component)
            ? { ...component, points: Number(input.value) }
            : component,
        )
        return { ...criterion, components, points: components.reduce((sum, { points }) => sum + points, 0) }
      }
      if (input.dataset.level !== undefined)
        return {
          ...criterion,
          levels: (criterion.levels ?? []).map((level, levelIndex) =>
            levelIndex === Number(input.dataset.level) ? { ...level, description: input.value } : level,
          ),
        }
      return criterion
    }),
  }))
})

const loadJson = (text: string): void => {
  try {
    rubric = JSON.parse(text) as Rubric
    render()
  } catch {
    element<HTMLElement>('#rubric-validation').textContent = '不是有效的 JSON。'
  }
}

element<HTMLButtonElement>('#rubric-json-apply').addEventListener('click', () =>
  loadJson(element<HTMLTextAreaElement>('#rubric-json').value),
)
element<HTMLInputElement>('#rubric-file').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void file.text().then(loadJson)
})

element<HTMLButtonElement>('#rubric-approve').addEventListener('click', () => {
  const reviewer = element<HTMLInputElement>('#rubric-reviewer').value.trim()
  if (!rubric || !reviewer || !validateRubric(rubric).ok) {
    element<HTMLElement>('#rubric-validation').insertAdjacentHTML('beforeend', '<p>請先修正錯誤並填寫核准者。</p>')
    return
  }
  rubric = approveRubric({ ...rubric, origin: 'teacher' }, reviewer)
  render()
})

element<HTMLButtonElement>('#rubric-download').addEventListener('click', () => {
  if (!rubric) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(rubric, null, 2)}\n`], { type: 'application/json' }))
  link.download = `${rubric.id || 'rubric'}.json`
  link.click()
  URL.revokeObjectURL(link.href)
})

render()
