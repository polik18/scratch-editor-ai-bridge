/**
 * Generator Test Suite
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { generateGame } from '../src/cli/generator.js'
import { inspectSb3Bytes } from '../src/cli/inspect.js'
import { getBlocks, getTargets, loadSb3 } from '../src/scratch/vm.js'

describe('Generator', () => {
  describe('generateGame', () => {
    it('should generate and preserve targets and block graphs from Canonical IR', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now()
      const designPath = path.resolve('src/core/ir/examples/06-platformer-core.json')
      const outputDir = path.join(tempDir, 'generated')

      const result = await generateGame(designPath, { outputDir })
      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      expect(result.manifest?.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(result.gates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'archive-validation', status: 'pass' }),
          expect.objectContaining({ name: 'asset-presence-and-md5', status: 'pass' }),
          expect.objectContaining({ name: 'scratch-vm-reload', status: 'pass' }),
          expect.objectContaining({ name: 'runtime-behavior', status: 'not-run' }),
          expect.objectContaining({ name: 'renderer-preview', status: 'not-run' }),
        ]),
      )

      const outputPath = result.output ?? ''
      expect(outputPath).not.toBe('')
      const generatedBytes = new Uint8Array(await fs.readFile(outputPath))
      const projectZip = await JSZip.loadAsync(generatedBytes)
      const projectEntry = projectZip.file('project.json')
      expect(projectEntry).not.toBeNull()
      const projectJson = JSON.parse(await (projectEntry?.async('string') ?? Promise.resolve('{}'))) as {
        targets: { blocks?: Record<string, unknown> }[]
      }
      const rawBlockCount = projectJson.targets.reduce(
        (sum: number, target: { blocks?: Record<string, unknown> }) => sum + Object.keys(target.blocks ?? {}).length,
        0,
      )
      const inspection = await inspectSb3Bytes(generatedBytes)
      expect(inspection.summary.blocks).toBe(rawBlockCount)
      expect(inspection.summary.analyzedBlocks).toBeLessThanOrEqual(rawBlockCount)

      const vm = await loadSb3(await fs.readFile(outputPath))
      try {
        const targets = getTargets(vm)
        expect(targets.map((target) => target.getName())).toEqual(['Stage', 'Player', 'Platform'])
        expect(targets.reduce((total, target) => total + getBlocks(target).length, 0)).toBeGreaterThan(10)
      } finally {
        vm.quit()
      }

      await fs.rm(tempDir, { recursive: true, force: true })
    }, 10000)

    it('warns when names are rendered as automatic visuals rather than library assets', async () => {
      const tempDir = await fs.mkdtemp('/tmp/scratch-asset-warning-')
      try {
        const input = path.join(tempDir, 'design.json')
        await fs.writeFile(
          input,
          JSON.stringify({
            title: 'Test',
            stage: { costumes: ['Arctic'] },
            spritesDef: [{ name: 'Abby', costumes: ['Abby-a'] }],
          }),
        )
        const result = await generateGame(input, { outputDir: tempDir })
        expect(result.success).toBe(true)
        const warnings = result.diagnostics.filter((diagnostic) => diagnostic.code === 'AUTOMATIC_ASSET')
        expect(warnings.map((warning) => warning.message).join(' ')).toContain('Arctic')
        expect(warnings.map((warning) => warning.message).join(' ')).toContain('Abby-a')
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('reports the invalid rotation value and the allowed schema values', async () => {
      const tempDir = await fs.mkdtemp('/tmp/scratch-invalid-rotation-')
      try {
        const designPath = path.join(tempDir, 'invalid.json')
        const project = JSON.parse(await fs.readFile('src/core/ir/examples/06-platformer-core.json', 'utf8')) as {
          sprites: { rotationStyle: string }[]
        }
        project.sprites[0].rotationStyle = 'all-around'
        await fs.writeFile(designPath, JSON.stringify(project))
        const result = await generateGame(designPath, { outputDir: tempDir })
        expect(result.success).toBe(false)
        expect(result.diagnostics[0]?.message).toContain('/sprites/0/rotationStyle')
        expect(result.diagnostics[0]?.message).toContain('all-around')
        expect(result.diagnostics[0]?.message).toContain('all around')
        expect(result.diagnostics[0]?.message).toContain('left-right')
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it.each([
      [
        'unknown-variable',
        {
          opcode: 'data_setvariableto',
          fields: { VARIABLE: 'missing score' },
          inputs: { VALUE: { type: 'literal', value: 1 } },
        },
        '宣告同名變數',
      ],
      ['missing-input', { opcode: 'motion_movesteps' }, '補上必要'],
      ['unknown-opcode', { opcode: 'motion_nonexistent' }, '支援的 opcode'],
    ])('reports actionable guidance for %s', async (code, brokenBlock, suggestion) => {
      const tempDir = await fs.mkdtemp('/tmp/scratch-invalid-semantic-')
      try {
        const designPath = path.join(tempDir, 'invalid.json')
        const project = JSON.parse(await fs.readFile('src/core/ir/examples/06-platformer-core.json', 'utf8')) as {
          sprites: { scripts: { blocks: unknown[] }[] }[]
        }
        project.sprites[0].scripts[1].blocks[1] = brokenBlock
        await fs.writeFile(designPath, JSON.stringify(project))
        const result = await generateGame(designPath, { outputDir: tempDir })
        expect(result.success).toBe(false)
        expect(result.diagnostics[0]?.message).toContain('/sprites/0/scripts/1/blocks/1')
        expect(result.diagnostics[0]?.message).toContain(code)
        expect(result.diagnostics[0]?.message).toContain(suggestion)
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('does not replace an existing output unless force is explicit', async () => {
      const tempDir = '/tmp/scratch-test-output-' + Date.now()
      await fs.mkdir(tempDir, { recursive: true })
      const outputFile = path.join(tempDir, 'existing.sb3')
      await fs.writeFile(outputFile, 'keep')
      const designPath = path.resolve('src/core/ir/examples/06-platformer-core.json')

      const result = await generateGame(designPath, { outputFile })
      expect(result.success).toBe(false)
      expect(result.diagnostics[0]?.stage).toBe('atomic-output-write')
      expect(await fs.readFile(outputFile, 'utf-8')).toBe('keep')

      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('should reject the documented sprites array instead of generating an empty project', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now()
      await fs.mkdir(tempDir, { recursive: true })
      const designPath = path.join(tempDir, 'design.json')
      await fs.writeFile(
        designPath,
        JSON.stringify({ title: 'Test Game', sprites: [{ name: 'Player' }], scripts: [] }),
      )

      const result = await generateGame(designPath, { outputDir: tempDir })
      expect(result.success).toBe(false)
      expect(result.diagnostics[0]?.message).toContain('sprites[] is not supported')

      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('generates nested GameDesign JSON with an auditable gate report', async () => {
      const tempDir = '/tmp/scratch-test-nested-' + Date.now()
      await fs.mkdir(tempDir, { recursive: true })
      const designPath = path.join(tempDir, 'nested.json')
      const outputFile = path.join(tempDir, 'nested.sb3')
      const reportPath = path.join(tempDir, 'report.json')
      await fs.writeFile(
        designPath,
        JSON.stringify({
          id: 'nested',
          title: 'Nested',
          type: 'arcade',
          sprites: 1,
          blocks: 6,
          difficulty: 'advanced',
          version: '1.0',
          created: '2026-10-30',
          designDoc: '',
          outputSb3: '',
          outputJson: '',
          spritesDef: [{ name: 'Hero' }],
          variables: [{ name: 'score', value: 0 }],
          lists: [],
          scripts: [
            {
              target: 'Hero',
              blocks: [
                { opcode: 'event_whenflagclicked' },
                {
                  opcode: 'control_forever',
                  inputs: {
                    SUBSTACK: [
                      { opcode: 'motion_changexby', inputs: { DX: 5 } },
                      {
                        opcode: 'control_if',
                        inputs: {
                          CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
                          SUBSTACK: [{ opcode: 'looks_say', inputs: { MESSAGE: 'fire' } }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      )

      const result = await generateGame(designPath, { outputFile, reportPath })
      expect(result.success).toBe(true)
      expect(result.gates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'scratch-vm-reload', status: 'pass' }),
          expect.objectContaining({ name: 'runtime-behavior', status: 'not-run' }),
        ]),
      )
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8')) as { status: string }
      expect(report.status).toBe('success')
      expect(await fs.stat(outputFile)).toBeDefined()

      await fs.rm(tempDir, { recursive: true, force: true })
    }, 10000)

    it('should handle invalid design JSON', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now()
      await fs.mkdir(tempDir, { recursive: true })

      const invalidPath = path.join(tempDir, 'invalid.json')
      await fs.writeFile(invalidPath, 'invalid json')

      const result = await generateGame(invalidPath, { outputDir: tempDir })

      expect(result.success).toBe(false)
      expect(result.diagnostics.length).toBeGreaterThan(0)

      // Cleanup
      await fs.unlink(invalidPath)
      await fs.rmdir(tempDir)
    })

    it('should handle missing input file', async () => {
      const result = await generateGame('/nonexistent/file.json')

      expect(result.success).toBe(false)
      expect(result.diagnostics.length).toBeGreaterThan(0)
    })
  })
})
