import { Buffer } from 'node:buffer'
import { md5 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils.js'
import { initializeScratchVM } from './bootstrap/vm-bootstrap'
import { requestOpenAiCompatiblePatch } from './core/ai/openai-compatible'
import {
  inspectRawBlocks,
  inspectRawTargets,
  inspectRawVariables,
  inspectRawProjectForAi,
  proposeRawLivePatch,
} from './core/ai/raw-tool-core'
import { inspectProjectForAi, proposeLivePatch } from './core/ai/tool-core'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
  type AnalysisIR,
  type ProjectEvidence,
  type ProjectFeedback,
  type ProjectMap,
  type ProjectScore,
} from './core/analyzer'
import {
  exportLosslessSb3,
  patchLosslessSb3BlockGraphs,
  patchRawSb3Properties,
  patchRawSb3Variables,
  rawSb3Revision,
  type RawPropertyChange,
  type RawSb3ArchiveEntry,
  type RawSb3Project,
} from './core/archive'
import {
  createAuthoringInstruction,
  createGameDesignDiscussionInstruction,
  createProjectFragmentInstruction,
  createStudentProjectInstruction,
  estimatePromptSize,
  type GameGenreProfile,
} from './core/capabilities'
import { parseSelfHostedCloudValue, selfHostedCloudKey, validSelfHostedCloudValue } from './core/cloud/self-hosted'
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
import {
  addExtractionRepair,
  applyLiveVariablePatchToProject,
  createLiveVariablePatchInstruction,
  createEmptyProjectFragmentSession,
  mergeProjectFragment,
  normalizeAiDraft,
  normalizeAiResponse,
  parseAiProjectResponse,
  parseAiResponse,
  parseLiveVariablePatch,
  type LivePatchOperation,
  type ProjectFragmentSession,
  type RequirementCoverageEntry,
} from './core/normalizer'
import {
  decryptProgressSave,
  encryptProgressSave,
  encryptCloudValue,
  isEncryptedProgressSave,
} from './core/progress/encryption'
import { accessProgressSave, parseProgressSave, type ProgressSave } from './core/progress/storage'
import {
  deleteSyncedSave,
  getSyncedSave,
  putSyncedSave,
  syncSaveKey,
  type SyncConnection,
} from './core/progress/sync-client'
import { createAnalysisPrompt, createScoringFeedbackPrompt, type TutorMode } from './core/prompt'
import {
  createAiOutputValidationReport,
  createRepairPrompt,
  createRepairReport,
  findRepeatedRepairIssues,
  type AiOutputValidationReport,
  type RepairReport,
  type RepeatedRepairIssue,
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
import {
  createVM,
  loadSb3,
  renderSb3Preview,
  type ScratchRuntimePatchChange,
  type ScratchRuntimePatchUpdate,
} from './scratch/vm'
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

const bootstrapVm = await initializeScratchVM()

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

  onProgress(message: Record<string, unknown>): void

  onHardwareMessage(message: Record<string, unknown>): void

  onRuntimePatchResult(message: Record<string, unknown>): void

  onSelfHostedCloudMessage(message: Record<string, unknown>): void

  replaceProject(archive: Blob, revision: number): void

  applyRuntimePatch(
    operations: readonly ScratchRuntimePatchUpdate[],
    baseRevision: number,
    revision: number,
  ): Promise<Record<string, unknown>>

  requestProgress(
    type: 'capture-game-progress' | 'restore-game-progress' | 'validate-game-progress',
    revision: number,
    snapshot?: unknown,
    targetSnapshot?: unknown,
  ): Promise<Record<string, unknown>>

  requestSelfHostedCloud(revision: number, projectId: string, canWrite: boolean): Promise<Record<string, unknown>>
}

let activeStudentAnimation: ActiveStudentAnimation | null = null

let speechConsentPromptQueue: Promise<void> = Promise.resolve()

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const active: any = activeStudentAnimation

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

  if (event.source !== active.frame.contentWindow) return

  if (typeof message.type === 'string' && message.type.startsWith('hardware-')) {
    active.onHardwareMessage(message)

    return
  }

  if (message.type === 'runtime-patch-result' || message.type === 'game-progress-result') {
    active.onRuntimePatchResult(message)

    return
  }
  if (message.type === 'selfhosted-cloud-write' || message.type === 'selfhosted-cloud-status') {
    active.onSelfHostedCloudMessage(message)
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
  else if (message.type === 'progress') active.onProgress(message)
  else if (message.type === 'stopped') active.finish('動畫預覽已停止；舞台靜態畫面已恢復。')
  else if (message.type === 'error') {
    const detail = typeof message.detail === 'string' ? `：${message.detail}` : ''

    active.finish(`動畫預覽載入失敗${detail}`)
  }
})

const stopStudentAnimation = (message: string): void => {
  ;(activeStudentAnimation as any)?.finish(message)
}

const AI_INSTRUCTION = createAuthoringInstruction()

