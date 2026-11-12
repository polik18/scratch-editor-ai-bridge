/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition, prefer-const -- Reader output normalizes untyped Scratch archive data and preserves readable local bindings. */
import { extractProjectBlockGraphs, type ScratchBlockGraph, type ScratchBlockGraphNode } from '../graph'
import { LIBRARY_BACKDROPS, LIBRARY_SPRITES } from '../visuals/library'
import messagesJson from './block-messages.json'
import type { ProjectReaderResult, ReaderAssets, ReaderOptions, ReaderSection } from './types'

type RecordLike = Readonly<Record<string, unknown>>

interface BlockMessage {
  readonly template: string
  readonly args: readonly string[]
}

interface Costume {
  readonly name?: unknown
  readonly md5ext?: unknown
  readonly dataFormat?: unknown
  readonly width?: unknown
  readonly height?: unknown
}

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const fieldValue = (value: unknown): string =>
  Array.isArray(value) ? asString(value[0], String(value[0] ?? '')) : String(value)

const blockMessages = messagesJson.blocks as Record<string, BlockMessage>
const officialCostumes = new Map<string, string>()
for (const sprite of LIBRARY_SPRITES)
  for (const costume of sprite.costumes)
    officialCostumes.set(costume[1], '官方素材 ' + sprite.name + ' 的 ' + costume[0])
for (const backdrop of LIBRARY_BACKDROPS) officialCostumes.set(backdrop.costume[1], '官方背景 ' + backdrop.name)

const targetVariables = (target: RecordLike): Map<string, string> => {
  const result = new Map<string, string>()
  if (!isRecord(target.variables)) return result
  for (const [id, value] of Object.entries(target.variables))
    if (Array.isArray(value) && typeof value[0] === 'string' && value[2] !== true) result.set(id, value[0])
  return result
}

const targetLists = (target: RecordLike): Map<string, string> => {
  const result = new Map<string, string>()
  if (!isRecord(target.lists)) return result
  for (const [id, value] of Object.entries(target.lists))
    if (Array.isArray(value) && typeof value[0] === 'string') result.set(id, value[0])
  return result
}

const targetCostumes = (target: RecordLike): Costume[] =>
  Array.isArray(target.costumes) ? target.costumes.filter(isRecord) : []

const positionZone = (x: number, y: number): string => {
  const horizontal = x < -160 ? '左' : x > 160 ? '右' : '正中'
  const vertical = y > 60 ? '上' : y < -60 ? '下' : '中'
  return horizontal === '正中' && vertical === '中' ? '正中' : horizontal + vertical
}

const primitiveValue = (value: unknown, variables: Map<string, string>, lists: Map<string, string>): string => {
  if (!Array.isArray(value)) return String(value ?? '')
  const kind = value[0]
  const raw = value[1]
  if (Array.isArray(raw)) return primitiveValue(raw, variables, lists)
  if ((kind === 12 || kind === 13) && typeof raw === 'string')
    return kind === 12 ? (variables.get(raw) ?? raw) : (lists.get(raw) ?? raw)
  if (kind === 11) return typeof raw === 'string' ? raw : ''
  return String(raw ?? '')
}

const descriptorValue = (
  descriptor: unknown,
  graph: ScratchBlockGraph,
  variables: Map<string, string>,
  lists: Map<string, string>,
  renderInline: (id: string) => string,
): string => {
  if (typeof descriptor === 'string' && graph[descriptor]) return renderInline(descriptor)
  if (!Array.isArray(descriptor)) return String(descriptor ?? '')
  if ((descriptor[0] === 1 || descriptor[0] === 2) && typeof descriptor[1] === 'string' && graph[descriptor[1]])
    return renderInline(descriptor[1])
  if ((descriptor[0] === 1 || descriptor[0] === 2) && Array.isArray(descriptor[1]))
    return primitiveValue(descriptor[1], variables, lists)
  if (descriptor[0] === 2) return descriptorValue(descriptor[1], graph, variables, lists, renderInline)
  if (descriptor[0] === 3)
    return (
      descriptorValue(descriptor[1], graph, variables, lists, renderInline) ||
      primitiveValue(descriptor[2], variables, lists)
    )
  return primitiveValue(descriptor, variables, lists)
}

