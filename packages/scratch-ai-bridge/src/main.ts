import { Buffer } from 'node:buffer'
import { md5 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils.js'
import { initializeScratchVM } from './bootstrap/vm-bootstrap'
import {
  apiKeyStorageWarning,
  clearAiConnection,
  loadAiConnection,
  saveAiConnection,
} from './core/ai/connection-store'
import {
  listOpenAiCompatibleModels,
  requestOpenAiCompatiblePatch,
  requestOpenAiCompatibleText,
} from './core/ai/openai-compatible'
import {
  inspectRawBlocks,
  inspectRawTargets,
  inspectRawVariables,
  inspectRawProjectForAi,
  proposeRawLivePatch,
} from './core/ai/raw-tool-core'
import { inspectProjectForAi, proposeLivePatch } from './core/ai/tool-core'
import {
  createValueExplanationPrompt,
  isInternalTarget,
  resetNote,
  usageLines,
  valueItems,
  type ValueItem,
} from './core/ai/value-guide'
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
import { groupDiagnosticsForDisplay } from './core/analyzer/diagnostic-groups'
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
import { createStudentIterationInstruction } from './core/capabilities/student-iteration'
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
  changedVariableNames,
  controlMovement,
  createPlaytestFeedback,
  inferPlaytestPlan,
  snapshotsChanged,
  type PlaytestSnapshot,
} from './core/playtest/feedback'
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
import { readProjectForAi } from './core/reader'
import type { ReaderOptions } from './core/reader/types'
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
  validateCanonicalSemanticsBestEffort,
  type CanonicalIRValidationIssue,
  type CanonicalSemanticIssue,
} from './core/validator'
import {
  createScratchAssetFetcher,
  describeLibraryResolution,
  selectLibraryCandidates,
  resolveLibraryAssets,
  type LibraryResolutionReport,
  type ResolveLibraryAssetsOptions,
} from './core/visuals/library'
import {
  resolveAutomaticVisual,
  summarizeAutomaticVisuals,
  type AutomaticVisualSummary,
} from './core/visuals/presets'
import { chooseProjectFile, friendlyOpenError, isFileDrag, projectFileProblem } from './open-project'
import { SCRATCH_LINK_HARDWARE_EXTENSION_IDS } from './scratch/extensions'
import { fetchPublicScratchProject } from './scratch/public-project'
import {
  createVM,
  loadSb3,
  pickScratchPreviewTarget,
  renderSb3Preview,
  type ScratchRuntimePatchChange,
  type ScratchRuntimePatchUpdate,
} from './scratch/vm'
import {
  buildDescription,
  createDescriptionInstruction,
  createDescriptionRepairPrompt,
  createDescriptionRevisionPrompt,
  descriptionKind,
  playtestFeedbackLines,
  type DescriptionKind,
} from './student-description'
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

  playtestKey(key: string, isDown: boolean): void

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
// Whether the work in the preview has changes the student has not downloaded; set by renderStudentPreview.
let studentPreviewHasEdits = (): boolean => false

let cancelActiveStudentPlaytest: (() => void) | null = null

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
  activeStudentAnimation?.finish(message)
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



        <div class="eyebrow">不用安裝 · 作品在本機處理；貼到 AI 的內容會交給該服務</div>



        <h1>AI × Scratch 作品轉換器</h1>



        <p class="lede">把你的遊戲想法交給 AI，再將 AI 回覆變成可在 Scratch 開啟的專案。</p>



      </div>



      <div class="status-pill"><span></span> Scratch 工具已準備好</div>



    </header>







    <details class="teacher-share">
      <summary>老師分享學生解惑頁</summary>
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
    </details>



    <nav class="tabs" role="tablist" aria-label="選擇功能">



      <button id="generate-tab" class="tab active" role="tab" aria-selected="true" aria-controls="generate-panel" data-tab="generate">用 AI 做 Scratch</button>



      <button id="analyze-tab" class="tab" role="tab" aria-label="請 AI 幫我檢查作品" aria-selected="false" aria-controls="analyze-panel" data-tab="analyze">進階：檢查已有作品</button>



    </nav>







    <div id="drop-overlay" class="drop-overlay" hidden><div><strong id="drop-overlay-title">放開就打開這個作品</strong><span>Scratch 3 的 .sb3 檔</span></div></div>
    <div class="workspace" id="main-content" tabindex="-1">



      <section id="generate-panel" class="panel-grid" role="tabpanel" aria-labelledby="generate-tab">
        <article class="card wide open-project-card" id="open-project">
          <div class="open-project-text">
            <h2>已經有作品了？</h2>
            <p>打開自己的 Scratch 作品（.sb3），就能預覽、請 AI 幫忙修改。也可以直接把檔案拖進這個視窗。</p>
            <p class="open-project-privacy">檔案只在你的電腦裡讀取，不會上傳。</p>
          </div>
          <button id="open-sb3-button" class="button primary" type="button">打開我的作品</button>
          <input id="open-sb3-file" class="visually-hidden" type="file" accept=".sb3,application/zip" tabindex="-1" aria-hidden="true">
          <label class="scratch-url-field" for="scratch-project-url">或貼上 Scratch 公開作品網址</label>
          <div class="scratch-url-row"><input id="scratch-project-url" type="url" inputmode="url" placeholder="https://scratch.mit.edu/projects/作品編號/" autocomplete="url"><button id="open-scratch-url" class="button secondary" type="button">從網址讀取</button></div>
          <p class="open-project-privacy">只讀公開作品；若瀏覽器的 CORS 政策不允許直接下載，請用 CLI fetch 或 skill-scratch-site 先下載，再把 .sb3 拖進來。</p>
          <div id="open-sb3-status" class="status-box" role="status" aria-live="polite"></div>
        </article>



        <ol class="progress-steps" aria-label="製作進度">



          <li class="current"><span>1</span>寫下想法</li>



          <li><span>2</span>交給 AI</li>



          <li><span>3</span>貼回回答</li>



          <li><span>4</span>試玩下載</li>



        </ol>



        <article class="card idea-card">



          <div class="step-heading"><span>1</span><div><h2>你想做什麼作品？</h2><p>一句主題或角色也可以。先寫下想法，再複製訊息給 AI。</p></div></div>



          <label for="project-request" class="field-label">我的作品想法</label>



          <textarea id="project-request" class="request-input" maxlength="1000" placeholder="例如：我想做一個關於深海探險的遊戲，主角是一條小魚。"></textarea>



          <details class="idea-examples-panel">
            <summary>找靈感（選用）</summary>
          <div class="idea-examples" aria-label="作品想法範例">



            <span>找靈感：</span>



            <button type="button" class="idea-chip" data-request="我想做一個深海救援遊戲，主角是小魚，要找到走失的海龜朋友。">深海救援</button>



            <button type="button" class="idea-chip" data-request="我想做一個機器人送信遊戲，主角要把重要信件送到城市另一邊。">機器人送信</button>



            <button type="button" class="idea-chip" data-request="我想做一個校園解謎故事，主角在學校裡發現一張奇怪的紙條。">校園解謎</button>



          </div>
          </details>



          <label for="authoring-mode" class="field-label">製作方式</label>
          <select id="authoring-mode" class="request-input genre-select">
            <option value="game">遊戲（建議）：AI 寫簡短的遊戲描述，Bridge 產生積木</option>
            <option value="story">動畫：AI 寫劇本（角色、場景、對白），Bridge 產生積木</option>
            <option value="blocks">進階：AI 直接寫所有積木（節奏、繪圖、模擬等其他類型）</option>
          </select>

          <div class="button-row"><button id="copy-direct-instruction" class="button primary" disabled>複製製作訊息給 AI</button></div>
          <p>不要在想法中填入姓名、班級等個人資料。複製後，打開老師允許的 AI 網頁貼上訊息並送出。</p>
          <p>Bridge 只會向 Scratch 官方伺服器下載素材；作品本身不會上傳，已下載素材可能暫存在這個瀏覽器的本機快取。</p>
          <p id="student-draft-status" role="status" aria-live="polite">這個分頁會暫存你的作品；關閉分頁或清除資料後可能無法找回，請下載作品。</p>
          <p><a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">開啟 Gemini ↗</a> <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">開啟 ChatGPT ↗</a></p>



          <p id="copy-status" class="inline-status" role="status" aria-live="polite">先寫下作品想法，或選一個範例。</p>

        </article>

        <section class="card wide" id="student-ai-guide" aria-labelledby="student-ai-guide-title" hidden>
          <div class="step-heading"><span>2</span><div><h2 id="student-ai-guide-title">把訊息交給 AI</h2><p>1. 打開老師允許的 AI 網頁。2. 把剛才複製的訊息貼上並送出。3. 等 AI 回答完成，再複製整段回答。</p></div></div>
          <p>貼到 AI 的內容會交給該服務，請不要放入姓名、班級等個人資料。</p>
          <div class="button-row"><a class="button secondary" href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">開啟 Gemini ↗</a><a class="button secondary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">開啟 ChatGPT ↗</a><button class="button primary" id="student-ai-answer-ready" type="button">我拿到回答了</button></div>
        </section>

        <details class="card game-brief-panel" id="optional-game-brief">
          <summary>進階：先和 AI 討論玩法（選用）</summary>

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

            <label for="game-brief" class="field-label">把討論後確認的玩法貼在這裡</label>

            <textarea id="game-brief" class="request-input brief-input" maxlength="3000" placeholder="例如：玩家操控小魚游動，收集氧氣泡泡並躲避水母；每救到一隻海龜就解鎖新海域，碰到水母會失去氧氣，耗盡後可立即重來。"></textarea>

            <div class="button-row"><button id="copy-design-instruction" class="button secondary" disabled>複製玩法討論訊息</button><button id="copy-build-instruction" class="button primary" disabled>用已確認玩法複製製作指令</button></div>

            <p id="build-prompt-status" class="inline-status" role="status" aria-live="polite">討論完成後貼上確認的玩法，再複製製作指令。也可以直接用「複製製作訊息給 AI」。</p>

        </details>



        <article class="card wide">



          <div class="step-heading"><span>3</span><div><h2>把 AI 的回答貼在這裡</h2><p>1. 複製製作訊息。2. 貼到老師允許的 AI 網頁並送出。3. 等回答完成，複製整段回答貼回這裡。</p></div></div>



          <label for="json-editor" class="visually-hidden">AI 的完整回覆</label>



          <textarea id="json-editor" class="mono editor student-editor" spellcheck="false" placeholder="把 AI 的完整回答貼在這裡。"></textarea>



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
          <div class="button-row student-actions"><button id="student-build" class="button primary">檢查並製作 Scratch</button></div>
          <details class="sample-workflow">
            <summary>先試用範例（選用）</summary>
            <div class="button-row"><button id="load-sample" class="button secondary">載入平台遊戲範例</button></div>
          </details>



          <div id="generate-status" class="status-box" role="status" aria-live="polite"></div>
          <button id="restore-student-project" class="button secondary" type="button" hidden>回到上一個可用作品</button>



          <section id="student-result" class="student-result" hidden>



            <strong id="student-result-title"></strong>



            <p id="student-result-message"></p>



            <ul id="student-requirement-coverage"></ul>

            <section id="student-assets" class="student-assets" hidden aria-labelledby="student-assets-title">
              <h3 id="student-assets-title">本作品使用的素材</h3>
              <p>可以替角色換成另一個官方素材；程式積木、變數和玩法不會改變，換好後會重新編譯並下載新版 .sb3。</p>
              <div id="student-asset-list" class="student-asset-list"></div>
              <p id="student-assets-status" class="inline-status" role="status" aria-live="polite"></p>
            </section>



            <div id="student-preview" class="student-preview" hidden aria-label="作品畫面預覽"></div>



            <div id="student-candidate-actions" class="button-row" hidden>
              <button id="accept-student-candidate" class="button primary" type="button">使用這個新版並下載</button>
              <button id="discard-student-candidate" class="button secondary" type="button">回到原本的作品</button>
            </div>
            <button id="download-student-validation-report" class="button secondary" hidden>下載驗證報告.json</button>



          </section>



        <article class="card iteration-card" id="iteration-card" hidden>
          <div class="step-heading"><div><h2>我想改一改</h2><p>說出想修改的地方，複製訊息貼給剛才的 AI，再把新回答貼回上方檢查。</p></div></div>
          <label for="iteration-request" class="field-label">你想改什麼？</label>
          <textarea id="iteration-request" class="request-input" maxlength="1000" placeholder="例如：讓小貓跳高一點"></textarea>
          <div class="button-row"><button id="iteration-generate" class="button primary" type="button">複製修改訊息給 AI</button></div>
          <p id="iteration-status" class="inline-status" role="status" aria-live="polite"></p>
        </article>

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



          </section>

            <div id="clipboard-fallback" class="clipboard-fallback" hidden>



              <label for="clipboard-fallback-text">瀏覽器拒絕剪貼簿存取，請從這裡全選複製：</label>



              <textarea id="clipboard-fallback-text" class="mono compact" readonly></textarea>



            </div>



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
const authoringMode = byId<HTMLSelectElement>('authoring-mode')
/** @returns The description kind the student chose, or undefined when the AI writes blocks directly. */
const chosenDescriptionKind = (): DescriptionKind | undefined =>
  authoringMode.value === 'game' || authoringMode.value === 'story' ? authoringMode.value : undefined

const iterationRequest = byId<HTMLTextAreaElement>('iteration-request')

const iterationGenerate = byId<HTMLButtonElement>('iteration-generate')

const iterationStatus = byId<HTMLParagraphElement>('iteration-status')

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

const studentAssets = byId<HTMLElement>('student-assets')

const studentAssetList = byId<HTMLDivElement>('student-asset-list')

const studentAssetsStatus = byId<HTMLParagraphElement>('student-assets-status')

const progressSteps = [...document.querySelectorAll<HTMLElement>('.progress-steps li')]

instruction.value = AI_INSTRUCTION

editor.value = ''

let latestStudentProject: CanonicalProject | null = null
interface StudentSnapshot {
  project: CanonicalProject
  source: string
  sb3: Blob
}
let latestStudentSnapshot: StudentSnapshot | null = null
let previousStudentSnapshot: StudentSnapshot | null = null
let pendingStudentSnapshot: StudentSnapshot | null = null
let currentReaderOptions: ReaderOptions = {}
let studentRevisionRequested = false
const studentCandidateActions = byId<HTMLElement>('student-candidate-actions')
const restoreStudentProject = byId<HTMLButtonElement>('restore-student-project')
const iterationCard = byId<HTMLElement>('iteration-card')
const studentDraftStatus = byId<HTMLElement>('student-draft-status')
const studentDraftKey = 'scratch-ai-bridge.student-draft.v1'
let studentDraftTouched = false

