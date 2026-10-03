import type { CanonicalBlock, CanonicalProject, CanonicalScript } from '../ir/types'

export interface AnalysisDiagnostic {
  severity: 'info' | 'warning'
  code: string
  message: string
  target?: string
  script?: number
}

export interface AnalysisScriptSummary {
  index: number
  trigger: string
  blockCount: number
  opcodes: string[]
  reads: string[]
  writes: string[]
  broadcasts: string[]
  receives: string[]
  summary: string
}

export interface AnalysisTargetSummary {
  name: string
  kind: 'stage' | 'sprite'
  blockCount: number
  variableCount: number
  listCount: number
  costumeCount: number
  soundCount: number
  scripts: AnalysisScriptSummary[]
}

export interface AnalysisIR {
  format: 'scratch-ai-bridge/analysis-ir'
  version: 1
  summary: {
    targets: number
    sprites: number
    blocks: number
    scripts: number
    variables: number
    lists: number
    broadcasts: number
    costumes: number
    sounds: number
  }
  targets: AnalysisTargetSummary[]
  dependencies: {
    broadcasts: { name: string; senders: string[]; receivers: string[] }[]
  }
  diagnostics: AnalysisDiagnostic[]
}

const HAT_OPCODES = new Set([
  'event_whenflagclicked',
  'event_whenbroadcastreceived',
  'event_whenkeypressed',
  'event_whenthisspriteclicked',
  'event_whenstageclicked',
  'event_whengreaterthan',
  'event_whenbackdropswitchesto',
  'control_start_as_clone',
  'procedures_definition',
])

const visitBlock = (
  block: CanonicalBlock,
  visitor: (block: CanonicalBlock) => void,
  active = new Set<CanonicalBlock>(),
): void => {
  if (active.has(block)) return
  active.add(block)
  visitor(block)
  for (const input of Object.values(block.inputs ?? {})) {
    if (input.type === 'block') visitBlock(input.block, visitor, active)
    if (input.type === 'stack') {
      for (const child of input.blocks) visitBlock(child, visitor, active)
    }
  }
  active.delete(block)
}

const scriptBlockCount = (script: CanonicalScript): number => {
  let count = 0
  for (const block of script.blocks) visitBlock(block, () => (count += 1))
  return count
}

const field = (block: CanonicalBlock, name: string): string | undefined => {
  const value = block.fields?.[name]
  return value === undefined ? undefined : String(value)
}

const analyzeScript = (
  script: CanonicalScript,
  index: number,
  targetName: string,
  diagnostics: AnalysisDiagnostic[],
): AnalysisScriptSummary => {
  const opcodes: string[] = []
  const reads = new Set<string>()
  const writes = new Set<string>()
  const broadcasts = new Set<string>()
  const receives = new Set<string>()
  const variableInitializationsInForever: string[] = []

  const inspect = (block: CanonicalBlock, inForever: boolean, active: Set<CanonicalBlock>): void => {
    if (active.has(block)) return
    const nextActive = new Set(active)
    nextActive.add(block)

    opcodes.push(block.opcode)
    const nestedForever = inForever || block.opcode === 'control_forever'
    if (block.opcode === 'data_setvariableto') {
      const name = field(block, 'VARIABLE')
      if (name) writes.add(name)
      if (inForever) variableInitializationsInForever.push(name ?? '')
    }
    if (block.opcode === 'data_changevariableby') {
      const name = field(block, 'VARIABLE')
      if (name) writes.add(name)
    }
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.type === 'variable') reads.add(input.name)
      if (input.type === 'broadcast') broadcasts.add(input.name)
      if (input.type === 'block') inspect(input.block, nestedForever, nextActive)
      if (input.type === 'stack') {
        for (const child of input.blocks) inspect(child, nestedForever, nextActive)
      }
    }
    if (block.opcode === 'event_whenbroadcastreceived') {
      const name = field(block, 'BROADCAST_OPTION')
      if (name) receives.add(name)
    }
  }

  for (const block of script.blocks) inspect(block, false, new Set())

  const first = script.blocks.at(0)
  if (first && !HAT_OPCODES.has(first.opcode)) {
    diagnostics.push({
      severity: 'warning',
      code: 'detached-script',
      target: targetName,
      script: index,
      message: `腳本從「${first.opcode}」開始，沒有事件帽積木；一般執行時可能不會自動啟動。`,
    })
  }
  const containsForever = opcodes.includes('control_forever')
  const containsYield = opcodes.some((opcode) =>
    ['control_wait', 'event_broadcastandwait', 'sensing_askandwait'].includes(opcode),
  )
  if (containsForever && !containsYield) {
    diagnostics.push({
      severity: 'warning',
      code: 'forever-without-yield',
      target: targetName,
      script: index,
      message: '偵測到 forever 腳本中沒有明顯 wait/yield；請確認是否造成高 CPU 或其他腳本飢餓。',
    })
  }
  if (variableInitializationsInForever.length > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'forever-reinitialize',
      target: targetName,
      script: index,
      message: '偵測到 forever 內設定變數；若原意是只初始化一次，應將初始化移到迴圈外。',
    })
  }

  return {
    index,
    trigger: first?.opcode ?? 'empty',
    blockCount: scriptBlockCount(script),
    opcodes,
    reads: Array.from(reads),
    writes: Array.from(writes),
    broadcasts: Array.from(broadcasts),
    receives: Array.from(receives),
    summary: `${first?.opcode ?? 'empty'}${opcodes.length > 1 ? ` → ${opcodes.slice(1, 5).join(' → ')}` : ''}${opcodes.length > 5 ? ' …' : ''}`,
  }
}