const formatCustomProcedure = (block: ScratchBlockGraphNode): string | undefined => {
  const mutation = isRecord(block.mutation) ? block.mutation : undefined
  const proccode = mutation && typeof mutation.proccode === 'string' ? mutation.proccode : undefined
  if (!proccode) return undefined
  if (block.opcode === 'procedures_call') return '呼叫自訂積木「' + proccode + '」'
  if (block.opcode === 'procedures_prototype') return '自訂積木標頭「' + proccode + '」'
  return '定義 ' + proccode
}

const formatBlock = (
  block: ScratchBlockGraphNode,
  graph: ScratchBlockGraph,
  variables: Map<string, string>,
  lists: Map<string, string>,
  renderInline: (id: string) => string,
): { readonly text: string; readonly readable: boolean } => {
  const custom = formatCustomProcedure(block)
  if (custom) return { text: custom, readable: true }
  if (block.opcode.startsWith('argument_reporter_')) {
    const field = isRecord(block.fields) ? fieldValue(block.fields.VALUE) : ''
    return { text: '參數「' + field + '」', readable: true }
  }
  const message = blockMessages[block.opcode]
  if (!message) return { text: '⟦未知：' + block.opcode + ' 積木，只能看⟧', readable: false }
  if (block.opcode === 'event_whenflagclicked') return { text: '當綠旗被點擊', readable: true }
  const inputs = isRecord(block.inputs) ? block.inputs : {}
  const fields = isRecord(block.fields) ? block.fields : {}
  const values = message.args.map((name) => {
    if (Object.hasOwn(fields, name)) return fieldValue(fields[name])
    if (Object.hasOwn(inputs, name)) return descriptorValue(inputs[name], graph, variables, lists, renderInline)
    return '？'
  })
  let text = message.template
  let valueIndex = 0
  text = text.replace(/%[0-9]+/g, () => values[valueIndex++] ?? '？')
  for (const [index, name] of message.args.entries()) text = text.replace('[' + name + ']', values[index] ?? '？')
  return { text, readable: true }
}

const commentsText = (target: RecordLike): string[] => {
  if (!isRecord(target.comments)) return []
  return Object.values(target.comments)
    .filter(isRecord)
    .map((comment) => asString(comment.text).trim())
    .filter(Boolean)
}

const costumeDescription = (costume: Costume): string => {
  const md5ext = asString(costume.md5ext)
  const official = officialCostumes.get(md5ext)
  if (official) return official
  const name = asString(costume.name, '未命名造型')
  const format = asString(costume.dataFormat, '未知格式')
  return (
    '自己畫或匯入的「' +
    name +
    '」（' +
    format +
    '，約 ' +
    String(costume.width ?? '?') +
    '×' +
    String(costume.height ?? '?') +
    '）'
  )
}

const colorName = (value: string): string | undefined => {
  const normalized = value.trim().toLowerCase()
  const colors: Readonly<Record<string, string>> = {
    '#f00': '紅色',
    '#ff0000': '紅色',
    '#0f0': '綠色',
    '#00ff00': '綠色',
    '#00f': '藍色',
    '#0000ff': '藍色',
    '#ff0': '黃色',
    '#ffff00': '黃色',
    '#0ff': '青色',
    '#00ffff': '青色',
    '#f0f': '紫紅色',
    '#ff00ff': '紫紅色',
    red: '紅色',
    orange: '橘色',
    yellow: '黃色',
    green: '綠色',
    blue: '藍色',
    purple: '紫色',
    brown: '棕色',
    pink: '粉紅色',
  }
  return colors[normalized]
}

