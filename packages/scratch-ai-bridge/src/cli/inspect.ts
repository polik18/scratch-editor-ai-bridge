import { createHash } from 'node:crypto'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
  diagnosticFeedbackId,
} from '../core/analyzer'
import { safeOpcode } from '../core/analyzer/safe-opcode'
import { importLosslessSb3 } from '../core/archive'
import { projectJsonToCanonicalWithReport } from '../core/decompiler/project-json'
import { extractProjectBlockGraphs } from '../core/graph'
import { hideTargetNames, restoreTargetNames } from '../core/prompt/target-placeholders'

export interface CliInspection {
  readonly format: 'scratch-ai-bridge/inspection'
  readonly version: 1
  readonly analyzerVersion: 1
  readonly rubricVersion: 'sb3-static-v3'
  readonly analysisMode: 'static-raw-sb3'
  readonly runtimeVerified: false
  readonly fileId: string
  readonly status: 'ok' | 'partial'
  readonly partialReasons: readonly string[]
  readonly summary: Omit<ReturnType<typeof analyzeCanonicalProject>['summary'], 'blocks'> & {
    readonly blocks: number
    readonly analyzedBlocks: number
    readonly shadowBlocks: number
  }
  readonly score: {
    readonly total: number | null
    readonly max: number
    readonly coverage: number
    readonly criteria: readonly {
      readonly id: string
      readonly title: string
      readonly points: number
      readonly score: number | null
      readonly applicability: 'applicable' | 'not-applicable'
      readonly explanation: string
      readonly evidenceIds: readonly string[]
    }[]
  }
  readonly coverage: Omit<ReturnType<typeof createProjectMap>['coverage'], 'scripts'> & {
    readonly scripts: readonly (Omit<
      ReturnType<typeof createProjectMap>['coverage']['scripts'][number],
      'targetName'
    > & {
      readonly target: string
    })[]
  }
  readonly feedback: {
    readonly summary: string
    readonly omittedItems: number
    readonly items: readonly {
      readonly id: string
      readonly kind: string
      readonly severity: string
      readonly confidence: string
      readonly title: string
      readonly message: string
      readonly nextStep: string
      readonly evidenceIds: readonly string[]
    }[]
  }
  readonly evidence: readonly {
    readonly id: string
    readonly target: string
    readonly script: number | null
    readonly opcode: string
    readonly label: string
    readonly path: string
  }[]
  readonly omittedEvidence: number
  readonly diagnostics: readonly {
    readonly severity: string
    readonly code: string
    readonly message: string
    readonly target?: string
    readonly script?: number
    readonly evidenceIds?: readonly string[]
  }[]
  readonly limitations: readonly string[]
}

const redactQuotedContent = (value: string): string =>
  value
    .replace(/「([^」]*)」/g, (_match, content: string) =>
      /^__SCRATCH_(TARGET|SYMBOL)_\d+__$/.test(content) ? `「${content}」` : '「內容已隱去」',
    )
    .replace(/“[^”]*”/g, '「內容已隱去」')
    .replace(/"[^"\n]*"/g, '「內容已隱去」')

const localizedDiagnostic = (code: string): string | undefined => {
  const messages: Record<string, string> = {
    'block-graph-invalid-argument-reporter':
      'Bridge 找到一個不在對應自製積木定義內的參數積木（常見於拆下或複製積木後留下的草稿）；請檢查積木定義或未接上的草稿積木。',
    'extension-runtime-disabled': '作品使用相機或感測器 extension；CLI 不會啟動這些功能，請在原 Scratch 環境確認。',
    'extension-runtime-unverified':
      '作品使用額外的 Scratch extension；CLI 只分析積木結構，無法確認裝置或瀏覽器中的實際行為。',
    'extension-data-egress': '作品使用語音積木；輸入文字可能送到 Scratch 語音服務，請避免放入姓名、地址等個人資料。',
    'detached-script': '有一段程式沒有事件積木（例如綠旗或按鍵），一般情況下可能不會自動開始。',
    'unclassified-script-entry': '這段程式從目前無法辨認的積木開始；Bridge 無法判斷它是不是擴充功能的事件積木。',
    'receiver-no-sender': '找到一段等待角色訊息的程式，但作品中沒有找到明顯的同名發送訊息。',
  }
  return messages[code]
}

