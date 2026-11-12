// Measures how readable a folder of .sb3 files is for the AI today; the numbers go in the hand-made sb3 plan.
// Usage (from packages/scratch-ai-bridge): npx tsx scripts/tools/measure-corpus.ts <folder> [--json]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inspectRawProjectForAi } from '../../src/core/ai/raw-tool-core'
import { importLosslessSb3 } from '../../src/core/archive/sb3-archive'
import { extractProjectBlockGraphs, isToleratedGraphIssue } from '../../src/core/graph/block-graph'
import { readProjectForAi } from '../../src/core/reader'
import library from '../../src/core/visuals/library-index.json'

interface RawBlock {
  readonly opcode: string
  readonly shadow?: boolean
  readonly topLevel?: boolean
}
interface RawTarget {
  readonly blocks: Record<string, RawBlock | unknown[]>
  readonly comments?: Record<string, unknown>
  readonly costumes: readonly { readonly assetId: string }[]
}

const official = new Set<string>()
for (const sprite of library.sprites)
  for (const costume of sprite.costumes) official.add(String(costume[1]).split('.')[0])
for (const backdrop of library.backdrops) official.add(String(backdrop.costume[1]).split('.')[0])
const CORE = /^(motion|looks|sound|event|control|sensing|operator|data|procedures|argument)_/

const main = async (): Promise<void> => {
  const [folder, flag] = process.argv.slice(2)
  const rows = []
  for (const name of readdirSync(folder)
    .filter((file) => file.endsWith('.sb3'))
    .sort()) {
    const project = await importLosslessSb3(readFileSync(join(folder, name)))
    const targets = (project.projectJson as { targets: RawTarget[] }).targets
    let blocks = 0
    let scripts = 0
    let extensionBlocks = 0
    let comments = 0
    let costumes = 0
    let officialCostumes = 0
    let rawBlockJsonChars = 0
    const extensions = new Set<string>()
    for (const target of targets) {
      rawBlockJsonChars += JSON.stringify(target.blocks).length
      for (const block of Object.values(target.blocks)) {
        if (Array.isArray(block) || block.shadow) continue
        blocks += 1
        if (block.topLevel) scripts += 1
        if (!CORE.test(block.opcode)) {
          extensionBlocks += 1
          extensions.add(block.opcode.split('_')[0])
        }
      }
      comments += Object.keys(target.comments ?? {}).length
      for (const costume of target.costumes) {
        costumes += 1
        if (official.has(costume.assetId)) officialCostumes += 1
      }
    }
    const graphs = extractProjectBlockGraphs(project.projectJson)
    const reader = readProjectForAi(project.projectJson, { entries: project.entries })
    const issues = graphs.flatMap((graph) => graph.issues)
    const lockedSprites = graphs
      .filter((graph) => !graph.issues.every((issue) => isToleratedGraphIssue(issue, graph.blocks)))
      .map((graph) => graph.targetName)
    const issueCodes: Record<string, number> = {}
    for (const issue of issues) issueCodes[issue.code] = (issueCodes[issue.code] ?? 0) + 1
    rows.push({
      name,
      sprites: targets.length - 1,
      blocks,
      scripts,
      extensionBlocks,
      extensions: [...extensions].join(','),
      comments,
      costumes,
      officialCostumes,
      rawBlockJsonChars,
      firstPromptChars: inspectRawProjectForAi(project).length,
      readerChars: reader.text.length,
      readerBlocks: reader.coverage.blocks,
      readerReadable: reader.coverage.readable,
      readerOpaque: reader.coverage.opaque,
      pagesOf10: Math.ceil(blocks / 10),
      graphIssues: issues.length,
      lockedSprites: lockedSprites.join(','),
      issueCodes,
    })
  }
  if (flag === '--json') console.log(JSON.stringify(rows, null, 2))
  else console.table(rows.map(({ issueCodes: _codes, ...row }) => row))
}

void main()
