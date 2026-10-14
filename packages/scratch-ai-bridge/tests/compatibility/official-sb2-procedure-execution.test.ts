import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProject } from '../../src/core/compiler/compiler'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler/decompiler'
import type { ScratchVMHandle } from '../../src/scratch'
import { createVM, loadSb3, runForTicks, saveSb3 } from '../../src/scratch'

const getProcedureFixturePath = (fixtureName: string): string =>
  fileURLToPath(new URL(`../../../scratch-vm/test/fixtures/execute/${fixtureName}.sb2`, import.meta.url))
const officialProcedureFixtureNames = [
  'procedures-recursive-default-string',
  'procedures-recursive-default-number',
  'procedures-recursive-default-boolean',
  'procedures-nested-missing-no-param',
  'procedures-nested-missing-string-param',
  'procedures-nested-missing-number-param',
  'procedures-nested-missing-boolean-param',
  'procedures-param-outside-string',
  'procedures-param-outside-number',
  'procedures-param-outside-boolean',
  'procedures-number-number-boolean',
  'procedures-boolean-reporter-bug',
].sort()
const officialSb3ProcedureFixturePath = fileURLToPath(
  new URL('../../../scratch-vm/test/fixtures/load-extensions/confirm-load/pen-dolphin-3d.sb3', import.meta.url),
)