/**
 * Inspect an SB3 using its archive JSON and raw block graph without loading Scratch VM.
 * @param bytes SB3 archive bytes.
 * @returns A privacy-filtered, evidence-linked static inspection.
 */
export const inspectSb3Bytes = async (bytes: Uint8Array): Promise<CliInspection> => {
  const archive = await importLosslessSb3(bytes)
  const conversion = projectJsonToCanonicalWithReport(archive.projectJson, 'Scratch Project')
  const project = conversion.canonical
  const rawGraphs = extractProjectBlockGraphs(archive.projectJson)
  const analysis = analyzeCanonicalProject(project, rawGraphs)
  const projectMap = createProjectMap(
    project,
    analysis,
    rawGraphs,
    conversion.canonicalBlockMappings,
    archive.projectJson,
  )
  const projectFeedback = createProjectFeedback(analysis, projectMap)
  const projectScore = createProjectScore(project, analysis, projectMap, projectFeedback)
  const publicEvidenceId = new Map(projectMap.evidence.map((item, index) => [item.id, `E${index + 1}`]))
  const targetLabels = new Map<string, string>([
    [project.stage.name, '舞台'],
    ...project.sprites.map((sprite, index) => [sprite.name, `角色 ${index + 1}`] as [string, string]),
  ])
  const targetSymbols = [project.stage, ...project.sprites].map(() => new Map<string, string>())
  let variableNumber = 0
  for (const [index, target] of [project.stage, ...project.sprites].entries()) {
    for (const variable of target.variables) targetSymbols[index].set(variable.name, `變數 V${++variableNumber}`)
  }
  const symbols = targetSymbols[0]
  const messages = new Map(analysis.dependencies.broadcasts.map(({ name }, index) => [name, `訊息 M${index + 1}`]))
  const rawTargets = Array.isArray(archive.projectJson.targets) ? archive.projectJson.targets : []
  const variableIds = new Map<string, string>()
  const ambiguousVariableIds = new Set<string>()
  rawTargets.forEach((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('variables' in raw) ||
      !('name' in raw) ||
      !('isStage' in raw) ||
      !raw.variables ||
      typeof raw.variables !== 'object'
    )
      return
    const index = [project.stage, ...project.sprites].findIndex(
      (target) => target.name === raw.name && (target.kind === 'stage') === raw.isStage,
    )
    for (const [id, value] of Object.entries(raw.variables)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        const label = targetSymbols.at(index < 0 ? targetSymbols.length : index)?.get(value[0])
        if (label && !ambiguousVariableIds.has(id)) {
          const existing = variableIds.get(id)
          if (existing && existing !== label) {
            variableIds.delete(id)
            ambiguousVariableIds.add(id)
          } else variableIds.set(id, label)
        }
      }
    }
  })
  const allBlockIds = rawTargets.flatMap((target: unknown) =>
    target && typeof target === 'object' && 'blocks' in target && target.blocks && typeof target.blocks === 'object'
      ? Object.keys(target.blocks)
      : [],
  )
  const shadowBlockCount = rawTargets.reduce((count: number, target: unknown) => {
    if (!target || typeof target !== 'object' || !('blocks' in target)) return count
    const blocks = (target as { blocks?: unknown }).blocks
    if (!blocks || typeof blocks !== 'object') return count
    return (
      count +
      Object.values(blocks).filter(
        (block) => block && typeof block === 'object' && (block as { shadow?: unknown }).shadow === true,
      ).length
    )
  }, 0)
  const unknownOpcodes = [
    ...new Set(
      rawGraphs
        .flatMap(({ blocks }) => Object.values(blocks).map(({ opcode }) => opcode))
        .filter((opcode) => safeOpcode(opcode) === 'unknown-extension'),
    ),
  ].sort((a, b) => b.length - a.length)
  const redact = (value: string, code?: string): string => {
    let output = value
    for (const opcode of unknownOpcodes) if (opcode) output = output.replaceAll(opcode, '未辨識的積木')
    for (const id of allBlockIds) {
      if (id.length >= 8) output = output.replaceAll(id, '積木')
    }
    const hidden = hideTargetNames(output, targetLabels)
    output = redactQuotedContent(hidden.text)
    if (code === 'forever-reinitialize') output = output.replace(/（[^）]*）/g, '（變數名稱已隱去）')
    output = restoreTargetNames(output, hidden.placeholders)
    return output
  }
  const sourceBlock = (path: string): Record<string, unknown> | undefined => {
    let current: unknown = project
    for (const part of path.split('/').slice(1)) {
      if (!current || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part.replaceAll('~1', '/').replaceAll('~0', '~')]
    }
    return current && typeof current === 'object' ? (current as Record<string, unknown>) : undefined
  }
  const evidenceLabel = (item: (typeof projectMap.evidence)[number]): string => {
    const block = sourceBlock(item.path)
    const fields = block?.fields as Record<string, unknown> | undefined
    const inputs = block?.inputs as Record<string, { type?: string; name?: string; value?: unknown }> | undefined
    const variable = fields?.VARIABLE
    const localSymbols = targetSymbols.at(item.targetIndex)
    const rawField = item.blockId
      ? rawGraphs.find(
          ({ targetName, isStage }) => targetName === item.targetName && isStage === (item.targetIndex === 0),
        )?.blocks[item.blockId]?.fields?.VARIABLE
      : undefined
    const variableId = Array.isArray(rawField) && typeof rawField[1] === 'string' ? rawField[1] : undefined
    const variableLabel = variableId
      ? variableIds.get(variableId)
      : typeof variable === 'string'
        ? (localSymbols?.get(variable) ?? symbols.get(variable))
        : undefined
    const broadcastInput = inputs?.BROADCAST_INPUT
    const broadcastName =
      fields?.BROADCAST_OPTION ?? (broadcastInput?.type === 'broadcast' ? broadcastInput.name : broadcastInput?.value)
    const messageLabel = typeof broadcastName === 'string' ? messages.get(broadcastName) : undefined
    const label = redact(item.studentLabel)
    const symbol = item.symbol ?? variableLabel ?? messageLabel
    return symbol ? `${label}（${symbol}）` : label
  }
  const evidenceId = (id: string): string => publicEvidenceId.get(id) ?? 'E-unknown'
  const evidenceById = new Map(projectMap.evidence.map((item) => [item.id, item]))
  const priorityFeedback = projectFeedback.items.filter(
    (item) => item.severity === 'warning' || item.kind === 'design-question',
  )
  const structuralFeedback = projectFeedback.items.filter((item) => item.kind === 'confirmed-structure').slice(0, 10)
  const selectedFeedback = [...priorityFeedback, ...structuralFeedback]
  const selectedEvidenceIds = new Set(
    selectedFeedback
      .flatMap((item) => item.evidenceIds.slice(0, 4))
      .concat(projectScore.criteria.flatMap((criterion) => criterion.evidenceIds)),
  )
  const selectedEvidence = [...selectedEvidenceIds]
    .map((id) => evidenceById.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const evidence = selectedEvidence.map((item) => ({
    id: evidenceId(item.id),
    target: targetLabels.get(item.targetName) ?? `角色 ${item.targetIndex}`,
    script: item.scriptIndex == null ? null : item.scriptIndex + 1,
    opcode: safeOpcode(item.opcode),
    label: evidenceLabel(item),
    path:
      item.blockId && item.path.includes('/blocks/') && !item.path.includes('/scripts/')
        ? `/targets/${item.targetIndex}/blocks/已隱去`
        : item.path,
  }))
  const diagnostics = analysis.diagnostics.map((item) => {
    const message = localizedDiagnostic(item.code) ?? redact(item.message, item.code)
    const matching =
      projectFeedback.items.find(({ id }) => id === diagnosticFeedbackId(item)) ??
      (item.code === 'detached-script'
        ? projectFeedback.items.find(({ id }) =>
            id.startsWith(`diagnostic:detached-script:${encodeURIComponent(item.target ?? '')}:`),
          )
        : undefined)
    const references = matching?.evidenceIds.slice(0, 4).map(evidenceId) ?? []
    return {
      severity: item.severity,
      code: item.code,
      message,
      ...(references.length > 0 ? { evidenceIds: references } : {}),
      ...(item.target ? { target: targetLabels.get(item.target) ?? '角色' } : {}),
      ...(item.script ? { script: item.script } : {}),
    }
  })
  const graphDiagnostics = analysis.diagnostics.filter(({ code }) => code.startsWith('block-graph-'))
  const unresolvedGraphIssues =
    graphDiagnostics.filter(({ severity }) => severity === 'warning').length +
    Math.max(0, projectMap.coverage.malformedGraphIssues - graphDiagnostics.length)
  const draftGraphNotes = graphDiagnostics.filter(({ severity }) => severity === 'info').length
  const partial = archive.warnings.length > 0 || projectMap.coverage.opaqueBlocks > 0 || unresolvedGraphIssues > 0
  const partialReasons = [
    ...(projectMap.coverage.opaqueBlocks > 0
      ? [`有 ${projectMap.coverage.opaqueBlocks} 個積木目前無法完整解讀`]
      : []),
    ...(unresolvedGraphIssues > 0 ? [`有 ${unresolvedGraphIssues} 項積木結構資料需要確認`] : []),
    ...(archive.warnings.length > 0 ? ['SB3 封裝有需要確認的資料'] : []),
  ]
  const limitations = [
    '這是從 SB3 結構產生的靜態分析；沒有執行作品，不能推論實際玩法、手感或 FPS。',
    'Scratch extensions 與硬體沒有在 CLI 中載入或執行。',
    ...(draftGraphNotes > 0
      ? [`有 ${draftGraphNotes} 項未接草稿的積木圖紀錄；原始資料已保留，修改時仍需經安全檢查。`]
      : []),
    ...projectFeedback.limits.map((item) => redact(item)),
    ...archive.warnings.map((item) => redact(item)),
  ]

  return {
    format: 'scratch-ai-bridge/inspection',
    version: 1,
    analyzerVersion: 1,
    rubricVersion: 'sb3-static-v3',
    analysisMode: 'static-raw-sb3',
    runtimeVerified: false,
    fileId: createHash('sha256').update(bytes).digest('hex'),
    status: partial ? 'partial' : 'ok',
    partialReasons,
    summary: {
      ...analysis.summary,
      blocks: allBlockIds.length,
      analyzedBlocks: analysis.summary.blocks,
      shadowBlocks: shadowBlockCount,
    },
    score: {
      total: projectScore.total,
      max: projectScore.max,
      coverage: projectScore.coverage,
      criteria: projectScore.criteria.map((criterion) => ({
        ...criterion,
        explanation: redact(criterion.explanation),
        evidenceIds: criterion.evidenceIds.map(evidenceId),
      })),
    },
    coverage: {
      ...projectMap.coverage,
      extensions: projectMap.coverage.extensions.map((item, index) =>
        item.extensionName === '未辨識的擴充' ? { ...item, extensionId: `unknown-extension-${index + 1}` } : item,
      ),
      scripts: projectMap.coverage.scripts.map(({ targetName, ...script }) => ({
        ...script,
        target: targetLabels.get(targetName) ?? '角色',
      })),
    },
    feedback: {
      summary: redact(projectFeedback.summary),
      omittedItems: Math.max(0, projectFeedback.items.length - selectedFeedback.length),
      items: selectedFeedback.map((item, index) => ({
        id: `F${index + 1}`,
        kind: item.kind,
        severity: item.severity,
        confidence: item.confidence,
        title: item.title,
        message: (() => {
          const code = item.id.startsWith('diagnostic:') ? item.id.split(':')[1] : undefined
          if (code === 'condition-variable-mismatch-in-loop') {
            const sources = item.evidenceIds
              .map((id) => evidenceById.get(id))
              .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
            const condition = sources.find(({ opcode }) => opcode === 'control_if')
            const write = sources.find(
              ({ opcode }) => opcode === 'data_setvariableto' || opcode === 'data_changevariableby',
            )
            const readLabel = condition && /變數 V\d+/.exec(evidenceLabel(condition))?.[0]
            const writeLabel = write && /變數 V\d+/.exec(evidenceLabel(write))?.[0]
            if (readLabel && writeLabel)
              return `迴圈條件讀取${readLabel}，分支卻更新${writeLabel}；請確認是否符合設計。`
          }
          const source =
            item.kind === 'confirmed-structure'
              ? item.evidenceIds
                  .map((id) => evidenceById.get(id))
                  .find(
                    (entry) =>
                      entry &&
                      [
                        'data_setvariableto',
                        'data_changevariableby',
                        'event_broadcast',
                        'event_broadcastandwait',
                        'event_whenbroadcastreceived',
                      ].includes(entry.opcode),
                  )
              : undefined
          if (source) return `這段程式包含「${evidenceLabel(source)}」積木；是否執行取決於作品的條件與狀態。`
          if (code === 'detached-script') {
            const countMatch = /同一角色共有 (\d+) 段/.exec(item.message)
            if (countMatch) {
              return `同一角色共有 ${countMatch[1]} 段程式沒有事件積木（例如綠旗或按鍵），一般情況下可能不會自動開始，也可能是留下的草稿。`
            }
          }
          return (code ? localizedDiagnostic(code) : undefined) ?? redact(item.message, code)
        })(),
        nextStep: (() => {
          const code = item.id.startsWith('diagnostic:') ? item.id.split(':')[1] : undefined
          const nextSteps: Record<string, string> = {
            'block-graph-invalid-procedure-definition': '在 Scratch 編輯器中檢查自製積木的定義和參數。',
            'block-graph-invalid-argument-reporter': '在 Scratch 編輯器中檢查參數積木是否放在正確的自製積木裡。',
            'extension-runtime-disabled': '在 Scratch 原環境執行作品，確認需要的 extension 或裝置可以使用。',
            'extension-runtime-unverified': '在 Scratch 原環境執行作品，確認 extension 的行為符合你的設計。',
            'extension-data-egress': '確認文字不含個人資料，再在 Scratch 中測試語音功能。',
            'detached-script': '檢查這段程式是否應接上綠旗、按鍵或其他事件積木。',
            'unclassified-script-entry':
              '請在原 Scratch 環境確認這段程式是否由擴充功能事件積木啟動；目前不需要因這項提示修改作品。',
            'receiver-no-sender': '檢查發送訊息和接收訊息使用的名稱是否一致。',
          }
          return (code ? nextSteps[code] : undefined) ?? redact(item.nextStep, code)
        })(),
        evidenceIds: item.evidenceIds.slice(0, 4).map(evidenceId),
      })),
    },
    evidence,
    omittedEvidence: Math.max(0, projectMap.evidence.length - evidence.length),
    diagnostics,
    limitations,
  }
}