function saveStudentDraft(): void {
  studentDraftTouched = true
  try {
    sessionStorage.setItem(
      studentDraftKey,
      JSON.stringify({
        version: 1,
        request: projectRequest.value,
        response: editor.value,
        modification: iterationRequest.value,
        guideOpen: !byId<HTMLElement>('student-ai-guide').hidden,
        latest: latestStudentSnapshot
          ? { project: latestStudentSnapshot.project, source: latestStudentSnapshot.source }
          : null,
        previous: previousStudentSnapshot
          ? { project: previousStudentSnapshot.project, source: previousStudentSnapshot.source }
          : null,
        pending: pendingStudentSnapshot
          ? { project: pendingStudentSnapshot.project, source: pendingStudentSnapshot.source }
          : null,
        revisionRequested: studentRevisionRequested,
      }),
    )
    studentDraftStatus.textContent = '已暫存在這個分頁。關閉分頁或清除資料後可能無法找回，請下載作品。'
  } catch {
    studentDraftStatus.textContent = '無法暫存這次內容；請保持分頁開啟，並下載或複製作品備份。'
  }
}

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

let latestPlaytestPrompt: string | null = null

let latestPlaytestSummary: string | null = null

let latestStudentValidationReport: AiOutputValidationReport | null = null

let latestRequirementCoverage: readonly RequirementCoverageEntry[] | null = null

let latestFeatures: readonly string[] | null = null

/** The description behind the current project, when the AI wrote a game or animation description. */
let latestDescription: { readonly text: string; readonly feedback: string; readonly built: boolean } | null = null

const renderRepairTools = (): void => {
  const report = latestRepairContext?.report

  const hasIssues = (report?.issues.length ?? 0) > 0

  const actionable = (report?.summary.errors ?? 0) + (report?.summary.warnings ?? 0)

  const descriptionFeedback = latestDescription?.feedback ?? ''

  repairTools.hidden =
    !hasIssues && repairUndoSnapshot === null && latestPlaytestPrompt === null && !descriptionFeedback

  copyRepairPrompt.disabled = actionable === 0 && latestPlaytestPrompt === null && !descriptionFeedback

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

  if (!latestPlaytestSummary && !report && latestDescription && descriptionFeedback) {
    const problems = descriptionFeedback.split('\n').length
    repairTitle.textContent = latestDescription.built ? '作品做好了，有幾個地方建議確認' : '作品描述還要修改'
    repairExplanation.textContent = `${latestDescription.built ? `有 ${problems} 個地方建議確認` : `共 ${problems} 個問題`}，都已經放進修正訊息。按「複製修正訊息給 AI」，一次交給 AI 全部修正：\n${descriptionFeedback}`
    return
  }

  repairTitle.textContent = latestPlaytestSummary
    ? '自動試玩發現需要修正的地方'
    : report
      ? report.summary.errors > 0
        ? '作品資料還不完整'
        : report.summary.warnings > 0
          ? '作品還有幾個地方需要確認'
          : '格式已自動整理完成'
      : '作品檢查結果'

  repairExplanation.textContent =
    latestPlaytestSummary ??
    (report
      ? latestRepairContext?.repeatedIssues.length
        ? `上一輪修正後仍有 ${latestRepairContext.repeatedIssues.length} 個相同問題。請依 fingerprint 與欄位路徑檢查；若 AI 反覆輸出同一內容，可改用下方欄位範例手動修正。`
        : report.summary.errors > 0
          ? `AI 回覆還缺少 ${report.summary.errors} 個製作作品需要的資料。請複製修正訊息，貼回 AI 後再試一次。`
          : report.summary.warnings > 0
            ? `有 ${report.summary.warnings} 個遊戲規則不夠清楚，Bridge 不會自行猜測。作品已照目前內容做好；想讓 AI 一起修正，就複製修正訊息（試玩發現的問題也會一併放進去）。`
            : `已自動整理 ${report.summary.autoRepaired} 個格式問題；作品內容沒有需要確認的地方。`
      : '')
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

  latestPlaytestPrompt = null

  latestPlaytestSummary = null

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

const sampledColorName = (red: number, green: number, blue: number): string => {
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  if (maximum < 45) return '黑色'
  if (minimum > 220) return '白色'
  if (maximum - minimum < 24) return maximum < 130 ? '灰色' : '淺灰色'
  if (maximum === red && green >= blue * 1.35) return red > 190 && green > 130 ? '橘色' : '黃綠色'
  if (maximum === red) return '紅色'
  if (maximum === green && blue > red * 1.2) return '青色'
  if (maximum === green) return '綠色'
  if (maximum === blue && red > green * 1.2) return '紫色'
  return '藍色'
}

const samplePngVisualHints = async (archive: RawSb3Project): Promise<Record<string, string>> => {
  if (typeof createImageBitmap !== 'function') return {}
  const targets = Array.isArray(archive.projectJson.targets) ? archive.projectJson.targets : []
  const entries = new Map(archive.entries.map((entry) => [entry.name, entry.bytes]))
  const hints: Record<string, string> = {}
  for (const target of targets) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) continue
    const costumes = (target as Record<string, unknown>).costumes
    if (!Array.isArray(costumes)) continue
    for (const costume of costumes) {
      if (typeof costume !== 'object' || costume === null || Array.isArray(costume)) continue
      const record = costume as { md5ext?: unknown; dataFormat?: unknown }
      if (record.dataFormat !== 'png' || typeof record.md5ext !== 'string') continue
      const bytes = entries.get(record.md5ext)
      if (!bytes) continue
      try {
        const image = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = 48
        canvas.height = 48
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) {
          image.close()
          continue
        }
        context.drawImage(image, 0, 0, 48, 48)
        image.close()
        const pixels = context.getImageData(0, 0, 48, 48).data
        const counts = new Map<string, number>()
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] ?? 0
          if (alpha < 32) continue
          const color = sampledColorName(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)
          counts.set(color, (counts.get(color) ?? 0) + alpha)
        }
        const colors = [...counts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3)
          .map(([color]) => color)
        if (colors.length > 0) hints[record.md5ext] = `；瀏覽器取樣主要顏色約為${colors.join('、')}`
      } catch {
        // A browser decoder or a damaged PNG must not prevent the project from opening.
      }
    }
  }
  return hints
}

const loadPreviewImage = async (source: string): Promise<HTMLImageElement> => {
  const image = new Image()
  image.decoding = 'async'
  image.src = source
  await image.decode()
  return image
}

const createCostumeCollageDataUrl = async (project: CanonicalProject): Promise<string | null> => {
  const items = [
    { label: `背景：${project.stage.name}`, costume: project.stage.costumes.at(project.stage.currentCostume ?? 0) },
    ...project.sprites.map((sprite) => ({
      label: `角色：${sprite.name}`,
      costume: sprite.costumes.at(sprite.currentCostume ?? 0),
    })),
  ].slice(0, 48)
  const loaded: { readonly label: string; readonly image: HTMLImageElement }[] = []
  for (const item of items) {
    const source = costumeImageSource(item.costume)
    if (!source) continue
    try {
      loaded.push({ label: item.label, image: await loadPreviewImage(source) })
    } catch {
      // One damaged costume must not prevent the rest of the collage from being useful.
    }
  }
  if (loaded.length === 0) return null
  const columns = 4
  const tileWidth = 180
  const tileHeight = 150
  const canvas = document.createElement('canvas')
  canvas.width = columns * tileWidth
  canvas.height = Math.ceil(loaded.length / columns) * tileHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = '14px sans-serif'
  context.fillStyle = '#111827'
  for (const [index, item] of loaded.entries()) {
    const x = (index % columns) * tileWidth
    const y = Math.floor(index / columns) * tileHeight
    const scale = Math.min((tileWidth - 20) / item.image.naturalWidth, (tileHeight - 40) / item.image.naturalHeight)
    const width = Math.max(1, item.image.naturalWidth * scale)
    const height = Math.max(1, item.image.naturalHeight * scale)
    context.drawImage(item.image, x + (tileWidth - width) / 2, y + 8, width, height)
    context.fillText(item.label.slice(0, 24), x + 8, y + tileHeight - 12)
  }
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.length <= 2_000_000 ? dataUrl : null
}

const libraryCostumeFormat = (md5ext: string): CanonicalProject['stage']['costumes'][number]['dataFormat'] =>
  md5ext.endsWith('.png') ? 'png' : 'svg'

const renderStudentAssetLibrary = (project: CanonicalProject, snapshot: StudentSnapshot): void => {
  studentAssetList.replaceChildren()
  studentAssets.hidden = false
  studentAssetsStatus.textContent = '素材可以替換；替換時不會改變程式積木。'

  const stageCard = document.createElement('article')
  stageCard.className = 'student-asset-card'
  const stageCostume = project.stage.costumes.at(project.stage.currentCostume ?? 0) ?? project.stage.costumes.at(0)
  const stageImage = costumeImageSource(stageCostume)
  if (stageImage) {
    const image = document.createElement('img')
    image.className = 'student-asset-thumb'
    image.alt = `背景 ${stageCostume?.name ?? '未命名'}`
    image.src = stageImage
    stageCard.append(image)
  }
  const stageInfo = document.createElement('div')
  stageInfo.className = 'student-asset-info'
  const stageTitle = document.createElement('strong')
  stageTitle.textContent = `背景：${stageCostume?.name ?? '未命名'}`
  const stageNote = document.createElement('span')
  stageNote.textContent = 'Scratch 官方背景／目前使用的背景'
  stageInfo.append(stageTitle, stageNote)
  stageCard.append(stageInfo)
  studentAssetList.append(stageCard)

  project.sprites.forEach((sprite, spriteIndex) => {
    const candidates = selectLibraryCandidates(`${project.name} ${sprite.name}`, {
      sprites: 6,
      backdrops: 1,
      sounds: 4,
    }).sprites
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.name, candidate])).values()]
    if (uniqueCandidates.length === 0) return

    const card = document.createElement('article')
    card.className = 'student-asset-card'
    const sourceCostume = sprite.costumes.at(sprite.currentCostume ?? 0) ?? sprite.costumes.at(0)
    const source = costumeImageSource(sourceCostume)
    if (source) {
      const image = document.createElement('img')
      image.className = 'student-asset-thumb'
      image.alt = `${sprite.name}目前造型`
      image.src = source
      card.append(image)
    }

    const info = document.createElement('div')
    info.className = 'student-asset-info'
    const title = document.createElement('strong')
    title.textContent = `角色：${sprite.name}`
    const current = document.createElement('span')
    current.textContent = `目前造型：${sourceCostume?.name ?? '未命名'}`
    const controls = document.createElement('div')
    controls.className = 'student-asset-controls'
    const select = document.createElement('select')
    select.className = 'student-asset-select'
    select.setAttribute('aria-label', `${sprite.name}的新官方素材`)
    uniqueCandidates.forEach((candidate) => {
      const option = document.createElement('option')
      option.value = candidate.name
      option.textContent = candidate.name
      select.append(option)
    })
    const change = document.createElement('button')
    change.type = 'button'
    change.className = 'button secondary student-asset-change'
    change.textContent = '換一個並下載新版'
    change.addEventListener('click', () => {
      const activeSnapshot = pendingStudentSnapshot ?? latestStudentSnapshot
      if (activeSnapshot !== snapshot) {
        studentAssetsStatus.textContent = '作品已變更，請先重新檢查後再換素材。'
        return
      }
      const candidate = uniqueCandidates.find(({ name }) => name === select.value)
      const tuple = candidate?.costumes[0]
      const target = activeSnapshot.project.sprites.at(spriteIndex)
      if (!candidate || !tuple || !target) return
      change.disabled = true
      select.disabled = true
      studentAssetsStatus.textContent = `正在下載官方素材「${candidate.name}」並重新編譯…`
      void (async () => {
        try {
          const nextProject = structuredClone(activeSnapshot.project)
          const nextTarget = nextProject.sprites.at(spriteIndex)
          if (!nextTarget) throw new Error('找不到要替換的角色。')
          nextTarget.costumes = [{ name: tuple[0], dataFormat: libraryCostumeFormat(tuple[1]) }]
          nextTarget.currentCostume = 0
          nextTarget.sounds = []
          const resolved = await resolveLibraryAssets(nextProject, libraryAssetFetcher, { replaceModelSvg: true })
          const nextSb3 = await compileCanonicalProjectToSb3(resolved.project)
          latestLibraryReport = resolved.report
          latestAutomaticVisuals = summarizeAutomaticVisuals(resolved.project)
          const nextSnapshot: StudentSnapshot = {
            project: resolved.project,
            source: activeSnapshot.source,
            sb3: nextSb3,
          }
          if (pendingStudentSnapshot === activeSnapshot) pendingStudentSnapshot = nextSnapshot
          else {
            previousStudentSnapshot = activeSnapshot
            latestStudentSnapshot = nextSnapshot
            restoreStudentProject.hidden = false
          }
          latestStudentProject = resolved.project
          download(
            nextSb3,
            `${resolved.project.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`,
          )
          renderStudentAssetLibrary(resolved.project, nextSnapshot)
          renderStudentPreview(resolved.project, nextSb3)
          studentAssetsStatus.textContent = `已換成官方素材「${candidate.name}」並下載新版。${describeLibraryResolution(resolved.report)}`
          saveStudentDraft()
        } catch (error) {
          studentAssetsStatus.textContent = error instanceof Error ? error.message : '替換素材失敗，原作品未改變。'
          change.disabled = false
          select.disabled = false
        }
      })()
    })
    controls.append(select, change)
    info.append(title, current, controls)
    card.append(info)
    studentAssetList.append(card)
  })
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