app.innerHTML = `



  <a class="skip-link" href="#main-content">跳到主要內容</a>



  <header class="site-header">



    <div class="header-inner">



      <a class="brand-lockup" href="https://polik18.github.io/" aria-label="回到 Polik Projects 專案總覽">



        <span class="brand-mark" aria-hidden="true">P</span>



        <span><strong>Scratch AI Bridge</strong><small>POLIK PROJECTS · CLASSROOM TOOLS</small></span>



      </a>



      <nav aria-label="網站導覽">



        <a class="home-link" href="https://polik18.github.io/">← Polik 專案總覽</a>



      </nav>



    </div>



  </header>



  <div class="app-shell">



    <header class="topbar">



      <div>



        <div class="eyebrow">不用安裝 · 專案不上傳；外送文字前會先徵求同意</div>



        <h1>AI × Scratch 作品轉換器</h1>



        <p class="lede">把你的遊戲想法交給 AI，再將 AI 回覆變成可在 Scratch 開啟的專案。</p>



      </div>



      <div class="status-pill"><span></span> Scratch 工具已準備好</div>



    </header>







    <aside class="student-share-panel" aria-labelledby="student-share-title">



      <div class="student-share-copy">



        <span class="student-share-eyebrow">教師分享</span>



        <h2 id="student-share-title">給學生的解惑小幫手</h2>



        <p>學生可以上傳 Scratch 作品、寫下問題，再帶著作品線索去問 AI。這個專頁不顯示成績，也沒有作品生成功能。</p>



        <a href="https://polik18.github.io/scratch-editor-ai-bridge/student-help.html" target="_blank" rel="noopener noreferrer">開啟學生專頁 ↗</a>



      </div>



      <div class="student-share-action">



        <button id="copy-student-help-link" class="button primary" type="button">一鍵複製學生連結</button>



        <p id="student-help-link-status" role="status" aria-live="polite"></p>



      </div>



      <div id="student-help-link-fallback" class="student-share-fallback" hidden>



        <label for="student-help-link-text">無法自動複製時，請全選下方網址：</label>



        <input id="student-help-link-text" type="text" readonly value="https://polik18.github.io/scratch-editor-ai-bridge/student-help.html" />



      </div>



    </aside>







    <nav class="tabs" role="tablist" aria-label="選擇功能">



      <button id="generate-tab" class="tab active" role="tab" aria-selected="true" aria-controls="generate-panel" data-tab="generate">用 AI 做 Scratch</button>



      <button id="analyze-tab" class="tab" role="tab" aria-selected="false" aria-controls="analyze-panel" data-tab="analyze">請 AI 幫我檢查作品</button>



    </nav>







    <div class="workspace" id="main-content" tabindex="-1">



      <section id="generate-panel" class="panel-grid" role="tabpanel" aria-labelledby="generate-tab">



        <ol class="progress-steps" aria-label="製作進度">



          <li class="current"><span>1</span>描述作品</li>



          <li><span>2</span>確認玩法</li>



          <li><span>3</span>貼 AI 作品</li>



          <li><span>4</span>下載作品</li>



        </ol>



        <article class="card idea-card">



          <div class="step-heading"><span>1</span><div><h2>你想做什麼作品？</h2><p>一句主題或角色也可以。先用精簡指令和 AI 確認玩法，再貼回 brief 製作；也可直接讓 AI 自行設計。</p></div></div>



          <label for="project-request" class="field-label">我的作品想法</label>



          <textarea id="project-request" class="request-input" maxlength="1000" placeholder="例如：我想做一個關於深海探險的遊戲，主角是一條小魚。"></textarea>



          <div class="idea-examples" aria-label="作品想法範例">



            <span>找靈感：</span>



            <button type="button" class="idea-chip" data-request="我想做一個深海救援遊戲，主角是小魚，要找到走失的海龜朋友。">深海救援</button>



            <button type="button" class="idea-chip" data-request="我想做一個機器人送信遊戲，主角要把重要信件送到城市另一邊。">機器人送信</button>



            <button type="button" class="idea-chip" data-request="我想做一個校園解謎故事，主角在學校裡發現一張奇怪的紙條。">校園解謎</button>



          </div>



          <div class="button-row"><button id="copy-design-instruction" class="button primary" disabled>先和 AI 討論玩法</button><button id="copy-direct-instruction" class="button secondary" disabled>讓 AI 自行設計並製作</button></div>



          <p id="copy-status" class="inline-status" role="status" aria-live="polite">先寫下作品想法，或選一個範例。</p>

          <div class="game-brief-panel">

            <label for="game-genre" class="field-label">想做哪一類？（可讓 AI 從點子判斷）</label>

            <select id="game-genre" class="request-input genre-select">
              <option value="auto">讓 AI 依玩法決定</option>
              <option value="platformer">平台跳躍／動作冒險</option>
              <option value="arcade">街機射擊／閃避</option>
              <option value="puzzle-story">解謎／冒險故事</option>
              <option value="rhythm">節奏／音樂互動</option>
              <option value="drawing">繪圖／互動藝術</option>
              <option value="simulation">模擬／經營</option>
            </select>

            <label for="game-brief" class="field-label">把討論後確認的玩法 brief 貼在這裡</label>

            <textarea id="game-brief" class="request-input brief-input" maxlength="3000" placeholder="例如：玩家操控小魚游動，收集氧氣泡泡並躲避水母；每救到一隻海龜就解鎖新海域，碰到水母會失去氧氣，耗盡後可立即重來。"></textarea>

            <div class="button-row"><button id="copy-build-instruction" class="button primary" disabled>用已確認玩法複製製作指令</button></div>

            <p id="build-prompt-status" class="inline-status" role="status" aria-live="polite">討論完成後貼上 brief，再複製製作指令。你也可以直接選擇「讓 AI 自行設計並製作」。</p>

          </div>



        </article>



        <article class="card wide">



          <div class="step-heading"><span>2</span><div><h2>把 AI 最後做好的作品貼在這裡</h2><p>先回答 AI 的發想問題；等它回傳完整 JSON 作品後，再整段貼上，不需要刪除程式碼框。</p></div></div>



          <label for="json-editor" class="visually-hidden">AI 的完整回覆</label>



          <textarea id="json-editor" class="mono editor student-editor" spellcheck="false" placeholder="和 AI 討論完成後，貼上它最後產生的完整作品回覆。"></textarea>



          <details class="fragment-workflow">
            <summary>大型作品：分角色製作並逐片組合</summary>
            <p>每次只請 AI 完成一個 Stage 或角色；先加入 Stage，再貼角色片段。成功加入後會更新上方完整作品欄，可繼續新增同一角色的腳本。</p>
            <label class="fragment-reuse-option"><input id="fragment-reuse-contract" type="checkbox" checked>沿用同一 AI 對話前面已提供的能力規格（可省下重複積木目錄；若開新對話，請取消勾選）</label>
            <div class="fragment-fields">
              <label>target 類型<select id="fragment-kind"><option value="stage">Stage</option><option value="sprite">Sprite 角色</option></select></label>
              <label>target 名稱<input id="fragment-target-name" value="舞台" maxlength="80"></label>
              <label>片段 ID<input id="fragment-id" value="stage-1" maxlength="100"></label>
            </div>
            <div class="button-row"><button id="copy-fragment-prompt" class="button secondary">複製本片段指令</button></div>
            <label for="fragment-editor" class="visually-hidden">單一作品片段 JSON</label>
            <textarea id="fragment-editor" class="mono editor" aria-label="單一作品片段 JSON" spellcheck="false" placeholder="貼上單一 project-fragment JSON"></textarea>
            <div class="button-row"><button id="add-fragment" class="button primary">加入片段</button><button id="reset-fragments" class="button secondary">清除片段組合</button></div>
            <p id="fragment-status" class="inline-status" role="status" aria-live="polite">片段組合保存在本機瀏覽器；目前尚無片段。</p>
          </details>
          <div class="button-row student-actions"><button id="student-build" class="button primary">檢查並製作 Scratch</button><button id="load-sample" class="button secondary">試用平台遊戲範例</button></div>



          <div id="generate-status" class="status-box" role="status" aria-live="polite"></div>



          <section id="student-result" class="student-result" hidden>



            <strong id="student-result-title"></strong>



            <p id="student-result-message"></p>



            <ul id="student-requirement-coverage"></ul>



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



              <label for="instruction" class="field-label">目前 AI 指令（依設計階段更新）</label>



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



          <section aria-labelledby="project-map-title" class="project-map">



            <section class="project-score" aria-labelledby="project-score-title">



              <h3 id="project-score-title">SB3 程式結構參考分</h3>



              <p id="project-score-summary" class="muted">只分析檔案中看得到的程式結構，不代表作品品質或正式成績；作品不會上傳。</p>



              <ol id="project-score-criteria"></ol>



              <ul id="project-score-limits"></ul>



              <button id="copy-scoring-prompt" class="button secondary" disabled>複製參考分回饋提示給 Gemini</button>



            </section>



            <h3 id="project-map-title">作品目前看得出的行為</h3>



            <p id="project-map-coverage" class="muted">載入作品後顯示有積木依據的觀察與分析限制。</p>



            <ul id="project-map-facts"></ul>



            <details class="feedback-details"><summary>確認與下一步</summary><ul id="project-feedback-items"></ul><ul id="project-feedback-limits"></ul><button id="download-anonymous-feedback" class="button secondary" disabled>下載匿名回饋記錄</button><span id="feedback-export-status" role="status"></span></details>



          </section>



          <details class="target-script-list"><summary>角色與程式清單</summary><label class="field-label" for="target-script-filter">搜尋角色</label><input id="target-script-filter" type="search" placeholder="輸入角色名稱"><div id="target-script-list"></div></details>



        </article>



        <article class="card wide">



          <h2>3. 請 AI 協助</h2>



          <div class="analysis-controls">



            <label>你想了解什麼？ <input id="question" type="text" placeholder="例如：為什麼按下綠旗後角色沒有動？"></label>



            <label>回答方式 <select id="tutor-mode"><option value="student">給學生提示</option><option value="teacher">給老師建議</option></select></label>



            <label>提示程度 <select id="hint-level"><option value="1">簡短提示</option><option value="2" selected>逐步引導</option><option value="3">詳細說明</option><option value="4">完整解法</option></select></label>



          </div>



          <div class="button-row"><button id="copy-prompt" class="button primary" disabled>複製學習提示給 AI</button><button id="preview-imported-project" class="button secondary" disabled>預覽匯入作品</button></div>



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



    <footer class="license-notice">



      <p>



        本工具採用 AGPL-3.0-only 授權。<a href="https://github.com/polik18/scratch-editor-ai-bridge" target="_blank" rel="noopener noreferrer">取得本網站對應源碼（GitHub）</a> ·



        <a href="https://github.com/polik18/scratch-editor-ai-bridge/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">查看授權條款</a>



      </p>



      <p>Scratch 為 Scratch Foundation 的商標；本工具是獨立專案，未獲 Scratch Foundation 背書。</p>



    </footer>



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

const gameBrief = byId<HTMLTextAreaElement>('game-brief')

const gameGenre = byId<HTMLSelectElement>('game-genre')

const copyDesignInstruction = byId<HTMLButtonElement>('copy-design-instruction')

const copyBuildInstruction = byId<HTMLButtonElement>('copy-build-instruction')

const copyDirectInstruction = byId<HTMLButtonElement>('copy-direct-instruction')

const buildPromptStatus = byId<HTMLParagraphElement>('build-prompt-status')

const fragmentKind = byId<HTMLSelectElement>('fragment-kind')
const fragmentTargetName = byId<HTMLInputElement>('fragment-target-name')
const fragmentId = byId<HTMLInputElement>('fragment-id')
const fragmentEditor = byId<HTMLTextAreaElement>('fragment-editor')
const fragmentStatus = byId<HTMLParagraphElement>('fragment-status')
const fragmentReuseContract = byId<HTMLInputElement>('fragment-reuse-contract')
const fragmentStorageKey = 'scratch-ai-bridge.project-fragment-session.v1'
let projectFragmentSession: ProjectFragmentSession = createEmptyProjectFragmentSession()
try {
  const saved = sessionStorage.getItem(fragmentStorageKey)
  if (saved) {
    const parsed = JSON.parse(saved) as { project: ProjectFragmentSession['project']; appliedFragmentIds: string[] }
    if (parsed.project && Array.isArray(parsed.appliedFragmentIds)) {
      projectFragmentSession = { project: parsed.project, appliedFragmentIds: new Set(parsed.appliedFragmentIds) }
      editor.value = JSON.stringify(parsed.project, null, 2)
    }
  }
} catch {
  fragmentStatus.textContent = '瀏覽器限制 sessionStorage；片段目前只保存在這個分頁，請勿重新載入。'
}

const copyStatus = byId<HTMLParagraphElement>('copy-status')

const studentResult = byId<HTMLElement>('student-result')

const studentResultTitle = byId<HTMLElement>('student-result-title')

const studentResultMessage = byId<HTMLParagraphElement>('student-result-message')

const studentPreview = byId<HTMLDivElement>('student-preview')

const downloadStudentValidationReport = byId<HTMLButtonElement>('download-student-validation-report')

const studentRequirementCoverage = byId<HTMLUListElement>('student-requirement-coverage')

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

  readonly repeatedIssues: readonly RepeatedRepairIssue[]

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

let latestRequirementCoverage: readonly RequirementCoverageEntry[] | null = null

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
    ? latestRepairContext?.repeatedIssues.length
      ? `上一輪修正後仍有 ${latestRepairContext.repeatedIssues.length} 個相同問題。請依 fingerprint 與欄位路徑檢查；若 AI 反覆輸出同一內容，可改用下方欄位範例手動修正。`
      : report.summary.errors > 0
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
  const repeatedIssues = findRepeatedRepairIssues(latestRepairContext?.report, report)

  latestRepairContext = { report, currentProject, repeatedIssues, ...(validationReport ? { validationReport } : {}) }

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
    const active: any = activeStudentAnimation

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

  startAnimation.textContent = '執行作品（最多 120 秒）'

  const stopAnimation = document.createElement('button')

  stopAnimation.type = 'button'

  stopAnimation.className = 'button secondary'

  stopAnimation.textContent = '停止預覽'

  stopAnimation.hidden = true

  previewActions.append(startAnimation, stopAnimation)

  previewColumn.append(previewActions)

  let liveProject = structuredClone(project)
  let currentRawForProgress = rawSource
  let handleSelfHostedCloudMessage: (message: Record<string, unknown>) => void = () => undefined
  let stopSelfHostedCloud: (reason: string) => void = () => undefined
  let liveRevision = 0
  let livePatchBusy = false
  const liveUndoStack: {
    readonly projectBefore: CanonicalProject
    readonly projectAfter: CanonicalProject
    readonly runtimeUndo: readonly ScratchRuntimePatchUpdate[] | null
    readonly runtimeRedo: readonly ScratchRuntimePatchUpdate[] | null
    readonly requiresReload: boolean
    readonly summary: string
  }[] = []
  const liveRedoStack: typeof liveUndoStack = []
  const pendingLivePatches = new Map<
    string,
    { readonly resolve: (message: Record<string, unknown>) => void; readonly timer: number }
  >()
  const livePatchPanel = document.createElement('details')
  livePatchPanel.className = 'student-live-patch'
  const livePatchSummary = document.createElement('summary')
  livePatchSummary.textContent = '邊玩邊調整（變數、角色與舞台）'
  const livePatchHelp = document.createElement('p')
  livePatchHelp.textContent =
    '複製修改指令給 AI，貼回它產生的 live-patch JSON。差異舊值以作品欄為準；復原會回到套用當下的執行狀態。執行中修改角色位置等欄位可能被遊戲腳本再次改寫。最多可復原最近 20 次修改。'
  const livePatchPromptButton = document.createElement('button')
  livePatchPromptButton.type = 'button'
  livePatchPromptButton.className = 'button secondary'
  livePatchPromptButton.textContent = '複製 AI 即時修改指令'
  const livePatchInputLabel = document.createElement('label')
  livePatchInputLabel.htmlFor = 'live-patch-editor'
  livePatchInputLabel.textContent = 'AI 回傳的 patch JSON'
  const livePatchInput = document.createElement('textarea')
  livePatchInput.id = 'live-patch-editor'
  livePatchInput.className = 'mono editor live-patch-editor'
  livePatchInput.setAttribute('aria-label', 'AI 回傳的即時修改 patch JSON')
  livePatchInput.placeholder = '貼上 scratch-ai-bridge/live-patch v1 JSON'
  const localAiSettings = document.createElement('details')
  localAiSettings.className = 'live-ai-settings'
  const localAiSettingsSummary = document.createElement('summary')
  localAiSettingsSummary.textContent = '設定本機模型 API（不需要 OpenAI key）'
  const localAiHelp = document.createElement('p')
  localAiHelp.textContent =
    '填入這台電腦上的 OpenAI-compatible 模型 API 網址（localhost、127.0.0.1 或 ::1）與模型 ID。API key 可留空；若需要，僅保留在目前頁面記憶體，不會存檔。模型服務需允許本網站跨來源連線（CORS）。目前不連外部付費 API。'
  const gatewayHelp = document.createElement('p')
  gatewayHelp.textContent =
    '若模型在另一台區網電腦，先啟動本機 model gateway 指向該電腦，再於此配對。使用 HTTP 時作品文字和憑證會在區網明文傳輸。'
  const gatewayLabel = document.createElement('label')
  gatewayLabel.htmlFor = 'local-ai-gateway'
  gatewayLabel.textContent = '本機 model gateway 網址'
  const gatewayUrl = document.createElement('input')
  gatewayUrl.id = 'local-ai-gateway'
  gatewayUrl.type = 'url'
  gatewayUrl.value = 'http://127.0.0.1:43129'
  const gatewayConnect = document.createElement('button')
  gatewayConnect.type = 'button'
  gatewayConnect.className = 'button secondary'
  gatewayConnect.textContent = '配對區網模型 gateway'
  const gatewayDisconnect = document.createElement('button')
  gatewayDisconnect.type = 'button'
  gatewayDisconnect.className = 'button secondary'
  gatewayDisconnect.textContent = '中斷區網模型 gateway'
  gatewayDisconnect.hidden = true
  const gatewayStatus = document.createElement('p')
  gatewayStatus.setAttribute('role', 'status')
  gatewayStatus.textContent = '區網 gateway 未連線。'
  let gatewayToken = ''
  let gatewayOrigin = ''
  const gatewayFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (!gatewayToken || url.origin !== gatewayOrigin || url.pathname !== '/v1/chat/completions')
      return Promise.reject(new Error('模型網址與配對的 gateway 不符；請重新配對或中斷 gateway。'))
    const headers = new Headers(init?.headers)
    headers.set('X-Bridge-Token', gatewayToken)
    return fetch(input, { ...init, headers })
  }
  const localAiBaseUrlLabel = document.createElement('label')
  localAiBaseUrlLabel.htmlFor = 'local-ai-base-url'
  localAiBaseUrlLabel.textContent = 'API 網址'
  const localAiBaseUrl = document.createElement('input')
  localAiBaseUrl.id = 'local-ai-base-url'
  localAiBaseUrl.type = 'url'
  localAiBaseUrl.autocomplete = 'off'
  localAiBaseUrl.placeholder = '例如 http://localhost:1234/v1'
  const localAiModelLabel = document.createElement('label')
  localAiModelLabel.htmlFor = 'local-ai-model'
  localAiModelLabel.textContent = '模型 ID'
  const localAiModel = document.createElement('input')
  localAiModel.id = 'local-ai-model'
  localAiModel.autocomplete = 'off'
  localAiModel.placeholder = '填入模型服務回報的 model ID'
  const localAiKeyLabel = document.createElement('label')
  localAiKeyLabel.htmlFor = 'local-ai-key'
  localAiKeyLabel.textContent = 'API key（本機服務需要時才填）'
  const localAiKey = document.createElement('input')
  localAiKey.id = 'local-ai-key'
  localAiKey.type = 'password'
  localAiKey.autocomplete = 'off'
  localAiKey.placeholder = '可留空；不會保存到瀏覽器'
  const localAiRequestLabel = document.createElement('label')
  localAiRequestLabel.htmlFor = 'local-ai-request'
  localAiRequestLabel.textContent = '想怎麼調整遊戲？'
  const localAiRequest = document.createElement('textarea')
  localAiRequest.id = 'local-ai-request'
  localAiRequest.className = 'mono editor'
  localAiRequest.placeholder = '例如：讓玩家跳得更高，並把移動速度稍微降低。'
  localAiRequest.rows = 3
  const localAiActions = document.createElement('div')
  localAiActions.className = 'button-row'
  const localAiGenerateButton = document.createElement('button')
  localAiGenerateButton.type = 'button'
  localAiGenerateButton.className = 'button primary'
  localAiGenerateButton.textContent = '請本機 AI 提出修改'
  localAiGenerateButton.disabled = Boolean(rawSource)
  const localAiCancelButton = document.createElement('button')
  localAiCancelButton.type = 'button'
  localAiCancelButton.className = 'button secondary'
  localAiCancelButton.textContent = '取消請求'
  localAiCancelButton.hidden = true
  localAiActions.append(localAiGenerateButton, localAiCancelButton)
  localAiSettings.append(
    localAiSettingsSummary,
    localAiHelp,
    gatewayHelp,
    gatewayLabel,
    gatewayUrl,
    gatewayConnect,
    gatewayDisconnect,
    gatewayStatus,
    localAiBaseUrlLabel,
    localAiBaseUrl,
    localAiModelLabel,
    localAiModel,
    localAiKeyLabel,
    localAiKey,
    localAiRequestLabel,
    localAiRequest,
    localAiActions,
  )
  const localAiController: { current: AbortController | null } = { current: null }
  const stopGateway = (): void => {
    const token = gatewayToken
    const origin = gatewayOrigin
    gatewayToken = ''
    gatewayOrigin = ''
    localAiController.current?.abort()
    gatewayDisconnect.hidden = true
    gatewayConnect.disabled = false
    gatewayStatus.textContent = '區網 gateway 已中斷。'
    if (token && origin)
      void fetch(`${origin}/bridge/unpair`, { method: 'POST', headers: { 'X-Bridge-Token': token } }).catch(
        () => undefined,
      )
  }
  gatewayConnect.addEventListener('click', () => {
    void (async () => {
      gatewayConnect.disabled = true
      try {
        const url = new URL(gatewayUrl.value)
        if (
          url.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost'].includes(url.hostname) ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        )
          throw new Error('Gateway 必須是本機 HTTP origin，例如 http://127.0.0.1:43129。')
        const response = await fetch(`${url.origin}/bridge/pair`, { method: 'POST', cache: 'no-store' })
        if (!response.ok) throw new Error(`Gateway 配對失敗（HTTP ${response.status}）。`)
        const result = (await response.json()) as { token?: unknown; endpoint?: unknown }
        if (typeof result.token !== 'string' || result.token.length < 32 || typeof result.endpoint !== 'string')
          throw new Error('Gateway 配對回應無效。')
        gatewayToken = result.token
        gatewayOrigin = url.origin
        localAiBaseUrl.value = `${url.origin}/v1`
        gatewayDisconnect.hidden = false
        gatewayStatus.textContent = `已配對 ${result.endpoint}，配對最長 30 分鐘。`
      } catch (error) {
        gatewayConnect.disabled = false
        gatewayStatus.textContent =
          error instanceof TypeError
            ? '無法連接 gateway；請確認程序正在執行、網址正確，並允許瀏覽器存取本機網路。'
            : error instanceof Error
              ? error.message
              : String(error)
      }
    })()
  })
  gatewayDisconnect.addEventListener('click', stopGateway)
  const mcpSettings = document.createElement('details')
  mcpSettings.className = 'live-ai-settings'
  const mcpSettingsSummary = document.createElement('summary')
  mcpSettingsSummary.textContent = '連接外部 AI（MCP）'
  const mcpHelp = document.createElement('p')
  mcpHelp.textContent =
    '先在 MCP host 啟動 scratch-ai-bridge-mcp，再按連接。Bridge 會向本機 relay 取得 30 分鐘配對權；外部 AI 可讀取目前作品並提出待審修改，不能自行套用。'
  const mcpEndpointLabel = document.createElement('label')
  mcpEndpointLabel.htmlFor = 'mcp-relay-url'
  mcpEndpointLabel.textContent = '本機 MCP relay 網址'
  const mcpEndpoint = document.createElement('input')
  mcpEndpoint.id = 'mcp-relay-url'
  mcpEndpoint.type = 'url'
  mcpEndpoint.autocomplete = 'off'
  mcpEndpoint.value = 'http://127.0.0.1:43128'
  const mcpActions = document.createElement('div')
  mcpActions.className = 'button-row'
  const mcpConnectButton = document.createElement('button')
  mcpConnectButton.type = 'button'
  mcpConnectButton.className = 'button secondary'
  mcpConnectButton.textContent = '連接 MCP'
  const mcpDisconnectButton = document.createElement('button')
  mcpDisconnectButton.type = 'button'
  mcpDisconnectButton.className = 'button secondary'
  mcpDisconnectButton.textContent = '中斷 MCP'
  mcpDisconnectButton.hidden = true
  mcpActions.append(mcpConnectButton, mcpDisconnectButton)
  const mcpStatus = document.createElement('p')
  mcpStatus.className = 'inline-status'
  mcpStatus.setAttribute('role', 'status')
  mcpStatus.setAttribute('aria-live', 'polite')
  mcpStatus.textContent = '未連線'
  mcpSettings.append(mcpSettingsSummary, mcpHelp, mcpEndpointLabel, mcpEndpoint, mcpActions, mcpStatus)
  let mcpActiveToken = ''
  let mcpConnectedEndpoint = ''
  let mcpPollController: AbortController | null = null
  let mcpCandidate: {
    readonly candidateId: string
    readonly summary: string
    readonly baseRevision: number
    readonly patchJson: string
  } | null = null
  let rawAi: {
    inspect: () => string
    inspectBlocks: (args: unknown) => ReturnType<typeof inspectRawBlocks>
    inspectTargets: (args: unknown) => ReturnType<typeof inspectRawTargets>
    inspectVariables: (args: unknown) => ReturnType<typeof inspectRawVariables>
    validate: (json: string) => ReturnType<typeof proposeRawLivePatch>
    present: (json: string) => ReturnType<typeof proposeRawLivePatch>
    status: () => unknown
    report: (message: string) => void
  } | null = null
  const livePatchDiff = document.createElement('pre')
  livePatchDiff.className = 'live-patch-diff'
  livePatchDiff.hidden = true
  const livePatchActions = document.createElement('div')
  livePatchActions.className = 'button-row'
  const previewPatchButton = document.createElement('button')
  previewPatchButton.type = 'button'
  previewPatchButton.className = 'button secondary'
  previewPatchButton.textContent = '檢查修改'
  previewPatchButton.disabled = true
  const applyPatchButton = document.createElement('button')
  applyPatchButton.type = 'button'
  applyPatchButton.className = 'button primary'
  applyPatchButton.textContent = '套用到執行中的遊戲'
  applyPatchButton.disabled = true
  const undoPatchButton = document.createElement('button')
  undoPatchButton.type = 'button'
  undoPatchButton.className = 'button secondary'
  undoPatchButton.textContent = '復原上次修改'
  undoPatchButton.disabled = true
  const redoPatchButton = document.createElement('button')
  redoPatchButton.type = 'button'
  redoPatchButton.className = 'button secondary'
  redoPatchButton.textContent = '重做已復原修改'
  redoPatchButton.disabled = true
  livePatchActions.append(previewPatchButton, applyPatchButton, undoPatchButton, redoPatchButton)
  const livePatchStatus = document.createElement('p')
  livePatchStatus.className = 'inline-status'
  livePatchStatus.setAttribute('role', 'status')
  livePatchStatus.setAttribute('aria-live', 'polite')
  const canPatchLiveProject = !rawSource
  if (rawSource) {
    livePatchStatus.textContent = '為保留匯入作品的原始積木與素材，即時修改目前只開放 Canonical IR 作品。'
    livePatchPromptButton.disabled = true
    localAiSettings.hidden = true
    mcpSettings.hidden = true
  } else {
    livePatchStatus.textContent = '開始執行作品後可調整既有變數、角色與舞台屬性；積木/腳本及雲端變數不支援。'
  }
  const setLivePatchReady = (ready: boolean): void => {
    const enabled = ready && canPatchLiveProject && !livePatchBusy
    previewPatchButton.disabled = !enabled
    applyPatchButton.disabled = !enabled
    undoPatchButton.disabled = !enabled || liveUndoStack.length === 0
    redoPatchButton.disabled = !enabled || liveRedoStack.length === 0
  }
  const showLivePatchDiff = (summary: string, operations: readonly LivePatchOperation[]): void => {
    livePatchDiff.textContent = [
      summary,
      ...operations.map((operation) => {
        if (operation.op === 'add-target-script')
          return `新增 ${operation.target} 腳本：${operation.script.blocks.map(({ opcode }) => opcode).join(' → ')}`
        if (operation.op === 'replace-target-script')
          return `替換 ${operation.target} 腳本 ${operation.selector}：${operation.script.blocks.map(({ opcode }) => opcode).join(' → ')}`
        if (operation.op === 'remove-target-script') return `移除 ${operation.target} 腳本 ${operation.selector}`
        const label =
          operation.op === 'set-variable'
            ? `${operation.target}/${operation.name}`
            : operation.op === 'set-target-property'
              ? `${operation.target}.${operation.property}`
              : `Stage.${operation.property}`
        return `${label}: ${JSON.stringify(operation.beforeValue)} → ${JSON.stringify(operation.value)}`
      }),
      ...(operations.some((operation) => operation.op.includes('-target-script'))
        ? ['套用與復原都會重載遊戲，並重置目前進度。']
        : []),
    ].join('\n')
    livePatchDiff.hidden = false
  }
  let preparedLivePatch: ReturnType<typeof parseLiveVariablePatch> | null = null
  const inspectLivePatch = (): void => {
    preparedLivePatch = parseLiveVariablePatch(livePatchInput.value, liveProject, liveRevision)
    showLivePatchDiff(preparedLivePatch.summary, preparedLivePatch.operations)
    livePatchStatus.dataset.kind = 'ok'
    livePatchStatus.textContent = `修改內容合法（revision ${liveRevision}）。確認後套用到目前預覽。`
  }
  const stopMcpConnection = (message: string): void => {
    const token = mcpActiveToken
    const endpoint = mcpConnectedEndpoint
    mcpActiveToken = ''
    mcpConnectedEndpoint = ''
    mcpPollController?.abort()
    mcpPollController = null
    mcpConnectButton.disabled = false
    mcpDisconnectButton.hidden = true
    mcpStatus.textContent = message
    if (token && endpoint)
      void fetch(`${endpoint}/bridge/unpair`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }).catch(() => undefined)
  }
  const handleMcpToolRequest = (request: unknown): unknown => {
    if (typeof request !== 'object' || request === null || Array.isArray(request))
      throw new Error('MCP relay 傳來無效的工具要求。')
    const { tool, arguments: args } = request as { tool?: unknown; arguments?: unknown }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('MCP 工具參數格式錯誤。')
    if (rawAi) {
      if (tool === 'inspect_project') return { projectName: liveProject.name, instruction: rawAi.inspect() }
      if (tool === 'inspect_raw_blocks') return rawAi.inspectBlocks(args)
      if (tool === 'inspect_raw_targets') return rawAi.inspectTargets(args)
      if (tool === 'inspect_raw_variables') return rawAi.inspectVariables(args)
      if (tool === 'get_patch_status') return rawAi.status()
      if (tool === 'propose_live_patch') {
        if (localAiController.current) throw new Error('本機 AI 請求進行中。')
        const patchJson = (args as { patchJson?: unknown }).patchJson
        if (typeof patchJson !== 'string') throw new Error('請提供 patchJson 字串。')
        const candidate = rawAi.present(patchJson)
        return {
          state: 'pending-user-review',
          candidateId: candidate.candidateId,
          baseRevision: candidate.baseRevision,
          changes: candidate.changes,
        }
      }
      throw new Error(`Bridge 不提供 MCP 工具「${String(tool)}」。`)
    }
    if (tool === 'inspect_project') {
      return {
        projectName: liveProject.name,
        baseRevision: liveRevision,
        instruction: inspectProjectForAi(liveProject, liveRevision),
      }
    }
    if (tool === 'propose_live_patch') {
      if (localAiController.current) throw new Error('本機 AI 請求進行中，請稍後再提出 MCP 修改。')
      if (mcpCandidate?.baseRevision === liveRevision)
        throw new Error('目前已有尚未處理的 MCP 候選；請先檢查、套用或清除後再提案。')
      if (preparedLivePatch?.baseRevision === liveRevision)
        throw new Error('目前已有待審修改；請先套用、清除或編輯後再提出 MCP 候選。')
      if (livePatchInput.value.trim() && !mcpCandidate)
        throw new Error('Patch 欄位已有內容；請先檢查或清除，再接受 MCP 候選。')
      const patchJson = (args as { patchJson?: unknown }).patchJson
      if (typeof patchJson !== 'string') throw new Error('MCP propose_live_patch 缺少 patchJson 字串。')
      const candidate = proposeLivePatch(liveProject, liveRevision, patchJson)
      livePatchInput.value = candidate.patchJson
      livePatchInput.dispatchEvent(new Event('input', { bubbles: true }))
      inspectLivePatch()
      mcpCandidate = {
        candidateId: candidate.candidateId,
        summary: candidate.summary,
        baseRevision: candidate.baseRevision,
        patchJson: candidate.patchJson,
      }
      livePatchStatus.dataset.kind = 'pending'
      livePatchStatus.textContent = `外部 AI 提出「${candidate.summary}」。差異已顯示；請檢查後自行確認套用。`
      return {
        state: 'pending-user-review',
        candidateId: candidate.candidateId,
        baseRevision: candidate.baseRevision,
        operationCount: candidate.operationCount,
        changes: candidate.changes,
      }
    }
    if (tool === 'get_patch_status') {
      if (!mcpCandidate) return { state: 'no-candidate', revision: liveRevision }
      return {
        ...mcpCandidate,
        state: mcpCandidate.baseRevision === liveRevision ? 'pending-user-review' : 'revision-changed',
        revision: liveRevision,
      }
    }
    throw new Error(`Bridge 不提供 MCP 工具「${String(tool)}」。`)
  }
  const pollMcpRelay = async (endpoint: string, token: string): Promise<void> => {
    while (mcpActiveToken === token) {
      const controller = new AbortController()
      mcpPollController = controller
      try {
        const response = await fetch(`${endpoint}/bridge/poll`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.status === 204) {
          mcpStatus.textContent = '已連線，等待外部 AI 工具呼叫。'
        } else if (response.ok) {
          const request: unknown = await response.json()
          const id = (request as { id?: unknown }).id
          if (typeof id !== 'string') throw new Error('MCP relay request 缺少 ID。')
          let result: unknown
          let error: string | undefined
          try {
            result = handleMcpToolRequest(request)
          } catch (toolError) {
            error = toolError instanceof Error ? toolError.message : String(toolError)
          }
          const delivered = await fetch(`${endpoint}/bridge/respond`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, result, ...(error ? { error } : {}) }),
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!delivered.ok) throw new Error(`MCP relay 回覆失敗（HTTP ${delivered.status}）。`)
        } else if (response.status === 401 || response.status === 403) {
          throw new Error('MCP 配對碼無效，或目前網站來源未列入 server allowlist。')
        } else {
          throw new Error(`無法連線 MCP relay（HTTP ${response.status}）。`)
        }
      } catch (error) {
        if (mcpActiveToken !== token) break
        stopMcpConnection(error instanceof Error ? error.message : String(error))
        break
      } finally {
        if (mcpPollController === controller) mcpPollController = null
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400))
    }
  }
  mcpConnectButton.addEventListener('click', () => {
    try {
      const url = new URL(mcpEndpoint.value.trim())
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(hostname))
        throw new Error('MCP relay 僅允許本機 loopback HTTP。')
      if (url.username || url.password || url.search || url.hash)
        throw new Error('MCP relay 網址不可包含帳密、查詢參數或片段。')
      mcpConnectButton.disabled = true
      mcpStatus.textContent = '正在配對本機 MCP relay…'
      void (async () => {
        const endpoint = url.toString().replace(/\/+$/, '')
        try {
          const response = await fetch(`${endpoint}/bridge/pair`, { method: 'POST', cache: 'no-store' })
          if (!response.ok) throw new Error(`MCP relay 配對失敗（HTTP ${response.status}）。`)
          const pairing = (await response.json()) as { token?: unknown }
          if (typeof pairing.token !== 'string' || pairing.token.length < 32)
            throw new Error('MCP relay 沒有回傳有效的配對憑證。')
          mcpActiveToken = pairing.token
          mcpConnectedEndpoint = endpoint
          mcpDisconnectButton.hidden = false
          mcpStatus.textContent = '已配對本機 MCP relay，正在連線…'
          void pollMcpRelay(endpoint, pairing.token)
        } catch (error) {
          mcpConnectButton.disabled = false
          mcpStatus.textContent = error instanceof Error ? error.message : String(error)
        }
      })()
    } catch (error) {
      mcpStatus.textContent = error instanceof Error ? error.message : String(error)
    }
  })
  mcpDisconnectButton.addEventListener('click', () => stopMcpConnection('已中斷 MCP 連線。'))
  window.addEventListener('pagehide', () => {
    mcpActiveToken = ''
    mcpPollController?.abort()
    if (gatewayToken) stopGateway()
  })
  livePatchPromptButton.addEventListener('click', () => {
    copyStudentPrompt(
      createLiveVariablePatchInstruction(liveProject, liveRevision),
      livePatchStatus,
      '已複製目前作品的即時修改指令',
    )
  })
  localAiGenerateButton.addEventListener('click', () => {
    void (async () => {
      if (localAiController.current) return
      if (rawAi) {
        const adapter = rawAi
        const controller = new AbortController()
        localAiController.current = controller
        const timeout = window.setTimeout(() => controller.abort(), 120_000)
        localAiGenerateButton.disabled = true
        localAiCancelButton.hidden = false
        adapter.report('正在請本機模型提出修改…')
        try {
          const response = await requestOpenAiCompatiblePatch({
            baseUrl: localAiBaseUrl.value,
            model: localAiModel.value,
            apiKey: localAiKey.value,
            instruction: adapter.inspect(),
            request: localAiRequest.value,
            signal: controller.signal,
            enableRawBlockInspection: true,
            ...(gatewayToken ? { fetchImpl: gatewayFetch } : {}),
            onToolCall: (name, argumentsJson) => {
              try {
                if (name === 'inspect_project') return { output: adapter.inspect() }
                const args: unknown = JSON.parse(argumentsJson)
                if (name === 'inspect_raw_blocks') return { output: JSON.stringify(adapter.inspectBlocks(args)) }
                if (name === 'inspect_raw_targets') return { output: JSON.stringify(adapter.inspectTargets(args)) }
                if (name === 'inspect_raw_variables')
                  return { output: JSON.stringify(adapter.inspectVariables(args)) }
                if (
                  name !== 'propose_live_patch' ||
                  typeof args !== 'object' ||
                  args === null ||
                  typeof (args as { patchJson?: unknown }).patchJson !== 'string'
                )
                  throw new Error('工具參數無效。')
                const candidate = adapter.validate((args as { patchJson: string }).patchJson)
                return {
                  output: JSON.stringify({ candidateId: candidate.candidateId, changes: candidate.changes }),
                  patchJson: candidate.patchJson,
                }
              } catch (error) {
                return { output: `候選未通過驗證：${error instanceof Error ? error.message : String(error)}` }
              }
            },
          })
          adapter.present(response)
        } catch (error) {
          adapter.report(
            error instanceof Error && error.name === 'AbortError'
              ? '本機模型請求已取消或逾時。'
              : error instanceof Error
                ? error.message
                : String(error),
          )
        } finally {
          window.clearTimeout(timeout)
          if (localAiController.current === controller) localAiController.current = null
          localAiGenerateButton.disabled = false
          localAiCancelButton.hidden = true
        }
        return
      }
      if (preparedLivePatch?.baseRevision === liveRevision) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent = '目前已有待審修改；請先套用、清除或編輯後再產生另一份修改。'
        return
      }
      if (mcpCandidate?.baseRevision === liveRevision) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent = '目前已有待審 MCP 候選；請先套用、清除或編輯後再產生另一份修改。'
        return
      }
      const controller = new AbortController()
      localAiController.current = controller
      const timeout = window.setTimeout(() => controller.abort(), 120_000)
      localAiGenerateButton.disabled = true
      localAiCancelButton.hidden = false
      livePatchStatus.dataset.kind = 'pending'
      livePatchStatus.textContent = '正在把目前作品的精簡結構與修改要求送到你設定的模型…'
      try {
        const response = await requestOpenAiCompatiblePatch({
          baseUrl: localAiBaseUrl.value,
          model: localAiModel.value,
          apiKey: localAiKey.value,
          instruction: inspectProjectForAi(liveProject, liveRevision),
          request: localAiRequest.value,
          signal: controller.signal,
          ...(gatewayToken ? { fetchImpl: gatewayFetch } : {}),
          onToolCall: (name, argumentsJson) => {
            try {
              const args: unknown = JSON.parse(argumentsJson)
              if (name === 'inspect_project') {
                return { output: inspectProjectForAi(liveProject, liveRevision) }
              }
              if (name === 'propose_live_patch') {
                if (
                  typeof args !== 'object' ||
                  args === null ||
                  typeof (args as { patchJson?: unknown }).patchJson !== 'string'
                )
                  throw new Error('propose_live_patch 必須提供 patchJson 字串。')
                const candidate = proposeLivePatch(
                  liveProject,
                  liveRevision,
                  (args as { patchJson: string }).patchJson,
                )
                return {
                  output: JSON.stringify({ candidateId: candidate.candidateId, changes: candidate.changes }),
                  patchJson: candidate.patchJson,
                }
              }
              throw new Error(`不支援的模型工具：${name}`)
            } catch (error) {
              return { output: `候選未通過驗證：${error instanceof Error ? error.message : String(error)}` }
            }
          },
        })
        const candidate = proposeLivePatch(liveProject, liveRevision, response)
        livePatchInput.value = candidate.patchJson
        livePatchInput.dispatchEvent(new Event('input', { bubbles: true }))
        inspectLivePatch()
        livePatchStatus.dataset.kind = 'pending'
        livePatchStatus.textContent = '本機模型已提出修改，差異已顯示；請檢查後自行確認套用。'
      } catch (error) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent =
          error instanceof Error && error.name === 'AbortError'
            ? '本機模型請求已取消或逾時。'
            : error instanceof Error
              ? error.message
              : String(error)
      } finally {
        window.clearTimeout(timeout)
        if (localAiController.current === controller) localAiController.current = null
        localAiGenerateButton.disabled = false
        localAiCancelButton.hidden = true
      }
    })()
  })
  localAiCancelButton.addEventListener('click', () => localAiController.current?.abort())
  previewPatchButton.addEventListener('click', () => {
    try {
      inspectLivePatch()
    } catch (error) {
      preparedLivePatch = null
      livePatchDiff.hidden = true
      livePatchStatus.dataset.kind = 'error'
      livePatchStatus.textContent = error instanceof Error ? error.message : String(error)
    }
  })
  const requestRuntimePatch = async (
    updates: readonly ScratchRuntimePatchUpdate[],
    baseRevision: number,
  ): Promise<Record<string, unknown>> => {
    const active = activeStudentAnimation
    if (!active) throw new Error('動畫預覽已停止。')
    return active.applyRuntimePatch(updates, baseRevision, baseRevision + 1)
  }
  const waitForAnimationReady = async (): Promise<void> => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (generation !== studentPreviewGeneration) throw new Error('預覽已切換。')
      if (activeStudentAnimation && stageStatus.textContent.includes('動畫執行中')) return
      if (!activeStudentAnimation && !startAnimation.disabled && !animationStarting)
        throw new Error(stageStatus.textContent || '動畫預覽重載失敗。')
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    throw new Error(`動畫預覽重載逾時：${stageStatus.textContent || '尚未回報狀態'}`)
  }
  const reloadPreviewArchive = async (archive: Blob, revision: number): Promise<void> => {
    const currentAnimation = activeStudentAnimation
    liveRevision = revision
    patchedPreviewArchive = archive
    if (currentAnimation) {
      stageStatus.textContent = '正在重新載入作品。'
      currentAnimation.replaceProject(archive, revision)
    } else if (!startAnimation.hidden) startAnimation.click()
    else throw new Error('動畫預覽目前無法重載。')
    await waitForAnimationReady()
  }
  if (rawSource) {
    livePatchPanel.hidden = true
    const panel = document.createElement('details')
    panel.className = 'student-live-patch'
    const title = document.createElement('summary')
    title.textContent = '調整匯入作品的角色、舞台與變數'
    const help = document.createElement('p')
    help.textContent =
      '修改作品中的初始屬性及非雲端變數。支援的修改會同步到執行中的遊戲；其他修改會重載遊戲並重置進度。下載會另存新的 SB3。'
    const targetLabel = document.createElement('label')
    targetLabel.textContent = '角色或舞台'
    const targetSelect = document.createElement('select')
    targetLabel.append(targetSelect)
    const propertyLabel = document.createElement('label')
    propertyLabel.textContent = '屬性或變數'
    const propertySelect = document.createElement('select')
    propertyLabel.append(propertySelect)
    const valueLabel = document.createElement('label')
    valueLabel.textContent = '新值（可見填 true 或 false；造型使用從 0 開始的編號）'
    const valueInput = document.createElement('input')
    valueInput.type = 'text'
    valueLabel.append(valueInput)
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    const actions = document.createElement('div')
    actions.className = 'button-row'
    const makeButton = (label: string): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'button secondary'
      button.textContent = label
      actions.append(button)
      return button
    }
    const apply = makeButton('套用屬性')
    const undo = makeButton('復原')
    const redo = makeButton('重做')
    const save = makeButton('下載修改後的 SB3')
    const acceptCandidate = makeButton('確認套用 AI 修改')
    const discardCandidate = makeButton('捨棄 AI 修改')
    acceptCandidate.hidden = true
    discardCandidate.hidden = true
    const candidateDiff = document.createElement('pre')
    candidateDiff.className = 'live-patch-diff'
    candidateDiff.hidden = true
    let currentRaw = rawSource
    let rawCandidate: ReturnType<typeof proposeRawLivePatch> | null = null
    let rawBusy = false
    interface RawHistoryEntry {
      project: RawSb3Project
      runtime: ScratchRuntimePatchUpdate | null
      animation: ActiveStudentAnimation | null
    }
    const undoStack: RawHistoryEntry[] = []
    const redoStack: RawHistoryEntry[] = []
    const getTargets = (): Record<string, unknown>[] =>
      Array.isArray(currentRaw.projectJson.targets)
        ? currentRaw.projectJson.targets.filter(
            (target: unknown): target is Record<string, unknown> =>
              typeof target === 'object' && target !== null && !Array.isArray(target),
          )
        : []
    const getVariables = (target: Record<string, unknown> | undefined): Record<string, unknown> => {
      const variables = target?.variables
      return typeof variables === 'object' && variables !== null && !Array.isArray(variables)
        ? (variables as Record<string, unknown>)
        : {}
    }
    const refresh = (): void => {
      const targets = getTargets()
      const chosen = targetSelect.value
      targetSelect.replaceChildren()
      for (const target of targets) {
        if (typeof target.name !== 'string' || targets.filter((item) => item.name === target.name).length !== 1)
          continue
        const option = document.createElement('option')
        option.value = target.name
        option.textContent = target.isStage === true ? `${target.name}（舞台）` : target.name
        targetSelect.append(option)
      }
      if (Array.from(targetSelect.options).some((option) => option.value === chosen)) targetSelect.value = chosen
      const target = targets.find((item) => item.name === targetSelect.value)
      const previousProperty = propertySelect.value
      propertySelect.replaceChildren()
      const fields =
        target?.isStage === true
          ? ['currentCostume', 'volume', 'tempo']
          : ['x', 'y', 'direction', 'size', 'visible', 'currentCostume', 'volume']
      for (const field of fields) {
        if (typeof target?.[field] !== (field === 'visible' ? 'boolean' : 'number')) continue
        const option = document.createElement('option')
        option.value = field
        option.textContent = field
        propertySelect.append(option)
      }
      for (const [id, variable] of Object.entries(getVariables(target))) {
        if (!Array.isArray(variable) || typeof variable[0] !== 'string' || variable[2] === true) continue
        if (!['string', 'number', 'boolean'].includes(typeof variable[1])) continue
        const option = document.createElement('option')
        option.value = `variable:${id}`
        option.textContent = `變數：${variable[0]}`
        propertySelect.append(option)
      }
      if (Array.from(propertySelect.options).some((option) => option.value === previousProperty))
        propertySelect.value = previousProperty
      const selected = propertySelect.value
      const variable = selected.startsWith('variable:') ? getVariables(target)[selected.slice(9)] : undefined
      const oldValue: unknown = Array.isArray(variable) ? variable[1] : target?.[selected]
      valueInput.value =
        typeof oldValue === 'string' || typeof oldValue === 'number' || typeof oldValue === 'boolean'
          ? String(oldValue)
          : ''
      apply.disabled = !target || !propertySelect.value
      undo.disabled = undoStack.length === 0
      redo.disabled = redoStack.length === 0
    }
    const setBusy = (busy: boolean): void => {
      rawBusy = busy
      for (const element of [
        targetSelect,
        propertySelect,
        valueInput,
        apply,
        undo,
        redo,
        save,
        acceptCandidate,
        discardCandidate,
      ])
        element.disabled = busy
      if (!busy) refresh()
    }
    const install = async (
      next: RawSb3Project,
      runtime: ScratchRuntimePatchUpdate | null,
      verifyGraph = false,
    ): Promise<ScratchRuntimePatchUpdate | null> => {
      const nextArchive = await exportLosslessSb3(next)
      if (verifyGraph) {
        const validationVm = await createVM()
        try {
          await loadSb3(nextArchive, validationVm)
        } finally {
          validationVm.quit()
        }
      }
      if (generation !== studentPreviewGeneration) throw new Error('預覽已切換，修改未套用。')
      let inverse: ScratchRuntimePatchUpdate | null = null
      const animation = activeStudentAnimation
      if (animation) {
        const previousArchive = patchedPreviewArchive ?? (await exportLosslessSb3(currentRaw))
        try {
          if (runtime) {
            const response = await requestRuntimePatch([runtime], liveRevision)
            if (generation !== studentPreviewGeneration || activeStudentAnimation !== animation)
              throw new Error('預覽已切換，修改結果已捨棄。')
            if (response.ok !== true || !Array.isArray(response.changes) || response.changes.length !== 1)
              throw new Error(typeof response.error === 'string' ? response.error : '預覽 VM 未確認修改。')
            const before: unknown = (response.changes[0] as { beforeValue?: unknown }).beforeValue
            if (typeof before !== 'number' && typeof before !== 'string' && typeof before !== 'boolean')
              throw new Error('預覽 VM 傳回無效的復原值。')
            if (runtime.op === 'set-stage-property' && typeof before !== 'number')
              throw new Error('預覽 VM 傳回無效的舞台復原值。')
            inverse = { ...runtime, value: before } as ScratchRuntimePatchUpdate
            liveRevision += 1
            patchedPreviewArchive = nextArchive
          } else {
            await reloadPreviewArchive(nextArchive, liveRevision + 1)
            if (generation !== studentPreviewGeneration || activeStudentAnimation !== animation)
              throw new Error('預覽已切換，修改結果已捨棄。')
          }
        } catch (error) {
          if (generation !== studentPreviewGeneration || activeStudentAnimation !== animation) throw error
          try {
            await reloadPreviewArchive(previousArchive, liveRevision + 1)
          } catch {
            patchedPreviewArchive = previousArchive
            throw new Error('預覽重載及回復失敗，請重新執行作品；原始作品仍可下載。')
          }
          throw error
        }
      } else {
        patchedPreviewArchive = nextArchive
      }
      if (generation !== studentPreviewGeneration) throw new Error('預覽已切換，修改結果已捨棄。')
      currentRaw = next
      currentRawForProgress = next
      return inverse
    }
    rawAi = {
      inspect: () => inspectRawProjectForAi(currentRaw),
      inspectTargets: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('角色查詢格式無效。')
        const item = args as { baseRevision?: unknown; offset?: unknown; limit?: unknown }
        if (
          typeof item.baseRevision !== 'string' ||
          (item.offset !== undefined && typeof item.offset !== 'number') ||
          (item.limit !== undefined && typeof item.limit !== 'number')
        )
          throw new Error('角色查詢欄位無效。')
        return inspectRawTargets(currentRaw, item.baseRevision, item.offset, item.limit)
      },
      inspectVariables: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('變數查詢格式無效。')
        const item = args as { baseRevision?: unknown; targetIndex?: unknown; offset?: unknown; limit?: unknown }
        if (
          typeof item.baseRevision !== 'string' ||
          typeof item.targetIndex !== 'number' ||
          (item.offset !== undefined && typeof item.offset !== 'number') ||
          (item.limit !== undefined && typeof item.limit !== 'number')
        )
          throw new Error('變數查詢欄位無效。')
        return inspectRawVariables(currentRaw, item.baseRevision, item.targetIndex, item.offset, item.limit)
      },
      inspectBlocks: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('積木查詢格式無效。')
        const item = args as { baseRevision?: unknown; targetIndex?: unknown; offset?: unknown; limit?: unknown }
        if (
          typeof item.baseRevision !== 'string' ||
          typeof item.targetIndex !== 'number' ||
          (item.offset !== undefined && typeof item.offset !== 'number') ||
          (item.limit !== undefined && typeof item.limit !== 'number')
        )
          throw new Error('積木查詢欄位無效。')
        return inspectRawBlocks(currentRaw, item.baseRevision, item.targetIndex, item.offset, item.limit)
      },
      validate: (json) => proposeRawLivePatch(currentRaw, json),
      present: (json) => {
        if (rawBusy) throw new Error('正在套用修改，請稍後再試。')
        if (rawCandidate) throw new Error('已有待審的 AI 修改，請先確認或捨棄。')
        const candidate = proposeRawLivePatch(currentRaw, json)
        rawCandidate = candidate
        candidateDiff.textContent = [
          candidate.summary,
          ...candidate.changes,
          '確認後若遊戲執行中將重載並重置進度。',
        ].join('\n')
        candidateDiff.hidden = false
        acceptCandidate.hidden = false
        discardCandidate.hidden = false
        status.textContent = 'AI 修改已通過檢查，請檢視差異並確認。'
        return candidate
      },
      status: () =>
        rawCandidate
          ? {
              state:
                rawCandidate.baseRevision === rawSb3Revision(currentRaw) ? 'pending-user-review' : 'revision-changed',
              candidateId: rawCandidate.candidateId,
              baseRevision: rawCandidate.baseRevision,
            }
          : { state: 'no-candidate', revision: rawSb3Revision(currentRaw) },
      report: (message) => {
        status.textContent = message
      },
    }
    discardCandidate.addEventListener('click', () => {
      rawCandidate = null
      candidateDiff.hidden = true
      acceptCandidate.hidden = true
      discardCandidate.hidden = true
      status.textContent = '已捨棄 AI 修改。'
    })
    acceptCandidate.addEventListener('click', () => {
      void (async () => {
        if (!rawCandidate) return
        setBusy(true)
        try {
          const candidate = proposeRawLivePatch(currentRaw, rawCandidate.patchJson)
          const previous = currentRaw
          await install(candidate.project, null, candidate.requiresVmValidation)
          undoStack.push({ project: previous, runtime: null, animation: activeStudentAnimation })
          if (undoStack.length > 20) undoStack.shift()
          redoStack.length = 0
          rawCandidate = null
          candidateDiff.hidden = true
          acceptCandidate.hidden = true
          discardCandidate.hidden = true
          status.textContent = `已套用 AI 修改「${candidate.summary}」。`
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error)
        } finally {
          setBusy(false)
        }
      })()
    })
    targetSelect.addEventListener('change', refresh)
    propertySelect.addEventListener('change', refresh)
    apply.addEventListener('click', () => {
      void (async () => {
        setBusy(true)
        try {
          const target = getTargets().find((item) => item.name === targetSelect.value)
          const selection = propertySelect.value
          const fieldLabel = propertySelect.selectedOptions.item(0)?.textContent ?? selection
          const variableId = selection.startsWith('variable:') ? selection.slice(9) : null
          const variable = variableId !== null ? getVariables(target)[variableId] : undefined
          const expected: unknown = Array.isArray(variable) ? variable[1] : target?.[selection]
          if (typeof expected !== 'number' && typeof expected !== 'boolean' && typeof expected !== 'string')
            throw new Error('找不到可修改的屬性或變數。')
          const text = valueInput.value
          if (typeof expected !== 'string' && !text.trim()) throw new Error('請輸入新值。')
          const value =
            typeof expected === 'string'
              ? text
              : typeof expected === 'boolean'
                ? text.trim() === 'true'
                  ? true
                  : text.trim() === 'false'
                    ? false
                    : text
                : Number(text)
          if (typeof expected === 'boolean' && typeof value !== 'boolean')
            throw new Error('布林值請填 true 或 false。')
          const revision = rawSb3Revision(currentRaw)
          const next =
            variableId !== null
              ? patchRawSb3Variables(currentRaw, revision, [
                  { targetName: targetSelect.value, variableId, expected, value },
                ])
              : typeof expected !== 'string' && typeof value !== 'string'
                ? patchRawSb3Properties(currentRaw, revision, [
                    {
                      targetName: targetSelect.value,
                      property: selection as RawPropertyChange['property'],
                      expected,
                      value,
                    },
                  ])
                : (() => {
                    throw new Error('屬性值無效。')
                  })()
          let runtime: ScratchRuntimePatchUpdate | null = null
          if (variableId !== null && Array.isArray(variable) && typeof variable[0] === 'string') {
            const sameName = Object.values(getVariables(target)).filter(
              (entry) => Array.isArray(entry) && entry[0] === variable[0],
            )
            if (sameName.length === 1)
              runtime = { op: 'set-variable', targetName: targetSelect.value, variableName: variable[0], value }
          } else if (target?.isStage === true && typeof value === 'number') {
            if (selection === 'tempo' && value >= 20 && value <= 500)
              runtime = { op: 'set-stage-property', property: 'tempo', value }
            else if (selection === 'volume') runtime = { op: 'set-stage-property', property: 'volume', value }
            else if (selection === 'currentCostume')
              runtime = { op: 'set-stage-property', property: 'backdropIndex', value }
          } else if (target?.isStage === false && typeof value !== 'string') {
            const limits: Partial<Record<string, readonly [number, number]>> = {
              x: [-240, 240],
              y: [-180, 180],
              direction: [-180, 180],
              size: [1, 500],
            }
            const range = limits[selection]
            if (
              (selection === 'visible' && typeof value === 'boolean') ||
              selection === 'currentCostume' ||
              (typeof value === 'number' && range && value >= range[0] && value <= range[1])
            )
              runtime = {
                op: 'set-target-property',
                targetName: targetSelect.value,
                property: selection as Extract<ScratchRuntimePatchUpdate, { op: 'set-target-property' }>['property'],
                value,
              }
          }
          const previous = currentRaw
          const inverse = await install(next, runtime)
          undoStack.push({ project: previous, runtime: inverse, animation: activeStudentAnimation })
          if (undoStack.length > 20) undoStack.shift()
          redoStack.length = 0
          status.textContent = `已套用 ${targetSelect.value}／${fieldLabel}：${String(expected)} → ${String(value)}。`
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error)
        } finally {
          setBusy(false)
        }
      })()
    })
    const moveHistory = (from: RawHistoryEntry[], to: RawHistoryEntry[], message: string): void => {
      void (async () => {
        const next = from.at(-1)
        if (!next) return
        setBusy(true)
        try {
          const previous = currentRaw
          const inverse = await install(next.project, next.animation === activeStudentAnimation ? next.runtime : null)
          from.pop()
          to.push({ project: previous, runtime: inverse, animation: activeStudentAnimation })
          status.textContent = message
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error)
        } finally {
          setBusy(false)
        }
      })()
    }
    undo.addEventListener('click', () => moveHistory(undoStack, redoStack, '已復原修改。'))
    redo.addEventListener('click', () => moveHistory(redoStack, undoStack, '已重做修改。'))
    save.addEventListener('click', () => {
      setBusy(true)
      void exportLosslessSb3(currentRaw)
        .then((archive) => download(archive, 'scratch-preserved-edit.sb3'))
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : String(error)
        })
        .finally(() => setBusy(false))
    })
    refresh()
    localAiSettings.hidden = false
    localAiGenerateButton.disabled = false
    mcpSettings.hidden = false
    panel.append(
      title,
      help,
      localAiSettings,
      mcpSettings,
      targetLabel,
      propertyLabel,
      valueLabel,
      candidateDiff,
      actions,
      status,
    )
    previewColumn.append(panel)
  }
  applyPatchButton.addEventListener('click', () => {
    void (async () => {
      try {
        if (!preparedLivePatch) inspectLivePatch()
        const patch = preparedLivePatch
        if (!patch) throw new Error('請先檢查修改內容。')
        livePatchBusy = true
        setLivePatchReady(true)
        const projectBefore = liveProject
        const nextProject = applyLiveVariablePatchToProject(liveProject, patch.operations)
        const structuralPatch = patch.operations.some((operation) => operation.op.includes('-target-script'))
        if (structuralPatch) {
          const validation = validateCanonicalProject(nextProject)
          if (!validation.valid) throw new Error(formatValidationErrors(validation.errors))
          inspectSemantics(validation.data)
          const nextArchive = await compileProjectToBlob(validation.data)
          const previousArchive = patchedPreviewArchive ?? (await compileProjectToBlob(projectBefore))
          try {
            await reloadPreviewArchive(nextArchive, liveRevision + 1)
          } catch (reloadError) {
            try {
              await reloadPreviewArchive(previousArchive, liveRevision + 1)
            } catch (rollbackError) {
              patchedPreviewArchive = previousArchive
              throw new Error(
                `結構修改重載失敗，舊作品回復載入也失敗；可按「執行作品」重試。修改錯誤：${reloadError instanceof Error ? reloadError.message : String(reloadError)}；回復錯誤：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              )
            }
            throw new Error(
              `結構修改重載失敗，已重新載入舊作品（進度已重置）：${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
            )
          }
          liveProject = validation.data
          patchedPreviewArchive = nextArchive
          editor.value = JSON.stringify(liveProject, null, 2)
          liveUndoStack.push({
            projectBefore,
            projectAfter: nextProject,
            runtimeUndo: null,
            runtimeRedo: null,
            requiresReload: true,
            summary: patch.summary,
          })
          liveRedoStack.length = 0
          if (liveUndoStack.length > 20) liveUndoStack.shift()
          preparedLivePatch = null
          livePatchDiff.hidden = true
          livePatchStatus.dataset.kind = 'ok'
          livePatchStatus.textContent = `已套用「${patch.summary}」。作品已安全重載；遊戲進度已重置，可復原。`
          return
        }
        const nextArchive = await compileProjectToBlob(nextProject)
        const response = await requestRuntimePatch(
          patch.operations.map((operation): ScratchRuntimePatchUpdate => {
            if (operation.op === 'set-variable')
              return {
                op: 'set-variable',
                targetName: operation.target,
                variableName: operation.name,
                value: operation.value,
              }
            if (operation.op === 'set-target-property')
              return {
                op: 'set-target-property',
                targetName: operation.target,
                property: operation.property,
                value: operation.value,
              }
            if (operation.op === 'set-stage-property')
              return { op: 'set-stage-property', property: operation.property, value: operation.value }
            throw new Error('Structure patch cannot be applied as a runtime operation.')
          }),
          liveRevision,
        )
        if (
          response.ok !== true ||
          !Array.isArray(response.changes) ||
          response.changes.length !== patch.operations.length
        )
          throw new Error(typeof response.error === 'string' ? response.error : '預覽 VM 未套用完整修改。')
        const runtimeChanges = response.changes as ScratchRuntimePatchChange[]
        const runtimeUndo = runtimeChanges.map((change): ScratchRuntimePatchUpdate => {
          if (change.op === 'set-variable')
            return {
              op: 'set-variable',
              targetName: change.targetName,
              variableName: change.variableName,
              value: change.beforeValue,
            }
          if (change.op === 'set-target-property')
            return {
              op: 'set-target-property',
              targetName: change.targetName,
              property: change.property,
              value: change.beforeValue,
            }
          return { op: 'set-stage-property', property: change.property, value: change.beforeValue as number }
        })
        const runtimeRedo = runtimeChanges.map((change): ScratchRuntimePatchUpdate => {
          if (change.op === 'set-variable')
            return {
              op: 'set-variable',
              targetName: change.targetName,
              variableName: change.variableName,
              value: change.value,
            }
          if (change.op === 'set-target-property')
            return {
              op: 'set-target-property',
              targetName: change.targetName,
              property: change.property,
              value: change.value,
            }
          return { op: 'set-stage-property', property: change.property, value: change.value as number }
        })
        liveUndoStack.push({
          projectBefore,
          projectAfter: nextProject,
          runtimeUndo,
          runtimeRedo,
          requiresReload: false,
          summary: patch.summary,
        })
        liveRedoStack.length = 0
        if (liveUndoStack.length > 20) liveUndoStack.shift()
        liveProject = nextProject
        patchedPreviewArchive = nextArchive
        liveRevision += 1
        editor.value = JSON.stringify(liveProject, null, 2)
        preparedLivePatch = null
        livePatchDiff.hidden = true
        livePatchStatus.dataset.kind = 'ok'
        livePatchStatus.textContent = `已即時套用「${patch.summary}」。作品欄已同步，可繼續遊玩或復原。`
      } catch (error) {
        preparedLivePatch = null
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        livePatchBusy = false
        setLivePatchReady(Boolean(activeStudentAnimation))
      }
    })()
  })
  undoPatchButton.addEventListener('click', () => {
    void (async () => {
      const last = liveUndoStack.at(-1)
      if (!last) return
      try {
        livePatchBusy = true
        setLivePatchReady(true)
        const previousArchive = await compileProjectToBlob(last.projectBefore)
        if (last.requiresReload) {
          const currentProject = liveProject
          const currentArchive = patchedPreviewArchive ?? (await compileProjectToBlob(currentProject))
          const previousArchive = await compileProjectToBlob(last.projectBefore)
          liveProject = last.projectBefore
          editor.value = JSON.stringify(liveProject, null, 2)
          try {
            await reloadPreviewArchive(previousArchive, liveRevision + 1)
          } catch (reloadError) {
            liveProject = currentProject
            editor.value = JSON.stringify(liveProject, null, 2)
            try {
              await reloadPreviewArchive(currentArchive, liveRevision + 1)
            } catch (rollbackError) {
              throw new Error(
                `復原重載失敗，且目前作品重新載入也失敗；請重新執行預覽。原因：${reloadError instanceof Error ? reloadError.message : String(reloadError)}；回復錯誤：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              )
            }
            throw reloadError
          }
          liveUndoStack.pop()
          liveRedoStack.push(last)
          if (liveRedoStack.length > 20) liveRedoStack.shift()
          patchedPreviewArchive = previousArchive
          preparedLivePatch = null
          livePatchDiff.hidden = true
          livePatchStatus.dataset.kind = 'ok'
          livePatchStatus.textContent = `已復原「${last.summary}」。遊戲已重載，進度已重置；revision ${liveRevision}。`
          return
        }
        const response = await requestRuntimePatch(last.runtimeUndo ?? [], liveRevision)
        if (response.ok !== true)
          throw new Error(typeof response.error === 'string' ? response.error : '無法復原修改。')
        liveUndoStack.pop()
        liveRedoStack.push(last)
        if (liveRedoStack.length > 20) liveRedoStack.shift()
        liveProject = last.projectBefore
        patchedPreviewArchive = previousArchive
        liveRevision += 1
        editor.value = JSON.stringify(liveProject, null, 2)
        preparedLivePatch = null
        livePatchDiff.hidden = true
        livePatchStatus.dataset.kind = 'ok'
        livePatchStatus.textContent = `已復原「${last.summary}」。revision ${liveRevision}。`
      } catch (error) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        livePatchBusy = false
        setLivePatchReady(Boolean(activeStudentAnimation))
      }
    })()
  })
  redoPatchButton.addEventListener('click', () => {
    void (async () => {
      const last = liveRedoStack.at(-1)
      if (!last) return
      try {
        livePatchBusy = true
        setLivePatchReady(true)
        if (last.requiresReload) {
          const currentProject = liveProject
          const currentArchive = patchedPreviewArchive ?? (await compileProjectToBlob(currentProject))
          const redoArchive = await compileProjectToBlob(last.projectAfter)
          liveProject = last.projectAfter
          editor.value = JSON.stringify(liveProject, null, 2)
          try {
            await reloadPreviewArchive(redoArchive, liveRevision + 1)
          } catch (reloadError) {
            liveProject = currentProject
            editor.value = JSON.stringify(liveProject, null, 2)
            await reloadPreviewArchive(currentArchive, liveRevision + 1)
            throw reloadError
          }
          patchedPreviewArchive = redoArchive
        } else {
          const updates = last.runtimeRedo
          if (!updates) throw new Error('找不到可重做的 runtime patch 資料。')
          const response = await requestRuntimePatch(updates, liveRevision)
          if (response.ok !== true)
            throw new Error(typeof response.error === 'string' ? response.error : '無法重做修改。')
          liveProject = last.projectAfter
          patchedPreviewArchive = await compileProjectToBlob(liveProject)
          liveRevision += 1
          editor.value = JSON.stringify(liveProject, null, 2)
        }
        liveRedoStack.pop()
        liveUndoStack.push(last)
        if (liveUndoStack.length > 20) liveUndoStack.shift()
        preparedLivePatch = null
        livePatchDiff.hidden = true
        livePatchStatus.dataset.kind = 'ok'
        livePatchStatus.textContent = last.requiresReload
          ? `已重做「${last.summary}」。作品已重載，遊戲進度已重置；revision ${liveRevision}。`
          : `已重做「${last.summary}」。可繼續遊玩或再次復原。`
      } catch (error) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        livePatchBusy = false
        setLivePatchReady(Boolean(activeStudentAnimation))
      }
    })()
  })
  livePatchInput.addEventListener('input', () => {
    preparedLivePatch = null
    livePatchDiff.hidden = true
    if (mcpCandidate && livePatchInput.value !== mcpCandidate.patchJson) mcpCandidate = null
  })
  livePatchPanel.append(
    livePatchSummary,
    livePatchHelp,
    ...(rawSource ? [] : [localAiSettings, mcpSettings]),
    livePatchPromptButton,
    livePatchInputLabel,
    livePatchInput,
    livePatchDiff,
    livePatchActions,
    livePatchStatus,
  )
  previewColumn.append(livePatchPanel)

  const progressPanel = document.createElement('details')
  progressPanel.className = 'student-live-patch'
  const progressTitle = document.createElement('summary')
  progressTitle.textContent = '本機遊戲進度'
  const progressHelp = document.createElement('p')
  progressHelp.textContent =
    '存檔包含原始角色的位置、方向、大小、造型、顯示狀態，以及非雲端變數與清單，保存在這個瀏覽器。分身、積木執行位置及雲端資料不包含；請在遊戲開始後讀檔，遊戲腳本仍可能改寫讀入的值。作品變更後，可匯入舊存檔並確認相容性。'
  const progressLabel = document.createElement('label')
  progressLabel.textContent = '存檔名稱'
  const progressSlot = document.createElement('input')
  progressSlot.type = 'text'
  progressSlot.maxLength = 40
  progressSlot.value = '我的進度'
  progressLabel.append(progressSlot)
  const progressPasswordLabel = document.createElement('label')
  progressPasswordLabel.textContent = '匯出／匯入密碼（選填，至少 12 個字元；留空時匯出明文）'
  const progressPassword = document.createElement('input')
  progressPassword.type = 'password'
  progressPassword.autocomplete = 'off'
  progressPassword.maxLength = 256
  progressPasswordLabel.append(progressPassword)
  const progressActions = document.createElement('div')
  progressActions.className = 'button-row'
  const progressButton = (name: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button secondary'
    button.textContent = name
    progressActions.append(button)
    return button
  }
  const progressSave = progressButton('儲存進度')
  const progressLoad = progressButton('讀取進度')
  const progressDelete = progressButton('刪除存檔')
  const progressExport = progressButton('匯出存檔')
  const progressImport = progressButton('匯入存檔')
  const progressFile = document.createElement('input')
  progressFile.type = 'file'
  progressFile.accept = 'application/json,.json'
  progressFile.hidden = true
  const progressStatus = document.createElement('p')
  progressStatus.setAttribute('role', 'status')
  const syncPanel = document.createElement('details')
  syncPanel.className = 'live-ai-settings'
  const syncTitle = document.createElement('summary')
  syncTitle.textContent = '自架跨裝置同步'
  const syncHelp = document.createElement('p')
  syncHelp.textContent =
    '先啟動自己的同步伺服器；另一台電腦以 SSH tunnel 連線。同步只傳送加密存檔，請在上方輸入至少 12 字元的加密密碼。Token 與密碼僅留在目前頁面。自動同步會在儲存時上傳、讀取時檢查遠端；雙方都變更時會保留資料並提示處理。'
  const syncUrlLabel = document.createElement('label')
  syncUrlLabel.htmlFor = 'progress-sync-url'
  syncUrlLabel.textContent = '本機同步伺服器網址'
  const syncUrl = document.createElement('input')
  syncUrl.id = 'progress-sync-url'
  syncUrl.type = 'url'
  syncUrl.value = 'http://127.0.0.1:43131'
  const syncTokenLabel = document.createElement('label')
  syncTokenLabel.htmlFor = 'progress-sync-token'
  syncTokenLabel.textContent = '同步伺服器 token'
  const syncToken = document.createElement('input')
  syncToken.id = 'progress-sync-token'
  syncToken.type = 'password'
  syncToken.autocomplete = 'off'
  syncToken.maxLength = 64
  const syncAutoLabel = document.createElement('label')
  const syncAuto = document.createElement('input')
  syncAuto.type = 'checkbox'
  syncAutoLabel.append(syncAuto, document.createTextNode('啟用自動同步（僅在沒有衝突時）'))
  const syncActions = document.createElement('div')
  syncActions.className = 'button-row'
  const makeSyncButton = (name: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button secondary'
    button.textContent = name
    syncActions.append(button)
    return button
  }
  const syncUpload = makeSyncButton('上傳加密存檔')
  const syncDownload = makeSyncButton('下載同步存檔')
  const syncDelete = makeSyncButton('刪除遠端存檔')
  const syncStatus = document.createElement('p')
  syncStatus.setAttribute('role', 'status')
  const cloudHelp = document.createElement('p')
  cloudHelp.textContent =
    '自架雲端變數讓相同版本作品、使用相同 token 和密碼的玩家共享數值，與個人存檔分開。連線後才接收初始值，遊戲需處理較晚抵達的更新；同時寫入可能衝突，不能保證多人加總是原子操作。未勾選寫入時只讀取；停止時已在傳送中的最後一筆可能仍完成。'
  const cloudWriteLabel = document.createElement('label')
  const cloudWrite = document.createElement('input')
  cloudWrite.type = 'checkbox'
  cloudWriteLabel.append(cloudWrite, document.createTextNode('允許此遊戲寫入自架雲端變數'))
  const cloudActions = document.createElement('div')
  cloudActions.className = 'button-row'
  const cloudConnect = document.createElement('button')
  cloudConnect.type = 'button'
  cloudConnect.className = 'button secondary'
  cloudConnect.textContent = '連接自架雲端變數'
  const cloudDisconnect = document.createElement('button')
  cloudDisconnect.type = 'button'
  cloudDisconnect.className = 'button secondary'
  cloudDisconnect.textContent = '中斷自架雲端變數'
  cloudDisconnect.hidden = true
  cloudActions.append(cloudConnect, cloudDisconnect)
  const cloudStatus = document.createElement('p')
  cloudStatus.setAttribute('role', 'status')
  cloudStatus.textContent = '自架雲端變數未連線。'
  const syncBaselines = new Map<string, { etag: string | null; localFingerprint: string | null }>()
  const resetSync = (): void => {
    stopSelfHostedCloud('同步設定已變更，自架雲端變數已中斷。')
    syncBaselines.clear()
    if (syncAuto.checked) {
      syncAuto.checked = false
      syncStatus.textContent = '同步設定已變更，請重新啟用自動同步。'
    }
  }
  syncUrl.addEventListener('input', resetSync)
  syncToken.addEventListener('input', resetSync)
  progressPassword.addEventListener('input', resetSync)
  syncPanel.append(
    syncTitle,
    syncHelp,
    syncUrlLabel,
    syncUrl,
    syncTokenLabel,
    syncToken,
    syncAutoLabel,
    syncActions,
    syncStatus,
    cloudHelp,
    cloudWriteLabel,
    cloudActions,
    cloudStatus,
  )
  const progressRevision = (): string =>
    currentRawForProgress
      ? rawSb3Revision(currentRawForProgress)
      : `sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(liveProject))))}`
  const setProgressBusy = (busy: boolean): void => {
    for (const element of [
      progressSlot,
      progressPassword,
      progressSave,
      progressLoad,
      progressDelete,
      progressExport,
      progressImport,
      syncUrl,
      syncToken,
      syncAuto,
      syncUpload,
      syncDownload,
      syncDelete,
    ])
      element.disabled = busy
  }
  const syncConnection = (): SyncConnection => ({ baseUrl: syncUrl.value.trim(), token: syncToken.value.trim() })
  interface SelfHostedCloudState {
    readonly animation: ActiveStudentAnimation
    readonly projectId: string
    readonly revision: number
    readonly connection: SyncConnection
    readonly controller: AbortController
    readonly names: readonly string[]
    readonly password: string
    readonly canWrite: boolean
    readonly expiresAt: number
    readonly seen: Map<string, string>
    readonly cloudValues: Map<string, string | number>
    readonly generations: Map<string, number>
    readonly pending: Map<string, string | number>
    activeName: string | null
    writing: boolean
    offset: number
    pollTimer: number | null
    expiryTimer: number | null
  }
  let cloudState: SelfHostedCloudState | null = null
  let cloudStarting: {
    animation: ActiveStudentAnimation
    controller: AbortController
    projectId: string
    revision: number
    canWrite: boolean
    pending: Map<string, string | number>
  } | null = null
  const cloudIsCurrent = (state: SelfHostedCloudState): boolean =>
    cloudState === state &&
    !state.controller.signal.aborted &&
    activeStudentAnimation === state.animation &&
    liveRevision === state.revision &&
    Date.now() < state.expiresAt
  stopSelfHostedCloud = (reason) => {
    const current = cloudState
    const starting = cloudStarting
    if (!current && !starting) return
    cloudState = null
    cloudStarting = null
    current?.controller.abort()
    starting?.controller.abort()
    if (current?.pollTimer !== null && current?.pollTimer !== undefined) window.clearTimeout(current.pollTimer)
    if (current?.expiryTimer !== null && current?.expiryTimer !== undefined) window.clearTimeout(current.expiryTimer)
    current?.pending.clear()
    starting?.pending.clear()
    const animation = current?.animation ?? starting?.animation
    animation?.frame.contentWindow?.postMessage({ type: 'disconnect-selfhosted-cloud', token: animation.token }, '*')
    cloudConnect.disabled = false
    cloudDisconnect.hidden = true
    cloudWrite.disabled = false
    cloudStatus.textContent = reason
  }
  const cloudWriteLoop = async (state: SelfHostedCloudState): Promise<void> => {
    if (state.writing) return
    state.writing = true
    try {
      while (cloudIsCurrent(state) && state.pending.size > 0) {
        const next = state.pending.entries().next().value as [string, string | number] | undefined
        if (!next) break
        const [name, value] = next
        state.pending.delete(name)
        state.activeName = name
        try {
          const key = selfHostedCloudKey(state.projectId, name)
          const previous = await getSyncedSave(state.connection, key)
          if (previous)
            parseSelfHostedCloudValue(
              await decryptProgressSave(previous.document, state.password),
              state.projectId,
              name,
            )
          const document = await encryptCloudValue(
            {
              format: 'scratch-ai-bridge/self-hosted-cloud-value',
              version: 1,
              projectRevision: state.projectId,
              name,
              value,
            },
            state.password,
          )
          if (!cloudIsCurrent(state)) break
          const etag = await putSyncedSave(state.connection, key, document, previous?.etag ?? null)
          if (!cloudIsCurrent(state)) break
          state.seen.set(name, etag)
          state.cloudValues.set(name, value)
          cloudStatus.textContent = `自架雲端變數已連線；已送出「${name}」。`
        } catch (error) {
          if (cloudIsCurrent(state)) {
            const message = error instanceof Error ? error.message : String(error)
            cloudStatus.textContent = message.includes('遠端存檔已變更')
              ? '雲端變數同時被其他玩家修改；本次寫入未覆蓋，稍後將讀取遠端值。'
              : `雲端變數未送出：${message}`
          }
        } finally {
          state.activeName = null
        }
        if (cloudIsCurrent(state)) await new Promise((resolve) => window.setTimeout(resolve, 250))
      }
    } finally {
      state.writing = false
    }
  }
  const pollCloud = async (state: SelfHostedCloudState): Promise<void> => {
    if (!cloudIsCurrent(state)) {
      if (cloudState === state) stopSelfHostedCloud('作品或預覽已變更，請重新連線。')
      return
    }
    try {
      const count = Math.min(10, state.names.length)
      for (let index = 0; index < count; index += 1) {
        const name = state.names[state.offset % state.names.length]
        state.offset += 1
        if (state.activeName === name || state.pending.has(name)) continue
        const generation = state.generations.get(name) ?? 0
        const remote = await getSyncedSave(state.connection, selfHostedCloudKey(state.projectId, name))
        if (!cloudIsCurrent(state)) return
        if (state.activeName === name || state.pending.has(name) || (state.generations.get(name) ?? 0) !== generation)
          continue
        if (!remote) continue
        if (state.seen.get(name) === remote.etag) {
          if (!state.canWrite && state.cloudValues.has(name))
            state.animation.frame.contentWindow?.postMessage(
              {
                type: 'selfhosted-cloud-incoming',
                token: state.animation.token,
                baseRevision: state.revision,
                projectId: state.projectId,
                name,
                value: state.cloudValues.get(name),
              },
              '*',
            )
          continue
        }
        const value = parseSelfHostedCloudValue(
          await decryptProgressSave(remote.document, state.password),
          state.projectId,
          name,
        )
        if (!cloudIsCurrent(state)) return
        if (state.activeName === name || state.pending.has(name) || (state.generations.get(name) ?? 0) !== generation)
          continue
        state.animation.frame.contentWindow?.postMessage(
          {
            type: 'selfhosted-cloud-incoming',
            token: state.animation.token,
            baseRevision: state.revision,
            projectId: state.projectId,
            name,
            value,
          },
          '*',
        )
        state.seen.set(name, remote.etag)
        state.cloudValues.set(name, value)
        cloudStatus.textContent = `自架雲端變數已連線；已更新「${name}」。`
      }
    } catch (error) {
      if (cloudIsCurrent(state))
        cloudStatus.textContent = `雲端變數讀取失敗：${error instanceof Error ? error.message : String(error)}`
    }
    if (cloudIsCurrent(state))
      state.pollTimer = window.setTimeout(() => {
        void pollCloud(state)
      }, 2000)
  }
  handleSelfHostedCloudMessage = (message) => {
    if (message.type === 'selfhosted-cloud-status') {
      if (message.stopped === true)
        stopSelfHostedCloud(typeof message.reason === 'string' ? message.reason : '雲端連線已停止。')
      else if (cloudState && typeof message.reason === 'string') cloudStatus.textContent = message.reason
      return
    }
    const state = cloudState
    const starting = cloudStarting
    if (
      !state &&
      starting &&
      !starting.controller.signal.aborted &&
      starting.canWrite &&
      activeStudentAnimation === starting.animation &&
      message.projectId === starting.projectId &&
      message.baseRevision === starting.revision &&
      typeof message.name === 'string' &&
      message.name.length <= 256 &&
      validSelfHostedCloudValue(message.value)
    ) {
      if (starting.pending.size < 100 || starting.pending.has(message.name))
        starting.pending.set(message.name, message.value)
      return
    }
    if (
      !state ||
      !cloudIsCurrent(state) ||
      !state.canWrite ||
      message.projectId !== state.projectId ||
      message.baseRevision !== state.revision ||
      typeof message.name !== 'string' ||
      !state.names.includes(message.name) ||
      !validSelfHostedCloudValue(message.value)
    )
      return
    state.generations.set(message.name, (state.generations.get(message.name) ?? 0) + 1)
    state.pending.set(message.name, message.value)
    void cloudWriteLoop(state)
  }
  cloudConnect.addEventListener('click', () => {
    void (async () => {
      if (cloudState || cloudStarting) return
      const animation = activeStudentAnimation
      if (!animation) {
        cloudStatus.textContent = '請先執行作品，再連接雲端變數。'
        return
      }
      if (progressPassword.value.length < 12) {
        cloudStatus.textContent = '請先輸入至少 12 個字元的加密密碼。'
        return
      }
      const controller = new AbortController()
      const projectId = progressRevision()
      const revision = liveRevision
      const canWrite = cloudWrite.checked
      cloudStarting = { animation, controller, projectId, revision, canWrite, pending: new Map() }
      cloudConnect.disabled = true
      cloudDisconnect.hidden = false
      cloudWrite.disabled = true
      cloudStatus.textContent = '正在檢查自架雲端變數與連線…'
      try {
        const password = progressPassword.value
        const connection: SyncConnection = { ...syncConnection(), signal: controller.signal }
        const response = await animation.requestSelfHostedCloud(revision, projectId, canWrite)
        if (
          response.ok !== true ||
          !Array.isArray(response.names) ||
          !response.names.every((name: unknown) => typeof name === 'string') ||
          typeof response.expiresAt !== 'number' ||
          !Number.isFinite(response.expiresAt) ||
          response.expiresAt <= Date.now()
        )
          throw new Error(typeof response.error === 'string' ? response.error : '無法連接雲端變數。')
        const names = response.names as string[]
        const initial: { name: string; etag: string; value: string | number }[] = []
        for (const name of names) {
          const remote = await getSyncedSave(connection, selfHostedCloudKey(projectId, name))
          if (remote)
            initial.push({
              name,
              etag: remote.etag,
              value: parseSelfHostedCloudValue(await decryptProgressSave(remote.document, password), projectId, name),
            })
        }
        if (
          controller.signal.aborted ||
          cloudStarting?.controller !== controller ||
          activeStudentAnimation !== animation ||
          liveRevision !== revision ||
          progressRevision() !== projectId ||
          Date.now() >= response.expiresAt
        )
          throw new Error('作品、預覽或授權已變更。')
        const pending = new Map([...cloudStarting.pending].filter(([name]) => names.includes(name)))
        const state: SelfHostedCloudState = {
          animation,
          projectId,
          revision,
          connection,
          controller,
          names,
          password,
          canWrite,
          expiresAt: response.expiresAt,
          seen: new Map(),
          cloudValues: new Map(),
          generations: new Map(),
          pending,
          activeName: null,
          writing: false,
          offset: 0,
          pollTimer: null,
          expiryTimer: null,
        }
        cloudState = state
        cloudStarting = null
        for (const item of initial) {
          if (state.pending.has(item.name)) continue
          animation.frame.contentWindow?.postMessage(
            {
              type: 'selfhosted-cloud-incoming',
              token: animation.token,
              baseRevision: revision,
              projectId,
              name: item.name,
              value: item.value,
            },
            '*',
          )
          state.seen.set(item.name, item.etag)
          state.cloudValues.set(item.name, item.value)
        }
        state.expiryTimer = window.setTimeout(
          () => {
            if (cloudState === state) stopSelfHostedCloud('連線已到 30 分鐘上限，請重新連線。')
          },
          Math.max(0, state.expiresAt - Date.now()),
        )
        cloudStatus.textContent = `自架雲端變數已連線（${names.length} 個，${canWrite ? '可讀寫' : '唯讀'}）。`
        if (state.pending.size) void cloudWriteLoop(state)
        void pollCloud(state)
      } catch (error) {
        if (cloudStarting?.controller === controller)
          stopSelfHostedCloud(error instanceof Error ? error.message : String(error))
      }
    })()
  })
  cloudDisconnect.addEventListener('click', () => stopSelfHostedCloud('自架雲端變數已中斷。'))
  const progressFingerprint = (value: unknown): string | null =>
    value === undefined ? null : bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))))
  const pushProgress = async (revision: string, slot: string, automatic: boolean): Promise<void> => {
    syncStatus.textContent = '正在上傳加密存檔…'
    const connection = syncConnection()
    const key = syncSaveKey(revision, slot)
    const local = await accessProgressSave(revision, slot, 'get')
    const save = parseProgressSave(local, revision, slot)
    const remote = await getSyncedSave(connection, key)
    const remoteVersion = remote?.etag ?? null
    const baseline = syncBaselines.get(key)
    if (
      automatic &&
      ((baseline === undefined && remoteVersion !== null) ||
        (baseline !== undefined && baseline.etag !== remoteVersion))
    )
      throw new Error('遠端存檔與同步基準不同；請手動下載或上傳並確認。')
    const remoteSave = remote
      ? parseProgressSave(await decryptProgressSave(remote.document, progressPassword.value), revision, slot)
      : null
    if (!automatic && baseline?.etag !== remoteVersion && (remoteVersion !== null || baseline !== undefined)) {
      if (
        !window.confirm(
          `遠端存檔可能與本機不同。\n本機時間：${save.savedAt}\n遠端時間：${remoteSave?.savedAt ?? '遠端已刪除'}\n確定以上方本機存檔覆蓋遠端？`,
        )
      )
        throw new Error('已取消上傳。')
    }
    const document = await encryptProgressSave(save, progressPassword.value)
    const latest = await accessProgressSave(revision, slot, 'get')
    if (progressRevision() !== revision || JSON.stringify(latest) !== JSON.stringify(local))
      throw new Error('本機作品或存檔已變更，請重新同步。')
    const etag = await putSyncedSave(connection, key, document, remoteVersion)
    syncBaselines.set(key, { etag, localFingerprint: progressFingerprint(local) })
    syncStatus.textContent = '已上傳加密存檔。'
  }
  const runSync = (operation: 'upload' | 'download' | 'delete'): void => {
    void (async () => {
      setProgressBusy(true)
      syncStatus.textContent = '正在處理同步…'
      try {
        const revision = progressRevision()
        const slot = progressSlot.value.trim()
        const connection = syncConnection()
        const key = syncSaveKey(revision, slot)
        if (operation === 'upload') {
          await pushProgress(revision, slot, false)
          return
        }
        const remote = await getSyncedSave(connection, key)
        if (!remote) throw new Error('遠端沒有這個作品版本的存檔。')
        if (operation === 'delete') {
          if (!window.confirm(`確定刪除遠端「${slot}」存檔？`)) return
          await deleteSyncedSave(connection, key, remote.etag)
          syncBaselines.set(key, {
            etag: null,
            localFingerprint: progressFingerprint(await accessProgressSave(revision, slot, 'get')),
          })
          syncAuto.checked = false
          syncStatus.textContent = '已刪除遠端存檔。'
          return
        }
        const decrypted = await decryptProgressSave(remote.document, progressPassword.value)
        const save = parseProgressSave(decrypted, revision, slot)
        const local = await accessProgressSave(revision, slot, 'get')
        if (local && !window.confirm(`本機「${slot}」已有存檔，確定以遠端版本覆蓋？`)) return
        if (progressRevision() !== revision) throw new Error('作品已變更，請重新下載。')
        await accessProgressSave(revision, slot, 'put', save, local)
        syncBaselines.set(key, { etag: remote.etag, localFingerprint: progressFingerprint(save) })
        syncStatus.textContent = '已下載並解密存檔；執行作品後可讀取。'
      } catch (error) {
        syncStatus.textContent =
          error instanceof TypeError
            ? '同步連線失敗；請確認本機服務、SSH tunnel 與瀏覽器本機網路權限。'
            : error instanceof Error
              ? error.message
              : String(error)
      } finally {
        setProgressBusy(false)
      }
    })()
  }
  syncUpload.addEventListener('click', () => runSync('upload'))
  syncDownload.addEventListener('click', () => runSync('download'))
  syncDelete.addEventListener('click', () => runSync('delete'))
  const pullIfUnchanged = async (revision: string, slot: string, local: unknown): Promise<unknown> => {
    const key = syncSaveKey(revision, slot)
    const baseline = syncBaselines.get(key)
    if (!baseline) throw new Error('請先重新啟用自動同步，建立目前存檔的基準。')
    const remote = await getSyncedSave(syncConnection(), key)
    const version = remote?.etag ?? null
    if (version === baseline.etag) return local
    if (!remote || progressFingerprint(local) !== baseline.localFingerprint)
      throw new Error('本機與遠端都有變更，或遠端存檔已刪除；請手動處理。')
    const save = parseProgressSave(await decryptProgressSave(remote.document, progressPassword.value), revision, slot)
    if (progressRevision() !== revision) throw new Error('作品已變更，請重新同步。')
    await accessProgressSave(revision, slot, 'put', save, local)
    syncBaselines.set(key, { etag: remote.etag, localFingerprint: progressFingerprint(save) })
    syncStatus.textContent = '已自動下載遠端加密存檔。'
    return save
  }
  syncAuto.addEventListener('change', () => {
    if (!syncAuto.checked) return
    void (async () => {
      setProgressBusy(true)
      syncStatus.textContent = '正在建立同步基準…'
      try {
        if (progressPassword.value.length < 12) throw new Error('啟用同步前，請輸入至少 12 個字元的加密密碼。')
        const revision = progressRevision()
        const slot = progressSlot.value.trim()
        const key = syncSaveKey(revision, slot)
        const local = await accessProgressSave(revision, slot, 'get')
        const remote = await getSyncedSave(syncConnection(), key)
        if (remote) {
          const save = parseProgressSave(
            await decryptProgressSave(remote.document, progressPassword.value),
            revision,
            slot,
          )
          if (local !== undefined && progressFingerprint(local) !== progressFingerprint(save))
            throw new Error('本機與遠端存檔不同；請先手動選擇下載或上傳。')
          if (progressRevision() !== revision) throw new Error('作品已變更，請重新啟用同步。')
          if (local === undefined) await accessProgressSave(revision, slot, 'put', save, local)
          syncBaselines.set(key, { etag: remote.etag, localFingerprint: progressFingerprint(save) })
        } else {
          syncBaselines.set(key, { etag: null, localFingerprint: progressFingerprint(local) })
          if (local !== undefined) await pushProgress(revision, slot, true)
        }
        syncStatus.textContent = '自動同步已啟用。'
      } catch (error) {
        syncAuto.checked = false
        syncStatus.textContent = `無法啟用自動同步：${error instanceof Error ? error.message : String(error)}`
      } finally {
        setProgressBusy(false)
      }
    })()
  })
  const runProgress = (operation: 'save' | 'load' | 'delete'): void => {
    void (async () => {
      setProgressBusy(true)
      progressStatus.textContent = '正在處理進度…'
      try {
        const slot = progressSlot.value.trim()
        const revision = progressRevision()
        let stored = await accessProgressSave(revision, slot, 'get')
        if (operation === 'load' && syncAuto.checked) {
          try {
            stored = await pullIfUnchanged(revision, slot, stored)
          } catch (error) {
            syncStatus.textContent = `未取得遠端更新，將使用本機存檔：${error instanceof Error ? error.message : String(error)}`
          }
        }
        if (operation === 'delete') {
          if (!stored) throw new Error('找不到這個作品版本的存檔。')
          if (!window.confirm(`確定刪除「${slot}」的本機存檔？`)) return
          await accessProgressSave(revision, slot, 'delete', undefined, stored)
          syncBaselines.delete(syncSaveKey(revision, slot))
          if (syncAuto.checked) {
            syncAuto.checked = false
            syncStatus.textContent = '本機存檔已刪除，自動同步已停用；遠端存檔仍保留。'
          }
          progressStatus.textContent = '已刪除本機存檔。'
          return
        }
        const animation = activeStudentAnimation
        if (!animation) throw new Error('請先執行作品，再儲存或讀取進度。')
        const runtimeRevision = liveRevision
        if (operation === 'save') {
          if (stored && !window.confirm(`「${slot}」已有存檔，確定覆蓋？`)) return
          const result = await animation.requestProgress('capture-game-progress', runtimeRevision)
          if (result.ok !== true || !Array.isArray(result.snapshot) || !Array.isArray(result.targets))
            throw new Error(typeof result.error === 'string' ? result.error : '無法擷取進度。')
          if (
            activeStudentAnimation !== animation ||
            liveRevision !== runtimeRevision ||
            progressRevision() !== revision
          )
            throw new Error('擷取期間作品已變更，請重新儲存。')
          const save: ProgressSave = {
            format: 'scratch-ai-bridge/progress',
            version: 1,
            projectRevision: revision,
            slot,
            savedAt: new Date().toISOString(),
            variables: result.snapshot,
            targets: result.targets,
          }
          await accessProgressSave(revision, slot, 'put', save, stored)
          progressStatus.textContent = `已儲存 ${result.snapshot.length} 個非雲端變數與清單，以及 ${result.targets.length} 個角色或舞台狀態。`
          if (syncAuto.checked) {
            try {
              await pushProgress(revision, slot, true)
            } catch (error) {
              syncStatus.textContent = `本機已儲存，但未上傳：${error instanceof Error ? error.message : String(error)}`
            }
          }
        } else {
          if (typeof stored !== 'object' || stored === null || Array.isArray(stored))
            throw new Error('找不到這個作品版本的存檔。')
          const save = parseProgressSave(stored, revision, slot)
          if (
            activeStudentAnimation !== animation ||
            liveRevision !== runtimeRevision ||
            progressRevision() !== revision
          )
            throw new Error('作品已變更，請重新讀取。')
          const result = await animation.requestProgress(
            'restore-game-progress',
            runtimeRevision,
            save.variables,
            save.targets,
          )
          if (result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : '無法恢復進度。')
          progressStatus.textContent = save.targets
            ? '已讀取變數、清單與角色狀態；遊戲腳本可能繼續改變它們。'
            : '已讀取舊版存檔中的變數與清單；遊戲腳本可能繼續改變它們。'
        }
      } catch (error) {
        progressStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        setProgressBusy(false)
      }
    })()
  }
  progressSave.addEventListener('click', () => runProgress('save'))
  progressLoad.addEventListener('click', () => runProgress('load'))
  progressDelete.addEventListener('click', () => runProgress('delete'))
  progressExport.addEventListener('click', () => {
    void (async () => {
      setProgressBusy(true)
      try {
        const slot = progressSlot.value.trim()
        const revision = progressRevision()
        const save = parseProgressSave(await accessProgressSave(revision, slot, 'get'), revision, slot)
        const output = progressPassword.value ? await encryptProgressSave(save, progressPassword.value) : save
        downloadJson(
          output,
          progressPassword.value ? 'scratch-game-progress-encrypted.json' : 'scratch-game-progress.json',
        )
        progressStatus.textContent = progressPassword.value ? '已匯出加密存檔；請妥善保管密碼。' : '已匯出明文存檔。'
      } catch (error) {
        progressStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        setProgressBusy(false)
      }
    })()
  })
  progressImport.addEventListener('click', () => progressFile.click())
  progressFile.addEventListener('change', () => {
    const file = progressFile.files?.[0]
    progressFile.value = ''
    if (!file) return
    void (async () => {
      setProgressBusy(true)
      try {
        if (file.size > 224 * 1024) throw new Error('存檔檔案超過 224 KiB。')
        const slot = progressSlot.value.trim()
        const revision = progressRevision()
        const parsed: unknown = JSON.parse(await file.text())
        const decrypted = isEncryptedProgressSave(parsed)
          ? await decryptProgressSave(parsed, progressPassword.value)
          : parsed
        let save = parseProgressSave(decrypted, null, slot)
        if (save.projectRevision !== revision) {
          const animation = activeStudentAnimation
          if (!animation) throw new Error('此存檔來自不同版本；請先執行目前作品以檢查相容性。')
          const runtimeRevision = liveRevision
          const validation = await animation.requestProgress(
            'validate-game-progress',
            runtimeRevision,
            save.variables,
            save.targets,
          )
          if (validation.ok !== true)
            throw new Error(typeof validation.error === 'string' ? validation.error : '存檔無法與目前作品相容。')
          if (
            activeStudentAnimation !== animation ||
            liveRevision !== runtimeRevision ||
            progressRevision() !== revision
          )
            throw new Error('檢查期間作品已變更，請重新匯入。')
          if (
            !window.confirm(
              `此存檔來自不同作品版本。角色與變數可對應，但遊戲規則可能已改變。確定將存檔綁定到目前版本？\n原版本：${save.projectRevision.slice(0, 19)}…\n目前版本：${revision.slice(0, 19)}…`,
            )
          ) {
            progressStatus.textContent = '已取消跨版本匯入。'
            return
          }
          save = { ...save, projectRevision: revision }
        }
        const stored = await accessProgressSave(revision, slot, 'get')
        if (stored && !window.confirm(`「${slot}」已有存檔，確定覆蓋？`)) return
        if (progressRevision() !== revision) throw new Error('作品已變更，請重新匯入。')
        await accessProgressSave(revision, slot, 'put', save, stored)
        progressStatus.textContent = '已匯入本機存檔；執行作品後可讀取。'
      } catch (error) {
        progressStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        setProgressBusy(false)
      }
    })()
  })
  progressPanel.append(
    progressTitle,
    progressHelp,
    progressLabel,
    progressPasswordLabel,
    progressActions,
    progressFile,
    progressStatus,
    syncPanel,
  )
  previewColumn.append(progressPanel)

  studentPreview.append(previewColumn)

  const animationArchivePromise: Promise<{ archive: Blob | null; fallbackCount: number; error?: Error }> =
    createAnimationPreviewArchive(project, rawSource).catch((error: unknown) => ({
      archive: null,

      fallbackCount: 0,

      error: error instanceof Error ? error : new Error('無法準備損壞素材的動畫示意圖。'),
    }))

  let patchedPreviewArchive: Blob | null = null

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

      const archiveForRun = patchedPreviewArchive ?? prepared.archive ?? sb3

      let archiveForCurrentFrame = archiveForRun

      let revisionForCurrentFrame = liveRevision

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

        applyRuntimePatch: (operations, baseRevision, revision) =>
          new Promise<Record<string, unknown>>((resolve) => {
            const requestId = crypto.randomUUID()
            const patchTimer = window.setTimeout(() => {
              pendingLivePatches.delete(requestId)
              resolve({ ok: false, error: '即時修改逾時；預覽狀態未確認，請重新檢查作品。' })
              animation.finish('即時修改沒有及時確認；為避免預覽狀態與作品資料不一致，已停止預覽。')
            }, 5_000)
            pendingLivePatches.set(requestId, { resolve, timer: patchTimer })
            frame.contentWindow?.postMessage(
              {
                type: 'apply-runtime-patch',
                token,
                requestId,
                baseRevision,
                revision,
                operations: operations.map((operation) => {
                  if (operation.op === 'set-variable')
                    return {
                      op: operation.op,
                      target: operation.targetName,
                      name: operation.variableName,
                      value: operation.value,
                    }
                  if (operation.op === 'set-target-property')
                    return {
                      op: operation.op,
                      target: operation.targetName,
                      property: operation.property,
                      value: operation.value,
                    }
                  return { op: operation.op, property: operation.property, value: operation.value }
                }),
              },
              '*',
            )
          }),

        requestProgress: (type, revision, snapshot, targetSnapshot) =>
          new Promise<Record<string, unknown>>((resolve) => {
            const requestId = crypto.randomUUID()
            const progressTimer = window.setTimeout(() => {
              pendingLivePatches.delete(requestId)
              resolve({ ok: false, error: '存檔操作逾時。' })
              if (type === 'restore-game-progress') animation.finish('讀檔未能確認，已停止預覽。')
            }, 5_000)
            pendingLivePatches.set(requestId, { resolve, timer: progressTimer })
            frame.contentWindow?.postMessage(
              { type, token, requestId, baseRevision: revision, snapshot, targetSnapshot },
              '*',
            )
          }),

        requestSelfHostedCloud: (revision, projectId, canWrite) =>
          new Promise<Record<string, unknown>>((resolve) => {
            const requestId = crypto.randomUUID()
            const timer = window.setTimeout(() => {
              pendingLivePatches.delete(requestId)
              frame.contentWindow?.postMessage({ type: 'disconnect-selfhosted-cloud', token }, '*')
              resolve({ ok: false, error: '自架雲端變數連線逾時。' })
            }, 5_000)
            pendingLivePatches.set(requestId, { resolve, timer })
            frame.contentWindow?.postMessage(
              { type: 'connect-selfhosted-cloud', token, requestId, baseRevision: revision, projectId, canWrite },
              '*',
            )
          }),

        onSelfHostedCloudMessage: (message) => handleSelfHostedCloudMessage(message),

        onRuntimePatchResult: (message) => {
          if (typeof message.requestId !== 'string') return
          const pending = pendingLivePatches.get(message.requestId)
          if (!pending) return
          window.clearTimeout(pending.timer)
          pendingLivePatches.delete(message.requestId)
          pending.resolve(message)
        },

        replaceProject: (archive, revision) => {
          stopSelfHostedCloud('作品已修改，請重新連接自架雲端變數。')
          archiveForCurrentFrame = archive
          revisionForCurrentFrame = revision
          frame.src = previewUrl.toString()
        },

        onLoaded: () => {
          if (generation !== studentPreviewGeneration) return

          stageStatus.textContent = '預覽環境已載入，正在匯入作品。'

          frame.contentWindow?.postMessage(
            {
              type: 'start-preview',
              archive: archiveForCurrentFrame,
              extensions: hardwareExtensions,
              token,
              revision: revisionForCurrentFrame,
            },

            '*',
          )
        },

        onReady: () => {
          if (generation !== studentPreviewGeneration) return

          if (timer !== null) window.clearTimeout(timer)

          timer = window.setTimeout(() => animation.finish('動畫預覽已達 120 秒上限，已自動停止。'), 120_000)

          setLivePatchReady(true)

          frame.style.opacity = '1'

          frame.style.pointerEvents = ''

          frame.removeAttribute('aria-hidden')

          studentStageCanvas.hidden = true

          background.hidden = true

          stageStatus.hidden = false

          stageStatus.textContent = `動畫執行中。${prepared.fallbackCount > 0 ? `已將 ${prepared.fallbackCount} 個損壞造型替換為示意素材。` : ''}點擊舞台後可用方向鍵、空白鍵或作品中的滑鼠操作；預覽最多 120 秒。`

          if (hardwareExtensions.length > 0) hardwareControls.hidden = false

          startAnimation.hidden = true

          startAnimation.disabled = false

          stopAnimation.hidden = false
        },

        onProgress: (message) => {
          if (generation !== studentPreviewGeneration || typeof message.detail !== 'string') return
          stageStatus.hidden = false
          stageStatus.textContent = message.detail
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
          stopSelfHostedCloud('預覽已停止，自架雲端變數已中斷。')
          if (activeStudentAnimation === animation) activeStudentAnimation = null

          setLivePatchReady(false)

          for (const [requestId, pending] of pendingLivePatches) {
            window.clearTimeout(pending.timer)
            pending.resolve({ requestId, ok: false, error: '動畫預覽已停止。' })
          }
          pendingLivePatches.clear()

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

  latestRequirementCoverage = null

  downloadStudentValidationReport.hidden = true

  studentResult.hidden = true

  studentResult.removeAttribute('data-kind')

  studentResultTitle.textContent = ''

  studentResultMessage.textContent = ''

  studentRequirementCoverage.replaceChildren()

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

        repeatedIssues: [],
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

      repeatedIssues: [],
    }
  } catch (parseError) {
    return {
      report: createRepairReport({ parseError }),

      currentProject: editor.value,

      repeatedIssues: [],
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
  const brief = gameBrief.value.trim()
  copyDesignInstruction.disabled = request.length === 0
  copyDirectInstruction.disabled = request.length === 0
  copyBuildInstruction.disabled = request.length === 0 || brief.length === 0
  instruction.value = request
    ? createGameDesignDiscussionInstruction(request, gameGenre.value as GameGenreProfile)
    : AI_INSTRUCTION
  copyStatus.removeAttribute('data-kind')
  copyStatus.textContent = request
    ? `精簡討論指令 ${estimatePromptSize(instruction.value).characters.toLocaleString()} 字元；不含積木目錄或 JSON 規格。`
    : '先寫下作品想法，或選一個範例。'
  buildPromptStatus.removeAttribute('data-kind')
  if (request) {
    const prompt = createStudentProjectInstruction(request, {
      genre: gameGenre.value as GameGenreProfile,
      ...(brief ? { confirmedBrief: brief } : {}),
    })
    const size = estimatePromptSize(prompt)
    buildPromptStatus.textContent = brief
      ? `製作指令約 ${size.characters.toLocaleString()} 字元、${size.estimatedTokens.toLocaleString()} tokens（粗估；各 AI tokenizer 不同）。`
      : '討論完成後貼上 brief，再複製製作指令。也可跳過討論，讓 AI 自行規劃並製作。'
  } else {
    buildPromptStatus.textContent = '先輸入作品想法。'
  }
}

projectRequest.addEventListener('input', () => {
  updateStudentInstruction()
  setProgress(1)
})

gameBrief.addEventListener('input', updateStudentInstruction)
gameGenre.addEventListener('change', updateStudentInstruction)

for (const example of document.querySelectorAll<HTMLButtonElement>('.idea-chip')) {
  example.addEventListener('click', () => {
    projectRequest.value = example.dataset.request ?? ''

    updateStudentInstruction()

    setProgress(1)

    projectRequest.focus()
  })
}

const copyStudentPrompt = (prompt: string, status: HTMLParagraphElement, success: string): void => {
  const size = estimatePromptSize(prompt)
  void navigator.clipboard
    .writeText(prompt)
    .then(() => {
      status.textContent = `${success}（${size.characters.toLocaleString()} 字元，約 ${size.estimatedTokens.toLocaleString()} tokens；token 數為粗估）`
      status.dataset.kind = 'ok'
      instruction.value = prompt
      setProgress(2)
    })
    .catch(() => {
      const advancedTools = byId<HTMLDetailsElement>('advanced-tools')
      advancedTools.open = true
      instruction.value = prompt
      instruction.focus()
      instruction.select()
      status.textContent = `瀏覽器無法自動複製；已選取指令（${size.characters.toLocaleString()} 字元，約 ${size.estimatedTokens.toLocaleString()} tokens），請手動複製。`
      status.dataset.kind = 'error'
    })
}

copyDesignInstruction.addEventListener('click', () => {
  const request = projectRequest.value.trim()
  if (!request) return
  copyStudentPrompt(
    createGameDesignDiscussionInstruction(request, gameGenre.value as GameGenreProfile),
    copyStatus,
    '已複製精簡討論指令。確認玩法後把 brief 貼回本頁；製作階段可開新對話節省上下文',
  )
})

copyBuildInstruction.addEventListener('click', () => {
  const request = projectRequest.value.trim()
  if (!request || !gameBrief.value.trim()) return
  copyStudentPrompt(
    createStudentProjectInstruction(request, {
      genre: gameGenre.value as GameGenreProfile,
      confirmedBrief: gameBrief.value,
    }),
    buildPromptStatus,
    '已複製製作指令。建議用新的 AI 對話，只貼原始需求與已確認 brief',
  )
})

copyDirectInstruction.addEventListener('click', () => {
  const request = projectRequest.value.trim()
  if (!request) return
  copyStudentPrompt(
    createStudentProjectInstruction(request, { genre: gameGenre.value as GameGenreProfile }),
    copyStatus,
    '已複製完整製作指令；AI 會先自行規劃核心循環、挑戰、回饋、進展與勝敗',
  )
})

const fragmentProjectName = (): string =>
  projectFragmentSession.project?.name ||
  gameBrief.value.match(/(?:遊戲名稱|作品名稱|名稱)\s*[:：]\s*([^\n，。]+)/)?.[1]?.trim() ||
  'Scratch 遊戲'

const fragmentPrompt = (): string => {
  const project = projectFragmentSession.project
  return createProjectFragmentInstruction({
    projectName: fragmentProjectName(),
    fragmentId: fragmentId.value.trim() || `${fragmentKind.value}-fragment`,
    targetKind: fragmentKind.value as 'stage' | 'sprite',
    targetName: fragmentTargetName.value.trim() || (fragmentKind.value === 'stage' ? '舞台' : '角色'),
    designBrief: gameBrief.value.trim() || projectRequest.value.trim(),
    existingTargets: project ? [project.stage.name, ...project.sprites.map((sprite) => sprite.name)] : [],
    sharedNames: project
      ? [
          ...project.stage.variables.map((item) => `變數:${item.name}`),
          ...project.broadcasts.map((item) => `廣播:${item.name}`),
        ]
      : [],
    reuseCapabilityContract: Boolean(project && fragmentReuseContract.checked),
  })
}

byId<HTMLButtonElement>('copy-fragment-prompt').addEventListener('click', () => {
  copyStudentPrompt(
    fragmentPrompt(),
    fragmentStatus,
    projectFragmentSession.project && fragmentReuseContract.checked
      ? '已複製單一 target 指令；請貼在先前已載入完整能力規格的同一 AI 對話'
      : '已複製可獨立使用的單一 target 指令，內含完整能力規格',
  )
})

byId<HTMLButtonElement>('add-fragment').addEventListener('click', () => {
  try {
    const nextSession = mergeProjectFragment(projectFragmentSession, JSON.parse(fragmentEditor.value))
    projectFragmentSession = nextSession
    const project = nextSession.project
    if (!project) throw new Error('片段組合未產生作品。')
    editor.value = JSON.stringify(project, null, 2)
    let persisted = true
    try {
      sessionStorage.setItem(
        fragmentStorageKey,
        JSON.stringify({
          project,
          appliedFragmentIds: [...nextSession.appliedFragmentIds],
        }),
      )
    } catch {
      persisted = false
    }
    fragmentEditor.value = ''
    fragmentStatus.dataset.kind = 'ok'
    fragmentStatus.textContent = `已加入 ${nextSession.appliedFragmentIds.size} 個片段；${project.stage.name} + ${project.sprites.length} 個角色，可繼續加入腳本或按「檢查並製作 Scratch」。${persisted ? '' : '瀏覽器未允許保存，請勿重新載入。'}`
    const safeName =
      fragmentTargetName.value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-') || 'target'
    fragmentId.value = `${safeName}-${nextSession.appliedFragmentIds.size + 1}`
  } catch (error) {
    fragmentStatus.dataset.kind = 'error'
    fragmentStatus.textContent = error instanceof Error ? error.message : String(error)
  }
})

byId<HTMLButtonElement>('reset-fragments').addEventListener('click', () => {
  projectFragmentSession = createEmptyProjectFragmentSession()
  try {
    sessionStorage.removeItem(fragmentStorageKey)
  } catch {
    // The current in-memory session is still cleared when browser storage is unavailable.
  }
  editor.value = ''
  fragmentEditor.value = ''
  fragmentStatus.dataset.kind = 'ok'
  fragmentStatus.textContent = '片段組合與完整作品欄已清空。'
})

fragmentKind.addEventListener('change', () => {
  fragmentTargetName.value = fragmentKind.value === 'stage' ? '舞台' : '玩家'
  fragmentId.value = `${fragmentKind.value}-1`
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
    const aiResponse = parseAiProjectResponse(parsed.data)

    latestRequirementCoverage = aiResponse.requirementCoverage

    normalized = addExtractionRepair(normalizeAiDraft(aiResponse.project), parsed)
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

      ...(latestRequirementCoverage ? { requirementCoverage: latestRequirementCoverage } : {}),

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

      `作品包含 ${validation.data.sprites.length} 個角色。${describeAutomaticVisuals(automaticVisuals)}${describeOfflineCloudVariables(validation.data)}${latestRequirementCoverage ? '下方需求完成度是 AI 自述，Bridge 已檢查引用位置，但不代表已執行驗證。' : 'AI 回覆未提供需求完成度清單；格式與編譯通過不代表原始需求全數完成。'}請開啟下載的 .sb3 檔案繼續創作；本次驗證報告也可以下載。`,

      'success',
    )

    if (latestRequirementCoverage) {
      const labels: Record<RequirementCoverageEntry['status'], string> = {
        'implemented-structure': '結構上有對應積木',

        approximated: '簡化近似',

        'not-implemented': '未實作',

        'runtime-unavailable': '執行環境不可用',

        'not-verifiable-from-ir': '無法從 IR 驗證',
      }

      studentRequirementCoverage.replaceChildren(
        ...latestRequirementCoverage.map((entry) => {
          const item = document.createElement('li')

          item.textContent = `${entry.id} · ${entry.requirement} — AI 自述：${labels[entry.status]}${entry.evidencePointers.length ? `（${entry.evidencePointers.join('、')}）` : ''}`

          return item
        }),
      )
    }

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

      ...(latestRequirementCoverage ? { requirementCoverage: latestRequirementCoverage } : {}),

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

  const prompt = createRepairPrompt(
    latestRepairContext.report,

    latestRepairContext.currentProject,

    capabilityGuide,

    latestRepairContext.repeatedIssues,
  )

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

let projectMap: ProjectMap | null = null

let projectFeedback: ProjectFeedback | null = null

let projectScore: ProjectScore | null = null

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

const targetScriptFilter = byId<HTMLInputElement>('target-script-filter')

const projectMapCoverage = byId<HTMLParagraphElement>('project-map-coverage')

const projectMapFacts = byId<HTMLUListElement>('project-map-facts')

const projectFeedbackItems = byId<HTMLUListElement>('project-feedback-items')

const projectFeedbackLimits = byId<HTMLUListElement>('project-feedback-limits')

const projectScoreSummary = byId<HTMLParagraphElement>('project-score-summary')

const projectScoreCriteria = byId<HTMLOListElement>('project-score-criteria')

const projectScoreLimits = byId<HTMLUListElement>('project-score-limits')

const copyScoringPrompt = byId<HTMLButtonElement>('copy-scoring-prompt')

const downloadAnonymousFeedback = byId<HTMLButtonElement>('download-anonymous-feedback')

const feedbackExportStatus = byId<HTMLSpanElement>('feedback-export-status')

const feedbackRatings = new Map<string, 'helpful' | 'inaccurate' | 'not-my-goal'>()

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

const filterTargetScriptList = (): void => {
  const query = targetScriptFilter.value.trim().toLocaleLowerCase()

  targetScriptList.querySelectorAll<HTMLElement>('[data-target-index]').forEach((target) => {
    target.hidden = !target.textContent.toLocaleLowerCase().includes(query)
  })
}

const focusProjectEvidence = (source: ProjectEvidence): void => {
  const disclosure = targetScriptList.closest('details')

  if (disclosure) disclosure.open = true

  let evidenceTarget: HTMLElement | null = null

  if (source.scriptIndex === null && source.blockId) {
    evidenceTarget = document.getElementById(`raw-block-${source.targetIndex}-${encodeURIComponent(source.blockId)}`)
  } else if (source.scriptIndex === null) {
    evidenceTarget = targetScriptList.querySelector<HTMLElement>(
      `[data-target-index="${source.targetIndex}"] summary`,
    )
  } else {
    const scriptElement = document.getElementById(`target-script-${source.targetIndex}-script-${source.scriptIndex}`)

    const evidenceDetails = scriptElement?.querySelector<HTMLDetailsElement>('.script-evidence-details')

    if (scriptElement && evidenceDetails && projectMap) {
      evidenceDetails.open = true

      if (evidenceDetails.dataset.loaded !== 'true') {
        const evidenceList = document.createElement('ol')

        evidenceList.setAttribute('aria-label', '這段程式的積木線索')

        projectMap.evidence

          .filter((item) => item.targetIndex === source.targetIndex && item.scriptIndex === source.scriptIndex)

          .forEach((item, index) => {
            const row = document.createElement('li')

            row.id = `project-evidence-${item.targetIndex}-${encodeURIComponent(item.id)}`

            row.tabIndex = -1

            row.textContent = `第 ${index + 1} 個積木：${item.studentLabel}`

            evidenceList.append(row)
          })

        evidenceDetails.append(evidenceList)

        evidenceDetails.dataset.loaded = 'true'
      }

      evidenceTarget = document.getElementById(
        `project-evidence-${source.targetIndex}-${encodeURIComponent(source.id)}`,
      )
    }

    evidenceTarget ??= scriptElement
  }

  let parent = evidenceTarget?.parentElement

  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true

    parent = parent.parentElement
  }

  targetScriptList.querySelectorAll('.evidence-focus').forEach((item) => item.classList.remove('evidence-focus'))

  evidenceTarget?.classList.add('evidence-focus')

  evidenceTarget?.scrollIntoView({ block: 'center', behavior: 'smooth' })

  evidenceTarget?.focus()
}

const evidenceLocationLabel = (source: ProjectEvidence): string =>
  source.scriptIndex === null
    ? `查看「${source.targetName}」中尚未解讀的積木`
    : `定位「${source.targetName}」第 ${source.scriptIndex + 1} 段的「${source.studentLabel}」`

targetScriptFilter.addEventListener('input', filterTargetScriptList)

downloadAnonymousFeedback.addEventListener('click', () => {
  if (!projectFeedback || feedbackRatings.size === 0) return

  const responses = [...feedbackRatings.entries()].flatMap(([id, rating]) => {
    const index = projectFeedback?.items.findIndex((item) => item.id === id) ?? -1

    return index >= 0 ? [{ feedbackItem: index + 1, rating }] : []
  })

  downloadJson({ format: 'scratch-ai-bridge/anonymous-feedback', version: 1, responses }, 'anonymous-feedback.json')

  feedbackExportStatus.textContent = '匿名回饋記錄已下載；檔案不含作品、角色名稱或 AI 對話。'
})

const renderAnalysis = () => {
  if (!canonical || !analysis || !projectMap || !projectFeedback || !projectScore) return

  const currentProjectMap = projectMap

  const summary = analysis.summary

  projectScoreSummary.textContent = `${projectScore.total === null ? '目前沒有足夠的可讀證據換算參考分' : `SB3 結構參考分：${projectScore.total}/${projectScore.max}`}（分析覆蓋 ${projectScore.coverage}%）。這不是正式成績，也不代表作品已執行。`

  projectScoreCriteria.replaceChildren(
    ...projectScore.criteria.map((criterion) => {
      const item = document.createElement('li')

      const heading = document.createElement('strong')

      heading.textContent = `${criterion.title}：${criterion.score === null ? '不適用' : `${criterion.score}/${criterion.points} 分`}`

      const detail = document.createElement('p')

      detail.textContent = criterion.explanation

      item.append(heading, detail)

      for (const evidenceId of criterion.evidenceIds.slice(0, 4)) {
        const source = currentProjectMap.evidence.find(({ id }) => id === evidenceId)

        if (!source) continue

        const button = document.createElement('button')

        button.type = 'button'

        button.className = 'button secondary evidence-link'

        button.textContent = evidenceLocationLabel(source)

        button.addEventListener('click', () => focusProjectEvidence(source))

        item.append(button)
      }

      return item
    }),
  )

  projectScoreLimits.replaceChildren(
    ...projectScore.limits.map((limit) => {
      const item = document.createElement('li')

      item.textContent = limit

      return item
    }),
  )

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

  const extensionSummary = projectMap.coverage.extensions.length
    ? ` 擴充積木：${projectMap.coverage.extensions

        .map((item) => `${item.extensionName} ${item.recognizedBlocks} 個已辨認、${item.opaqueBlocks} 個尚不理解`)

        .join('；')}。不理解的擴充積木不代表作品錯誤，也不會因此扣分。`
    : ''

  projectMapCoverage.textContent = `保留 ${projectMap.coverage.importedBlocks} 個原始積木；其中 ${projectMap.coverage.recognizedBlocks} 個可辨識、${projectMap.coverage.opaqueBlocks} 個目前無法完整解讀。${extensionSummary} 回編/執行驗證：尚未執行。`

  projectMapFacts.replaceChildren(
    ...projectMap.facts.slice(0, 30).map((fact) => {
      const item = document.createElement('li')

      const claim = document.createElement('p')

      claim.textContent = `${fact.confidence === 'high' ? '積木中可見：' : '需要確認：'}${fact.claim}`

      item.append(claim)

      for (const source of fact.evidence) {
        const button = document.createElement('button')

        button.type = 'button'

        button.className = 'button secondary evidence-link'

        button.textContent = evidenceLocationLabel(source)

        button.addEventListener('click', () => {
          focusProjectEvidence(source)
        })

        item.append(button)
      }

      return item
    }),
  )

  projectFeedbackItems.replaceChildren(
    ...projectFeedback.items

      .filter(({ kind }) => kind !== 'confirmed-structure')

      .slice(0, 30)

      .map((feedback) => {
        const item = document.createElement('li')

        const title = document.createElement('strong')

        title.textContent =
          feedback.kind === 'confirmed-structure'
            ? `${feedback.title}（有積木證據）`
            : `${feedback.title}（供師生確認）`

        const message = document.createElement('p')

        message.textContent = feedback.message

        const nextStep = document.createElement('p')

        nextStep.textContent = `可以試試：${feedback.nextStep}`

        item.append(title, message, nextStep)

        for (const evidenceId of feedback.evidenceIds) {
          const source = currentProjectMap.evidence.find(({ id }) => id === evidenceId)

          if (!source) continue

          const button = document.createElement('button')

          button.type = 'button'

          button.className = 'button secondary evidence-link'

          button.textContent = evidenceLocationLabel(source)

          button.addEventListener('click', () => {
            focusProjectEvidence(source)
          })

          item.append(button)
        }

        const ratings = [
          ['helpful', '有幫助'],

          ['inaccurate', '不準確'],

          ['not-my-goal', '不是我的目標'],
        ] as const

        for (const [value, label] of ratings) {
          const button = document.createElement('button')

          button.type = 'button'

          button.className = 'button secondary evidence-link'

          button.textContent = label

          button.dataset.feedbackId = feedback.id

          button.setAttribute('aria-pressed', String(feedbackRatings.get(feedback.id) === value))

          button.addEventListener('click', () => {
            feedbackRatings.set(feedback.id, value)

            item.querySelectorAll<HTMLButtonElement>('[data-feedback-rating]').forEach((ratingButton) => {
              ratingButton.setAttribute('aria-pressed', String(ratingButton.dataset.feedbackRating === value))
            })

            button.dataset.feedbackRating = value

            downloadAnonymousFeedback.disabled = false

            feedbackExportStatus.textContent = '已記錄在本機記憶體；按「下載匿名回饋記錄」才會匯出。'
          })

          button.dataset.feedbackRating = value

          item.append(button)
        }

        return item
      }),
  )

  projectFeedbackLimits.replaceChildren(
    ...projectFeedback.limits.slice(0, 8).map((limit) => {
      const item = document.createElement('li')

      item.textContent = limit

      return item
    }),
  )

  targetScriptList.replaceChildren(
    ...[canonical.stage, ...canonical.sprites].map((target, targetIndex) => {
      const section = document.createElement('details')

      section.className = 'target-script-entry'

      section.dataset.targetIndex = String(targetIndex)

      const heading = document.createElement('summary')

      heading.textContent = `${target.kind === 'stage' ? '舞台' : '角色'}：${target.name}`

      const summary = document.createElement('p')

      summary.textContent = `${target.scripts.length} 段程式${
        target.procedures.length > 0 ? ` · ${target.procedures.length} 個自己做的積木` : ''
      }`

      section.append(heading, summary)

      if (target.scripts.length > 0) {
        const list = document.createElement('ol')

        target.scripts.forEach((_, index) => {
          const item = document.createElement('li')

          item.id = `target-script-${targetIndex}-script-${index}`

          item.tabIndex = -1

          item.textContent = `程式 ${index + 1}`

          const scriptEvidence = currentProjectMap.evidence.filter(
            (entry) => entry.targetIndex === targetIndex && entry.scriptIndex === index,
          )

          if (scriptEvidence.length > 0) {
            const source = document.createElement('small')

            const labels = scriptEvidence.slice(0, 6).map(({ studentLabel }) => studentLabel)

            source.textContent = `這段程式：${labels.join('，')}${scriptEvidence.length > labels.length ? '，以及其他積木' : ''}`

            item.append(source)

            const evidenceDetails = document.createElement('details')

            evidenceDetails.className = 'script-evidence-details'

            const evidenceSummary = document.createElement('summary')

            evidenceSummary.textContent = `查看積木線索（${scriptEvidence.length} 個）`

            evidenceDetails.append(evidenceSummary)

            item.append(evidenceDetails)
          }

          list.append(item)
        })

        section.append(list)
      }

      if (target.procedures.length > 0) {
        const procedures = document.createElement('p')

        procedures.textContent = `自訂積木：${target.procedures.map(({ name }) => name).join('、')}`

        section.append(procedures)
      }

      const rawEvidence = currentProjectMap.evidence.filter(
        (entry) => entry.targetIndex === targetIndex && entry.scriptIndex === null,
      )

      if (rawEvidence.length > 0) {
        const rawList = document.createElement('ul')

        rawList.setAttribute('aria-label', '無法投影至 Canonical 腳本的原始積木')

        for (const source of rawEvidence) {
          const rawItem = document.createElement('li')

          rawItem.id = `raw-block-${targetIndex}-${encodeURIComponent(source.blockId ?? source.id)}`

          rawItem.tabIndex = -1

          rawItem.textContent = `第 ${rawEvidence.indexOf(source) + 1} 個積木目前無法解讀；它的效果需要在 Scratch 原始作品中確認。`

          rawList.append(rawItem)
        }

        section.append(rawList)
      }

      return section
    }),
  )

  filterTargetScriptList()

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

  projectScore = null

  copyScoringPrompt.disabled = true

  rawArchive = null

  feedbackRatings.clear()

  downloadAnonymousFeedback.disabled = true

  feedbackExportStatus.textContent = ''

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

    projectMap = createProjectMap(canonical, analysis, decompiled.rawBlockGraphs, decompiled.canonicalBlockMappings)

    projectFeedback = createProjectFeedback(analysis, projectMap)

    projectScore = createProjectScore(canonical, analysis, projectMap)

    copyScoringPrompt.disabled = false

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

    projectMap = null

    projectFeedback = null

    projectScore = null

    copyScoringPrompt.disabled = true

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

    .writeText(
      createAnalysisPrompt({
        analysis,

        canonical,

        projectMap: createProjectMap(canonical, analysis, sourceBlockGraphs, canonicalBlockMappings),

        mode,

        hintLevel,

        question,
      }),
    )

    .then(() =>
      setStatus(fileStatus, '已複製助教提示和匿名作品線索；貼到 AI 對話，就能取得一個提示和一個小步驟。', 'ok'),
    )

    .catch((error) => {
      setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error')
    })
})