const createOfficialSb3ProcedureSlice = async (): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(await readFile(officialSb3ProcedureFixturePath))
  const projectEntry = zip.file('project.json')
  if (!projectEntry) throw new Error('Official SB3 procedure fixture has no project.json')
  const project = JSON.parse(await projectEntry.async('string')) as {
    targets: {
      name: string
      isStage?: boolean
      blocks?: Record<string, unknown>
      costumes?: unknown[]
      sounds?: unknown[]
      currentCostume?: number
    }[]
    extensions?: string[]
    monitors?: unknown[]
  }
  const retainedTargets = project.targets.filter((target) => target.isStage === true || target.name === 'Title')
  if (retainedTargets.length !== 2 || !retainedTargets.some((target) => target.name === 'Title')) {
    throw new Error('Official SB3 procedure fixture no longer has its Stage and Title targets')
  }
  project.targets = retainedTargets
  const title = retainedTargets.find((target) => target.name === 'Title')
  if (!title?.blocks) throw new Error('Official SB3 procedure fixture Title target has no block graph')
  for (const value of Object.values(title.blocks)) {
    const block = value as { opcode?: unknown; inputs?: Record<string, unknown> }
    const duration = block.inputs?.DURATION
    if (block.opcode === 'control_wait' && Array.isArray(duration) && Array.isArray(duration[1])) {
      duration[1][1] = 0
    }
  }
  const stage = retainedTargets.find((target) => target.isStage)
  if (!stage) throw new Error('Official SB3 procedure fixture has no Stage target')
  stage.blocks = {}
  const blankSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
  )
  const blankAssetId = createHash('md5').update(blankSvg).digest('hex')
  for (const target of retainedTargets) {
    target.costumes = [
      {
        assetId: blankAssetId,
        dataFormat: 'svg',
        md5ext: `${blankAssetId}.svg`,
        name: 'procedure-test-blank',
        bitmapResolution: 1,
        rotationCenterX: 0.5,
        rotationCenterY: 0.5,
      },
    ]
    target.sounds = []
    target.currentCostume = 0
  }
  project.extensions = (project.extensions ?? []).filter((extensionId) => extensionId !== 'pen')
  project.monitors = []
  zip.file('project.json', JSON.stringify(project))
  zip.file(`${blankAssetId}.svg`, blankSvg)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const createIndependentSb3ProcedureFixture = async (): Promise<Uint8Array> => {
  const blankSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
  )
  const blankAssetId = createHash('md5').update(blankSvg).digest('hex')
  const blankCostume = {
    assetId: blankAssetId,
    name: 'blank',
    bitmapResolution: 1,
    md5ext: `${blankAssetId}.svg`,
    dataFormat: 'svg',
    rotationCenterX: 0.5,
    rotationCenterY: 0.5,
  }
  const targetDefaults = {
    variables: {},
    lists: {},
    broadcasts: {},
    comments: {},
    currentCostume: 0,
    costumes: [blankCostume],
    sounds: [],
    volume: 100,
  }
  const spriteBlocks = {
    hat: {
      opcode: 'event_whenflagclicked',
      next: 'call',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    call: {
      opcode: 'procedures_call',
      next: null,
      parent: 'hat',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: { tagName: 'mutation', children: [], proccode: 'mark execution', argumentids: '[]' },
    },
    definition: {
      opcode: 'procedures_definition',
      next: 'say',
      parent: null,
      inputs: { custom_block: [1, 'prototype'] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 80,
    },
    prototype: {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'definition',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'mark execution',
        argumentnames: '[]',
        argumentids: '[]',
        argumentdefaults: '[]',
        warp: false,
      },
    },
    say: {
      opcode: 'looks_say',
      next: null,
      parent: 'definition',
      inputs: { MESSAGE: [1, [10, 'independent fixture executed']] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
  }
  const project = {
    targets: [
      { ...targetDefaults, isStage: true, name: 'Stage', blocks: {}, layerOrder: 0, tempo: 60 },
      {
        ...targetDefaults,
        isStage: false,
        name: 'ProcedureFixture',
        blocks: spriteBlocks,
        layerOrder: 1,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        visible: true,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: 'Scratch AI Bridge procedure compatibility fixture' },
  }
  const archive = new JSZip()
  archive.file('project.json', JSON.stringify(project))
  archive.file(`${blankAssetId}.svg`, blankSvg)
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const observeRuntimeProcedureCalls = (vm: ScratchVMHandle): (() => ReadonlySet<string>) => {
  const runtime = (
    vm as ScratchVMHandle & {
      runtime: { _primitives: Record<string, (...args: unknown[]) => unknown> }
    }
  ).runtime
  const primitive = runtime._primitives.procedures_call
  const procedureNames = new Set<string>()
  runtime._primitives.procedures_call = (...args) => {
    const mutation = (args[0] as { mutation?: { proccode?: unknown } } | undefined)?.mutation
    if (typeof mutation?.proccode === 'string') procedureNames.add(mutation.proccode)
    return primitive(...args)
  }
  return () => procedureNames
}

const loadVisualFreeSb2Archive = async (path: string): Promise<Uint8Array> => {
  const sourceZip = await JSZip.loadAsync(await readFile(path))
  const projectEntry = sourceZip.file('project.json')
  if (!projectEntry) throw new Error('Official SB2 procedure fixture has no project.json')
  const project = JSON.parse(await projectEntry.async('string')) as {
    costumes?: unknown[]
    sounds?: unknown[]
    children?: { costumes?: unknown[]; sounds?: unknown[] }[]
  }
  for (const target of [project, ...(project.children ?? [])]) {
    target.costumes = []
    target.sounds = []
  }
  const fixtureZip = new JSZip()
  fixtureZip.file('project.json', JSON.stringify(project))
  return fixtureZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const resetEmptyCostumeIndices = async (archive: Blob): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(archive)
  const projectEntry = zip.file('project.json')
  if (!projectEntry) throw new Error('Scratch VM SB3 output has no project.json')
  const project = JSON.parse(await projectEntry.async('string')) as {
    targets: {
      costumes: unknown[]
      currentCostume: number
    }[]
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'
  const assetBytes = new TextEncoder().encode(svg)
  const assetId = createHash('md5').update(assetBytes).digest('hex')
  for (const target of project.targets) {
    if (target.costumes.length === 0) {
      target.costumes = [
        {
          assetId,
          dataFormat: 'svg',
          md5ext: `${assetId}.svg`,
          name: 'test-costume',
          bitmapResolution: 1,
          rotationCenterX: 0.5,
          rotationCenterY: 0.5,
        },
      ]
      target.currentCostume = 0
    }
  }
  zip.file('project.json', JSON.stringify(project))
  zip.file(`${assetId}.svg`, assetBytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const observeSayMessages = (vm: ScratchVMHandle): string[] => {
  const messages: string[] = []
  const internalVM = vm as ScratchVMHandle & {
    runtime: {
      on(event: string, listener: (target: unknown, type: string, text: string) => void): void
    }
  }
  internalVM.runtime.on('SAY', (_target, _type, text) => messages.push(text))
  return messages
}

const procedureAssertions = (messages: readonly string[]): string[] =>
  messages.map((message) => message.trim()).filter((message) => /^(?:plan|pass|fail|end)\b/i.test(message))

const assertOfficialProcedureResults = (messages: readonly string[]): void => {
  const assertions = procedureAssertions(messages)
  const planMessage = assertions.find((message) => /^plan\s+/i.test(message))
  const passes = assertions.filter((message) => /^pass\b/i.test(message))
  expect(assertions.filter((message) => /^fail\b/i.test(message))).toEqual([])
  expect(assertions).toContain('end')
  if (planMessage) expect(passes).toHaveLength(Number(planMessage.split(/\s+/)[1]))
  else expect(passes.length).toBeGreaterThan(0)
}

describe('Official legacy procedure execution through Scratch VM normalization', () => {
  it('includes every upstream SB2 procedure execution fixture in the explicit test matrix', async () => {
    const fixtureDirectory = fileURLToPath(new URL('../../../scratch-vm/test/fixtures/execute/', import.meta.url))
    const upstreamProcedureFixtures = (await readdir(fixtureDirectory))
      .filter((name) => /^procedures-.*\.sb2$/.test(name))
      .map((name) => name.slice(0, -'.sb2'.length))
      .sort()
    expect(upstreamProcedureFixtures).toEqual(officialProcedureFixtureNames)
  })

  it('executes an independent SB3 procedure graph before and after Canonical recompilation', async () => {
    const sourceArchive = await createIndependentSb3ProcedureFixture()
    const sourceVm = createVM() as ScratchVMHandle & { loadProject(input: Uint8Array): Promise<void> }
    let bridgeVm: ScratchVMHandle | undefined
    let reloadedVm: ScratchVMHandle | undefined
    try {
      await sourceVm.loadProject(sourceArchive)
      const sourceMessages = observeSayMessages(sourceVm)
      runForTicks(sourceVm, 20)
      expect(sourceMessages).toContain('independent fixture executed')

      const imported = await decompileSb3WithBlockGraphs(sourceArchive, 'independent-sb3-procedure-fixture')
      expect(imported.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
      expect(imported.canonical.sprites[0]?.procedures.map(({ name }) => name)).toEqual(['mark execution'])
      const canonicalCall = imported.canonical.sprites[0]?.scripts
        .flatMap(({ blocks }) => blocks)
        .find(({ opcode }) => opcode === 'procedures_call')
      expect(canonicalCall).toMatchObject({ procedure: { name: 'mark execution' } })

      bridgeVm = (await compileCanonicalProject(imported.canonical)).vm
      const bridgeMessages = observeSayMessages(bridgeVm)
      runForTicks(bridgeVm, 20)
      expect(bridgeMessages).toContain('independent fixture executed')

      reloadedVm = createVM()
      await loadSb3(await saveSb3(bridgeVm), reloadedVm)
      const reloadedMessages = observeSayMessages(reloadedVm)
      runForTicks(reloadedVm, 20)
      expect(reloadedMessages).toContain('independent fixture executed')
    } finally {
      sourceVm.quit()
      bridgeVm?.quit()
      reloadedVm?.quit()
    }
  })

  it('executes the procedure-bearing Title target from the official SB3 fixture through Canonical recompilation', async () => {
    const sourceArchive = await createOfficialSb3ProcedureSlice()
    const sourceVm = createVM() as ScratchVMHandle & { loadProject(input: Uint8Array): Promise<void> }
    let bridgeVm: ScratchVMHandle | undefined
    let reloadedVm: ScratchVMHandle | undefined
    try {
      await sourceVm.loadProject(sourceArchive)
      const sourceProcedureCalls = observeRuntimeProcedureCalls(sourceVm)
      runForTicks(sourceVm, 400)
      expect([...sourceProcedureCalls()]).toEqual(expect.arrayContaining(['fade in', 'fade out']))

      const imported = await decompileSb3WithBlockGraphs(sourceArchive, 'official-sb3-title-procedure-slice')
      expect(imported.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
      const title = imported.canonical.sprites.find(({ name }) => name === 'Title')
      expect(title?.procedures.map(({ name }) => name).sort()).toEqual(['fade in', 'fade out'])
      expect(imported.canonical.sprites.flatMap(({ scripts }) => scripts).flatMap(({ blocks }) => blocks)).toEqual(
        expect.arrayContaining([expect.objectContaining({ opcode: 'procedures_call' })]),
      )

      bridgeVm = (await compileCanonicalProject(imported.canonical)).vm
      const bridgeProcedureCalls = observeRuntimeProcedureCalls(bridgeVm)
      runForTicks(bridgeVm, 400)
      expect([...bridgeProcedureCalls()]).toEqual(expect.arrayContaining(['fade in', 'fade out']))

      reloadedVm = createVM()
      await loadSb3(await saveSb3(bridgeVm), reloadedVm)
      const reloadedProcedureCalls = observeRuntimeProcedureCalls(reloadedVm)
      runForTicks(reloadedVm, 400)
      expect([...reloadedProcedureCalls()]).toEqual(expect.arrayContaining(['fade in', 'fade out']))
    } finally {
      sourceVm.quit()
      bridgeVm?.quit()
      reloadedVm?.quit()
    }
  }, 30_000)

  it.each(officialProcedureFixtureNames)(
    'preserves official fixture %s through Canonical compile and reload',
    async (fixtureName) => {
      const legacyVm = createVM() as ScratchVMHandle & { loadProject(input: Uint8Array): Promise<void> }
      let bridgeVm: ScratchVMHandle | undefined
      try {
        await legacyVm.loadProject(await loadVisualFreeSb2Archive(getProcedureFixturePath(fixtureName)))
        const legacyMessages = observeSayMessages(legacyVm)
        runForTicks(legacyVm, 2_000)
        assertOfficialProcedureResults(legacyMessages)
        const sb3 = await resetEmptyCostumeIndices(await saveSb3(legacyVm))
        const normalized = await decompileSb3WithBlockGraphs(sb3, fixtureName)

        // The official test project was stripped of art so its procedure execution can run in Node.
        const compiled = await compileCanonicalProject(normalized.canonical)
        bridgeVm = compiled.vm
        const bridgeMessages = observeSayMessages(bridgeVm)
        runForTicks(bridgeVm, 2_000)
        assertOfficialProcedureResults(bridgeMessages)
        expect(procedureAssertions(bridgeMessages)).toEqual(procedureAssertions(legacyMessages))

        const directSb3Vm = createVM()
        try {
          await loadSb3(await saveSb3(bridgeVm), directSb3Vm)
          const directSb3Messages = observeSayMessages(directSb3Vm)
          runForTicks(directSb3Vm, 2_000)
          assertOfficialProcedureResults(directSb3Messages)
          expect(procedureAssertions(directSb3Messages)).toEqual(procedureAssertions(legacyMessages))
        } finally {
          directSb3Vm.quit()
        }
      } finally {
        legacyVm.quit()
        bridgeVm?.quit()
      }
    },
  )
})
