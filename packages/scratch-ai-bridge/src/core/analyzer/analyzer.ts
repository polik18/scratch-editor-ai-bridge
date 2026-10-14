import {
  DISABLED_SCRATCH_EXTENSION_IDS,
  DISABLED_SCRATCH_EXTENSION_REASONS,
  SCRATCH_LINK_HARDWARE_EXTENSION_IDS,
  LOCAL_SCRATCH_EXTENSION_IDS,
  SCRATCH_CORE_OPCODE_PREFIXES,
  VERIFIED_SCRATCH_EXTENSION_IDS,
} from '../../scratch/extensions'
import { CANONICAL_OPCODES } from '../capabilities'
import type { ScratchTargetBlockGraph } from '../graph'
import type { CanonicalBlock, CanonicalProject, CanonicalScript } from '../ir/types'

export interface AnalysisDiagnostic {
  severity: 'info' | 'warning'
  code: string
  message: string
  target?: string
  script?: number
  variable?: string
}

export interface AnalysisScriptSummary {
  index: number
  trigger: string
  blockCount: number
  opcodes: string[]
  reads: string[]
  writes: string[]
  listReads: string[]
  listWrites: string[]
  procedureCalls: string[]
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
  procedures: {
    name: string
    blockCount: number
    calls: string[]
    broadcasts: string[]
    reads: string[]
    writes: string[]
    listReads: string[]
    listWrites: string[]
  }[]
}