const studentIssueText = (
  code: string,
  diagnosticMessage: string,
): { title: string; message: string; nextStep: string } | undefined => {
  const messages: Record<string, { title: string; message: string; nextStep: string }> = {
    'condition-variable-mismatch-in-loop': {
      title: '檢查條件和變數',
      message: '這段迴圈檢查一個變數，卻更新了另一個變數；這可能是刻意的設計。',
      nextStep: '對照條件與分支的變數名稱，想想冷卻或狀態是否會依照預期改變，再實際測試。',
    },
    'duplicate-script-in-target': {
      title: '檢查重複的程式',
      message: '這個角色有兩段結構和內容相同的事件程式，事件發生時可能都會執行。',
      nextStep: '比較兩段程式；如果不需要重複執行，可以先保留一段，然後在 Scratch 測試。',
    },
    'delete-clone-under-non-clone-hat': {
      title: '檢查分身刪除的位置',
      message: '綠旗啟動的程式中有「刪除此分身」積木。',
      nextStep: '確認是否要刪除分身；如果是，檢查這個積木是否應放在分身啟動的程式中。',
    },
    'detached-script': {
      title: '檢查這段程式怎麼開始',
      message: '這一段沒有接著綠旗或按鍵等開始積木；也可能是你故意留下的草稿。',
      nextStep: '如果希望它自動開始，確認要用「當綠旗被點擊」、按鍵或其他事件；草稿可以保留。',
    },
    'block-graph-invalid-procedure-definition': {
      title: '請一起檢查自製積木',
      message: '這個角色的自製積木輸入資料數量對不起來，工具無法確認每個輸入要接到哪裡。',
      nextStep: '打開這個角色的「我的積木」，確認積木上的每個輸入都有對應設定；不確定時請老師陪你看。',
    },
    'block-graph-invalid-argument-reporter': {
      title: '請一起檢查自製積木',
      message: '工具找到一個自製積木的輸入，但目前無法確認它對應哪個參數。',
      nextStep: '打開這個角色的「我的積木」，檢查參數名稱是否和積木定義相同；不確定時請老師陪你看。',
    },
    'block-graph-invalid-node-property': {
      title: '有幾塊積木資料需要確認',
      message: '工具讀到一小部分積木資料不完整；這不一定代表你的遊戲邏輯錯了。',
      nextStep: '在 Scratch 打開相關角色，檢查積木是否接好；若作品能正常使用，可先請老師確認這項提醒。',
    },
  }
  const issue = messages[code]
  if (code === 'block-graph-invalid-procedure-definition') {
    const counts = /有 (\d+) 個參數 ID、(\d+) 個參數名稱、(\d+) 個預設值/.exec(diagnosticMessage)
    if (counts) {
      return {
        ...issue,
        message: `工具讀到 ${counts[2]} 個輸入名稱和 ${counts[3]} 個預設值，數量不一樣，所以無法確認每個輸入要接到哪裡。`,
      }
    }
  }
  return issue
}

