import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import type { CanonicalProject } from '../../src/core/ir/types'

const run = promisify(execFile)
const generator = resolve(process.cwd(), '../../research/dual-front-game/generate-costume.py')
const shapes = [
  { type: 'circle', cx: 50, cy: 25, r: 20, fill: '#0088FF' },
  { type: 'rect', x: 30, y: 45, width: 40, height: 40, rx: 5, fill: '#0088FF' },
  { type: 'circle', cx: 45, cy: 25, r: 3, fill: '#FFFFFF' },
]

it('renders validated shapes offline and refuses unsafe or malformed input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scratch-costume-'))
  const spec = join(directory, 'spec.json')
  const output = join(directory, 'costume.svg')
  try {
    await writeFile(spec, JSON.stringify({ shapes }))
    await run('python3', [generator, '--spec', spec, '--out', output])
    const svg = await readFile(output, 'utf8')
    expect(svg).toContain('viewBox="0 0 100 110"')
    expect(svg).toContain('fill="#0088FF"')
    expect(svg).not.toMatch(/<script|href=|<foreignObject/i)
    const game = join(directory, 'game.json')
    const template = resolve(process.cwd(), '../../research/dual-front-game/build-dual-front.py')
    await run('python3', [template, '--out', game, '--p1-spec', spec])
    const project = JSON.parse(await readFile(game, 'utf8')) as CanonicalProject
    expect(project.sprites[0].costumes[0].data).toContain('#0088FF')
    expect(project.sprites[0].costumes[2].data).not.toContain('#0088FF')
    expect(project.sprites[0].costumes[1].data).toContain('cx="91"')
    expect((await compileCanonicalProjectToSb3(project)).size).toBeGreaterThan(0)
    await expect(run('python3', [generator, '--spec', spec, '--out', output])).rejects.toThrow()
    await writeFile(spec, JSON.stringify({ shapes: [...shapes, { type: 'script', fill: '#FFFFFF' }] }))
    await expect(run('python3', [generator, '--spec', spec, '--out', join(directory, 'bad.svg')])).rejects.toThrow()
    await writeFile(
      spec,
      JSON.stringify({ shapes: [{ ...shapes[0], fill: '#123456" onload="alert(1)' }, ...shapes.slice(1)] }),
    )
    await expect(run('python3', [generator, '--spec', spec, '--out', join(directory, 'bad.svg')])).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