byId<HTMLButtonElement>('copy-student-help-link').addEventListener('click', () => {
  const studentHelpUrl = 'https://polik18.github.io/scratch-editor-ai-bridge/student-help.html'

  const status = byId<HTMLElement>('student-help-link-status')

  const fallback = byId<HTMLElement>('student-help-link-fallback')

  const fallbackInput = byId<HTMLInputElement>('student-help-link-text')

  const copyStudentHelpUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(studentHelpUrl)

      fallback.hidden = true

      status.textContent = '已複製，可以貼給學生。'
    } catch {
      fallback.hidden = false

      fallbackInput.focus()

      fallbackInput.select()

      status.textContent = '瀏覽器不允許自動複製，已選取網址，請按複製。'
    }
  }

  void copyStudentHelpUrl()
})

copyScoringPrompt.addEventListener('click', () => {
  if (!projectMap || !projectScore) return

  const prompt = createScoringFeedbackPrompt(projectScore, projectMap)

  void navigator.clipboard

    .writeText(prompt)

    .then(() => setStatus(fileStatus, '已複製匿名評分依據與學生回饋提示；請檢視後再貼到 Gemini。', 'ok'))

    .catch((error) => setStatus(fileStatus, error instanceof Error ? error.message : String(error), 'error'))
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

const main = async (): Promise<void> => {
  // Fail early if the official VM cannot initialize in this browser/build.

  const bootstrapVm = await initializeScratchVM()

  window.addEventListener('pagehide', () => bootstrapVm.quit(), { once: true })

  const studentStageCanvas = document.createElement('canvas')

  studentStageCanvas.width = 480

  studentStageCanvas.height = 360

  studentStageCanvas.className = 'student-preview-canvas'

  studentStageCanvas.setAttribute('aria-label', 'Scratch 靜態舞台預覽（積木尚未執行）')

  studentStageCanvas.hidden = true

  interface ActiveStudentAnimation {
    frame: HTMLIFrameElement

    token: string

    consentDialogs: Map<HTMLDialogElement, () => void>

    finish(message: string): void

    onLoaded(): void

    onReady(): void

    onHardwareMessage(message: Record<string, unknown>): void
  }

  const studentAnimationState: { current: ActiveStudentAnimation | null } = { current: null }

  let speechConsentPromptQueue: Promise<void> = Promise.resolve()

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const active = studentAnimationState.current

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
              if (studentAnimationState.current !== active) {
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

                if (studentAnimationState.current === active)
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
}

main().catch((error) => {
  console.error('Scratch AI Bridge initialization failed:', error)

  document.body.innerHTML = `<div style="padding:20px"><h1>初始化失敗</h1><p>Scratch AI Bridge 無法初始化。請檢查瀏覽器控制台錯誤。</p><details><summary>詳細錯誤</summary><pre>${error instanceof Error ? error.stack : String(error)}</pre></details></div>`
})