const renderStudentPreview = (
  project: CanonicalProject,
  sb3: Blob,
  rawSource?: RawSb3Project,
  options: { readonly autoPlaytest?: boolean; readonly readerOptions?: ReaderOptions } = {},
): void => {
  cancelActiveStudentPlaytest?.()
  cancelActiveStudentPlaytest = null
  stopStudentAnimation('動畫預覽已停止；舞台靜態畫面已恢復。')

  latestPlaytestPrompt = null

  latestPlaytestSummary = null

  const generation = ++studentPreviewGeneration

  studentPreviewHasEdits = () => false

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

  let pickedTargetName: string | undefined
  const stagePickHint = document.createElement('p')
  stagePickHint.className = 'inline-status'
  stagePickHint.textContent = '點一下舞台上的角色，就能把「我指的是誰」加到 AI 要求。'
  stagePickHint.setAttribute('role', 'status')
  stagePickHint.setAttribute('aria-live', 'polite')
  stageFrame.append(stagePickHint)
  studentStageCanvas.onclick = (event) => {
    const rect = studentStageCanvas.getBoundingClientRect()
    const targetName = pickScratchPreviewTarget(
      bootstrapVm,
      ((event.clientX - rect.left) / rect.width) * studentStageCanvas.width,
      ((event.clientY - rect.top) / rect.height) * studentStageCanvas.height,
      rect.width,
      rect.height,
    )
    if (!targetName) {
      stagePickHint.textContent = '這個位置沒有辨識到角色；請點角色本身，或在 AI 要求中寫出角色名稱。'
      return
    }
    pickedTargetName = targetName
    stagePickHint.textContent = `已選取：${targetName}。下一次送出 AI 要求時會附上「我指的是：${targetName}」。`
  }

  const previewColumn = document.createElement('div')

  previewColumn.className = 'student-preview-main'

  previewColumn.append(stageFrame)

  const authorInstructions = options.readerOptions?.authorInstructions?.trim()
  const notesAndCredits = options.readerOptions?.notesAndCredits?.trim()
  if (authorInstructions || notesAndCredits) {
    const authorDetails = document.createElement('details')
    authorDetails.className = 'student-author-notes'
    const authorSummary = document.createElement('summary')
    authorSummary.textContent = 'Scratch 作者說明'
    authorDetails.append(authorSummary)
    if (authorInstructions) {
      const instructions = document.createElement('p')
      instructions.textContent = `操作說明：${authorInstructions}`
      authorDetails.append(instructions)
    }
    if (notesAndCredits) {
      const notes = document.createElement('p')
      notes.textContent = `備註：${notesAndCredits}`
      authorDetails.append(notes)
    }
    previewColumn.append(authorDetails)
  }

  // AI editing and progress sit beside the stage, where the student is looking while playing.
  const sideColumn = document.createElement('div')

  sideColumn.className = 'student-preview-side'

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

  startAnimation.textContent = '🟢 綠旗：開始執行作品'

  const stopAnimation = document.createElement('button')

  stopAnimation.type = 'button'

  stopAnimation.className = 'button secondary'

  stopAnimation.textContent = '🔴 停止預覽'

  stopAnimation.hidden = true

  const playtestButton = document.createElement('button')

  playtestButton.type = 'button'

  playtestButton.className = 'button secondary'

  playtestButton.textContent = '🔎 重新自動試玩'

  playtestButton.disabled = true

  const playtestStatus = document.createElement('p')

  playtestStatus.className = 'student-preview-playtest-status'

  playtestStatus.setAttribute('role', 'status')

  playtestStatus.setAttribute('aria-live', 'polite')

  playtestStatus.textContent = '作品執行後會自動檢查按鍵與遊戲進度。'

  const visualDownloadActions = document.createElement('div')
  visualDownloadActions.className = 'button-row student-preview-visual-actions'
  const downloadStageImage = document.createElement('button')
  downloadStageImage.type = 'button'
  downloadStageImage.className = 'button secondary'
  downloadStageImage.textContent = '下載舞台截圖'
  downloadStageImage.addEventListener('click', () => {
    studentStageCanvas.toBlob((blob) => {
      if (blob) download(blob, `${project.name || 'scratch-project'}-舞台.png`)
    }, 'image/png')
  })
  const downloadCostumeCollage = document.createElement('button')
  downloadCostumeCollage.type = 'button'
  downloadCostumeCollage.className = 'button secondary'
  downloadCostumeCollage.textContent = '下載造型一覽圖'
  downloadCostumeCollage.addEventListener('click', () => {
    void createCostumeCollageDataUrl(project).then((dataUrl) => {
      if (!dataUrl) return
      const comma = dataUrl.indexOf(',')
      if (comma < 0) return
      const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (character) => character.charCodeAt(0))
      download(new Blob([bytes], { type: 'image/png' }), `${project.name || 'scratch-project'}-造型一覽.png`)
    })
  })
  visualDownloadActions.append(downloadStageImage, downloadCostumeCollage)
  previewActions.append(startAnimation, stopAnimation, playtestButton, playtestStatus, visualDownloadActions)

  previewColumn.append(previewActions)

  let liveProject = structuredClone(project)
  const setLiveProject = (val: CanonicalProject): void => {
    liveProject = val
  }
  let patchedPreviewArchive: Blob | null = null
  const setPatchedPreviewArchive = (val: Blob | null): void => {
    patchedPreviewArchive = val
  }
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
  studentPreviewHasEdits = () => liveUndoStack.length > 0
  const pendingLivePatches = new Map<
    string,
    { readonly resolve: (message: Record<string, unknown>) => void; readonly timer: number }
  >()
  const aiPanel = document.createElement('section')
  aiPanel.className = 'ai-edit-panel'
  const aiPanelTitle = document.createElement('h3')
  aiPanelTitle.textContent = '用 AI 修改這個作品'
  const aiPanelIntro = document.createElement('p')
  aiPanelIntro.className = 'ai-note'
  aiPanelIntro.textContent =
    '先按綠旗讓作品跑起來，再說想怎麼改。AI 只會提出修改，你看過、按「套用」才會改；最多可以復原 20 次。'
  const livePatchPanel = document.createElement('details')
  livePatchPanel.className = 'ai-subsection'
  livePatchPanel.id = 'live-patch-panel'
  const livePatchSummary = document.createElement('summary')
  livePatchSummary.textContent = '沒有本機 AI？用 Gemini／ChatGPT 複製貼上'
  const livePatchHelp = document.createElement('p')
  livePatchHelp.textContent =
    '按「複製修改指令」，貼給 AI 並寫上想怎麼改，再把它回覆的 JSON 貼到下面，按「檢查修改」。遊戲執行中改角色位置，可能會被遊戲自己的程式再改回去。'
  const livePatchPromptButton = document.createElement('button')
  livePatchPromptButton.type = 'button'
  livePatchPromptButton.className = 'button secondary'
  livePatchPromptButton.textContent = '複製修改指令'
  const livePatchInputLabel = document.createElement('label')
  livePatchInputLabel.htmlFor = 'live-patch-editor'
  livePatchInputLabel.textContent = 'AI 回覆的 JSON'
  const livePatchInput = document.createElement('textarea')
  livePatchInput.id = 'live-patch-editor'
  livePatchInput.className = 'mono editor live-patch-editor'
  livePatchInput.setAttribute('aria-label', 'AI 回傳的即時修改 patch JSON')
  livePatchInput.placeholder = '把 AI 的回覆貼在這裡'
  // The AI editing area: a one-time connection setup that folds into one line, then what to change.
  const localAiSettings = document.createElement('div')
  localAiSettings.className = 'ai-edit'
  const aiConnection = document.createElement('details')
  aiConnection.className = 'ai-connection'
  const aiConnectionSummary = document.createElement('summary')
  const gatewaySettings = document.createElement('details')
  gatewaySettings.className = 'ai-subsection'
  const gatewaySummary = document.createElement('summary')
  gatewaySummary.textContent = '模型在另一台電腦（區網）'
  const gatewayHelp = document.createElement('p')
  gatewayHelp.textContent =
    '先在這台電腦啟動 model gateway，指向那台電腦，再按「配對」。用 HTTP 時，作品內容和 API key 會以明文在區網傳送。'
  const gatewayLabel = document.createElement('label')
  gatewayLabel.htmlFor = 'local-ai-gateway'
  gatewayLabel.textContent = 'gateway 網址'
  const gatewayUrl = document.createElement('input')
  gatewayUrl.id = 'local-ai-gateway'
  gatewayUrl.type = 'url'
  gatewayUrl.value = 'http://127.0.0.1:43129'
  const gatewayConnect = document.createElement('button')
  gatewayConnect.type = 'button'
  gatewayConnect.className = 'button secondary'
  gatewayConnect.textContent = '配對'
  const gatewayDisconnect = document.createElement('button')
  gatewayDisconnect.type = 'button'
  gatewayDisconnect.className = 'button secondary'
  gatewayDisconnect.textContent = '中斷配對'
  gatewayDisconnect.hidden = true
  const gatewayStatus = document.createElement('p')
  gatewayStatus.setAttribute('role', 'status')
  gatewayStatus.className = 'inline-status'
  gatewayStatus.textContent = '尚未配對。'
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
  localAiBaseUrlLabel.textContent = '服務位址'
  const localAiBaseUrl = document.createElement('input')
  localAiBaseUrl.id = 'local-ai-base-url'
  localAiBaseUrl.type = 'url'
  localAiBaseUrl.autocomplete = 'off'
  localAiBaseUrl.placeholder = 'http://127.0.0.1:8000/v1'
  const localAiModelLabel = document.createElement('label')
  localAiModelLabel.htmlFor = 'local-ai-model'
  localAiModelLabel.textContent = '模型'
  const localAiModel = document.createElement('input')
  localAiModel.id = 'local-ai-model'
  localAiModel.autocomplete = 'off'
  localAiModel.placeholder = '按「測試連線」後從清單選，或直接輸入'
  const localAiModelList = document.createElement('datalist')
  localAiModelList.id = 'local-ai-models'
  localAiModel.setAttribute('list', localAiModelList.id)
  const localAiKeyLabel = document.createElement('label')
  localAiKeyLabel.htmlFor = 'local-ai-key'
  localAiKeyLabel.textContent = 'API key（服務要求才填）'
  const localAiKey = document.createElement('input')
  localAiKey.id = 'local-ai-key'
  localAiKey.type = 'password'
  localAiKey.autocomplete = 'off'
  localAiKey.placeholder = '沒有就留空'
  const localAiRequestLabel = document.createElement('label')
  localAiRequestLabel.htmlFor = 'local-ai-request'
  localAiRequestLabel.textContent = '想怎麼改？'
  const localAiRequest = document.createElement('textarea')
  localAiRequest.id = 'local-ai-request'
  localAiRequest.className = 'ai-request'
  localAiRequest.placeholder = '例如：讓主角跳高一點，一開始多給 2 條命。'
  localAiRequest.rows = 3
  const visionLabel = document.createElement('label')
  visionLabel.className = 'ai-remember'
  const visionCheckbox = document.createElement('input')
  visionCheckbox.type = 'checkbox'
  visionLabel.append(visionCheckbox, ' 這個模型看得懂圖片（送出舞台截圖和造型一覽圖）')
  const localAiActions = document.createElement('div')
  localAiActions.className = 'button-row'
  const localAiGenerateButton = document.createElement('button')
  localAiGenerateButton.type = 'button'
  localAiGenerateButton.className = 'button primary'
  localAiGenerateButton.textContent = '請 AI 提出修改'
  localAiGenerateButton.disabled = Boolean(rawSource)
  const localAiCancelButton = document.createElement('button')
  localAiCancelButton.type = 'button'
  localAiCancelButton.className = 'button secondary'
  localAiCancelButton.textContent = '取消請求'
  localAiCancelButton.hidden = true
  localAiActions.append(localAiGenerateButton, localAiCancelButton)
  const localAiStatus = document.createElement('p')
  localAiStatus.className = 'inline-status'
  localAiStatus.setAttribute('role', 'status')
  localAiStatus.setAttribute('aria-live', 'polite')
  // Shown right under the button: the panel's own status sits below other controls, out of view while waiting.
  const watchLocalAi = (): ((message: string, kind: 'pending' | 'error') => void) => {
    const started = Date.now()
    const show = (): void => {
      localAiStatus.dataset.kind = 'pending'
      localAiStatus.textContent = `AI 正在讀作品、想修改…已等 ${Math.round((Date.now() - started) / 1000)} 秒（最多 120 秒，可按「取消請求」）`
    }
    show()
    const timer = window.setInterval(show, 1000)
    return (message, kind) => {
      window.clearInterval(timer)
      localAiStatus.dataset.kind = kind
      localAiStatus.textContent = message
    }
  }
  const field = (label: HTMLLabelElement, ...controls: HTMLElement[]): HTMLDivElement => {
    const row = document.createElement('div')
    row.className = 'ai-field'
    const controlBox = document.createElement('div')
    controlBox.className = 'ai-field-controls'
    controlBox.append(...controls)
    row.append(label, controlBox)
    return row
  }
  const smallButton = (text: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button secondary small'
    button.textContent = text
    return button
  }
  const presets = document.createElement('div')
  presets.className = 'ai-chips'
  const presetLabel = document.createElement('span')
  presetLabel.textContent = '常用：'
  presets.append(presetLabel)
  for (const [name, url] of [
    ['oMLX', 'http://127.0.0.1:8000/v1'],
    ['LM Studio', 'http://127.0.0.1:1234/v1'],
    ['Ollama', 'http://127.0.0.1:11434/v1'],
  ] as const) {
    const chip = smallButton(name)
    chip.title = url
    chip.addEventListener('click', () => {
      localAiBaseUrl.value = url
      localAiBaseUrl.dispatchEvent(new Event('input', { bubbles: true }))
    })
    presets.append(chip)
  }
  const showKey = smallButton('顯示')
  showKey.addEventListener('click', () => {
    const hidden = localAiKey.type === 'password'
    localAiKey.type = hidden ? 'text' : 'password'
    showKey.textContent = hidden ? '隱藏' : '顯示'
  })
  const testConnection = document.createElement('button')
  testConnection.type = 'button'
  testConnection.className = 'button secondary'
  testConnection.textContent = '測試連線'
  const connectionStatus = document.createElement('p')
  connectionStatus.className = 'inline-status'
  connectionStatus.setAttribute('role', 'status')
  connectionStatus.textContent = '填好位址（和 API key）後按「測試連線」，會檢查能不能連上，並列出可用的模型。'
  const rememberLabel = document.createElement('label')
  rememberLabel.className = 'ai-remember'
  const remember = document.createElement('input')
  remember.type = 'checkbox'
  remember.id = 'local-ai-remember'
  rememberLabel.append(remember, ' 記住服務位址和模型')
  const rememberKeyLabel = document.createElement('label')
  rememberKeyLabel.className = 'ai-remember'
  const rememberKey = document.createElement('input')
  rememberKey.type = 'checkbox'
  rememberKey.id = 'local-ai-remember-key'
  rememberKey.disabled = true
  rememberKeyLabel.append(rememberKey, ' 也記住 API key')
  const forget = smallButton('清除記住的設定')
  const rememberRow = document.createElement('div')
  rememberRow.className = 'ai-remember-row'
  rememberRow.append(rememberLabel, forget)
  const rememberNote = document.createElement('p')
  rememberNote.className = 'ai-note'
  rememberNote.textContent = `不勾選時，關掉或重新整理頁面就會忘記。${apiKeyStorageWarning(location.hostname)}`
  gatewaySettings.append(
    gatewaySummary,
    gatewayHelp,
    field(gatewayLabel, gatewayUrl, gatewayConnect, gatewayDisconnect),
    gatewayStatus,
  )
  aiConnection.append(
    aiConnectionSummary,
    field(localAiBaseUrlLabel, localAiBaseUrl),
    presets,
    field(localAiKeyLabel, localAiKey, showKey),
    field(localAiModelLabel, localAiModel, localAiModelList),
    testConnection,
    connectionStatus,
    rememberRow,
    rememberKeyLabel,
    rememberNote,
    gatewaySettings,
  )
  const examples = document.createElement('div')
  examples.className = 'ai-chips'
  const examplesLabel = document.createElement('span')
  examplesLabel.textContent = '例如：'
  examples.append(examplesLabel)
  for (const example of ['主角跳高一點', '一開始多 2 條命', '時間多 30 秒', '移動快一點']) {
    const chip = smallButton(example)
    chip.addEventListener('click', () => {
      localAiRequest.value = localAiRequest.value.trim() ? `${localAiRequest.value.trim()}，${example}` : example
      localAiRequest.focus()
    })
    examples.append(chip)
  }
  const requestBlock = document.createElement('div')
  requestBlock.className = 'ai-request-block'
  requestBlock.append(localAiRequestLabel, localAiRequest, visionLabel, examples, localAiActions, localAiStatus)
  localAiSettings.append(aiConnection, requestBlock)

  const browserStorage = ((): Storage | undefined => {
    try {
      return window.localStorage
    } catch {
      return undefined
    }
  })()
  let connectionTested = false
  const connectionValues = () => ({
    baseUrl: localAiBaseUrl.value.trim(),
    model: localAiModel.value.trim(),
    apiKey: localAiKey.value,
  })
  const describeConnection = (): void => {
    const { baseUrl, model } = connectionValues()
    let host = baseUrl
    try {
      host = new URL(baseUrl).host
    } catch {
      // Shown as typed until it is a valid address.
    }
    aiConnectionSummary.dataset.state = baseUrl && model ? (connectionTested ? 'ok' : 'set') : 'none'
    aiConnectionSummary.textContent =
      baseUrl && model
        ? `${connectionTested ? '已連線' : '已設定'}：${model}（${host}）`
        : '還沒設定 AI 連線，按這裡設定'
  }
  const rememberIfAsked = (): void => {
    if (
      remember.checked &&
      !saveAiConnection(browserStorage, {
        ...connectionValues(),
        apiKey: rememberKey.checked ? localAiKey.value : '',
      })
    )
      connectionStatus.textContent = '這個瀏覽器不允許存資料，設定只會保留到關閉頁面。'
  }
  const remembered = loadAiConnection(browserStorage)
  if (remembered) {
    localAiBaseUrl.value = remembered.baseUrl
    localAiModel.value = remembered.model
    localAiKey.value = remembered.apiKey
    remember.checked = true
    rememberKey.disabled = false
    rememberKey.checked = remembered.apiKey !== ''
  }
  for (const input of [localAiBaseUrl, localAiModel, localAiKey])
    input.addEventListener('input', () => {
      connectionTested = false
      describeConnection()
      rememberIfAsked()
    })
  remember.addEventListener('change', () => {
    rememberKey.disabled = !remember.checked
    if (!remember.checked) rememberKey.checked = false
    if (remember.checked) rememberIfAsked()
    else clearAiConnection(browserStorage)
    connectionStatus.textContent = remember.checked
      ? '已記住服務位址和模型；API key 沒有記。'
      : '已不再記住；關掉頁面就會忘記。'
  })
  rememberKey.addEventListener('change', () => {
    rememberIfAsked()
    connectionStatus.textContent = rememberKey.checked ? '已連 API key 一起記住。' : '已刪掉記住的 API key。'
  })
  forget.addEventListener('click', () => {
    clearAiConnection(browserStorage)
    remember.checked = false
    rememberKey.checked = false
    rememberKey.disabled = true
    localAiBaseUrl.value = ''
    localAiModel.value = ''
    localAiKey.value = ''
    localAiModelList.replaceChildren()
    connectionTested = false
    describeConnection()
    aiConnection.open = true
    connectionStatus.textContent = '已清除這台電腦記住的設定，畫面上的欄位也清空了。'
  })
  testConnection.addEventListener('click', () => {
    void (async () => {
      testConnection.disabled = true
      connectionStatus.dataset.kind = 'pending'
      connectionStatus.textContent = '正在連線…'
      try {
        const models = await listOpenAiCompatibleModels({
          baseUrl: localAiBaseUrl.value,
          apiKey: localAiKey.value,
          ...(gatewayToken ? { fetchImpl: gatewayFetch } : {}),
        })
        localAiModelList.replaceChildren(
          ...models.map((id) => Object.assign(document.createElement('option'), { value: id })),
        )
        if (models.length > 0 && !models.includes(localAiModel.value.trim())) localAiModel.value = models[0] ?? ''
        connectionTested = true
        connectionStatus.dataset.kind = 'ok'
        connectionStatus.textContent =
          models.length > 0
            ? `連上了，找到 ${models.length} 個模型${models.length > 1 ? '，可以在「模型」欄換一個' : ''}。`
            : '連上了，但服務沒有列出模型；請自己輸入模型名稱。'
        describeConnection()
        rememberIfAsked()
      } catch (error) {
        connectionTested = false
        connectionStatus.dataset.kind = 'error'
        connectionStatus.textContent = error instanceof Error ? error.message : String(error)
        describeConnection()
      } finally {
        testConnection.disabled = false
      }
    })()
  })
  describeConnection()
  aiConnection.open = aiConnectionSummary.dataset.state === 'none'
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
        localAiBaseUrl.dispatchEvent(new Event('input', { bubbles: true }))
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
  mcpSettings.className = 'ai-subsection'
  const mcpSettingsSummary = document.createElement('summary')
  mcpSettingsSummary.textContent = '讓 Claude／Codex 直接修改（MCP）'
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
    revision: () => string
    readScript: (args: unknown) => unknown
    find: (args: unknown) => unknown
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
  applyPatchButton.textContent = '套用修改'
  applyPatchButton.disabled = true
  const undoPatchButton = document.createElement('button')
  undoPatchButton.type = 'button'
  undoPatchButton.className = 'button secondary'
  undoPatchButton.textContent = '復原'
  undoPatchButton.disabled = true
  const redoPatchButton = document.createElement('button')
  redoPatchButton.type = 'button'
  redoPatchButton.className = 'button secondary'
  redoPatchButton.textContent = '重做'
  redoPatchButton.disabled = true
  livePatchActions.append(previewPatchButton, applyPatchButton, undoPatchButton, redoPatchButton)
  const livePatchStatus = document.createElement('p')
  livePatchStatus.className = 'inline-status'
  livePatchStatus.id = 'live-patch-status'
  livePatchStatus.setAttribute('role', 'status')
  livePatchStatus.setAttribute('aria-live', 'polite')
  const canPatchLiveProject = !rawSource
  if (rawSource) {
    livePatchStatus.textContent =
      '為保留匯入作品的原始積木與素材，這裡不直接編輯積木；可用 MCP 讀取讀本並提出待審修改。'
    livePatchPromptButton.disabled = true
    localAiSettings.hidden = true
  } else {
    livePatchStatus.textContent = '作品執行後可以修改變數、角色和舞台；積木和雲端變數不能在這裡改。'
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
  const setPreparedLivePatch = (val: ReturnType<typeof parseLiveVariablePatch> | null): void => {
    preparedLivePatch = val
  }
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
  const handleMcpToolRequest = async (request: unknown): Promise<unknown> => {
    if (typeof request !== 'object' || request === null || Array.isArray(request))
      throw new Error('MCP relay 傳來無效的工具要求。')
    const { tool, arguments: args } = request as { tool?: unknown; arguments?: unknown }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('MCP 工具參數格式錯誤。')
    if (
      tool === 'ask_student' &&
      typeof (args as { question?: unknown }).question === 'string' &&
      Array.isArray((args as { choices?: unknown }).choices)
    ) {
      const choices = (args as { choices: unknown[] }).choices.filter(
        (choice): choice is string => typeof choice === 'string',
      )
      return { answer: await askStudent((args as { question: string }).question, choices) }
    }
    if (rawAi) {
      if (tool === 'inspect_project')
        return {
          projectName: liveProject.name,
          baseRevision: rawAi.revision(),
          instruction: rawAi.inspect(),
        }
      if (tool === 'read_script') return rawAi.readScript(args)
      if (tool === 'find') return rawAi.find(args)
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
            result = await handleMcpToolRequest(request)
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
  const askStudent = async (question: string, choices: readonly string[]): Promise<string | null> => {
    const dialog = document.createElement('dialog')
    dialog.className = 'ai-question-dialog'
    const heading = document.createElement('h3')
    heading.textContent = 'AI 想確認一件事'
    const prompt = document.createElement('p')
    prompt.textContent = question
    const actions = document.createElement('div')
    actions.className = 'button-row'
    const safeChoices = [...new Set(choices)].filter((choice) => choice.trim()).slice(0, 8)
    const fallbackChoices =
      safeChoices.length > 0 ? safeChoices : project.sprites.map((sprite) => sprite.name).slice(0, 8)
    let settled = false
    return new Promise((resolve) => {
      const finish = (answer: string | null): void => {
        if (settled) return
        settled = true
        dialog.close()
        dialog.remove()
        if (answer && project.sprites.some((sprite) => sprite.name === answer)) {
          pickedTargetName = answer
          stagePickHint.textContent = `已選取：${answer}。下一次送出 AI 要求時會附上「我指的是：${answer}」。`
        }
        resolve(answer)
      }
      for (const choice of fallbackChoices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'button secondary'
        button.textContent = choice
        button.addEventListener('click', () => finish(choice))
        actions.append(button)
      }
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'button secondary'
      cancel.textContent = '取消這次修改'
      cancel.addEventListener('click', () => finish(null))
      actions.append(cancel)
      dialog.addEventListener('cancel', () => finish(null), { once: true })
      dialog.append(heading, prompt, actions)
      document.body.append(dialog)
      dialog.showModal()
    })
  }

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
        const finish = watchLocalAi()
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
            onToolCall: async (name, argumentsJson) => {
              try {
                if (name === 'inspect_project') return { output: adapter.inspect() }
                const args: unknown = JSON.parse(argumentsJson)
                if (
                  name === 'ask_student' &&
                  typeof args === 'object' &&
                  args !== null &&
                  typeof (args as { question?: unknown }).question === 'string' &&
                  Array.isArray((args as { choices?: unknown }).choices)
                ) {
                  const choices = (args as { choices: unknown[] }).choices.filter(
                    (choice): choice is string => typeof choice === 'string',
                  )
                  const answer = await askStudent((args as { question: string }).question, choices)
                  return { output: JSON.stringify({ answer }) }
                }
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
          finish('AI 已提出修改，差異列在下方；請檢查後按「確認套用 AI 修改」。', 'pending')
        } catch (error) {
          const message =
            error instanceof Error && error.name === 'AbortError'
              ? '本機模型請求已取消或逾時。'
              : error instanceof Error
                ? error.message
                : String(error)
          adapter.report(message)
          finish(message, 'error')
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
      const finish = watchLocalAi()
      try {
        const imageDataUrls: string[] = []
        if (visionCheckbox.checked) {
          try {
            const stageImage = studentStageCanvas.toDataURL('image/png')
            if (stageImage.length <= 2_000_000) imageDataUrls.push(stageImage)
            const collage = await createCostumeCollageDataUrl(liveProject)
            if (collage) imageDataUrls.push(collage)
          } catch {
            // Vision is optional; a browser canvas failure must not block a text-only patch request.
          }
        }
        const response = await requestOpenAiCompatiblePatch({
          baseUrl: localAiBaseUrl.value,
          model: localAiModel.value,
          apiKey: localAiKey.value,
          instruction: inspectProjectForAi(liveProject, liveRevision),
          request: `${pickedTargetName ? `我指的是角色「${pickedTargetName}」。` : ''}${localAiRequest.value}`,
          ...(imageDataUrls.length > 0 ? { imageDataUrl: imageDataUrls } : {}),
          signal: controller.signal,
          ...(gatewayToken ? { fetchImpl: gatewayFetch } : {}),
          onToolCall: async (name, argumentsJson) => {
            try {
              const args: unknown = JSON.parse(argumentsJson)
              if (name === 'inspect_project') {
                return { output: inspectProjectForAi(liveProject, liveRevision) }
              }
              if (
                name === 'ask_student' &&
                typeof args === 'object' &&
                args !== null &&
                typeof (args as { question?: unknown }).question === 'string' &&
                Array.isArray((args as { choices?: unknown }).choices)
              ) {
                const choices = (args as { choices: unknown[] }).choices.filter(
                  (choice): choice is string => typeof choice === 'string',
                )
                const answer = await askStudent((args as { question: string }).question, choices)
                return { output: JSON.stringify({ answer }) }
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
        finish('AI 已提出修改，差異列在下方；請檢查後確認套用。', 'pending')
      } catch (error) {
        livePatchStatus.dataset.kind = 'error'
        livePatchStatus.textContent =
          error instanceof Error && error.name === 'AbortError'
            ? '本機模型請求已取消或逾時。'
            : error instanceof Error
              ? error.message
              : String(error)
        finish(livePatchStatus.textContent, 'error')
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
    cancelActiveStudentPlaytest?.()
    cancelActiveStudentPlaytest = null
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
    aiPanel.hidden = true
    const panel = document.createElement('section')
    panel.className = 'ai-edit-panel'
    const title = document.createElement('h3')
    title.textContent = '用 AI 修改這個作品'
    const help = document.createElement('p')
    help.className = 'ai-note'
    help.textContent =
      'AI 會讀這個作品，提出修改；你看過、按「套用」才會改，遊戲會重新開始。原本的檔案不會變，改好按「下載修改後的 SB3」另存一份。'
    const manual = document.createElement('details')
    manual.className = 'ai-subsection'
    const manualSummary = document.createElement('summary')
    manualSummary.textContent = '不用 AI，自己改數值'
    const targetLabel = document.createElement('label')
    targetLabel.textContent = '要改誰'
    const targetSelect = document.createElement('select')
    targetLabel.append(targetSelect)
    const propertyLabel = document.createElement('label')
    propertyLabel.textContent = '要改什麼'
    const propertySelect = document.createElement('select')
    propertyLabel.append(propertySelect)
    const showAllLabel = document.createElement('label')
    showAllLabel.className = 'ai-remember'
    const showAll = document.createElement('input')
    showAll.type = 'checkbox'
    showAllLabel.append(showAll, ' 也列出程式內部用的角色和變數')
    // What the value is, whether the game sets it again, and the AI's explanation.
    const valueGuide = document.createElement('div')
    valueGuide.className = 'value-guide'
    const valueHint = document.createElement('p')
    const valueReset = document.createElement('p')
    valueReset.className = 'value-reset'
    const valueExplanation = document.createElement('p')
    valueExplanation.className = 'value-explanation'
    valueExplanation.setAttribute('aria-live', 'polite')
    const explainActions = document.createElement('div')
    explainActions.className = 'ai-chips'
    const explainButton = document.createElement('button')
    explainButton.type = 'button'
    explainButton.className = 'button secondary small'
    explainButton.textContent = '請 AI 說明這是什麼'
    const copyQuestion = document.createElement('button')
    copyQuestion.type = 'button'
    copyQuestion.className = 'button secondary small'
    copyQuestion.textContent = '複製問題（貼給 Gemini 問）'
    explainActions.append(explainButton, copyQuestion)
    valueGuide.append(valueHint, valueReset, valueExplanation, explainActions)
    const valueLabel = document.createElement('label')
    valueLabel.textContent = '新的值'
    const valueInput = document.createElement('input')
    valueInput.type = 'text'
    const valueChoice = document.createElement('select')
    valueChoice.hidden = true
    valueChoice.addEventListener('change', () => {
      valueInput.value = valueChoice.value
    })
    valueLabel.append(valueInput, valueChoice)
    const explanations = new Map<string, string>()
    const status = document.createElement('p')
    status.className = 'inline-status'
    status.setAttribute('role', 'status')
    const candidateActions = document.createElement('div')
    candidateActions.className = 'button-row'
    const historyActions = document.createElement('div')
    historyActions.className = 'button-row'
    const manualActions = document.createElement('div')
    manualActions.className = 'button-row'
    const makeButton = (label: string, row: HTMLDivElement, kind = 'secondary'): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `button ${kind}`
      button.textContent = label
      row.append(button)
      return button
    }
    const apply = makeButton('套用屬性', manualActions)
    const undo = makeButton('復原', historyActions)
    const redo = makeButton('重做', historyActions)
    const save = makeButton('下載修改後的 SB3', historyActions)
    const acceptCandidate = makeButton('確認套用 AI 修改', candidateActions, 'primary')
    const discardCandidate = makeButton('不要這個修改', candidateActions)
    acceptCandidate.hidden = true
    discardCandidate.hidden = true
    const candidateDiff = document.createElement('pre')
    candidateDiff.className = 'live-patch-diff'
    candidateDiff.hidden = true
    let currentRaw = rawSource
    let downloadedRaw = rawSource
    studentPreviewHasEdits = () => currentRaw !== downloadedRaw
    const setCurrentRaw = (val: RawSb3Project): void => {
      currentRaw = val
    }
    let rawCandidate: ReturnType<typeof proposeRawLivePatch> | null = null
    const setRawCandidate = (val: ReturnType<typeof proposeRawLivePatch> | null): void => {
      rawCandidate = val
    }
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
    const shownValue = (item: ValueItem): string =>
      item.kind === 'costume'
        ? (item.options?.[Number(item.value)] ?? String(item.value))
        : item.key === 'visible'
          ? item.value
            ? '顯示'
            : '隱藏'
          : String(item.value)
    const explanationPrompt = (item: ValueItem): string =>
      createValueExplanationPrompt(
        item,
        targetSelect.selectedOptions.item(0)?.textContent ?? targetSelect.value,
        usageLines(currentRaw.projectJson, targetSelect.value, item.key),
        resetNote(currentRaw.projectJson, targetSelect.value, item.key),
      )
    let guidedItem: ValueItem | undefined
    const showValueGuide = (item: ValueItem | undefined): void => {
      guidedItem = item
      valueGuide.hidden = !item
      if (!item) return
      valueHint.textContent = item.hint ?? ''
      valueReset.textContent = resetNote(currentRaw.projectJson, targetSelect.value, item.key) ?? ''
      valueExplanation.textContent = explanations.get(`${targetSelect.value}|${item.key}`) ?? ''
      const choices: [string, string][] =
        item.kind === 'costume'
          ? (item.options ?? []).map((name, index) => [String(index), name])
          : item.kind === 'boolean'
            ? [
                ['true', item.key === 'visible' ? '顯示' : '是（true）'],
                ['false', item.key === 'visible' ? '隱藏' : '否（false）'],
              ]
            : []
      valueChoice.hidden = choices.length === 0
      valueInput.hidden = choices.length > 0
      valueInput.inputMode = item.kind === 'text' ? 'text' : 'decimal'
      valueChoice.replaceChildren(
        ...choices.map(([value, label]) =>
          Object.assign(document.createElement('option'), { value, textContent: label }),
        ),
      )
      if (choices.length > 0) valueChoice.value = valueInput.value
    }
    showAll.addEventListener('change', () => refresh())
    explainButton.addEventListener('click', () => {
      const item = guidedItem
      if (!item) return
      const cacheKey = `${targetSelect.value}|${item.key}`
      void (async () => {
        explainButton.disabled = true
        valueExplanation.textContent = 'AI 正在看用到它的程式…'
        try {
          const text = await requestOpenAiCompatibleText({
            baseUrl: localAiBaseUrl.value,
            model: localAiModel.value,
            apiKey: localAiKey.value,
            prompt: explanationPrompt(item),
            ...(gatewayToken ? { fetchImpl: gatewayFetch } : {}),
          })
          explanations.set(cacheKey, `AI 說明：${text}`)
          if (guidedItem === item) valueExplanation.textContent = `AI 說明：${text}`
        } catch (error) {
          if (guidedItem === item)
            valueExplanation.textContent = `${error instanceof Error ? error.message : String(error)}（也可以按「複製問題」貼給 Gemini 問。）`
        } finally {
          explainButton.disabled = false
        }
      })()
    })
    copyQuestion.addEventListener('click', () => {
      if (!guidedItem) return
      void navigator.clipboard.writeText(explanationPrompt(guidedItem)).then(
        () => {
          valueExplanation.textContent = '已複製問題，貼到 Gemini 或 ChatGPT 就能問。'
        },
        () => {
          valueExplanation.textContent = '瀏覽器不允許複製；請改用「請 AI 說明」。'
        },
      )
    })
    const refresh = (): void => {
      const targets = getTargets()
      const chosen = targetSelect.value
      targetSelect.replaceChildren()
      for (const target of targets) {
        if (typeof target.name !== 'string' || targets.filter((item) => item.name === target.name).length !== 1)
          continue
        if (!showAll.checked && target.isStage !== true && isInternalTarget(target.name)) continue
        const option = document.createElement('option')
        option.value = target.name
        option.textContent = target.isStage === true ? '舞台（背景、全部角色共用的變數）' : target.name
        targetSelect.append(option)
      }
      if (Array.from(targetSelect.options).some((option) => option.value === chosen)) targetSelect.value = chosen
      const target = targets.find((item) => item.name === targetSelect.value)
      const previousProperty = propertySelect.value
      propertySelect.replaceChildren()
      const items = target ? valueItems(currentRaw.projectJson, targetSelect.value) : []
      for (const item of items) {
        if (item.internal && !showAll.checked) continue
        const option = document.createElement('option')
        option.value = item.key
        option.textContent = `${item.label}（目前 ${shownValue(item)}）`
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
      showValueGuide(items.find((item) => item.key === selected))
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
        valueChoice,
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
            setPatchedPreviewArchive(nextArchive)
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
            setPatchedPreviewArchive(previousArchive)
            throw new Error('預覽重載及回復失敗，請重新執行作品；原始作品仍可下載。')
          }
          throw error
        }
      } else {
        setPatchedPreviewArchive(nextArchive)
      }
      if (generation !== studentPreviewGeneration) throw new Error('預覽已切換，修改結果已捨棄。')
      setCurrentRaw(next)
      currentRawForProgress = next
      return inverse
    }
    rawAi = {
      inspect: () => inspectRawProjectForAi(currentRaw, currentReaderOptions),
      revision: () => rawSb3Revision(currentRaw),
      readScript: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('程式查詢格式無效。')
        const item = args as { baseRevision?: unknown; scriptId?: unknown }
        if (typeof item.baseRevision !== 'string' || typeof item.scriptId !== 'string' || item.scriptId.length > 256)
          throw new Error('程式查詢欄位無效。')
        const currentRevision = rawSb3Revision(currentRaw)
        if (item.baseRevision !== currentRevision)
          throw new Error(`SB3 revision has changed (expected ${currentRevision})`)
        const reader = readProjectForAi(currentRaw.projectJson, { entries: currentRaw.entries }, currentReaderOptions)
        const section = reader.sections.find((candidate) => candidate.id === `script:${String(item.scriptId)}`)
        return { baseRevision: currentRevision, scriptId: item.scriptId, text: section?.text ?? null }
      },
      find: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('讀本搜尋格式無效。')
        const item = args as { baseRevision?: unknown; query?: unknown }
        if (
          typeof item.baseRevision !== 'string' ||
          typeof item.query !== 'string' ||
          !item.query.trim() ||
          item.query.length > 256
        )
          throw new Error('讀本搜尋欄位無效。')
        const currentRevision = rawSb3Revision(currentRaw)
        if (item.baseRevision !== currentRevision)
          throw new Error(`SB3 revision has changed (expected ${currentRevision})`)
        const reader = readProjectForAi(currentRaw.projectJson, { entries: currentRaw.entries }, currentReaderOptions)
        const query = item.query.toLocaleLowerCase('zh-TW')
        const matches = reader.sections
          .flatMap((section) => section.text.split('\n').map((line) => ({ section: section.id, line })))
          .filter(({ line }) => line.toLocaleLowerCase('zh-TW').includes(query))
          .slice(0, 100)
        return { baseRevision: currentRevision, query: item.query, matches }
      },
      inspectTargets: (args) => {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('角色查詢格式無效。')
        const item = args as { baseRevision?: unknown; offset?: unknown; limit?: unknown; query?: unknown }
        if (
          typeof item.baseRevision !== 'string' ||
          (item.offset !== undefined && typeof item.offset !== 'number') ||
          (item.limit !== undefined && typeof item.limit !== 'number') ||
          (item.query !== undefined && typeof item.query !== 'string')
        )
          throw new Error('角色查詢欄位無效。')
        return inspectRawTargets(currentRaw, item.baseRevision, item.offset, item.limit, { query: item.query })
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
        const item = args as {
          baseRevision?: unknown
          targetIndex?: unknown
          offset?: unknown
          limit?: unknown
          blockId?: unknown
          opcode?: unknown
          query?: unknown
        }
        if (
          typeof item.baseRevision !== 'string' ||
          typeof item.targetIndex !== 'number' ||
          (item.offset !== undefined && typeof item.offset !== 'number') ||
          (item.limit !== undefined && typeof item.limit !== 'number') ||
          (item.blockId !== undefined && typeof item.blockId !== 'string') ||
          (item.opcode !== undefined && typeof item.opcode !== 'string') ||
          (item.query !== undefined && typeof item.query !== 'string')
        )
          throw new Error('積木查詢欄位無效。')
        return inspectRawBlocks(currentRaw, item.baseRevision, item.targetIndex, item.offset, item.limit, {
          blockId: item.blockId,
          opcode: item.opcode,
          query: item.query,
        })
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
          ...candidate.warnings,
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
          setRawCandidate(null)
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
          const fieldLabel = guidedItem?.label ?? selection
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
      const saving = currentRaw
      void exportLosslessSb3(saving)
        .then((archive) => {
          download(archive, `${sourceArchiveFilename.replace(/\.sb3$/i, '')}-改過.sb3`)
          downloadedRaw = saving
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : String(error)
        })
        .finally(() => setBusy(false))
    })
    refresh()
    localAiSettings.hidden = false
    localAiGenerateButton.disabled = false
    mcpSettings.hidden = false
    manual.append(manualSummary, targetLabel, propertyLabel, showAllLabel, valueGuide, valueLabel, manualActions)
    panel.append(
      title,
      help,
      localAiSettings,
      candidateDiff,
      candidateActions,
      status,
      historyActions,
      manual,
      mcpSettings,
    )
    sideColumn.append(panel)
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
              setPatchedPreviewArchive(previousArchive)
              throw new Error(
                `結構修改重載失敗，舊作品回復載入也失敗；可按「執行作品」重試。修改錯誤：${reloadError instanceof Error ? reloadError.message : String(reloadError)}；回復錯誤：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              )
            }
            throw new Error(
              `結構修改重載失敗，已重新載入舊作品（進度已重置）：${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
            )
          }
          setLiveProject(validation.data)
          setPatchedPreviewArchive(nextArchive)
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
          setPreparedLivePatch(null)
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
          return { op: 'set-stage-property', property: change.property, value: change.value }
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
        setLiveProject(nextProject)
        setPatchedPreviewArchive(nextArchive)
        liveRevision += 1
        editor.value = JSON.stringify(liveProject, null, 2)
        setPreparedLivePatch(null)
        livePatchDiff.hidden = true
        livePatchStatus.dataset.kind = 'ok'
        livePatchStatus.textContent = `已即時套用「${patch.summary}」。作品欄已同步，可繼續遊玩或復原。`
      } catch (error) {
        setPreparedLivePatch(null)
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
          setLiveProject(last.projectBefore)
          editor.value = JSON.stringify(liveProject, null, 2)
          try {
            await reloadPreviewArchive(previousArchive, liveRevision + 1)
          } catch (reloadError) {
            setLiveProject(currentProject)
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
          setPatchedPreviewArchive(previousArchive)
          setPreparedLivePatch(null)
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
        setLiveProject(last.projectBefore)
        setPatchedPreviewArchive(previousArchive)
        liveRevision += 1
        editor.value = JSON.stringify(liveProject, null, 2)
        setPreparedLivePatch(null)
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
          setLiveProject(last.projectAfter)
          editor.value = JSON.stringify(liveProject, null, 2)
          try {
            await reloadPreviewArchive(redoArchive, liveRevision + 1)
          } catch (reloadError) {
            setLiveProject(currentProject)
            editor.value = JSON.stringify(liveProject, null, 2)
            await reloadPreviewArchive(currentArchive, liveRevision + 1)
            throw reloadError
          }
          setPatchedPreviewArchive(redoArchive)
        } else {
          const updates = last.runtimeRedo
          if (!updates) throw new Error('找不到可重做的 runtime patch 資料。')
          const response = await requestRuntimePatch(updates, liveRevision)
          if (response.ok !== true)
            throw new Error(typeof response.error === 'string' ? response.error : '無法重做修改。')
          setLiveProject(last.projectAfter)
          setPatchedPreviewArchive(await compileProjectToBlob(liveProject))
          liveRevision += 1
          editor.value = JSON.stringify(liveProject, null, 2)
        }
        liveRedoStack.pop()
        liveUndoStack.push(last)
        if (liveUndoStack.length > 20) liveUndoStack.shift()
        setPreparedLivePatch(null)
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
  livePatchPanel.append(livePatchSummary, livePatchHelp, livePatchPromptButton, livePatchInputLabel, livePatchInput)
  aiPanel.append(
    aiPanelTitle,
    aiPanelIntro,
    ...(rawSource ? [] : [localAiSettings]),
    livePatchDiff,
    livePatchActions,
    livePatchStatus,
    livePatchPanel,
    mcpSettings,
  )
  sideColumn.append(aiPanel)

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
  const setCloudState = (val: SelfHostedCloudState | null): void => {
    cloudState = val
  }
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
        const next = state.pending.entries().next().value
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
        const names = response.names
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
          cloudStarting.controller !== controller ||
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
        setCloudState(state)
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
  sideColumn.append(progressPanel)

  studentPreview.append(previewColumn, sideColumn)

  const animationArchivePromise: Promise<{ archive: Blob | null; fallbackCount: number; error?: Error }> =
    createAnimationPreviewArchive(project, rawSource).catch((error: unknown) => ({
      archive: null,

      fallbackCount: 0,

      error: error instanceof Error ? error : new Error('無法準備損壞素材的動畫示意圖。'),
    }))

  const sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds))

  const capturePlaytestSnapshot = async (
    animation: ActiveStudentAnimation,
  ): Promise<PlaytestSnapshot | undefined> => {
    const result = await animation.requestProgress('capture-game-progress', liveRevision)
    if (result.ok !== true) return undefined
    const targets = Array.isArray(result.targets) ? result.targets : []
    const sprites = targets
      .filter(
        (target): target is Record<string, unknown> =>
          typeof target === 'object' && target !== null && !Array.isArray(target),
      )
      .filter(
        (target) =>
          target.isStage !== true &&
          typeof target.name === 'string' &&
          typeof target.x === 'number' &&
          typeof target.y === 'number' &&
          typeof target.visible === 'boolean' &&
          typeof target.currentCostume === 'number',
      )
      .map((target) => ({
        name: target.name as string,
        x: target.x as number,
        y: target.y as number,
        visible: target.visible as boolean,
        currentCostume: target.currentCostume as number,
      }))
    const variables = (Array.isArray(result.snapshot) ? result.snapshot : [])
      .filter(
        (variable): variable is Record<string, unknown> =>
          typeof variable === 'object' && variable !== null && !Array.isArray(variable),
      )
      .filter(
        (variable) =>
          typeof variable.targetName === 'string' &&
          typeof variable.name === 'string' &&
          typeof variable.type === 'string' &&
          Object.hasOwn(variable, 'value'),
      )
      .map((variable) => ({
        targetName: variable.targetName as string,
        name: variable.name as string,
        type: variable.type as string,
        value: variable.value,
      }))
    return { sprites, variables }
  }

  const setPlaytestStatus = (kind: string, text: string): void => {
    playtestStatus.dataset.kind = kind
    playtestStatus.textContent = text
  }

  async function runAutoPlaytest(animation: ActiveStudentAnimation, stopWhenDone = false): Promise<void> {
    if (generation !== studentPreviewGeneration || activeStudentAnimation !== animation) return
    if (playtestStatus.dataset.running === 'true') return
    const cancellation = { cancelled: false }
    const cancel = (): void => {
      cancellation.cancelled = true
    }
    cancelActiveStudentPlaytest = cancel
    const ensureNotCancelled = (): void => {
      if (cancellation.cancelled || generation !== studentPreviewGeneration || activeStudentAnimation !== animation)
        throw new Error('作品已變更，已取消自動試玩。')
    }
    const plan = inferPlaytestPlan(projectRequest.value)
    const deadline = Date.now() + 4_500
    const captureWithinBudget = async (): Promise<PlaytestSnapshot | undefined> => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('自動試玩已達 4.5 秒上限。')
      return Promise.race([
        capturePlaytestSnapshot(animation),
        new Promise<undefined>((_, reject) =>
          window.setTimeout(() => reject(new Error('自動試玩擷取逾時。')), Math.min(remaining, 1_200)),
        ),
      ])
    }
    playtestStatus.dataset.running = 'true'
    playtestButton.disabled = true
    playtestStatus.dataset.kind = 'neutral'
    playtestStatus.textContent = '自動試玩中（擷取初始狀態）…'
    try {
      ensureNotCancelled()
      const start = await captureWithinBudget()
      ensureNotCancelled()
      await sleep(250)
      const afterIdle = await captureWithinBudget()
      ensureNotCancelled()
      const controls = []
      for (const control of plan.controls) {
        ensureNotCancelled()
        playtestStatus.textContent = `自動試玩中（測試${control.label ?? control.key}）…`
        const before = await captureWithinBudget()
        animation.playtestKey(control.key, true)
        await sleep(350)
        const after = await captureWithinBudget()
        animation.playtestKey(control.key, false)
        controls.push(controlMovement(before, after, control))
      }
      if (plan.controls.length === 0) await sleep(900)
      ensureNotCancelled()
      const end = await captureWithinBudget()
      const feedback = createPlaytestFeedback(projectRequest.value, project, {
        ready: true,
        pageErrors: [],
        autonomousMotion: snapshotsChanged(start, afterIdle),
        controls,
        changedVariables: changedVariableNames(start, end),
      })
      const feedbackKind = feedback.passed ? 'ok' : 'warning'
      const feedbackText = `${feedback.title}：${feedback.summary}`
      setPlaytestStatus(feedbackKind, feedbackText)
      if (feedback.passed) {
        latestPlaytestPrompt = null
        latestPlaytestSummary = null
      } else if (latestDescription) {
        latestPlaytestPrompt = createDescriptionRepairPrompt(
          latestDescription.text,
          [latestDescription.feedback, playtestFeedbackLines(feedback.issues)].filter(Boolean).join('\n'),
        )
        latestPlaytestSummary = feedback.summary
      } else if (feedback.repairPrompt) {
        const capabilityGuide = projectRequest.value.trim()
          ? createStudentProjectInstruction(projectRequest.value)
          : AI_INSTRUCTION
        const validationPrompt = latestRepairContext
          ? createRepairPrompt(
              latestRepairContext.report,
              latestRepairContext.currentProject,
              capabilityGuide,
              latestRepairContext.repeatedIssues,
            )
          : ''
        latestPlaytestPrompt = validationPrompt
          ? `${validationPrompt}\n\n【實際試玩回饋】\n${feedback.repairPrompt}`
          : feedback.repairPrompt
        latestPlaytestSummary = feedback.summary
      }
      renderRepairTools()
    } catch (error) {
      if (cancellation.cancelled) return
      latestPlaytestPrompt = `請修正 Scratch 作品的實際玩法。Bridge 自動試玩時無法完成狀態擷取：${error instanceof Error ? error.message : String(error)}`
      latestPlaytestSummary = '自動試玩沒有完成，請重新執行預覽或把這個訊息貼回 AI。'
      const failureText = latestPlaytestSummary
      setPlaytestStatus('warning', failureText)
      renderRepairTools()
    } finally {
      if (cancelActiveStudentPlaytest === cancel) cancelActiveStudentPlaytest = null
      if (!cancellation.cancelled && stopWhenDone && activeStudentAnimation === animation)
        animation.finish('自動試玩完成；可按綠旗繼續手動試玩。')
      delete playtestStatus.dataset.running
      playtestButton.disabled = activeStudentAnimation !== animation
    }
  }

  let animationStarting = false
  let pendingAutoPlaytest = options.autoPlaytest === true

  startAnimation.addEventListener('click', () => {
    if (activeStudentAnimation || animationStarting || generation !== studentPreviewGeneration) return

    const shouldAutoPlaytest = pendingAutoPlaytest
    pendingAutoPlaytest = false

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

          setLivePatchReady(true)

          frame.style.opacity = '1'

          frame.style.pointerEvents = ''

          frame.removeAttribute('aria-hidden')

          studentStageCanvas.hidden = true

          background.hidden = true

          stageStatus.hidden = false

          stageStatus.textContent = `動畫執行中。${prepared.fallbackCount > 0 ? `已將 ${prepared.fallbackCount} 個損壞造型替換為示意素材。` : ''}點擊舞台後可用方向鍵、空白鍵或作品中的滑鼠操作。`

          if (hardwareExtensions.length > 0) hardwareControls.hidden = false

          startAnimation.hidden = true

          startAnimation.disabled = false

          stopAnimation.hidden = false

          playtestButton.disabled = false

          if (shouldAutoPlaytest) void runAutoPlaytest(animation, true)
        },

        onProgress: (message) => {
          if (generation !== studentPreviewGeneration || typeof message.detail !== 'string') return
          stageStatus.hidden = false
          stageStatus.textContent = message.detail
        },

        playtestKey: (key, isDown) => {
          frame.contentWindow?.postMessage({ type: 'playtest-key', token, key, isDown }, '*')
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

          playtestButton.disabled = true

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

      playtestButton.disabled = true

      stageStatus.textContent = error instanceof Error ? error.message : '無法準備動畫預覽。'

      stageStatus.dataset.kind = 'warning'
    })
  })

  playtestButton.addEventListener('click', () => {
    const animation = activeStudentAnimation
    if (animation) void runAutoPlaytest(animation)
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

  if (spriteList.childElementCount > 0) previewColumn.append(spriteList)

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

      if (options.autoPlaytest) window.setTimeout(() => startAnimation.click(), 0)
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

  latestFeatures = null

  downloadStudentValidationReport.hidden = true

  studentResult.hidden = true

  pendingStudentSnapshot = null

  studentCandidateActions.hidden = true

  restoreStudentProject.hidden = latestStudentSnapshot === null

  iterationCard.hidden = true

  studentResult.removeAttribute('data-kind')

  studentResultTitle.textContent = ''

  studentResultMessage.textContent = ''

  studentRequirementCoverage.replaceChildren()

  studentAssets.hidden = true

  studentAssetList.replaceChildren()

  studentAssetsStatus.textContent = ''

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

          semanticIssues: validateCanonicalSemanticsBestEffort(normalized.data),
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
  copyStatus.textContent = request ? '想法準備好了！按「複製製作訊息給 AI」。' : '先寫下作品想法，或選一個範例。'
  buildPromptStatus.removeAttribute('data-kind')
  if (request) {
    const prompt = createStudentProjectInstruction(request, {
      genre: gameGenre.value as GameGenreProfile,
      ...(brief ? { confirmedBrief: brief } : {}),
    })
    const size = estimatePromptSize(prompt)
    buildPromptStatus.textContent = brief
      ? `製作指令約 ${size.characters.toLocaleString()} 字元、${size.estimatedTokens.toLocaleString()} tokens（粗估；各 AI tokenizer 不同）。`
      : '討論完成後貼上確認的玩法，再複製製作指令。也可跳過討論，讓 AI 自行規劃並製作。'
  } else {
    buildPromptStatus.textContent = '先輸入作品想法。'
  }
}

projectRequest.addEventListener('input', () => {
  saveStudentDraft()
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
  void Promise.resolve()
    .then(() => navigator.clipboard.writeText(prompt))
    .then(() => {
      status.textContent = success
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
  byId<HTMLDetailsElement>('optional-game-brief').open = true
  copyStudentPrompt(
    createGameDesignDiscussionInstruction(request, gameGenre.value as GameGenreProfile),
    copyStatus,
    '已複製精簡討論指令。確認玩法後把 brief 貼回本頁；製作階段可開新對話節省上下文',
  )
})

copyBuildInstruction.addEventListener('click', () => {
  const request = projectRequest.value.trim()
  if (!request || !gameBrief.value.trim()) return
  const kind = chosenDescriptionKind()
  copyStudentPrompt(
    kind
      ? createDescriptionInstruction(kind, request, gameBrief.value)
      : createStudentProjectInstruction(request, {
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
  studentRevisionRequested = false
  byId<HTMLElement>('student-ai-guide').hidden = false
  saveStudentDraft()
  const kind = chosenDescriptionKind()
  copyStudentPrompt(
    kind
      ? createDescriptionInstruction(kind, request)
      : createStudentProjectInstruction(request, { genre: gameGenre.value as GameGenreProfile }),
    copyStatus,
    '複製好了！打開 AI 網頁貼上並送出，等回答完成後複製回這個網頁。',
  )
})

byId<HTMLButtonElement>('student-ai-answer-ready').addEventListener('click', () => {
  setProgress(3)
  editor.focus()
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

iterationRequest.addEventListener('input', saveStudentDraft)

iterationGenerate.addEventListener('click', () => {
  const request = iterationRequest.value.trim()
  if (!request || !latestStudentProject) {
    iterationStatus.textContent = '請先完成作品，再寫下想修改的地方。'
    iterationStatus.dataset.kind = 'error'
    return
  }
  const source = latestStudentSnapshot?.source ?? ''
  const prompt = descriptionKind(source)
    ? createDescriptionRevisionPrompt(source, request)
    : createStudentIterationInstruction(JSON.stringify(latestStudentProject), request, projectRequest.value.trim())
  void copyTextWithFallback(prompt, '已複製修改訊息。請貼到原本的 AI 對話，再把新回答貼回上方檢查。')
  studentRevisionRequested = true
  byId<HTMLElement>('student-ai-guide').hidden = false
  setProgress(2)
  saveStudentDraft()
  iterationStatus.textContent = '請將修改訊息貼給 AI，然後把 AI 的新回答貼回上方。原本的下載作品不會被覆蓋。'
  iterationStatus.dataset.kind = 'neutral'
})

const fragmentProjectName = (): string => {
  const briefMatch = /(?:遊戲名稱|作品名稱|名稱)\s*[:：]\s*([^\n，。]+)/.exec(gameBrief.value)
  return projectFragmentSession.project?.name ?? briefMatch?.[1]?.trim() ?? 'Scratch 遊戲'
}

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
  saveStudentDraft()
})

fragmentKind.addEventListener('change', () => {
  fragmentTargetName.value = fragmentKind.value === 'stage' ? '舞台' : '玩家'
  fragmentId.value = `${fragmentKind.value}-1`
})

byId<HTMLButtonElement>('load-sample').addEventListener('click', () => {
  studentDraftTouched = true
  studentRevisionRequested = false
  editor.value = JSON.stringify(sampleProject, null, 2)

  repairUndoSnapshot = null

  clearRepairContext()

  clearStudentResult()

  setProgress(3)

  setStatus(generateStatus, '已載入平台遊戲範例。按「檢查並製作 Scratch」即可試用。', 'ok')
  saveStudentDraft()
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

          semanticIssues: validateCanonicalSemanticsBestEffort(normalized.data),
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

const libraryAssetFetcher = createScratchAssetFetcher()

let latestLibraryReport: LibraryResolutionReport | null = null
let latestAutomaticVisuals: AutomaticVisualSummary | null = null

const compileProjectToBlob = async (
  project: CanonicalProject,
  options: ResolveLibraryAssetsOptions = {},
): Promise<Blob> => {
  const resolved = await resolveLibraryAssets(project, libraryAssetFetcher, options)
  latestLibraryReport = resolved.report
  latestAutomaticVisuals = summarizeAutomaticVisuals(resolved.project)
  return compileCanonicalProjectToSb3(resolved.project)
}

const describeAutomaticVisuals = (summary: AutomaticVisualSummary | null): string => {
  if (!summary) return ''
  const additions: string[] = []
  if (summary.backdropCostumes > 0) additions.push(`${summary.backdropCostumes} 個背景`)
  if (summary.spriteCostumes > 0) additions.push(`${summary.spriteCostumes} 個角色造型`)
  return additions.length > 0 ? `已自動補上 ${additions.join('、')}。` : ''
}

const describeLatestAutomaticVisuals = (): string => describeAutomaticVisuals(latestAutomaticVisuals)

const describeLatestLibraryAssets = (): string =>
  latestLibraryReport ? describeLibraryResolution(latestLibraryReport) : ''

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
    setStatus(generateStatus, '正在下載官方素材並透過 Scratch VM 編譯…')

    const sb3 = await compileProjectToBlob(project, { replaceModelSvg: true })

    download(sb3, `${project.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)

    publishRepairContext(createRepairReport({ data: project, semanticIssues }), project)

    const cloudWarning = describeOfflineCloudVariables(project)

    const semanticWarning = semanticIssues.length > 0 ? `（保留 ${semanticIssues.length} 項語意警告）` : ''

    setStatus(
      generateStatus,

      `完成：.sb3 已由 Scratch VM 產生。${describeLatestAutomaticVisuals()}${describeLatestLibraryAssets()}${semanticWarning}${cloudWarning ? `\n${cloudWarning}` : ''}`,

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

  // A game or animation description is built into blocks here; the blocks then go through the same checks,
  // compile, preview and playtest as block-level replies.
  const kind = descriptionKind(source)
  latestDescription = null
  let described: CanonicalProject | undefined
  if (kind) {
    const built = buildDescription(source, kind)
    clearRepairContext()
    latestDescription = { text: source, feedback: built.feedback, built: built.project !== undefined }
    renderRepairTools()
    if (!built.project) {
      setStatus(
        generateStatus,
        `作品描述還有 ${built.errors} 個問題，已全部放進修正訊息，請一次交給 AI 修正。`,
        'error',
      )
      setProgress(3)
      return
    }
    described = built.project
  }

  let parsed: ReturnType<typeof parseAiResponse>

  try {
    parsed = described ? { data: described, extracted: false, candidateCount: 1 } : parseAiResponse(source)
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

    latestFeatures = aiResponse.features

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

  // The editor keeps a description as written; it is what later revisions start from.
  if (normalized.repairs.length > 0 && !described) {
    repairUndoSnapshot = source

    editor.value = JSON.stringify(normalized.data, null, 2)
  }

  const validation = validateCanonicalProject(normalized.data)

  if (!validation.valid) {
    // Semantic issues go into the same report so the AI can fix everything in one round.
    const semanticIssues = validateCanonicalSemanticsBestEffort(normalized.data)

    const report = createRepairReport({
      data: normalized.data,

      repairs: normalized.repairs,

      normalizationWarnings: normalized.warnings,

      schemaIssues: validation.errors,

      semanticIssues,
    })

    const validationReport = await createAiOutputValidationReport({
      sourceResponse,

      canonicalProject: normalized.data,

      repairReport: report,

      checks: {
        responseParsed: 'passed',

        normalization: 'passed',

        canonicalSchema: 'failed',

        semanticValidation: semanticIssues.some((issue) => issue.severity === 'error') ? 'failed' : 'skipped',

        scratchVmCompile: 'skipped',
      },
    })

    publishRepairContext(report, normalized.data, validationReport)

    setStatus(
      generateStatus,
      `AI 回覆還有 ${report.summary.errors} 個問題，已全部放進修正訊息，請一次交給 AI 修正。`,
      'error',
    )

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

  // Warnings alone do not stop the build: the student gets a playable project, and the warnings travel with the
  // playtest feedback in the next repair message instead of costing a round of their own.
  if (report.summary.errors > 0) {
    const validationReport = await createAiOutputValidationReport({
      sourceResponse,

      canonicalProject: validation.data,

      repairReport: report,

      checks: {
        responseParsed: 'passed',

        normalization: 'passed',

        canonicalSchema: 'passed',

        semanticValidation: 'failed',

        scratchVmCompile: 'skipped',
      },
    })

    publishRepairContext(report, validation.data, validationReport)

    setStatus(generateStatus, `還有 ${report.summary.errors} 個必要問題需要 AI 修正。`, 'error')

    setProgress(3)

    return
  }

  try {
    setStatus(generateStatus, '正在下載官方素材並製作 Scratch 專案，請稍候…')

    setProgress(4)

    const sb3 = await compileProjectToBlob(validation.data, { replaceModelSvg: true })

    latestStudentValidationReport = await createAiOutputValidationReport({
      sourceResponse,

      canonicalProject: validation.data,

      repairReport: report,

      ...(latestRequirementCoverage ? { requirementCoverage: latestRequirementCoverage } : {}),

      checks: {
        responseParsed: 'passed',

        normalization: 'passed',

        canonicalSchema: 'passed',

        semanticValidation: report.summary.warnings > 0 ? 'review' : 'passed',

        scratchVmCompile: 'passed',
      },
    })

    if (editor.value !== sourceResponse) {
      setStatus(generateStatus, '檢查時內容已變更，請再按一次檢查。', 'error')
      setProgress(3)
      return
    }

    downloadStudentValidationReport.hidden = false
    const candidate = { project: validation.data, source: sourceResponse, sb3 }
    const isCandidate = studentRevisionRequested && latestStudentSnapshot !== null
    if (isCandidate) {
      pendingStudentSnapshot = candidate
      studentCandidateActions.hidden = false
      restoreStudentProject.hidden = true
      iterationCard.hidden = true
    } else {
      download(sb3, `${validation.data.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`)
      previousStudentSnapshot = latestStudentSnapshot
      latestStudentSnapshot = candidate
      latestStudentProject = validation.data
      restoreStudentProject.hidden = previousStudentSnapshot === null
      iterationCard.hidden = false
    }

    repairUndoSnapshot = null

    if (report.summary.warnings > 0 && !described) publishRepairContext(report, validation.data)
    else clearRepairContext()

    setStatus(
      generateStatus,
      `${isCandidate ? '新版已準備好，請先試玩，再決定是否使用。' : '完成！Scratch 專案已開始下載。'}${
        report.summary.warnings > 0 ? `有 ${report.summary.warnings} 個地方建議確認，已放進下方的修正訊息。` : ''
      }`,
      'ok',
    )

    setStudentResult(
      isCandidate ? `新版候選「${validation.data.name}」` : `已完成「${validation.data.name}」`,

      `作品包含 ${validation.data.sprites.length} 個角色。${describeLatestAutomaticVisuals()}${describeLatestLibraryAssets()}${describeOfflineCloudVariables(validation.data)}${latestRequirementCoverage ? '下方需求完成度是 AI 自述，Bridge 已檢查引用位置，但不代表已執行驗證。' : latestFeatures ? `AI 列出的功能：${latestFeatures.join('、')}。這是 AI 自述，不代表已執行驗證。` : 'AI 回覆未提供功能清單；格式與編譯通過不代表原始需求全數完成。'}${isCandidate ? '先試玩，再選擇是否使用新版。' : '請開啟下載的 .sb3 檔案繼續創作。'}本次驗證報告也可以下載。`,

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
    } else if (latestFeatures) {
      studentRequirementCoverage.replaceChildren(
        ...latestFeatures.map((feature) => {
          const item = document.createElement('li')
          item.textContent = `AI 列出的功能：${feature}`
          return item
        }),
      )
    }

    renderStudentPreview(validation.data, sb3, undefined, { autoPlaytest: true })

    renderStudentAssetLibrary(validation.data, candidate)

    saveStudentDraft()
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

byId<HTMLButtonElement>('accept-student-candidate').addEventListener('click', () => {
  if (!pendingStudentSnapshot) return
  if (editor.value !== pendingStudentSnapshot.source) {
    setStatus(generateStatus, '回答已變更，請重新檢查後再使用新版。', 'error')
    return
  }
  previousStudentSnapshot = latestStudentSnapshot
  latestStudentSnapshot = pendingStudentSnapshot
  latestStudentProject = pendingStudentSnapshot.project
  pendingStudentSnapshot = null
  studentRevisionRequested = false
  studentCandidateActions.hidden = true
  iterationCard.hidden = false
  restoreStudentProject.hidden = previousStudentSnapshot === null
  setStatus(generateStatus, '已使用新版，Scratch 作品已開始下載。', 'ok')
  studentResultTitle.textContent = `已使用「${latestStudentProject.name}」`
  studentResultMessage.textContent = '新版已使用，原本下載的作品仍保留在你的裝置。'
  saveStudentDraft()
  download(
    latestStudentSnapshot.sb3,
    `${latestStudentProject.name.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}.sb3`,
  )
})

byId<HTMLButtonElement>('discard-student-candidate').addEventListener('click', () => {
  if (!latestStudentSnapshot) return
  pendingStudentSnapshot = null
  studentRevisionRequested = false
  studentCandidateActions.hidden = true
  latestStudentProject = latestStudentSnapshot.project
  editor.value = latestStudentSnapshot.source
  downloadStudentValidationReport.hidden = true
  clearRepairContext()
  setStatus(generateStatus, '已回到原本的作品。', 'ok')
  setStudentResult(`已回到「${latestStudentProject.name}」`, '可以繼續試玩原本的作品。', 'success')
  renderStudentPreview(latestStudentProject, latestStudentSnapshot.sb3)
  renderStudentAssetLibrary(latestStudentProject, latestStudentSnapshot)
  iterationCard.hidden = false
  restoreStudentProject.hidden = previousStudentSnapshot === null
  saveStudentDraft()
})

restoreStudentProject.addEventListener('click', () => {
  const snapshot = studentResult.hidden ? latestStudentSnapshot : previousStudentSnapshot
  if (!snapshot) return
  const current = latestStudentSnapshot
  latestStudentSnapshot = snapshot
  previousStudentSnapshot = current === snapshot ? previousStudentSnapshot : current
  latestStudentProject = snapshot.project
  pendingStudentSnapshot = null
  studentRevisionRequested = false
  studentCandidateActions.hidden = true
  downloadStudentValidationReport.hidden = true
  editor.value = snapshot.source
  clearRepairContext()
  setStatus(generateStatus, '已回到上一個可用作品。', 'ok')
  setStudentResult(`已回到「${snapshot.project.name}」`, '可以繼續試玩，或重新檢查並下載這個作品。', 'success')
  renderStudentPreview(snapshot.project, snapshot.sb3)
  renderStudentAssetLibrary(snapshot.project, snapshot)
  iterationCard.hidden = false
  restoreStudentProject.hidden = previousStudentSnapshot === null
  setProgress(4)
  saveStudentDraft()
})

byId<HTMLButtonElement>('compile').addEventListener('click', () => {
  void compileProject()
})

const studentBuildButton = byId<HTMLButtonElement>('student-build')
studentBuildButton.addEventListener('click', () => {
  if (studentBuildButton.disabled) return
  studentBuildButton.disabled = true
  editor.readOnly = true
  void buildStudentProject().finally(() => {
    studentBuildButton.disabled = false
    editor.readOnly = false
  })
})

downloadStudentValidationReport.addEventListener('click', () => {
  if (!latestStudentValidationReport) return

  const filename = `${latestStudentValidationReport.projectName.replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'scratch-project'}-validation-report.json`

  downloadJson(latestStudentValidationReport, filename)
})

copyRepairPrompt.addEventListener('click', () => {
  if (latestPlaytestPrompt) {
    void copyTextWithFallback(latestPlaytestPrompt, '已複製試玩修正訊息；請貼回 AI 對話。')
    return
  }
  if (latestDescription?.feedback) {
    void copyTextWithFallback(
      createDescriptionRepairPrompt(latestDescription.text, latestDescription.feedback),
      '已複製修正訊息（所有問題都在裡面）；請貼回 AI 對話。',
    )
    return
  }
  if (!latestRepairContext) return

  const request = projectRequest.value.trim()

  const capabilityGuide = request ? createStudentProjectInstruction(request) : AI_INSTRUCTION

  const prompt = createRepairPrompt(
    latestRepairContext.report,

    latestRepairContext.currentProject,

    capabilityGuide,

    latestRepairContext.repeatedIssues,
  )

  const handoff = request ? `學生原本的作品想法：${request}\n\n${prompt}` : prompt
  void copyTextWithFallback(handoff, '已複製修正訊息；請貼回 AI 對話。')
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
  saveStudentDraft()
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
  const evidenceById = new Map(currentProjectMap.evidence.map((entry) => [entry.id, entry]))
  const evidenceByScript = new Map<string, (typeof currentProjectMap.evidence)[number][]>()
  for (const entry of currentProjectMap.evidence) {
    const key = `${entry.targetIndex}:${entry.scriptIndex ?? 'raw'}`
    const bucket = evidenceByScript.get(key)
    if (bucket) bucket.push(entry)
    else evidenceByScript.set(key, [entry])
  }

  const summary = analysis.summary

  projectScoreSummary.textContent = `${projectScore.total === null ? '目前不足以換算結構參考分，不代表作品不好' : `SB3 結構參考分：${projectScore.total}/${projectScore.max}`}（分析覆蓋 ${projectScore.coverage}%）。分數只反映部分程式結構，不代表作品品質、創意或正式成績；本次也沒有執行作品。`

  projectScoreCriteria.replaceChildren(
    ...projectScore.criteria.map((criterion) => {
      const item = document.createElement('li')

      const heading = document.createElement('strong')

      heading.textContent = `${criterion.title}：${criterion.score === null ? '不適用' : `${criterion.score}/${criterion.points} 分`}`

      const detail = document.createElement('p')

      detail.textContent = criterion.explanation

      item.append(heading, detail)

      for (const evidenceId of criterion.evidenceIds.slice(0, 4)) {
        const source = evidenceById.get(evidenceId)

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
      ...groupDiagnosticsForDisplay(analysis.diagnostics).map((group) => {
        const diagnostic = document.createElement('div')
        diagnostic.className = `diagnostic ${group.severity}`
        const label = document.createElement('b')
        label.textContent = group.severity === 'warning' ? '建議確認' : '作品觀察'
        const content = document.createElement('div')
        const summary = document.createElement('span')
        summary.textContent = group.summary
        content.append(summary)
        if (group.count > 1) {
          const details = document.createElement('details')
          const heading = document.createElement('summary')
          heading.textContent = `查看 ${group.count} 項詳細位置`
          const list = document.createElement('ul')
          for (const entry of group.items) {
            const item = document.createElement('li')
            const message = group.code === 'detached-script' ? '未接事件積木，可能是草稿或手動執行。' : entry.message
            item.textContent = `${entry.target ? `「${entry.target}」` : ''}${entry.script ? `第 ${entry.script} 段：` : ''}${message}`
            list.append(item)
          }
          details.append(heading, list)
          content.append(details)
        }
        diagnostic.append(label, content)
        return diagnostic
      }),
    )
  } else {
    const diagnostic = document.createElement('div')
    diagnostic.className = 'diagnostic ok'
    const label = document.createElement('b')
    label.textContent = '檢查完成'
    const message = document.createElement('span')
    message.textContent = '目前沒有偵測到規則型問題。'
    diagnostic.append(label, message)
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

  const actionableFeedback = projectFeedback.items.filter(({ kind }) => kind !== 'confirmed-structure')
  const detachedFeedback = actionableFeedback.filter(({ id }) => id.startsWith('diagnostic:detached-script:'))
  const detachedCount = analysis.diagnostics.filter(({ code }) => code === 'detached-script').length
  const otherFeedback = actionableFeedback.filter(({ id }) => !id.startsWith('diagnostic:detached-script:'))
  const firstDetached = detachedFeedback.at(0)
  const displayFeedback = firstDetached
    ? [
        ...otherFeedback,
        {
          ...firstDetached,
          title: '未接上事件積木的程式',
          message: `有 ${detachedCount} 段未接事件積木的程式；可能是草稿或手動執行，不一定是錯誤。`,
          evidenceIds: [...new Set(detachedFeedback.flatMap(({ evidenceIds }) => evidenceIds))].slice(0, 6),
        },
      ]
    : otherFeedback
  projectFeedbackItems.replaceChildren(
    ...displayFeedback
      .slice(0, 30)

      .map((feedback) => {
        const item = document.createElement('li')

        const title = document.createElement('strong')

        title.textContent = `${feedback.title}（供師生確認）`

        const message = document.createElement('p')

        message.textContent = feedback.message

        const nextStep = document.createElement('p')

        nextStep.textContent = `可以試試：${feedback.nextStep}`

        item.append(title, message, nextStep)

        for (const evidenceId of feedback.evidenceIds) {
          const source = evidenceById.get(evidenceId)

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

          const scriptEvidence = evidenceByScript.get(`${targetIndex}:${index}`) ?? []

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

      const rawEvidence = evidenceByScript.get(`${targetIndex}:raw`) ?? []

      if (rawEvidence.length > 0) {
        const rawList = document.createElement('ul')

        rawList.setAttribute('aria-label', '無法投影至 Canonical 腳本的原始積木')

        for (const [rawIndex, source] of rawEvidence.entries()) {
          const rawItem = document.createElement('li')

          rawItem.id = `raw-block-${targetIndex}-${encodeURIComponent(source.blockId ?? source.id)}`

          rawItem.tabIndex = -1

          rawItem.textContent = `第 ${rawIndex + 1} 個積木目前無法解讀；它的效果需要在 Scratch 原始作品中確認。`

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

const analyzeFile = async (file: File, readerOptions: ReaderOptions = {}): Promise<string | undefined> => {
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
  currentReaderOptions = readerOptions

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
    currentReaderOptions = {
      ...readerOptions,
      visualHints: await samplePngVisualHints(decompiled.rawArchive),
    }

    sourceBlockGraphs = decompiled.rawBlockGraphs

    analysis = analyzeCanonicalProject(canonical, decompiled.rawBlockGraphs)

    projectMap = createProjectMap(
      canonical,
      analysis,
      decompiled.rawBlockGraphs,
      decompiled.canonicalBlockMappings,
      decompiled.rawArchive.projectJson,
    )

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

    const message = friendlyOpenError(error instanceof Error ? error.message : String(error))
    setStatus(fileStatus, message, 'error')
    return message
  }
  return undefined
}

const previewImported = async (): Promise<string | undefined> => {
  const project = canonical

  const archive = rawArchive

  if (!project || !archive) return '還沒有打開作品。'

  previewImportedProject.disabled = true

  try {
    const sb3 = await exportLosslessSb3(archive)

    if (canonical !== project || rawArchive !== archive) return undefined

    const damagedCostumeCount = [project.stage, ...project.sprites].reduce(
      (count, target) => count + target.costumes.filter((costume) => !costume.data || costume.assetIssue).length,

      0,
    )

    latestStudentValidationReport = null

    downloadStudentValidationReport.hidden = true

    clearStudentResult()

    setStudentResult(
      `打開了「${project.name}」`,

      `按綠旗就能玩，下面可以請 AI 幫忙修改。${damagedCostumeCount > 0 ? `有 ${damagedCostumeCount} 個造型的圖檔缺少或損壞，畫面上先用示意圖代替。` : ''}原本的檔案不會被改動。`,

      damagedCostumeCount > 0 ? 'attention' : 'success',
    )

    activateTab(byId<HTMLButtonElement>('generate-tab'))

    renderStudentPreview(project, sb3, archive, { readerOptions: currentReaderOptions })
    return undefined
  } catch (error) {
    const message = friendlyOpenError(error instanceof Error ? error.message : String(error))
    setStatus(fileStatus, message, 'error')
    return message
  } finally {
    previewImportedProject.disabled = canonical === null || rawArchive === null
  }
}

previewImportedProject.addEventListener('click', () => {
  void previewImported()
})

const fileInput = byId<HTMLInputElement>('sb3-file')
const openFileInput = byId<HTMLInputElement>('open-sb3-file')
const openFileStatus = byId<HTMLDivElement>('open-sb3-status')
const scratchProjectUrl = byId<HTMLInputElement>('scratch-project-url')
const openScratchUrlButton = byId<HTMLButtonElement>('open-scratch-url')
const dropOverlay = byId<HTMLDivElement>('drop-overlay')
const dropOverlayTitle = byId<HTMLElement>('drop-overlay-title')
const generateTab = byId<HTMLButtonElement>('generate-tab')
const onGenerateTab = (): boolean => generateTab.getAttribute('aria-selected') === 'true'

/**
 * Opens a student's own project. On the main tab it goes straight to the preview with the AI edit panel; on the
 * analysis tab it only runs the analysis there.
 * @param files - What was chosen or dropped; the first .sb3 is opened.
 * @param readerOptions - Optional public Scratch metadata passed into the AI reader.
 */
const openProjectFiles = async (files: readonly File[], readerOptions: ReaderOptions = {}): Promise<void> => {
  const forPreview = onGenerateTab()
  const status = forPreview ? openFileStatus : fileStatus
  const { file, note } = chooseProjectFile(files)
  if (!file) return
  const problem = projectFileProblem(file)
  if (problem) {
    setStatus(status, problem, 'error')
    return
  }
  if (
    forPreview &&
    studentPreviewHasEdits() &&
    !window.confirm('目前的作品有改過。換成新作品後，還沒下載的修改就不見了。要換嗎？')
  )
    return
  setStatus(status, `正在打開「${file.name}」…`)
  const analyzeError = await analyzeFile(file, readerOptions)
  if (analyzeError) {
    setStatus(status, analyzeError, 'error')
    return
  }
  if (!forPreview) return
  const previewError = await previewImported()
  if (previewError) {
    setStatus(openFileStatus, previewError, 'error')
    return
  }
  const summary = analysis?.summary
  const counts = summary ? `：${summary.sprites} 個角色、${summary.scripts} 段程式、${summary.blocks} 個積木` : ''
  setStatus(openFileStatus, `已打開「${file.name}」${counts}。${note ?? ''}`, 'ok')
  studentResult.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

fileInput.addEventListener('change', () => {
  void openProjectFiles([...(fileInput.files ?? [])])
  fileInput.value = ''
})
openFileInput.addEventListener('change', () => {
  void openProjectFiles([...(openFileInput.files ?? [])])
  openFileInput.value = ''
})
byId<HTMLButtonElement>('open-sb3-button').addEventListener('click', () => {
  openFileInput.click()
})
openScratchUrlButton.addEventListener('click', () => {
  if (
    studentPreviewHasEdits() &&
    !window.confirm('目前的作品有改過。換成網址作品後，還沒下載的修改就不見了。要換嗎？')
  )
    return
  openScratchUrlButton.disabled = true
  setStatus(openFileStatus, '正在從 Scratch 公開伺服器下載作品與素材…')
  void (async () => {
    try {
      const requestedUrl = scratchProjectUrl.value
      const downloaded = await fetchPublicScratchProject(requestedUrl)
      const file = new File([downloaded.blob], downloaded.fileName, { type: 'application/zip' })
      await openProjectFiles([file], {
        title: downloaded.title,
        ...(downloaded.author ? { author: downloaded.author } : {}),
        sourceUrl: downloaded.url,
        license: downloaded.license,
        ...(downloaded.instructions ? { authorInstructions: downloaded.instructions } : {}),
        ...(downloaded.notes ? { notesAndCredits: downloaded.notes } : {}),
      })
      setStatus(openFileStatus, `已從 Scratch 讀取「${downloaded.title}」。原作品仍只保存在這個瀏覽器。`, 'ok')
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'Scratch 公開伺服器不允許這個網站直接讀取（CORS）。請用 CLI fetch 或 skill-scratch-site 下載後拖入 .sb3。'
          : error instanceof Error
            ? error.message
            : String(error)
      setStatus(openFileStatus, message, 'error')
    } finally {
      openScratchUrlButton.disabled = false
    }
  })()
})
scratchProjectUrl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openScratchUrlButton.click()
})

// Files can be dropped anywhere on the window. The overlay covers the page, including the cross-origin preview
// iframe that would otherwise swallow the drop, and dragenter/dragleave are counted because they fire for every
// child element crossed.
let fileDragDepth = 0
const hideDropOverlay = (): void => {
  fileDragDepth = 0
  dropOverlay.hidden = true
}
window.addEventListener('dragenter', (event) => {
  if (!isFileDrag([...(event.dataTransfer?.types ?? [])])) return
  event.preventDefault()
  fileDragDepth += 1
  dropOverlayTitle.textContent = onGenerateTab() ? '放開就打開這個作品' : '放開就檢查這個作品'
  dropOverlay.hidden = false
})
window.addEventListener('dragover', (event) => {
  if (!isFileDrag([...(event.dataTransfer?.types ?? [])])) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('dragleave', (event) => {
  if (!isFileDrag([...(event.dataTransfer?.types ?? [])])) return
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) dropOverlay.hidden = true
})
window.addEventListener('drop', (event) => {
  if (!isFileDrag([...(event.dataTransfer?.types ?? [])])) return
  event.preventDefault()
  hideDropOverlay()
  void openProjectFiles([...(event.dataTransfer?.files ?? [])])
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

        projectMap: createProjectMap(
          canonical,
          analysis,
          sourceBlockGraphs,
          canonicalBlockMappings,
          rawArchive?.projectJson,
        ),

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

const restoreStudentDraft = async (): Promise<void> => {
  try {
    const text = sessionStorage.getItem(studentDraftKey)
    if (!text) return
    const draft = JSON.parse(text) as {
      version?: unknown
      request?: unknown
      response?: unknown
      modification?: unknown
      guideOpen?: unknown
      revisionRequested?: unknown
      latest?: { project?: unknown; source?: unknown } | null
      previous?: { project?: unknown; source?: unknown } | null
      pending?: { project?: unknown; source?: unknown } | null
    }
    if (draft.version !== 1 || typeof draft.request !== 'string' || typeof draft.response !== 'string') return
    const readSnapshot = async (item: typeof draft.latest): Promise<StudentSnapshot | null> => {
      if (!item || typeof item.source !== 'string') return null
      const checked = validateCanonicalProject(item.project)
      if (!checked.valid || validateCanonicalSemantics(checked.data).some((issue) => issue.severity === 'error'))
        return null
      return { project: checked.data, source: item.source, sb3: await compileProjectToBlob(checked.data) }
    }
    const [latest, previous, pending] = await Promise.all([
      readSnapshot(draft.latest),
      readSnapshot(draft.previous),
      readSnapshot(draft.pending),
    ])
    if (studentDraftTouched) return
    projectRequest.value = draft.request
    editor.value = draft.response
    byId<HTMLElement>('student-ai-guide').hidden = draft.guideOpen !== true
    iterationRequest.value = typeof draft.modification === 'string' ? draft.modification : ''
    latestStudentSnapshot = latest
    previousStudentSnapshot = previous
    pendingStudentSnapshot = pending
    latestStudentProject = latest?.project ?? null
    studentRevisionRequested = draft.revisionRequested === true
    updateStudentInstruction()
    const visible = pending?.source === editor.value ? pending : latest?.source === editor.value ? latest : null
    if (visible) {
      setStudentResult(
        pending === visible ? '已恢復未確認的新版' : '已恢復上一個作品',
        '可以繼續試玩；請記得下載作品。',
        'success',
      )
      renderStudentPreview(visible.project, visible.sb3)
      renderStudentAssetLibrary(visible.project, visible)
      studentCandidateActions.hidden = pending !== visible
      iterationCard.hidden = pending === visible
      restoreStudentProject.hidden = pending === visible || previous === null
      setProgress(4)
    } else {
      restoreStudentProject.hidden = latest === null
      setProgress(editor.value.trim() ? 3 : projectRequest.value.trim() ? 2 : 1)
    }
    studentDraftStatus.textContent = '已從這個分頁恢復作品。關閉分頁或清除資料後可能無法找回，請下載作品。'
  } catch {
    studentDraftStatus.textContent = '無法恢復分頁暫存；請使用下載的作品或重新貼上 AI 回答。'
  }
}
void restoreStudentDraft()

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