const studentTargetLabel = (target: string | undefined): string | undefined => {
  if (!target || target === '舞台') return target
  const match = /^角色 (\d+)$/.exec(target)
  if (!match) return target
  let value = Number(match[1]) - 1
  if (!Number.isInteger(value) || value < 0) return target
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return `角色 ${letters}（Scratch 角色清單第 ${Number(match[1])} 個）`
}

/**
 * Render a short, student-facing note without scores or internal evidence identifiers.
 * @param inspection Static SB3 analysis.
 * @returns A small Markdown report suitable for a teacher to share with one student.
 */
export const inspectionToStudentMarkdown = (inspection: CliInspection): string => {
  const seenIssues = new Set<string>()
  const checks = [...inspection.diagnostics]
    .sort((a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning'))
    .flatMap((diagnostic) => {
      const issue = studentIssueText(diagnostic.code, diagnostic.message)
      if (
        !issue ||
        (diagnostic.severity !== 'warning' && diagnostic.code !== 'detached-script') ||
        seenIssues.has(diagnostic.code)
      )
        return []
      seenIssues.add(diagnostic.code)
      const source = inspection.evidence.find(
        (item) => item.target === diagnostic.target && item.script === (diagnostic.script ?? null),
      )
      const location = [
        studentTargetLabel(diagnostic.target),
        diagnostic.script === undefined ? undefined : `第 ${diagnostic.script} 段程式`,
      ]
        .filter((item): item is string => Boolean(item))
        .join('・')
      return [{ ...issue, source, location }]
    })
  const notes = checks.slice(0, 3).map(({ title, message, nextStep, source, location }) => {
    const sourceTarget = studentTargetLabel(source?.target)
    const where =
      location ||
      (sourceTarget
        ? `${sourceTarget}${source?.script === null ? '' : `・第 ${source?.script} 段程式`}`
        : '作品中的相關程式')
    const block = source?.label ? ` 找找看「${source.label}」這個積木。` : ''
    return `### ${title}\n\n${where}：${message}${block}\n\n**可以試試：**${nextStep}`
  })
  if (notes.length === 0) {
    const startBlock = inspection.evidence.find(({ opcode }) => opcode === 'event_whenflagclicked')
    if (startBlock) {
      const target = studentTargetLabel(startBlock.target) ?? startBlock.target
      const where = `${target}${startBlock.script === null ? '' : `・第 ${startBlock.script} 段程式`}`
      notes.push(
        `### 從一段程式開始觀察\n\n我看到${where}有「當綠旗被點擊」積木。\n\n**可以試試：**在 Scratch 找到這段程式，按一次綠旗，記下角色先做了什麼，再想想這和你原本想要的效果一不一樣。`,
      )
    }
  }
  const unknownCount = inspection.coverage.opaqueBlocks
  const extensionNote =
    unknownCount > 0
      ? `### 工具目前看不懂的積木\n\n有 ${unknownCount} 個額外積木目前無法完整解讀。這不代表你寫錯，也不需要只因為這項提醒就刪掉積木；可以在 Scratch 裡請老師陪你確認。`
      : undefined
  const runtimeNote =
    inspection.coverage.extensions.length > 0
      ? '這個報告沒有啟動作品中的擴充功能或裝置。若問題和攝影機、語音或音樂有關，請在 Scratch 裡實際測試並找老師確認。'
      : undefined
  const content = [...notes, ...(extensionNote ? [extensionNote] : []), ...(runtimeNote ? [runtimeNote] : [])].join(
    '\n\n',
  )
  return [
    '# 給學生看的作品小提醒',
    '',
    '下面只整理少數可以回到 Scratch 檢查的線索。它不是成績，也沒有實際執行你的作品。',
    '',
    content || '目前沒有找到需要優先檢查的結構提醒。可以選一段程式，想想它什麼時候開始、會讓角色做什麼。',
    '',
    '如果這和你原本想做的不同，請告訴老師「我原本想看到什麼」和「我實際看到什麼」，再一起測試。',
  ].join('\n')
}

export const inspectionToMarkdown = (inspection: CliInspection): string => {
  const lines = [
    '# Scratch 教師檢視報告（靜態分析）',
    '',
    `狀態：${inspection.status === 'ok' ? '可讀取' : '部分可讀，請查看限制'}`,
    `SB3 結構參考分：${inspection.score.total === null ? '資料不足，暫不換算' : `${inspection.score.total}/${inspection.score.max}`}（${inspection.rubricVersion}；分析覆蓋 ${inspection.score.coverage}%）`,
    `角色數：${inspection.summary.sprites}；積木數：${inspection.summary.blocks}；腳本數：${inspection.summary.scripts}`,
    `回饋顯示 ${inspection.feedback.items.length} 項；另省略 ${inspection.feedback.omittedItems} 項重複或較次要觀察。證據省略 ${inspection.omittedEvidence} 項。`,
    '',
    '## 評分面向',
    '',
    ...inspection.score.criteria.map(
      (item) =>
        `- ${item.title}：${item.score === null ? '不適用' : `${item.score}/${item.points}`}。${item.explanation} 證據：${item.evidenceIds.join(', ') || '無'}`,
    ),
    '',
    '## 可以試試的下一步',
    '',
    ...inspection.feedback.items.map(
      (item) => `- **${item.title}**：${item.message} ${item.nextStep}（${item.evidenceIds.join(', ') || '無證據'}）`,
    ),
    '',
    '## 擴充積木判讀',
    '',
    ...(inspection.coverage.extensions.length > 0
      ? inspection.coverage.extensions.map(
          (item) =>
            `- ${item.extensionName}：辨認 ${item.recognizedBlocks} 個、暫時看不懂 ${item.opaqueBlocks} 個；${item.runtime === 'unavailable-extension' ? '此環境未啟動所需裝置或擴充' : item.runtime === 'unverified-extension' ? '只做靜態判讀，未確認實際執行' : item.runtime === 'verified-extension' ? '有本機執行支援，但本次仍未執行作品' : 'Scratch 內建功能'}。`,
        )
      : ['- 沒有偵測到擴充積木。']),
    '- Bridge 暫時看不懂的擴充積木不等於學生程式錯誤，也不會因此扣分。',
    '',
    '## 證據索引',
    '',
    ...inspection.evidence.map(
      (item) =>
        `- ${item.id}：${item.target}${item.script === null ? '' : `，第 ${item.script} 段程式`}：${item.label}`,
    ),
    '',
    '## 分析限制',
    '',
    ...inspection.limitations.map((item) => `- ${item}`),
    '',
    '本報告只分析 SB3 靜態結構，沒有執行作品或測量 FPS。',
  ]
  return lines.join('\n')
}