const visualHint = (costume: Costume, assets: ReaderAssets): string => {
  const md5ext = asString(costume.md5ext)
  const entry = assets.entries?.find((candidate) => candidate.name === md5ext)
  if (!entry?.bytes) return ''
  const format = asString(costume.dataFormat).toLowerCase()
  if (format === 'svg') {
    const source = new TextDecoder().decode(entry.bytes)
    const colors = [...source.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?([^;"'\s]+)/gi)]
      .map((match) => colorName(match[1] ?? ''))
      .filter((color): color is string => color !== undefined)
    const unique = [...new Set(colors)]
    if (unique.length) return '；主要顏色約為' + unique.slice(0, 3).join('、')
    return ''
  }
  if (format === 'png' && entry.bytes.byteLength >= 24 && entry.bytes[0] === 0x89 && entry.bytes[1] === 0x50) {
    const view = new DataView(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    return `；實際畫面約 ${width}×${height} 像素，主要顏色需以畫面取樣`
  }
  return ''
}

const costumeDescriptionWithAssets = (costume: Costume, assets: ReaderAssets): string => {
  const description = costumeDescription(costume)
  return description + visualHint(costume, assets)
}

const targetDescription = (target: RecordLike, index: number, assets: ReaderAssets): string => {
  const name = asString(target.name, '角色 ' + index)
  const costumes = targetCostumes(target)
  if (target.isStage === true) {
    const backdrop = costumes[asNumber(target.currentCostume)]
    return [
      '## 舞台「' + name + '」',
      '- 舞台大小：480×360。',
      '- 目前背景：' + (backdrop ? costumeDescriptionWithAssets(backdrop, assets) : '沒有可辨識的背景') + '。',
    ].join('\n')
  }
  const x = asNumber(target.x)
  const y = asNumber(target.y)
  const currentCostume = costumes[asNumber(target.currentCostume)]
  const visible = target.visible === false ? '隱藏' : '看得到'
  const lines = [
    '## 角色「' + name + '」',
    '- 外觀：' +
      (currentCostume ? costumeDescriptionWithAssets(currentCostume, assets) : '沒有造型') +
      '；共 ' +
      costumes.length +
      ' 個造型。',
    '- 位置：x ' +
      x +
      '、y ' +
      y +
      '，在舞台' +
      positionZone(x, y) +
      '；大小 ' +
      asNumber(target.size, 100) +
      '%，方向 ' +
      asNumber(target.direction, 90) +
      '°，' +
      visible +
      '。',
  ]
  const comments = commentsText(target)
  if (comments.length) lines.push('- 註解：' + comments.map((comment) => '「' + comment + '」').join('、'))
  return lines.join('\n')
}

export const readProjectForAi = (
  projectJson: Record<string, unknown>,
  _assets: ReaderAssets = {},
  options: ReaderOptions = {},
): ProjectReaderResult => {
  const targets = Array.isArray(projectJson.targets) ? projectJson.targets.filter(isRecord) : []
  const graphs = extractProjectBlockGraphs(projectJson)
  const lineMap = new Map<string, { readonly targetIndex: number; readonly blockId: string }>()
  const allSections: ReaderSection[] = []
  let lineNumber = 0
  let blocks = 0
  let readable = 0
  let opaque = 0
  const targetSummaries: string[] = []
  const scriptPreviews: string[] = []
  const scriptSections: ReaderSection[] = []

  for (const [targetIndex, target] of targets.entries()) {
    const graph = graphs[targetIndex]
    if (!graph) continue
    const variables = targetVariables(target)
    const lists = targetLists(target)
    const used = new Set<string>()
    const targetLines: string[] = []
    for (const block of Object.values(graph.blocks)) {
      if (block.shadow === true) continue
      blocks += 1
      if (
        blockMessages[block.opcode] ||
        formatCustomProcedure(block) ||
        block.opcode.startsWith('argument_reporter_')
      )
        readable += 1
      else opaque += 1
    }
    const scripts = Object.entries(graph.blocks).filter(
      ([, block]) => block.topLevel === true && block.shadow !== true,
    )
    let renderInline: (id: string) => string
    renderInline = (id: string): string => {
      const block: ScratchBlockGraphNode | undefined = graph.blocks[id]
      if (!block) return id
      used.add(id)
      return formatBlock(block, graph.blocks, variables, lists, renderInline).text
    }
    const renderStack = (startId: string, depth: number, visited: Set<string>): void => {
      let id: string | null | undefined = startId
      while (typeof id === 'string') {
        if (visited.has(id)) {
          targetLines.push('  '.repeat(depth) + '⟦積木鏈循環：' + id + '⟧')
          break
        }
        visited.add(id)
        used.add(id)
        const block: ScratchBlockGraphNode | undefined = graph.blocks[id]
        if (!block) break
        const result = formatBlock(block, graph.blocks, variables, lists, renderInline)
        if (block.shadow !== true) {
          lineNumber += 1
          const line = 'L' + lineNumber
          lineMap.set(line, { targetIndex, blockId: id })
          targetLines.push(line + ' ' + '  '.repeat(depth) + result.text)
        }
        const inputs = isRecord(block.inputs) ? block.inputs : {}
        for (const [, descriptor] of Object.entries(inputs).filter(([name]) => name.startsWith('SUBSTACK'))) {
          const substack = Array.isArray(descriptor) ? descriptor[1] : undefined
          if (typeof substack === 'string' && graph.blocks[substack])
            renderStack(substack, depth + 1, new Set(visited))
          else if (substack !== undefined) targetLines.push('  '.repeat(depth + 1) + '⟦空的子程式⟧')
        }
        id = typeof block.next === 'string' ? block.next : null
      }
    }
    for (const [id] of scripts) {
      const before = targetLines.length
      renderStack(id, 0, new Set<string>())
      if (targetLines.length > before) {
        const scriptLines = targetLines.slice(before)
        scriptSections.push({
          id: 'script:' + id,
          targetIndex,
          text: '### 程式 ' + id + '\n' + scriptLines.join('\n'),
          blockIds: scriptLines
            .map((line) => /^L(\d+)/.exec(line)?.[1])
            .map((line) => (line ? lineMap.get('L' + line)?.blockId : undefined))
            .filter((blockId): blockId is string => blockId !== undefined),
        })
        scriptPreviews.push(
          '- ' +
            asString(target.name, '角色 ' + targetIndex) +
            ' 的程式 ' +
            id +
            '：\n' +
            targetLines.slice(before, before + 6).join('\n'),
        )
      }
    }
    const orphan = Object.entries(graph.blocks).filter(([id, block]) => block.shadow !== true && !used.has(id))
    if (orphan.length) {
      targetLines.push('### 散落的積木（不會執行）')
      for (const [id, block] of orphan) {
        const result = formatBlock(block, graph.blocks, variables, lists, renderInline)
        lineNumber += 1
        const line = 'L' + lineNumber
        lineMap.set(line, { targetIndex, blockId: id })
        targetLines.push(line + ' ' + result.text)
      }
    }
    targetSummaries.push(targetDescription(target, targetIndex, _assets))
    allSections.push({
      id: 'sprite:' + asString(target.name, '角色 ' + targetIndex),
      targetIndex,
      text: [
        targetDescription(target, targetIndex, _assets),
        targetLines.length ? '### 程式\n' + targetLines.join('\n') : '（沒有程式）',
      ].join('\n\n'),
      blockIds: Object.keys(graph.blocks),
    })
  }

  const title = options.title ?? asString(projectJson.projectName, '未命名作品')
  const overview = [
    '# 作品「' + title + '」',
    '舞台大小：480×360。',
    targetSummaries.length ? targetSummaries.join('\n\n') : '作品沒有角色或舞台。',
    options.authorInstructions?.trim() ? '## 作者操作說明\n' + options.authorInstructions.trim() : '',
    options.notesAndCredits?.trim() ? '## 作者備註\n' + options.notesAndCredits.trim() : '',
    '## 讀本涵蓋率\n可讀 ' + readable + '/' + blocks + ' 個積木；' + opaque + ' 個積木只能保留原樣。',
  ]
    .filter(Boolean)
    .join('\n\n')
  const overviewSection: ReaderSection = { id: 'overview', text: overview }
  const sections = [overviewSection, ...allSections, ...scriptSections]
  const maxChars = options.maxChars ?? 24000
  const fullText = sections.map((section) => section.text).join('\n\n')
  let text = fullText
  if (text.length > maxChars) {
    const prefix = [
      overview,
      '## 大作品提示\n需要讀完整程式時，請依角色和行號使用分段讀取。',
      ...scriptPreviews,
    ].join('\n\n')
    text = prefix.slice(0, maxChars)
  }
  return { text, sections, lineMap, coverage: { blocks, readable, opaque } }
}
/* eslint-enable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition, prefer-const */
