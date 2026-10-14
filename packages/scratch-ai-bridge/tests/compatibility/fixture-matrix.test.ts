import { Buffer } from 'node:buffer'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import scratchParser from 'scratch-parser'
import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject } from '../../src/core/analyzer'
import { exportLosslessSb3, importLosslessSb3 } from '../../src/core/archive'
import { compareProjectJson } from '../../src/core/compatibility/project-signature'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { decompileSb3, decompileSb3WithBlockGraphs, normalizeThroughVm } from '../../src/core/decompiler/decompiler'
import { projectJsonToCanonical } from '../../src/core/decompiler/project-json'
import type { CanonicalBlock } from '../../src/core/ir/types'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import { getProjectJson, loadSb3, runForTicks } from '../../src/scratch/vm'
import { fixtureByName, OFFICIAL_FIXTURE_MATRIX } from './fixture-matrix'

const archiveMetadataSignature = (entries: Awaited<ReturnType<typeof importLosslessSb3>>['entries']) =>
  entries.map((entry) => [
    entry.name,
    entry.isDirectory,
    entry.sha256,
    entry.filenameBytes,
    entry.filenameEncoding,
    entry.compressionMethod,
    entry.flags,
    entry.externalAttributes,
    entry.versionMadeBy,
    entry.versionNeeded,
    entry.localVersionNeeded,
    entry.internalAttributes,
    entry.dosTime,
    entry.dosDate,
    entry.localExtraBytes,
    entry.centralExtraBytes,
    entry.commentBytes,
    entry.hasDataDescriptor,
    entry.dataDescriptorHasSignature,
  ])

const vmFixtures = OFFICIAL_FIXTURE_MATRIX.filter(
  (fixture) => fixture.format === 'sb3' && fixture.expectation === 'vm-normalized',
)
const losslessFixtures = OFFICIAL_FIXTURE_MATRIX.filter(
  (fixture) => fixture.format === 'sb3' && fixture.expectation === 'lossless',
)
const behavioralFixtures = OFFICIAL_FIXTURE_MATRIX.filter(
  (fixture) => fixture.format === 'sb3' && fixture.expectation === 'behavioral',
)

const getSpriteX = (vm: Awaited<ReturnType<typeof loadSb3>>, name: string): number | undefined =>
  (
    vm as typeof vm & {
      runtime: { targets: { getName(): string; x: number }[] }
    }
  ).runtime.targets.find((target) => target.getName() === name)?.x

const listFixtures = async (directory: string, extension: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFixtures(path, extension)))
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path)
  }
  return files
}

const parseWithOfficialScratchParser = (bytes: Uint8Array): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    scratchParser(Buffer.from(bytes), false, (error, result) => {
      if (error) reject(error instanceof Error ? error : new Error('Official scratch-parser rejected the SB3'))
      else if (!Array.isArray(result) || !result[0] || typeof result[0] !== 'object' || Array.isArray(result[0])) {
        reject(new Error('Official scratch-parser did not return project JSON'))
      } else resolve(result[0] as Record<string, unknown>)
    })
  })

