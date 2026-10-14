import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const testDirectories: string[] = []
const checkerPath = fileURLToPath(new URL('../../scripts/check-audit-reachability.mjs', import.meta.url))

const createAuditFixture = async (mappedPackage: boolean) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scratch-ai-bridge-audit-'))
  testDirectories.push(root)
  const mapDirectory = path.join(root, 'packages/bridge/audit-dist/assets')
  const vulnerableLocation = path.join(root, 'packages/demo/node_modules/vulnerable-package')
  await mkdir(mapDirectory, { recursive: true })
  const mappedSource = mappedPackage
    ? path.relative(mapDirectory, path.join(vulnerableLocation, 'index.js')).split(path.sep).join('/')
    : '../../../bridge/src/index.js'
  await writeFile(path.join(mapDirectory, 'index.js.map'), JSON.stringify({ version: 3, sources: [mappedSource] }))
  const auditPath = path.join(root, 'audit.json')
  await writeFile(
    auditPath,
    JSON.stringify({
      vulnerabilities: {
        'vulnerable-package': {
          severity: 'high',
          nodes: ['packages/demo/node_modules/vulnerable-package'],
        },
      },
    }),
  )
  await writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'packages/demo': {
          name: 'demo-workspace',
          version: '1.0.0',
          dependencies: { 'vulnerable-package': '2.3.4' },
        },
        'packages/demo/node_modules/vulnerable-package': { version: '2.3.4' },
      },
    }),
  )
  return { root, mapDirectory: path.dirname(path.dirname(mapDirectory)), auditPath }
}

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('production dependency audit reachability checker', () => {
  it('passes when no vulnerable install path is present in mapped sources', async () => {
    const fixture = await createAuditFixture(false)
    const result = spawnSync(process.execPath, [checkerPath, fixture.auditPath, fixture.mapDirectory, fixture.root], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      vulnerableInstallPathCount: 1,
      vulnerableInstallPaths: [
        {
          installPath: 'packages/demo/node_modules/vulnerable-package',
          version: '2.3.4',
          vulnerabilities: [{ name: 'vulnerable-package', severity: 'high' }],
          mappedSourceCount: 0,
          affectedWorkspaces: [{ location: 'packages/demo', name: 'demo-workspace' }],
          introducingWorkspaces: [{ location: 'packages/demo', name: 'demo-workspace' }],
        },
      ],
      intersections: [],
    })
  })

  it('fails and identifies the exact vulnerable install path when it is mapped', async () => {
    const fixture = await createAuditFixture(true)
    const result = spawnSync(process.execPath, [checkerPath, fixture.auditPath, fixture.mapDirectory, fixture.root], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      intersections: [{ installPath: 'packages/demo/node_modules/vulnerable-package', mappedSourceCount: 1 }],
      vulnerableInstallPaths: [
        { installPath: 'packages/demo/node_modules/vulnerable-package', mappedSourceCount: 1 },
      ],
    })
  })

  it('separates equally near introducing workspaces from transitive workspace consumers', async () => {
    const fixture = await createAuditFixture(false)
    const audit = JSON.parse(await readFile(fixture.auditPath, 'utf8')) as {
      vulnerabilities: Record<string, { nodes: string[] }>
    }
    audit.vulnerabilities['vulnerable-package'].nodes = ['node_modules/vulnerable-package']
    await writeFile(fixture.auditPath, JSON.stringify(audit))

    const lockPath = path.join(fixture.root, 'package-lock.json')
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
      packages: Record<
        string,
        {
          name?: string
          version?: string
          dependencies?: Record<string, string>
          optionalDependencies?: Record<string, string>
          peerDependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
      >
    }
    delete lock.packages['packages/demo/node_modules/vulnerable-package']
    lock.packages['node_modules/vulnerable-package'] = { version: '2.3.4' }
    lock.packages['node_modules/wrapper-package'] = {
      version: '1.0.0',
      dependencies: { 'vulnerable-package': '2.3.4' },
    }
    lock.packages['packages/second'] = {
      name: 'second-workspace',
      dependencies: { 'vulnerable-package': '2.3.4' },
    }
    lock.packages['packages/transitive'] = {
      name: 'transitive-workspace',
      dependencies: { 'wrapper-package': '1.0.0' },
    }
    lock.packages['packages/dev-only'] = {
      name: 'dev-only-workspace',
      devDependencies: { 'vulnerable-package': '2.3.4' },
    }
    await writeFile(lockPath, JSON.stringify(lock))

    const result = spawnSync(process.execPath, [checkerPath, fixture.auditPath, fixture.mapDirectory, fixture.root], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      vulnerableInstallPaths: [
        {
          installPath: 'node_modules/vulnerable-package',
          affectedWorkspaces: [
            { location: 'packages/demo', name: 'demo-workspace' },
            { location: 'packages/second', name: 'second-workspace' },
            { location: 'packages/transitive', name: 'transitive-workspace' },
          ],
          introducingWorkspaces: [
            { location: 'packages/demo', name: 'demo-workspace' },
            { location: 'packages/second', name: 'second-workspace' },
          ],
        },
      ],
    })
  })

  it('reports only vulnerable packages in the bridge production dependency closure', async () => {
    const fixture = await createAuditFixture(false)
    const lockPath = path.join(fixture.root, 'package-lock.json')
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
      packages: Record<string, Record<string, unknown>>
    }
    lock.packages['packages/scratch-ai-bridge'] = {
      name: '@scratch/scratch-ai-bridge',
      dependencies: { '@scratch/scratch-vm': 'workspace:*' },
      devDependencies: { 'dev-only-vulnerable': '1.0.0' },
    }
    lock.packages['node_modules/@scratch/scratch-vm'] = {
      resolved: 'packages/scratch-vm',
      link: true,
    }
    lock.packages['packages/scratch-vm'] = {
      name: '@scratch/scratch-vm',
      dependencies: { 'vulnerable-package': '2.3.4' },
      optionalDependencies: { 'optional-vulnerable': '3.4.5' },
      peerDependencies: { 'peer-vulnerable': '5.6.7' },
    }
    lock.packages['node_modules/vulnerable-package'] = { version: '2.3.4' }
    lock.packages['node_modules/optional-vulnerable'] = { version: '3.4.5' }
    lock.packages['node_modules/peer-vulnerable'] = { version: '5.6.7' }
    lock.packages['node_modules/dev-only-vulnerable'] = { version: '1.0.0' }
    lock.packages['packages/unrelated/node_modules/unrelated-vulnerable'] = { version: '4.5.6' }
    await writeFile(lockPath, JSON.stringify(lock))

    const auditPath = path.join(fixture.root, 'production-audit.json')
    await writeFile(
      auditPath,
      JSON.stringify({
        vulnerabilities: {
          'vulnerable-package': {
            severity: 'high',
            nodes: ['node_modules/vulnerable-package'],
          },
          'optional-vulnerable': {
            severity: 'moderate',
            nodes: ['node_modules/optional-vulnerable'],
          },
          'peer-vulnerable': {
            severity: 'low',
            nodes: ['node_modules/peer-vulnerable'],
          },
          'dev-only-vulnerable': {
            severity: 'moderate',
            nodes: ['node_modules/dev-only-vulnerable'],
          },
          'unrelated-vulnerable': {
            severity: 'critical',
            nodes: ['packages/unrelated/node_modules/unrelated-vulnerable'],
          },
        },
      }),
    )

    const result = spawnSync(process.execPath, [checkerPath, auditPath, fixture.mapDirectory, fixture.root], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      bridgeProductionVulnerableInstallPathCount: 3,
      bridgeProductionVulnerableInstallPaths: [
        {
          installPath: 'node_modules/optional-vulnerable',
          vulnerabilities: [{ name: 'optional-vulnerable', severity: 'moderate' }],
        },
        {
          installPath: 'node_modules/peer-vulnerable',
          vulnerabilities: [{ name: 'peer-vulnerable', severity: 'low' }],
        },
        {
          installPath: 'node_modules/vulnerable-package',
          vulnerabilities: [{ name: 'vulnerable-package', severity: 'high' }],
          affectedWorkspaces: [
            { location: 'packages/scratch-ai-bridge', name: '@scratch/scratch-ai-bridge' },
            { location: 'packages/scratch-vm', name: '@scratch/scratch-vm' },
          ],
          introducingWorkspaces: [{ location: 'packages/scratch-vm', name: '@scratch/scratch-vm' }],
        },
      ],
    })
  })
})