export const analyzeCanonicalProject = (project: CanonicalProject): AnalysisIR => {
  const diagnostics: AnalysisDiagnostic[] = []
  const senders = new Map<string, string[]>()
  const receivers = new Map<string, string[]>()

  const sourceTargets = [project.stage, ...project.sprites]
  const targets = sourceTargets.map((target) => {
    const scripts = target.scripts.map((script, scriptIndex) =>
      analyzeScript(script, scriptIndex + 1, target.name, diagnostics),
    )
    for (const script of scripts) {
      for (const name of script.broadcasts) {
        const values = senders.get(name) ?? []
        values.push(`${target.name}#${script.index}`)
        senders.set(name, values)
      }
      for (const name of script.receives) {
        const values = receivers.get(name) ?? []
        values.push(`${target.name}#${script.index}`)
        receivers.set(name, values)
      }
    }
    return {
      name: target.name,
      kind: target.kind,
      blockCount: scripts.reduce((sum, script) => sum + script.blockCount, 0),
      variableCount: target.variables.length,
      listCount: target.lists.length,
      costumeCount: target.costumes.length,
      soundCount: target.sounds.length,
      scripts,
    } satisfies AnalysisTargetSummary
  })

  const broadcastNames = new Set<string>([
    ...project.broadcasts.map((broadcast) => broadcast.name),
    ...senders.keys(),
    ...receivers.keys(),
  ])

  for (const name of broadcastNames) {
    const senderCount = senders.get(name)?.length ?? 0
    const receiverCount = receivers.get(name)?.length ?? 0
    if (senderCount > 0 && receiverCount === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'broadcast-no-receiver',
        message: `廣播「${name}」有送出者，但沒有接收腳本。`,
      })
    }
    if (receiverCount > 0 && senderCount === 0) {
      diagnostics.push({
        severity: 'info',
        code: 'receiver-no-sender',
        message: `「當收到 ${name}」存在，但專案內找不到明顯的 broadcast 發送者。`,
      })
    }
  }

  return {
    format: 'scratch-ai-bridge/analysis-ir',
    version: 1,
    summary: {
      targets: targets.length,
      sprites: project.sprites.length,
      blocks: targets.reduce((sum, target) => sum + target.blockCount, 0),
      scripts: targets.reduce((sum, target) => sum + target.scripts.length, 0),
      variables: targets.reduce((sum, target) => sum + target.variableCount, 0),
      lists: targets.reduce((sum, target) => sum + target.listCount, 0),
      broadcasts: broadcastNames.size,
      costumes: targets.reduce((sum, target) => sum + target.costumeCount, 0),
      sounds: targets.reduce((sum, target) => sum + target.soundCount, 0),
    },
    targets,
    dependencies: {
      broadcasts: Array.from(broadcastNames, (name) => ({
        name,
        senders: senders.get(name) ?? [],
        receivers: receivers.get(name) ?? [],
      })),
    },
    diagnostics,
  }
}