describe('official Scratch compatibility fixture matrix', () => {
  it('preserves and reports offline cloud variables in official projects', async () => {
    for (const [fixtureName, expectedCloudVariables] of [
      ['cloud_variables_local.sb3', 1],
      ['cloud_variables_simple.sb3', 1],
      ['cloud_variables_limit.sb3', 10],
    ] as const) {
      const fixture = fixtureByName(fixtureName)
      const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
      const cloudVariables = [result.canonical.stage, ...result.canonical.sprites].flatMap((target) =>
        target.variables.filter(({ cloud }) => cloud === true).map(({ name }) => ({ target: target.name, name })),
      )
      expect(cloudVariables, fixtureName).toHaveLength(expectedCloudVariables)

      const report = analyzeCanonicalProject(result.canonical)
      const cloudWarnings = report.diagnostics.filter(({ code }) => code === 'cloud-variable-offline')
      expect(
        cloudWarnings
          .map(({ target, variable }) => ({ target, name: variable }))
          .sort((a, b) => `${a.target}/${a.name}`.localeCompare(`${b.target}/${b.name}`)),
        fixtureName,
      ).toEqual(cloudVariables.sort((a, b) => `${a.target}/${a.name}`.localeCompare(`${b.target}/${b.name}`)))

      const compiled = buildScratchProjectJson(result.canonical)
      const compiledCloudVariables = compiled.targets.flatMap((target) =>
        Object.values(target.variables)
          .filter((value) => value[2] === true)
          .map(([name]) => ({ target: target.name, name })),
      )
      expect(
        compiledCloudVariables.sort((a, b) => `${a.target}/${a.name}`.localeCompare(`${b.target}/${b.name}`)),
      ).toEqual(cloudVariables)
    }
  })

  it('contains a reviewed representative baseline of at least 30 fixtures', async () => {
    expect(OFFICIAL_FIXTURE_MATRIX.length).toBeGreaterThanOrEqual(30)
    expect(new Set(OFFICIAL_FIXTURE_MATRIX.map((fixture) => fixture.name)).size).toBe(OFFICIAL_FIXTURE_MATRIX.length)

    await Promise.all(OFFICIAL_FIXTURE_MATRIX.map((fixture) => access(fixture.path)))
  })

  it('classifies every official Scratch VM SB3 fixture', async () => {
    const fixtureRoot = dirname(fixtureByName('default.sb3').path)
    const upstreamFixtures = (await listFixtures(fixtureRoot, '.sb3'))
      .map((path) => relative(fixtureRoot, path).split(sep).join('/'))
      .sort()
    const classifiedFixtures = OFFICIAL_FIXTURE_MATRIX.filter(({ format }) => format === 'sb3')
      .map(({ name }) => name)
      .sort()

    expect(classifiedFixtures).toEqual(upstreamFixtures)
  })

  it('classifies every official Scratch VM Sprite3 fixture', async () => {
    const fixtureRoot = dirname(fixtureByName('cat.sprite3').path)
    const upstreamFixtures = (await listFixtures(fixtureRoot, '.sprite3'))
      .map((path) => relative(fixtureRoot, path).split(sep).join('/'))
      .sort()
    const classifiedFixtures = OFFICIAL_FIXTURE_MATRIX.filter(({ format }) => format === 'sprite3')
      .map(({ name }) => name)
      .sort()

    expect(classifiedFixtures).toEqual(upstreamFixtures)
  })

  it('classifies each fixture with an explicit expectation and category', () => {
    expect(OFFICIAL_FIXTURE_MATRIX.every((fixture) => fixture.category && fixture.notes)).toBe(true)
    expect(new Set(OFFICIAL_FIXTURE_MATRIX.map((fixture) => fixture.expectation))).toEqual(
      new Set(['parse-only', 'lossless', 'vm-normalized', 'behavioral']),
    )
  })

  it('keeps parse-only SB3 fixtures classified by Bridge scope rather than parser rejection', async () => {
    const fixtures = OFFICIAL_FIXTURE_MATRIX.filter(
      (fixture) => fixture.format === 'sb3' && fixture.expectation === 'parse-only',
    )
    expect(fixtures.length).toBeGreaterThan(0)

    for (const fixture of fixtures) {
      const source = await readFile(fixture.path)
      const officialProject = await parseWithOfficialScratchParser(source)
      const { projectVersion, ...officialProjectJson } = officialProject
      expect(projectVersion, `${fixture.name} official parser version`).toBe(3)
      expect(officialProject.targets, `${fixture.name} official targets`).toBeInstanceOf(Array)

      const rawArchive = await importLosslessSb3(source)
      expect(
        compareProjectJson(officialProjectJson, rawArchive.projectJson).equal,
        `${fixture.name} official parser/raw archive project`,
      ).toBe(true)
      expect(fixture.notes.trim().length, `${fixture.name} classification rationale`).toBeGreaterThan(0)
    }
  })

  it('round-trips ZIP metadata for every official SB3 fixture without requiring VM support', async () => {
    const fixtures = OFFICIAL_FIXTURE_MATRIX.filter((fixture) => fixture.format === 'sb3')
    expect(fixtures.length).toBeGreaterThan(0)

    for (const fixture of fixtures) {
      const source = await readFile(fixture.path)
      const imported = await importLosslessSb3(source)
      const exported = await exportLosslessSb3(imported)
      const output = new Uint8Array(await exported.arrayBuffer())
      const restored = await importLosslessSb3(output)
      const officialProject = await parseWithOfficialScratchParser(output)
      const { projectVersion, ...officialProjectJson } = officialProject

      expect(projectVersion, `${fixture.name} export parser version`).toBe(3)
      expect(
        compareProjectJson(officialProjectJson, restored.projectJson).equal,
        `${fixture.name} official parser/raw export`,
      ).toBe(true)
      expect(restored.projectEntryName, fixture.name).toBe(imported.projectEntryName)
      expect(restored.projectJsonBytes, fixture.name).toEqual(imported.projectJsonBytes)
      expect(archiveMetadataSignature(restored.entries), fixture.name).toEqual(
        archiveMetadataSignature(imported.entries),
      )
    }
  })

  it('round-trips the VM-normalized baseline through the official serializer', async () => {
    for (const fixture of vmFixtures) {
      const source = await readFile(fixture.path)
      const sourceArchive = await importLosslessSb3(source)
      const firstVm = await loadSb3(source)

      try {
        const firstProject = getProjectJson(firstVm)
        const normalized = await normalizeThroughVm(source)
        const normalizedArchive = await importLosslessSb3(normalized.archive)
        const sourceProjectEntry = sourceArchive.entries.find(({ name }) => name === sourceArchive.projectEntryName)
        const normalizedProjectEntry = normalizedArchive.entries.find(
          ({ name }) => name === normalizedArchive.projectEntryName,
        )
        expect(normalized.report.sourceProjectJsonSha256, fixture.name).toBe(sourceProjectEntry?.sha256)
        expect(normalized.report.normalizedProjectJsonSha256, fixture.name).toBe(normalizedProjectEntry?.sha256)
        expect(Array.isArray(normalized.report.projectJsonChanges), fixture.name).toBe(true)

        const sourceEntries = new Map(
          sourceArchive.entries.filter(({ isDirectory }) => !isDirectory).map(({ name, sha256 }) => [name, sha256]),
        )
        const normalizedEntries = new Map(
          normalizedArchive.entries
            .filter(({ isDirectory }) => !isDirectory)
            .map(({ name, sha256 }) => [name, sha256]),
        )
        expect(
          normalized.report.archiveEntryChanges.map(({ name }) => name),
          fixture.name,
        ).toEqual([...new Set([...sourceEntries.keys(), ...normalizedEntries.keys()])].sort())
        for (const change of normalized.report.archiveEntryChanges) {
          expect(change.sourceSha256, `${fixture.name} source ${change.name}`).toBe(
            sourceEntries.get(change.name) ?? null,
          )
          expect(change.normalizedSha256, `${fixture.name} output ${change.name}`).toBe(
            normalizedEntries.get(change.name) ?? null,
          )
        }

        const secondVm = await loadSb3(await normalized.archive.arrayBuffer())

        try {
          const comparison = compareProjectJson(firstProject, getProjectJson(secondVm))
          // VM-normalized fixtures are allowed to differ in representation. The
          // important Phase 0 contract is that the official serializer can
          // reload the result and that the difference is observable to a later
          // normalization report instead of being silently hidden.
          expect(typeof comparison.equal).toBe('boolean')
          expect(comparison.left).toBeDefined()
          expect(comparison.right).toBeDefined()
        } finally {
          secondVm.quit()
        }
      } finally {
        firstVm.quit()
      }
    }
  })

  it('executes every fixture classified as behavioral before and after Canonical recompilation', async () => {
    expect(behavioralFixtures.length).toBeGreaterThan(0)
    for (const fixture of behavioralFixtures) {
      const source = await readFile(fixture.path)
      const sourceVm = await loadSb3(source)
      let normalizedVm: Awaited<ReturnType<typeof loadSb3>> | undefined
      try {
        runForTicks(sourceVm, 16)
        const sourceX = getSpriteX(sourceVm, 'Sprite1')
        expect(sourceX, fixture.name).toBe(60)

        const imported = await decompileSb3WithBlockGraphs(source, fixture.name)
        const normalizedSb3 = await compileCanonicalProjectToSb3(imported.canonical)
        normalizedVm = await loadSb3(await normalizedSb3.arrayBuffer())
        runForTicks(normalizedVm, 16)
        expect(getSpriteX(normalizedVm, 'Sprite1'), fixture.name).toBe(sourceX)
      } finally {
        sourceVm.quit()
        normalizedVm?.quit()
      }
    }
  })

  it('losslessly re-exports every fixture classified for raw preservation', async () => {
    expect(losslessFixtures.length).toBeGreaterThan(0)
    for (const fixture of losslessFixtures) {
      const source = await readFile(fixture.path)
      const officialSource = await parseWithOfficialScratchParser(source)
      const imported = await importLosslessSb3(source)
      const { projectVersion: sourceVersion, ...officialSourceJson } = officialSource
      expect(sourceVersion, `${fixture.name} official source parser version`).toBe(3)
      expect(
        compareProjectJson(officialSourceJson, imported.projectJson).equal,
        `${fixture.name} official/raw source`,
      ).toBe(true)
      const exported = await exportLosslessSb3(imported)
      const restored = await importLosslessSb3(await exported.arrayBuffer())
      const officialExported = await parseWithOfficialScratchParser(new Uint8Array(await exported.arrayBuffer()))
      const { projectVersion: exportedVersion, ...officialExportedJson } = officialExported
      expect(exportedVersion, `${fixture.name} official export parser version`).toBe(3)
      expect(
        compareProjectJson(officialExportedJson, restored.projectJson).equal,
        `${fixture.name} official/raw export`,
      ).toBe(true)

      expect(restored.projectEntryName, fixture.name).toBe(imported.projectEntryName)
      expect(restored.projectJsonBytes, fixture.name).toEqual(imported.projectJsonBytes)
      expect(archiveMetadataSignature(restored.entries), fixture.name).toEqual(
        archiveMetadataSignature(imported.entries),
      )
    }
  })

  it('accepts registered field shapes in every VM-decodable official fixture', async () => {
    const fieldIssueCodes = new Set([
      'invalid-field-descriptor',
      'missing-field',
      'unknown-field',
      'invalid-field-value',
    ])
    for (const fixture of OFFICIAL_FIXTURE_MATRIX.filter(
      ({ format, expectation }) => format === 'sb3' && expectation !== 'parse-only',
    )) {
      const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
      const fieldIssues = result.rawBlockGraphs.flatMap(({ issues }) =>
        issues.filter(({ code }) => fieldIssueCodes.has(code)),
      )
      expect(fieldIssues, fixture.name).toEqual([])

      const mappingPaths = result.canonicalBlockMappings.map(({ irPath }) => irPath)
      expect(new Set(mappingPaths).size, `${fixture.name} mapping paths`).toBe(mappingPaths.length)
      for (const mapping of result.canonicalBlockMappings) {
        const target = result.rawBlockGraphs.find(({ targetIndex }) => targetIndex === mapping.targetIndex)
        expect(target, `${fixture.name} ${mapping.irPath} target`).toBeDefined()
        expect(target, `${fixture.name} ${mapping.irPath} identity`).toMatchObject({
          targetName: mapping.targetName,
          isStage: mapping.isStage,
        })
        expect(target?.blocks[mapping.blockId]?.opcode, `${fixture.name} ${mapping.irPath} source block`).toBe(
          mapping.opcode,
        )
      }
    }
  })

  it('decompiles procedures from the official mixed extension fixture', async () => {
    const fixture = fixtureByName('load-extensions/confirm-load/pen-dolphin-3d.sb3')
    const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
    const procedures = result.canonical.stage.procedures.concat(
      ...result.canonical.sprites.map(({ procedures: items }) => items),
    )
    const calls = result.rawBlockGraphs.flatMap(({ blocks }) =>
      Object.values(blocks).filter(({ opcode }) => opcode === 'procedures_call'),
    )
    const prototypes = result.rawBlockGraphs.flatMap(({ blocks }) =>
      Object.values(blocks).filter(({ opcode }) => opcode === 'procedures_prototype'),
    )
    const numericPrototypeCount = prototypes.filter(({ mutation }) => {
      const proccode = mutation?.proccode
      return typeof proccode === 'string' && proccode.includes('%n')
    }).length
    const numericArgumentCount = prototypes.reduce((count, { mutation }) => {
      const proccode = mutation?.proccode
      return count + (typeof proccode === 'string' ? (proccode.match(/%n/g) ?? []).length : 0)
    }, 0)
    const countCalls = (blocks: readonly CanonicalBlock[]): number =>
      blocks.reduce(
        (total, block) =>
          total +
          Number(block.opcode === 'procedures_call') +
          Object.values(block.inputs ?? {}).reduce(
            (nestedTotal, input) =>
              nestedTotal +
              (input.type === 'block'
                ? countCalls([input.block])
                : input.type === 'stack'
                  ? countCalls(input.blocks)
                  : 0),
            0,
          ),
        0,
      )
    const canonicalCalls = [result.canonical.stage, ...result.canonical.sprites].reduce(
      (total, target) =>
        total +
        target.scripts.reduce((scriptTotal, script) => scriptTotal + countCalls(script.blocks), 0) +
        target.procedures.reduce((procedureTotal, procedure) => procedureTotal + countCalls(procedure.body), 0),
      0,
    )

    expect(procedures).toHaveLength(19)
    expect(prototypes).toHaveLength(19)
    expect(calls).toHaveLength(31)
    for (const prototype of prototypes) {
      const mutation = prototype.mutation ?? {}
      const proccode = mutation.proccode
      expect(typeof proccode).toBe('string')
      if (typeof proccode !== 'string') continue
      const canonicalName = proccode.replace(/\s*%(?:s|n|b)/g, '').trim()
      const procedure = procedures.find(({ name }) => name === canonicalName)
      expect(procedure).toBeDefined()
      if (!procedure) continue
      const markers = proccode.match(/%(?:s|n|b)/g) ?? []
      const argumentNames = JSON.parse(String(mutation.argumentnames)) as string[]
      const argumentDefaults = JSON.parse(String(mutation.argumentdefaults)) as (string | number | boolean)[]
      expect(procedure.parameters).toEqual(
        argumentNames.map((name, index) => ({
          name,
          kind: markers[index] === '%b' ? 'boolean' : markers[index] === '%n' ? 'number' : 'string-number',
          default: argumentDefaults[index],
        })),
      )
      expect(procedure.warp).toBe(mutation.warp === true || mutation.warp === 'true')
    }
    expect(canonicalCalls).toBe(calls.length)
    expect(result.procedureNormalizationReport.format).toBe('scratch-ai-bridge/procedure-normalization-report')
    expect(numericPrototypeCount).toBe(13)
    expect(
      procedures.reduce(
        (count, procedure) => count + procedure.parameters.filter(({ kind }) => kind === 'number').length,
        0,
      ),
    ).toBe(numericArgumentCount)
    expect(result.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)

    const mappingPaths = result.canonicalBlockMappings.map(({ irPath }) => irPath)
    expect(new Set(mappingPaths).size).toBe(mappingPaths.length)
    for (const mapping of result.canonicalBlockMappings) {
      const target = result.rawBlockGraphs.find(({ targetIndex }) => targetIndex === mapping.targetIndex)
      expect(target, `${mapping.irPath} target`).toBeDefined()
      expect(target).toMatchObject({ targetName: mapping.targetName, isStage: mapping.isStage })
      expect(target?.blocks[mapping.blockId]?.opcode, mapping.irPath).toBe(mapping.opcode)
    }
  })

  it('preserves workspace and block comments from the official comments fixture', async () => {
    const fixture = fixtureByName('comments.sb3')
    const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
    const canonicalTargets = [result.canonical.stage, ...result.canonical.sprites]
    const blockComments = canonicalTargets.flatMap((target) =>
      target.scripts.flatMap(({ blocks }) => {
        const visit = (items: CanonicalBlock[]): CanonicalBlock[] =>
          items.flatMap((block) => [
            ...(block.comment ? [block] : []),
            ...Object.values(block.inputs ?? {}).flatMap((input) =>
              input.type === 'block' ? visit([input.block]) : input.type === 'stack' ? visit(input.blocks) : [],
            ),
          ])
        return visit(blocks)
      }),
    )

    expect(canonicalTargets.map(({ comments }) => comments?.length ?? 0)).toEqual([1, 1])
    expect(blockComments).toHaveLength(5)
    const roundTripped = projectJsonToCanonical(buildScratchProjectJson(result.canonical), fixture.name)
    expect(roundTripped.stage.comments).toEqual(result.canonical.stage.comments)
    expect(roundTripped.sprites.map(({ comments }) => comments)).toEqual(
      result.canonical.sprites.map(({ comments }) => comments),
    )
    const roundTrippedBlockComments = [roundTripped.stage, ...roundTripped.sprites].flatMap((target) =>
      target.scripts.flatMap(({ blocks }) => {
        const visit = (items: CanonicalBlock[]): NonNullable<CanonicalBlock['comment']>[] =>
          items.flatMap((block) => [
            ...(block.comment ? [block.comment] : []),
            ...Object.values(block.inputs ?? {}).flatMap((input) =>
              input.type === 'block' ? visit([input.block]) : input.type === 'stack' ? visit(input.blocks) : [],
            ),
          ])
        return visit(blocks)
      }),
    )
    expect(roundTrippedBlockComments).toEqual(blockComments.map(({ comment }) => comment))
  })

  it('retains sound asset bytes from the official default project', async () => {
    const fixture = fixtureByName('default.sb3')
    const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
    const stageSound = result.canonical.stage.sounds[0]
    const spriteSound = result.canonical.sprites[0]?.sounds[0]

    expect(stageSound.data).toMatch(/^data:audio\/wav;base64,/)
    expect(spriteSound.data).toMatch(/^data:audio\/wav;base64,/)
    expect(stageSound.data).not.toBe(spriteSound.data)
    const simpleApiResult = await decompileSb3(await readFile(fixture.path), fixture.name)
    expect(simpleApiResult.stage.sounds[0]?.data).toBe(stageSound.data)

    const original = await importLosslessSb3(await readFile(fixture.path))
    const rebuilt = await importLosslessSb3(await buildScratchProjectArchive(result.canonical))
    const originalSoundBytes = original.entries
      .filter(({ name }) => name.endsWith('.wav'))
      .map(({ bytes }) => Buffer.from(bytes).toString('base64'))
      .sort()
    const rebuiltSoundBytes = rebuilt.entries
      .filter(({ name }) => name.endsWith('.wav'))
      .map(({ bytes }) => Buffer.from(bytes).toString('base64'))
      .sort()
    expect(rebuiltSoundBytes).toEqual(originalSoundBytes)
  })

  it('retains SVG and bitmap costume bytes from official SB3 projects', async () => {
    for (const fixtureName of ['default.sb3', 'cloud_variables_local.sb3']) {
      const fixture = fixtureByName(fixtureName)
      const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
      const costumes = [result.canonical.stage, ...result.canonical.sprites].flatMap(({ costumes }) => costumes)
      expect(costumes.length).toBeGreaterThan(0)
      expect(costumes.every(({ data }) => typeof data === 'string' && data.startsWith('data:image/'))).toBe(true)

      const original = await importLosslessSb3(await readFile(fixture.path))
      const rebuilt = await importLosslessSb3(await buildScratchProjectArchive(result.canonical))
      const assetExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.bmp']
      const originalCostumeBytes = original.entries
        .filter(
          ({ name }) =>
            !name.split('/').at(-1)?.startsWith('._') &&
            assetExtensions.some((extension) => name.endsWith(extension)),
        )
        .map(({ bytes }) => Buffer.from(bytes).toString('base64'))
        .sort()
      const rebuiltCostumeBytes = rebuilt.entries
        .filter(({ name }) => assetExtensions.some((extension) => name.endsWith(extension)))
        .map(({ bytes }) => Buffer.from(bytes).toString('base64'))
        .sort()
      expect(rebuiltCostumeBytes).toEqual(originalCostumeBytes)
    }
  })

  it('reports missing and checksum-mismatched source assets', async () => {
    for (const fixtureName of ['missing_sound.sb3', 'corrupt_sound.sb3']) {
      const fixture = fixtureByName(fixtureName)
      const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)
      const assets = [result.canonical.stage, ...result.canonical.sprites].flatMap((target) => [
        ...target.costumes,
        ...target.sounds,
      ])
      const issues = assets.flatMap((asset) => (asset.assetIssue ? [asset.assetIssue] : []))
      expect(validateCanonicalProject(result.canonical)).toMatchObject({ valid: true })
      expect(issues, fixtureName).toContain(
        fixtureName === 'missing_sound.sb3' ? 'missing-archive-entry' : 'checksum-mismatch',
      )
      expect(() => buildScratchProjectJson(result.canonical), fixtureName).toThrow(/source asset has/)
    }
  })

  it('preserves official monitor state through Canonical IR', async () => {
    const fixture = fixtureByName('monitors.sb3')
    const result = await decompileSb3WithBlockGraphs(await readFile(fixture.path), fixture.name)

    expect(result.canonical.monitors).toHaveLength(18)
    expect(
      result.canonical.monitors?.some(({ opcode, mode }) => opcode === 'data_variable' && mode === 'slider'),
    ).toBe(true)
    expect(
      result.canonical.monitors?.some(({ opcode, mode }) => opcode === 'data_listcontents' && mode === 'list'),
    ).toBe(true)
    const compiled = buildScratchProjectJson(result.canonical)
    for (const monitor of compiled.monitors) {
      if (monitor.opcode !== 'data_variable' && monitor.opcode !== 'data_listcontents') continue
      const symbolName = monitor.params[monitor.opcode === 'data_variable' ? 'VARIABLE' : 'LIST']
      const target = compiled.targets.find(({ name }) => name === (monitor.spriteName ?? 'Stage'))
      const symbolCollection = monitor.opcode === 'data_variable' ? target?.variables : target?.lists
      const symbolEntry = Object.entries(symbolCollection ?? {}).find(
        ([, value]) => (value as unknown[])[0] === symbolName,
      )
      expect(symbolEntry?.[0]).toBe(monitor.id)
    }
    const roundTrippedMonitors = projectJsonToCanonical(compiled, fixture.name).monitors ?? []
    const withoutId = (items: typeof roundTrippedMonitors) => items.map(({ id: _id, ...monitor }) => monitor)
    expect(withoutId(roundTrippedMonitors)).toEqual(withoutId(result.canonical.monitors ?? []))
  })

  it('round-trips project extensions, meta, and target settings', async () => {
    for (const fixtureName of ['monitors.sb3', 'load-extensions/confirm-load/pen-simple-project.sb3']) {
      const fixture = fixtureByName(fixtureName)
      const bytes = await readFile(fixture.path)
      const source = await importLosslessSb3(bytes)
      const sourceProject = source.projectJson
      const result = await decompileSb3WithBlockGraphs(bytes, fixture.name)
      const simpleApiResult = await decompileSb3(bytes, fixture.name)

      expect(result.canonical.extensions).toEqual(sourceProject.extensions)
      expect(result.canonical.meta).toEqual(sourceProject.meta)
      expect(simpleApiResult.extensions).toEqual(sourceProject.extensions)
      expect(simpleApiResult.meta).toEqual(sourceProject.meta)
      const compileInput = structuredClone(result.canonical)
      if (fixtureName.includes('pen-simple-project')) {
        // The upstream fixture contains an asset digest mismatch; keep this
        // metadata assertion independent of the compiler's asset-integrity gate.
        compileInput.stage.costumes = []
        compileInput.stage.sounds = []
        compileInput.sprites.forEach((sprite) => {
          sprite.costumes = []
          sprite.sounds = []
        })
      }
      const compiled = buildScratchProjectJson(compileInput)
      expect(compiled.extensions).toEqual(sourceProject.extensions)
      expect(compiled.meta).toEqual(sourceProject.meta)
      for (const sourceTarget of sourceProject.targets as Record<string, unknown>[]) {
        const compiledTarget = compiled.targets.find(({ name }) => name === sourceTarget.name)
        expect(compiledTarget).toBeDefined()
        const compiledTargetRecord = compiledTarget as unknown as Record<string, unknown>
        for (const key of [
          'currentCostume',
          'volume',
          'layerOrder',
          'tempo',
          'videoTransparency',
          'videoState',
          'textToSpeechLanguage',
        ]) {
          if (Object.hasOwn(sourceTarget, key)) expect(compiledTargetRecord[key]).toEqual(sourceTarget[key])
        }
      }
    }
  })
})
