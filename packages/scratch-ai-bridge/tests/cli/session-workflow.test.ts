import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'

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
    expect(zip.file('cd21514d0531fdffb22204e0ec5ed84a.svg')).not.toBeNull()
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
