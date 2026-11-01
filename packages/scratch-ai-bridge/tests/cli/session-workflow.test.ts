import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { ScratchSession } from '../../src/cli/session/session.js'
import { validateBlockGraph } from '../../src/cli/graph-validator.js'
import { loadSb3 } from '../../src/scratch/vm.js'

const cli = path.resolve('scripts/scratch-session.mjs')
const fixture = path.resolve('../scratch-vm/test/fixtures/draggable.sb3')
const dirs: string[] = []
const workdir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scratch-session-test-'))
  dirs.push(dir)
  return dir
}
const run = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000 })
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('scratch-session CLI workflow', () => {
  it('exports embedded sprite costumes as content-addressed assets without changing the session', async () => {
    const session = new ScratchSession()
    session.newProject('Embedded')
    session.addSprite('Ball')
    session.addSprite('Bumper')
    const targets = session.getProjectJson().targets as { costumes: { data?: string }[] }[]
    targets[1].costumes[0].data = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0ibm9uZSIvPjwvc3ZnPg=='
    const before = JSON.stringify(session.getProjectJson())
    const archive = await session.compile()
    expect(JSON.stringify(session.getProjectJson())).toBe(before)
    const zip = await JSZip.loadAsync(archive)
    const project = JSON.parse(await zip.file('project.json')!.async('string'))
    const costumes = project.targets.slice(1).map((target: { costumes: unknown[] }) => target.costumes[0])
    expect(costumes[0].md5ext).toBe(costumes[1].md5ext)
    const bytes = await zip.file(costumes[0].md5ext)!.async('uint8array')
    expect(createHash('md5').update(bytes).digest('hex')).toBe(costumes[0].assetId)
    expect(costumes[0].md5ext).toBe(`${costumes[0].assetId}.svg`)
    expect(costumes[0]).not.toHaveProperty('data')
    expect(new TextDecoder().decode(bytes)).toContain('viewBox="0 0 100 100"')
  }, 60000)

  it('serializes literal block inputs in Scratch SB3 format', () => {
    const session = new ScratchSession()
    session.newProject('Inputs')
    const id = session.addBlock('Stage', 'motion_movesteps', {
      inputs: { STEPS: { type: 'literal', value: 10 } },
    })
    const target = (session.getProjectJson().targets as any[])[0]
    expect(target.blocks[id].inputs.STEPS).toEqual([1, [4, '10']])
  })

  it('executes a CLI-style literal input after an SB3 load', async () => {
    const session = new ScratchSession()
    session.newProject('Movement')
    session.addSprite('Ball')
    const flag = session.addBlock('Ball', 'event_whenflagclicked')
    session.addBlock('Ball', 'motion_movesteps', {
      parent: flag,
      inputs: { STEPS: { type: 'literal', value: 10 } },
    })
    const vm = await loadSb3(await session.compile())
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void; targets: { getName(): string; x: number }[] }
    }
    try {
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(runtime.runtime.targets.find((target) => target.getName() === 'Ball')?.x).toBe(10)
    } finally {
      vm.quit()
    }
  }, 60000)

  it('connects a substack without placing it after the control block', () => {
    const session = new ScratchSession()
    session.newProject('Loop')
    const loop = session.addBlock('Stage', 'control_forever')
    const move = session.addBlock('Stage', 'motion_movesteps')
    session.connectInput('Stage', loop, 'SUBSTACK', move)
    const target = (session.getProjectJson().targets as { blocks: Record<string, { inputs: Record<string, unknown>; next: unknown; parent: unknown; topLevel: boolean }> }[])[0]
    expect(target.blocks[loop].inputs.SUBSTACK).toEqual([2, move])
    expect(target.blocks[loop].next).toBeNull()
    expect(target.blocks[move].parent).toBe(loop)
    expect(target.blocks[move].topLevel).toBe(false)
    expect(() => session.connectInput('Stage', loop, 'SUBSTACK', move)).toThrow()
    session.removeBlock('Stage', loop)
    expect(target.blocks[move]).toBeUndefined()
  })

  it('executes a connected forever substack after SB3 loading', async () => {
    const session = new ScratchSession()
    session.newProject('Loop')
    session.addSprite('Ball')
    const flag = session.addBlock('Ball', 'event_whenflagclicked')
    const loop = session.addBlock('Ball', 'control_forever', { parent: flag })
    const move = session.addBlock('Ball', 'motion_movesteps', { inputs: { STEPS: { type: 'literal', value: 5 } } })
    session.connectInput('Ball', loop, 'SUBSTACK', move)
    const vm = await loadSb3(await session.compile())
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void; targets: { getName(): string; x: number }[] }
    }
    try {
      runtime.start()
      runtime.greenFlag()
      for (let i = 0; i < 4; i++) runtime.runtime._step()
      expect(runtime.runtime.targets.find((target) => target.getName() === 'Ball')?.x).toBeGreaterThan(5)
    } finally {
      vm.quit()
    }
  }, 60000)

  it('stores new variables by Scratch ID and serializes variable inputs', () => {
    const session = new ScratchSession()
    session.newProject('Variables')
    const id = session.addBlock('Stage', 'looks_say', {
      inputs: { MESSAGE: { type: 'variable', name: 'score' } },
    })
    const target = (session.getProjectJson().targets as any[])[0]
    const [variableId, variable] = Object.entries(target.variables)[0] as [string, unknown]
    expect(variable).toEqual(['score', 0])
    expect(target.blocks[id].inputs.MESSAGE).toEqual([3, [12, 'score', variableId], [10, '']])
    expect(() => session.addVariable('Stage', 'score')).toThrow('already exists')
  })

  it('rejects malformed embedded assets with their location', async () => {
    const session = new ScratchSession()
    session.newProject('Invalid')
    session.addSprite('Ball')
    const target = (session.getProjectJson().targets as any[])[1]
    target.costumes[0].data = 'not base64 data'
    await expect(session.archive()).rejects.toThrow('/targets/1/costumes/0')
  })

  it('rejects VM-style object inputs in a serialized project', () => {
    const session = new ScratchSession()
    session.newProject('Invalid input')
    const id = session.addBlock('Stage', 'motion_movesteps')
    const target = (session.getProjectJson().targets as any[])[0]
    target.blocks[id].inputs.STEPS = { block: 'missing', shadow: 'missing' }
    expect(validateBlockGraph(session.getProjectJson()).errors.join('\n')).toContain('STEPS')
  })

  it('reports the invalid opcodes found in the pinball draft', () => {
    const session = new ScratchSession()
    session.newProject('Invalid opcodes')
    session.addBlock('Stage', 'motion_goto_xy')
    session.addBlock('Stage', 'sense_touchingobject')
    const errors = validateBlockGraph(session.getProjectJson()).errors.join('\n')
    expect(errors).toContain('motion_gotoxy')
    expect(errors).toContain('sensing_touchingobject')
  })

  it('rejects a block link into a different sprite', () => {
    const session = new ScratchSession()
    session.newProject('Cross target')
    session.addSprite('A')
    session.addSprite('B')
    const parent = session.addBlock('A', 'event_whenflagclicked')
    const other = session.addBlock('B', 'looks_show')
    const targets = session.getProjectJson().targets as { blocks: Record<string, { next: string | null }> }[]
    targets[1].blocks[parent].next = other
    const errors = validateBlockGraph(session.getProjectJson()).errors.join('\n')
    expect(errors).toContain('different target')
  })
  it('persists load without rewriting the source and restores it on subsequent commands', () => {
    const dir = workdir()
    const input = path.join(dir, 'game.sb3')
    const original = readFileSync(fixture)
    writeFileSync(input, original)
    const loaded = run(dir, 'load', input)
    expect(loaded.status, loaded.stderr).toBe(0)
    expect(readFileSync(input)).toEqual(original)
    expect(JSON.parse(readFileSync(path.join(dir, '.scratch-session.json'), 'utf8'))).toMatchObject({
      format: 'scratch-session',
      version: 1,
      projectPath: input,
    })
    const info = run(dir, 'info')
    expect(info.status, info.stderr).toBe(0)
    expect(info.stdout).toContain(input)
  })

  it('generates shell-safe block ids and restores an unsaved project', () => {
    const dir = workdir()
    expect(run(dir, 'new', 'Example').status).toBe(0)
    const added = run(dir, 'add-block', 'Stage', 'event_whenflagclicked')
    expect(added.status, added.stderr).toBe(0)
    const id = /id=([^)]*)\)/.exec(added.stdout)?.[1]
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(run(dir, 'info').stdout).toContain('Stage')
  })

  it('accepts literal input values through the CLI', () => {
    const dir = workdir()
    expect(run(dir, 'new', 'Inputs').status).toBe(0)
    const result = run(dir, 'add-block', 'Stage', 'motion_movesteps', '--input-literal', 'STEPS', '10')
    expect(result.status, result.stderr).toBe(0)
    const state = JSON.parse(readFileSync(path.join(dir, '.scratch-session.json'), 'utf8'))
    const block = Object.values(state.projectJson.targets[0].blocks)[0] as any
    expect(block.inputs.STEPS).toEqual([1, [4, '10']])
  })

  it('requires an explicit Camoufox caller and rejects nonlocal GUI URLs', () => {
    const dir = workdir()
    expect(run(dir, 'new', 'Browser').status).toBe(0)
    const missingCaller = run(dir, 'open-camofox')
    expect(missingCaller.status).not.toBe(0)
    expect(missingCaller.stderr).toContain('--caller')
    const external = run(dir, 'open-camofox', '--caller', 'codex', '--url', 'https://example.com/')
    expect(external.status).not.toBe(0)
    expect(external.stderr).toContain('local HTTP')
  })

  it('connects a substack across separate CLI invocations', () => {
    const dir = workdir()
    expect(run(dir, 'new', 'Loop').status).toBe(0)
    const loop = /id=([^)]*)\)/.exec(run(dir, 'add-block', 'Stage', 'control_forever').stdout)?.[1]
    const child = /id=([^)]*)\)/.exec(run(dir, 'add-block', 'Stage', 'looks_say').stdout)?.[1]
    expect(loop).toBeDefined()
    expect(child).toBeDefined()
    const result = run(dir, 'connect-input', 'Stage', loop as string, 'SUBSTACK', child as string)
    expect(result.status, result.stderr).toBe(0)
    const state = JSON.parse(readFileSync(path.join(dir, '.scratch-session.json'), 'utf8')) as {
      projectJson: { targets: { blocks: Record<string, { inputs: Record<string, unknown> }> }[] }
    }
    expect(state.projectJson.targets[0].blocks[loop as string].inputs.SUBSTACK).toEqual([2, child])
  })

  it('reports corrupt or missing session data instead of silently creating a project', () => {
    const dir = workdir()
    writeFileSync(path.join(dir, '.scratch-session.json'), '{broken')
    const result = run(dir, 'info')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/session/i)
  })
  it('compiles the same project and assets into the requested output without lossy conversion', async () => {
    const dir = workdir()
    expect(run(dir, 'load', fixture).status).toBe(0)
    const output = path.join(dir, 'compiled.sb3')
    const result = run(dir, 'compile', output)
    expect(result.status, result.stderr).toBe(0)
    const original = await JSZip.loadAsync(readFileSync(fixture))
    const compiled = await JSZip.loadAsync(readFileSync(output))
    expect(
      JSON.parse(await (compiled.file('project.json') ?? expect.fail('missing compiled project')).async('string')),
    ).toEqual(
      JSON.parse(await (original.file('project.json') ?? expect.fail('missing source project')).async('string')),
    )
    for (const name of Object.keys(original.files)) {
      if (!original.files[name].dir && name !== 'project.json')
        expect(await (compiled.file(name) ?? expect.fail(`missing ${name}`)).async('uint8array')).toEqual(
          await (original.file(name) ?? expect.fail(`missing ${name}`)).async('uint8array'),
        )
    }
  }, 60000)

  it('migrates legacy state and reports a missing project path', () => {
    const dir = workdir()
    writeFileSync(
      path.join(dir, '.scratch-session.json'),
      JSON.stringify({ projectPath: '/missing/project.sb3', lastModified: '' }),
    )
    const result = run(dir, 'info')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Session project not found')
    expect(run(dir, 'load', fixture).status).toBe(0)
    expect(JSON.parse(readFileSync(path.join(dir, '.scratch-session.json'), 'utf8'))).toMatchObject({ version: 1 })
  })

  it('exports a new project with its built-in costume and validates it in the VM', async () => {
    const dir = workdir()
    expect(run(dir, 'new', 'Blank').status).toBe(0)
    const result = run(dir, 'compile', 'new.sb3')
    expect(result.status, result.stderr).toBe(0)
    const zip = await JSZip.loadAsync(readFileSync(path.join(dir, 'new.sb3')))
    const project = JSON.parse(await zip.file('project.json')!.async('string'))
    const costume = project.targets[0].costumes[0]
    const bytes = await zip.file(costume.md5ext)!.async('uint8array')
    expect(createHash('md5').update(bytes).digest('hex')).toBe(costume.assetId)
  }, 60000)

  it('gives an actionable error for missing block option values', () => {
    const dir = workdir()
    expect(run(dir, 'new').status).toBe(0)
    const result = run(dir, 'add-block', 'Stage', 'event_whenflagclicked', '--parent')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--parent requires a value')
  })
  it('loads a legacy embedded session and upgrades it on edit', () => {
    const dir = workdir()
    expect(run(dir, 'new', 'legacy').status).toBe(0)
    const file = path.join(dir, '.scratch-session.json')
    const state = JSON.parse(readFileSync(file, 'utf8')) as { projectJson: unknown }
    writeFileSync(file, JSON.stringify({ projectPath: null, lastModified: '', projectJson: state.projectJson }))
    const added = run(dir, 'add-var', 'Stage', 'score', '5')
    expect(added.status, added.stderr).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ format: 'scratch-session', version: 1 })
    expect(run(dir, 'ls').stdout).toContain('vars=1')
  })
})
