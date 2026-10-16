import { createHash } from 'node:crypto'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
} from '../core/analyzer'
import { importLosslessSb3 } from '../core/archive'
import { projectJsonToCanonicalWithReport } from '../core/decompiler/project-json'
import { extractProjectBlockGraphs } from '../core/graph'

export interface CliInspection {
  readonly format: 'scratch-ai-bridge/inspection'
  readonly version: 1
  readonly analyzerVersion: 1
  readonly rubricVersion: 'sb3-static-v2'
  readonly analysisMode: 'static-raw-sb3'
  readonly runtimeVerified: false
  readonly fileId: string
  readonly status: 'ok' | 'partial'
  readonly summary: ReturnType<typeof analyzeCanonicalProject>['summary']
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
  }[]
  readonly limitations: readonly string[]
}

const redactQuotedContent = (value: string): string =>
  value
    .replace(/「([^」]*)」/g, (_match, content: string) =>
      content.startsWith('__SCRATCH_TARGET_') ? `「${content}」` : '「內容已隱去」',
    )
    .replace(/“[^”]*”/g, '「內容已隱去」')
    .replace(/"[^"\n]*"/g, '「內容已隱去」')

const localizedDiagnostic = (code: string): string | undefined => {
  const messages: Record<string, string> = {
    'block-graph-invalid-argument-reporter':
      'Bridge 找到一個自製積木的參數積木，但無法確認它對應哪個輸入；請檢查積木定義和參數名稱。',
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
  const projectMap = createProjectMap(project, analysis, rawGraphs, conversion.canonicalBlockMappings)
  const projectFeedback = createProjectFeedback(analysis, projectMap)
  const projectScore = createProjectScore(project, analysis, projectMap)
  const publicEvidenceId = new Map(projectMap.evidence.map((item, index) => [item.id, `E${index + 1}`]))
  const targetLabels = new Map<string, string>([
    [project.stage.name, '舞台'],
    ...project.sprites.map((sprite, index) => [sprite.name, `角色 ${index + 1}`] as [string, string]),
  ])
  const rawTargets = Array.isArray(archive.projectJson.targets) ? archive.projectJson.targets : []
  const allBlockIds = rawTargets.flatMap((target: unknown) =>
    target && typeof target === 'object' && 'blocks' in target && target.blocks && typeof target.blocks === 'object'
      ? Object.keys(target.blocks)
      : [],
  )
  const redact = (value: string, code?: string): string => {
    let output = value
    for (const id of allBlockIds) {
      if (id.length >= 8) output = output.replaceAll(id, '積木')
    }
    const targetPlaceholders: string[] = []
    for (const [index, [name]] of [...targetLabels.entries()]
      .sort(([left], [right]) => right.length - left.length)
      .entries()) {
      const placeholder = `__SCRATCH_TARGET_${index}__`
      if (name) output = output.replaceAll(name, placeholder)
      targetPlaceholders.push(placeholder)
    }
    output = redactQuotedContent(output)
    if (code === 'forever-reinitialize') output = output.replace(/（[^）]*）/g, '（變數名稱已隱去）')
    for (const [index, label] of [...targetLabels.values()].entries()) {
      const placeholder = targetPlaceholders[index]
      if (placeholder) output = output.replaceAll(placeholder, label)
    }
    return output
  }
  const evidenceId = (id: string): string => publicEvidenceId.get(id) ?? 'E-unknown'
  const evidenceById = new Map(projectMap.evidence.map((item) => [item.id, item]))
  const warnings = projectFeedback.items.filter((item) => item.severity === 'warning')
  const seenTargets = new Set<number>()
  const diverseFacts = projectFeedback.items.filter((item) => {
    const targetIndex = item.evidenceIds
      .map((id) => evidenceById.get(id)?.targetIndex)
      .find((index): index is number => index !== undefined)
    if (targetIndex === undefined || seenTargets.has(targetIndex)) return false
    seenTargets.add(targetIndex)
    return true
  })
  const selectedFeedback = [...new Set([...warnings, ...diverseFacts, ...projectFeedback.items])].slice(0, 60)
  const selectedEvidenceIds = new Set(
    selectedFeedback
      .flatMap((item) => item.evidenceIds.slice(0, 2))
      .concat(projectScore.criteria.flatMap((criterion) => criterion.evidenceIds)),
  )
  const selectedEvidence = [...selectedEvidenceIds]
    .map((id) => evidenceById.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .slice(0, 240)
  const evidence = selectedEvidence.map((item) => ({
    id: evidenceId(item.id),
    target: targetLabels.get(item.targetName) ?? `角色 ${item.targetIndex}`,
    script: item.scriptIndex == null ? null : item.scriptIndex + 1,
    opcode: item.opcode,
    label: redact(item.studentLabel),
    path: item.path,
  }))
  const diagnostics = analysis.diagnostics.map((item) => {
    const message = localizedDiagnostic(item.code) ?? redact(item.message, item.code)
    return {
      severity: item.severity,
      code: item.code,
      message,
      ...(item.target ? { target: targetLabels.get(item.target) ?? '角色' } : {}),
      ...(item.script ? { script: item.script } : {}),
    }
  })
  const partial =
    archive.warnings.length > 0 ||
    projectMap.coverage.opaqueBlocks > 0 ||
    projectMap.coverage.malformedGraphIssues > 0
  const limitations = [
    '這是從 SB3 結構產生的靜態分析；沒有執行作品，不能推論實際玩法、手感或 FPS。',
    'Scratch extensions 與硬體沒有在 CLI 中載入或執行。',
    ...projectFeedback.limits.map((item) => redact(item)),
    ...archive.warnings.map((item) => redact(item)),
  ]

  return {
    format: 'scratch-ai-bridge/inspection',
    version: 1,
    analyzerVersion: 1,
    rubricVersion: 'sb3-static-v2',
    analysisMode: 'static-raw-sb3',
    runtimeVerified: false,
    fileId: createHash('sha256').update(bytes).digest('hex'),
    status: partial ? 'partial' : 'ok',
    summary: analysis.summary,
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
        evidenceIds: item.evidenceIds.slice(0, 2).map(evidenceId),
      })),
    },
    evidence,
    omittedEvidence: Math.max(0, projectMap.evidence.length - evidence.length),
    diagnostics,
    limitations,
  }
}

export const inspectionToMarkdown = (inspection: CliInspection): string => {
  const lines = [
    '# Scratch 作品靜態分析',
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