export interface AnalysisIR {
  format: 'scratch-ai-bridge/analysis-ir'
  version: 1
  summary: {
    targets: number
    sprites: number
    blocks: number
    scripts: number
    procedures: number
    variables: number
    lists: number
    broadcasts: number
    costumes: number
    sounds: number
  }
  targets: AnalysisTargetSummary[]
  dependencies: {
    broadcasts: { name: string; senders: string[]; receivers: string[] }[]
    procedures: { target: string; name: string; callees: string[] }[]
    monitors: { id: string; opcode: string; target: string | null; variable?: string; list?: string }[]
    assets: { target: string; kind: 'costume' | 'sound'; name: string; issue: string }[]
    extensions: { id: string; declared: boolean; blockCount: number; opcodes: string[] }[]
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

const blockListCount = (blocks: readonly CanonicalBlock[]): number => {
  let count = 0
  for (const block of blocks) visitBlock(block, () => (count += 1))
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
  const listReads = new Set<string>()
  const listWrites = new Set<string>()
  const broadcasts = new Set<string>()
  const receives = new Set<string>()
  const procedureCalls = new Set<string>()
  const variableInitializationsInForever: string[] = []

  const inspect = (block: CanonicalBlock, inForever: boolean, active: Set<CanonicalBlock>): void => {
    if (active.has(block)) return
    const nextActive = new Set(active)
    nextActive.add(block)

    opcodes.push(block.opcode)
    if (block.opcode === 'procedures_call' && block.procedure?.name) procedureCalls.add(block.procedure.name)
    const nestedForever = inForever || block.opcode === 'control_forever'
    if (block.opcode === 'data_setvariableto') {
      const name = field(block, 'VARIABLE')
      if (name) writes.add(name)
      if (inForever) variableInitializationsInForever.push(name ?? '')
    }
    if (block.opcode === 'data_changevariableby') {
      const name = field(block, 'VARIABLE')
      if (name) {
        reads.add(name)
        writes.add(name)
      }
    }
    if (block.opcode === 'data_variable') {
      const name = field(block, 'VARIABLE')
      if (name) reads.add(name)
    }
    const listName = field(block, 'LIST')
    if (listName) {
      if (
        [
          'data_itemoflist',
          'data_itemnumoflist',
          'data_lengthoflist',
          'data_listcontainsitem',
          'data_listcontents',
        ].includes(block.opcode)
      ) {
        listReads.add(listName)
      }
      if (
        [
          'data_addtolist',
          'data_deleteoflist',
          'data_deletealloflist',
          'data_insertatlist',
          'data_replaceitemoflist',
        ].includes(block.opcode)
      ) {
        listWrites.add(listName)
      }
    }
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.type === 'variable') reads.add(input.name)
      if (input.type === 'list') listReads.add(input.name)
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
  if (variableInitializationsInForever.length > 0) {
    const variableNames = Array.from(new Set(variableInitializationsInForever.filter(Boolean)))
    diagnostics.push({
      severity: 'info',
      code: 'forever-reinitialize',
      target: targetName,
      script: index,
      message: `偵測到 forever 內設定變數${variableNames.length ? `（${variableNames.join('、')}）` : ''}。碰撞反彈、計分或狀態更新通常是預期行為；只有只需執行一次的初始值設定，才應移到迴圈外。`,
    })
  }

  return {
    index,
    trigger: first?.opcode ?? 'empty',
    blockCount: scriptBlockCount(script),
    opcodes,
    reads: Array.from(reads),
    writes: Array.from(writes),
    listReads: Array.from(listReads),
    listWrites: Array.from(listWrites),
    procedureCalls: Array.from(procedureCalls),
    broadcasts: Array.from(broadcasts),
    receives: Array.from(receives),
    summary: `${first?.opcode ?? 'empty'}${opcodes.length > 1 ? ` → ${opcodes.slice(1, 5).join(' → ')}` : ''}${opcodes.length > 5 ? ' …' : ''}`,
  }
}

export const analyzeCanonicalProject = (
  project: CanonicalProject,
  rawBlockGraphs: readonly ScratchTargetBlockGraph[] = [],
): AnalysisIR => {
  const diagnostics: AnalysisDiagnostic[] = []
  const senders = new Map<string, string[]>()
  const receivers = new Map<string, string[]>()

  const sourceTargets = [project.stage, ...project.sprites]
  for (const target of sourceTargets) {
    for (const variable of target.variables) {
      if (variable.cloud !== true) continue
      diagnostics.push({
        severity: 'warning',
        code: 'cloud-variable-offline',
        target: target.name,
        variable: variable.name,
        message: `雲端變數「${variable.name}」已保留；目前 Bridge 預覽沒有 Scratch 雲端連線服務，其變更不會同步到 Scratch 雲端。`,
      })
    }
  }
  const assetDependencies = sourceTargets.flatMap((target) => [
    ...target.costumes.flatMap((costume) =>
      costume.assetIssue
        ? [{ target: target.name, kind: 'costume' as const, name: costume.name, issue: costume.assetIssue }]
        : [],
    ),
    ...target.sounds.flatMap((sound) =>
      sound.assetIssue
        ? [{ target: target.name, kind: 'sound' as const, name: sound.name, issue: sound.assetIssue }]
        : [],
    ),
  ])
  const monitorDependencies = (project.monitors ?? []).map((monitor) => {
    const dependency = {
      id: monitor.id,
      opcode: monitor.opcode,
      target: monitor.spriteName,
      ...(typeof monitor.params.VARIABLE === 'string' ? { variable: monitor.params.VARIABLE } : {}),
      ...(typeof monitor.params.LIST === 'string' ? { list: monitor.params.LIST } : {}),
    }
    const owner =
      monitor.spriteName === null ? project.stage : sourceTargets.find(({ name }) => name === monitor.spriteName)
    if (monitor.params.VARIABLE && !owner?.variables.some(({ name }) => name === monitor.params.VARIABLE)) {
      diagnostics.push({
        severity: 'warning',
        code: 'monitor-variable-missing',
        target: monitor.spriteName ?? project.stage.name,
        message: `監視器「${monitor.id}」參照不到變數「${monitor.params.VARIABLE}」。`,
      })
    }
    if (monitor.params.LIST && !owner?.lists.some(({ name }) => name === monitor.params.LIST)) {
      diagnostics.push({
        severity: 'warning',
        code: 'monitor-list-missing',
        target: monitor.spriteName ?? project.stage.name,
        message: `監視器「${monitor.id}」參照不到清單「${monitor.params.LIST}」。`,
      })
    }
    return dependency
  })
  for (const asset of assetDependencies) {
    diagnostics.push({
      severity: 'warning',
      code: `asset-${asset.issue}`,
      target: asset.target,
      message: `${asset.kind === 'costume' ? '造型' : '音效'}「${asset.name}」素材${asset.issue === 'missing-archive-entry' ? '在封存檔中不存在' : '的 checksum 與素材內容不符'}。`,
    })
  }
  const targets = sourceTargets.map((target) => {
    const scripts = target.scripts.map((script, scriptIndex) =>
      analyzeScript(script, scriptIndex + 1, target.name, diagnostics),
    )
    const procedures = target.procedures.map((procedure) => {
      const calls = new Set<string>()
      const broadcasts = new Set<string>()
      const reads = new Set<string>()
      const writes = new Set<string>()
      const listReads = new Set<string>()
      const listWrites = new Set<string>()
      for (const block of procedure.body) {
        visitBlock(block, (candidate) => {
          if (candidate.opcode === 'procedures_call' && candidate.procedure?.name) {
            calls.add(candidate.procedure.name)
          }
          if (candidate.opcode === 'data_variable') {
            const name = field(candidate, 'VARIABLE')
            if (name) reads.add(name)
          }
          if (candidate.opcode === 'data_changevariableby') {
            const name = field(candidate, 'VARIABLE')
            if (name) {
              reads.add(name)
              writes.add(name)
            }
          }
          if (candidate.opcode === 'data_setvariableto') {
            const name = field(candidate, 'VARIABLE')
            if (name) writes.add(name)
          }
          for (const input of Object.values(candidate.inputs ?? {})) {
            if (input.type === 'variable') reads.add(input.name)
            if (input.type === 'list') listReads.add(input.name)
            if (input.type === 'broadcast') broadcasts.add(input.name)
          }
          const listName = field(candidate, 'LIST')
          if (listName) {
            if (
              [
                'data_itemoflist',
                'data_itemnumoflist',
                'data_lengthoflist',
                'data_listcontainsitem',
                'data_listcontents',
              ].includes(candidate.opcode)
            ) {
              listReads.add(listName)
            }
            if (
              [
                'data_addtolist',
                'data_deleteoflist',
                'data_deletealloflist',
                'data_insertatlist',
                'data_replaceitemoflist',
              ].includes(candidate.opcode)
            ) {
              listWrites.add(listName)
            }
          }
        })
      }
      return {
        name: procedure.name,
        blockCount: blockListCount(procedure.body),
        calls: Array.from(calls),
        broadcasts: Array.from(broadcasts),
        reads: Array.from(reads),
        writes: Array.from(writes),
        listReads: Array.from(listReads),
        listWrites: Array.from(listWrites),
      }
    })
    const proceduresByName = new Map<string, (typeof procedures)[number]>()
    for (const procedure of procedures) {
      if (!proceduresByName.has(procedure.name)) proceduresByName.set(procedure.name, procedure)
    }
    const callersByProcedure = new Map<(typeof procedures)[number], (typeof procedures)[number][]>()
    for (const caller of procedures) {
      for (const calledName of caller.calls) {
        const callee = proceduresByName.get(calledName)
        if (!callee || callee === caller) continue
        const callers = callersByProcedure.get(callee) ?? []
        callers.push(caller)
        callersByProcedure.set(callee, callers)
      }
    }
    const procedureWorklist = [...procedures]
    const queuedProcedures = new Set(procedures)
    for (const callee of procedureWorklist) {
      queuedProcedures.delete(callee)
      for (const caller of callersByProcedure.get(callee) ?? []) {
        let changed = false
        for (const key of ['broadcasts', 'reads', 'writes', 'listReads', 'listWrites'] as const) {
          for (const symbol of callee[key]) {
            if (caller[key].includes(symbol)) continue
            caller[key].push(symbol)
            changed = true
          }
        }
        if (changed && !queuedProcedures.has(caller)) {
          procedureWorklist.push(caller)
          queuedProcedures.add(caller)
        }
      }
    }
    for (const script of scripts) {
      const visited = new Set<string>()
      const pending = [...script.procedureCalls]
      for (const name of pending) {
        if (visited.has(name)) continue
        visited.add(name)
        const procedure = proceduresByName.get(name)
        if (!procedure) continue
        for (const key of ['broadcasts', 'reads', 'writes', 'listReads', 'listWrites'] as const) {
          const values = script[key]
          for (const value of procedure[key]) {
            if (!values.includes(value)) values.push(value)
          }
        }
        pending.push(...procedure.calls)
      }
    }
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
    for (const procedure of procedures) {
      for (const name of procedure.broadcasts) {
        const values = senders.get(name) ?? []
        values.push(`${target.name}::procedure:${procedure.name}`)
        senders.set(name, values)
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
      procedures,
    } satisfies AnalysisTargetSummary
  })

  for (const target of targets) {
    const definitions = new Set(target.procedures.map((procedure) => procedure.name))
    const calls = [
      ...target.scripts.flatMap((script) => script.procedureCalls),
      ...target.procedures.flatMap((procedure) => procedure.calls),
    ]
    for (const name of calls) {
      if (definitions.has(name)) continue
      diagnostics.push({
        severity: 'warning',
        code: 'procedure-no-definition',
        target: target.name,
        message: `角色「${target.name}」呼叫了自訂積木「${name}」，但沒有對應的定義。`,
      })
    }
  }

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

  if (rawBlockGraphs.length > 0) {
    const canonicalOpcodes = new Set<string>(CANONICAL_OPCODES)
    const rawBlockCount = rawBlockGraphs.reduce((count, target) => count + Object.keys(target.blocks).length, 0)
    const unmodeledOpcodes = new Set(
      rawBlockGraphs.flatMap((target) =>
        Object.values(target.blocks)
          .filter((block) => block.shadow !== true)
          .map((block) => block.opcode)
          .filter((opcode) => !canonicalOpcodes.has(opcode)),
      ),
    )

    diagnostics.push({
      severity: 'info',
      code: 'raw-block-graph-preserved',
      message: `已保留原始積木圖中的 ${rawBlockCount} 個積木；Canonical IR 分析摘要不一定涵蓋所有原始欄位或獨立積木。`,
    })

    if (unmodeledOpcodes.size > 0) {
      diagnostics.push({
        severity: 'info',
        code: 'raw-block-graph-unmodeled-opcodes',
        message: `原始積木圖保留了目前 AI 編輯能力未涵蓋的積木：${Array.from(unmodeledOpcodes).sort().join(', ')}。`,
      })
    }

    for (const target of rawBlockGraphs) {
      for (const issue of target.issues) {
        diagnostics.push({
          severity: 'warning',
          code: `block-graph-${issue.code}`,
          target: target.targetName,
          message: issue.message,
        })
      }
    }
  }

  const declaredExtensions = new Set(project.extensions ?? [])
  const extensionIds = new Set(declaredExtensions)
  for (const target of rawBlockGraphs) {
    for (const { opcode } of Object.values(target.blocks)) {
      const separator = opcode.indexOf('_')
      if (separator <= 0) continue
      const prefix = opcode.slice(0, separator).replace(/[^\w-]/g, '-')
      if (!SCRATCH_CORE_OPCODE_PREFIXES.has(prefix)) extensionIds.add(prefix)
    }
  }
  const extensionDependencies = Array.from(extensionIds)
    .sort()
    .map((id) => {
      const opcodes = Array.from(
        new Set(
          rawBlockGraphs.flatMap((target) =>
            Object.values(target.blocks)
              .filter(({ opcode }) => opcode.startsWith(`${id}_`))
              .map(({ opcode }) => opcode),
          ),
        ),
      ).sort()
      if (DISABLED_SCRATCH_EXTENSION_IDS.has(id)) {
        diagnostics.push({
          severity: 'warning',
          code: 'extension-runtime-disabled',
          message: `Extension「${id}」${DISABLED_SCRATCH_EXTENSION_REASONS[id as keyof typeof DISABLED_SCRATCH_EXTENSION_REASONS]}；Bridge 已停用自動載入，來源 raw graph/archive 仍保留積木與宣告。`,
        })
      } else if (!LOCAL_SCRATCH_EXTENSION_IDS.has(id)) {
        diagnostics.push({
          severity: 'warning',
          code: 'extension-runtime-unavailable',
          message: `Extension「${id}」沒有本地 runtime adapter；積木與宣告會保留，但 Bridge 不會執行其程式碼。`,
        })
      } else if (!VERIFIED_SCRATCH_EXTENSION_IDS.has(id)) {
        diagnostics.push({
          severity: 'info',
          code: 'extension-runtime-unverified',
          message: `Extension「${id}」使用本地 Scratch adapter；其硬體、網路或瀏覽器功能尚未由 Bridge 行為測試完整驗證。`,
        })
      }
      if (SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(id)) {
        diagnostics.push({
          severity: 'warning',
          code: 'extension-hardware-unverified',
          message: `Extension「${id}」的動畫預覽提供 Scratch Link 搜尋與配對入口；搜尋會連線本機 Scratch Link，或在本機服務無法使用時嘗試 Scratch Device Manager。實際裝置連線與積木行為尚未由 Bridge 實機驗證。`,
        })
      }
      if (id === 'text2speech') {
        diagnostics.push({
          severity: 'warning',
          code: 'extension-data-egress',
          message:
            'Text to Speech 的 speak 積木最多 128 個字元會送至 Scratch 合成服務；動畫預覽每次傳送前都會詢問同意，但仍請勿放入個人或敏感資料。音訊播放尚未由 Bridge 完整驗證。',
        })
      }
      if (id === 'translate') {
        diagnostics.push({
          severity: 'warning',
          code: 'extension-data-egress',
          message:
            'Translate 積木最多會將 1,024 個字元送至 Scratch 翻譯服務；動畫預覽每次傳送前都會詢問同意，超過上限的文字不會送出。請勿放入個人或敏感資料。',
        })
      }
      return {
        id,
        declared: declaredExtensions.has(id),
        blockCount: opcodes.reduce(
          (count, opcode) =>
            count +
            rawBlockGraphs.reduce(
              (sum, target) => sum + Object.values(target.blocks).filter((block) => block.opcode === opcode).length,
              0,
            ),
          0,
        ),
        opcodes,
      }
    })

  return {
    format: 'scratch-ai-bridge/analysis-ir',
    version: 1,
    summary: {
      targets: targets.length,
      sprites: project.sprites.length,
      blocks: targets.reduce(
        (sum, target) =>
          sum +
          target.blockCount +
          target.procedures.reduce((procedureSum, item) => procedureSum + item.blockCount, 0),
        0,
      ),
      scripts: targets.reduce((sum, target) => sum + target.scripts.length, 0),
      procedures: targets.reduce((sum, target) => sum + target.procedures.length, 0),
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
      procedures: targets.flatMap((target) =>
        target.procedures.map((procedure) => ({
          target: target.name,
          name: procedure.name,
          callees: procedure.calls,
        })),
      ),
      monitors: monitorDependencies,
      assets: assetDependencies,
      extensions: extensionDependencies,
    },
    diagnostics,
  }
}
