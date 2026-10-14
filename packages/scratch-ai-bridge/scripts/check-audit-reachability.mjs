import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const usage =
  'Usage: node scripts/check-audit-reachability.mjs <npm-audit.json> <sourcemap-directory> [repository-root]'
const [
  auditPath,
  sourceMapRoot,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
] = process.argv.slice(2)

if (!auditPath || !sourceMapRoot) {
  console.error(usage)
  process.exit(2)
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))
const audit = await readJson(path.resolve(auditPath))
if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object') {
  throw new Error('npm audit JSON has no vulnerabilities object')
}

const repoRoot = path.resolve(repositoryRoot)
const lockfilePath = path.join(repoRoot, 'package-lock.json')
let lockfilePackages = {}
try {
  const lockfile = await readJson(lockfilePath)
  if (lockfile.packages && typeof lockfile.packages === 'object') lockfilePackages = lockfile.packages
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const resolvePackagePath = (fromPackagePath, dependencyName) => {
  let parentPath = fromPackagePath
  while (true) {
    const candidate = [parentPath, 'node_modules', dependencyName].filter(Boolean).join('/')
    if (Object.hasOwn(lockfilePackages, candidate)) return candidate
    if (!parentPath) return null
    const separator = parentPath.lastIndexOf('/')
    parentPath = separator < 0 ? '' : parentPath.slice(0, separator)
  }
}
const resolveLinkedPackagePath = (packagePath) => {
  const metadata = lockfilePackages[packagePath]
  if (metadata?.link !== true || typeof metadata.resolved !== 'string') return packagePath
  const linkedPath = path.posix.normalize(metadata.resolved)
  return Object.hasOwn(lockfilePackages, linkedPath) ? linkedPath : packagePath
}
const collectProductionDependencyPaths = (workspacePath) => {
  const visited = new Set()
  const expanded = new Set()
  const queue = [workspacePath]
  while (queue.length > 0) {
    const installPath = queue.shift()
    if (!installPath || visited.has(installPath)) continue
    visited.add(installPath)

    const packagePath = resolveLinkedPackagePath(installPath)
    visited.add(packagePath)
    if (expanded.has(packagePath)) continue
    expanded.add(packagePath)
    const metadata = lockfilePackages[packagePath]
    for (const dependencySet of [
      metadata?.dependencies,
      metadata?.optionalDependencies,
      metadata?.peerDependencies,
    ]) {
      for (const dependencyName of Object.keys(dependencySet ?? {})) {
        const dependencyPath = resolvePackagePath(packagePath, dependencyName)
        if (dependencyPath && !visited.has(dependencyPath)) queue.push(dependencyPath)
      }
    }
  }
  return visited
}
const dependentsByPath = new Map()
for (const [packagePath, metadata] of Object.entries(lockfilePackages)) {
  const dependencies = [metadata.dependencies, metadata.optionalDependencies, metadata.peerDependencies]
  for (const dependencySet of dependencies) {
    for (const dependencyName of Object.keys(dependencySet ?? {})) {
      const dependencyPath = resolvePackagePath(packagePath, dependencyName)
      if (!dependencyPath) continue
      const dependents = dependentsByPath.get(dependencyPath) ?? new Set()
      dependents.add(packagePath)
      dependentsByPath.set(dependencyPath, dependents)
    }
  }
  if (metadata.link === true && typeof metadata.resolved === 'string') {
    const linkedPath = path.posix.normalize(metadata.resolved)
    if (Object.hasOwn(lockfilePackages, linkedPath)) {
      const dependents = dependentsByPath.get(linkedPath) ?? new Set()
      dependents.add(packagePath)
      dependentsByPath.set(linkedPath, dependents)
    }
  }
}
const findAffectedWorkspaces = (packagePath) => {
  const workspaces = new Map()
  const visited = new Set()
  const queue = [packagePath]
  while (queue.length > 0) {
    const currentPath = queue.shift()
    if (!currentPath || visited.has(currentPath)) continue
    visited.add(currentPath)
    const metadata = lockfilePackages[currentPath]
    if (
      currentPath.startsWith('packages/') &&
      !currentPath.includes('/node_modules/') &&
      metadata &&
      metadata.link !== true
    ) {
      workspaces.set(currentPath, { location: currentPath, name: metadata.name ?? currentPath })
    }
    for (const dependent of dependentsByPath.get(currentPath) ?? []) queue.push(dependent)
  }
  return [...workspaces.values()].sort((left, right) => left.location.localeCompare(right.location))
}
const findIntroducingWorkspaces = (packagePath) => {
  const visitedDistance = new Map([[packagePath, 0]])
  const queue = [{ location: packagePath, distance: 0 }]
  const workspaces = new Map()
  let nearestDistance = Number.POSITIVE_INFINITY
  while (queue.length > 0) {
    const current = queue.shift()
    if (current.distance > nearestDistance) continue
    const metadata = lockfilePackages[current.location]
    if (
      current.location.startsWith('packages/') &&
      !current.location.includes('/node_modules/') &&
      metadata &&
      metadata.link !== true
    ) {
      nearestDistance = current.distance
      workspaces.set(current.location, { location: current.location, name: metadata.name ?? current.location })
      continue
    }
    for (const dependent of dependentsByPath.get(current.location) ?? []) {
      const distance = current.distance + 1
      if (distance >= (visitedDistance.get(dependent) ?? Number.POSITIVE_INFINITY)) continue
      visitedDistance.set(dependent, distance)
      queue.push({ location: dependent, distance })
    }
  }
  return [...workspaces.values()].sort((left, right) => left.location.localeCompare(right.location))
}
const vulnerableLocations = new Map()
for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
  for (const node of vulnerability.nodes ?? []) {
    const location = path.resolve(repoRoot, node)
    const entries = vulnerableLocations.get(location) ?? []
    entries.push({
      name,
      severity: vulnerability.severity,
      range: vulnerability.range,
      fixAvailable: vulnerability.fixAvailable,
    })
    vulnerableLocations.set(location, entries)
  }
}

const sourceMaps = []
const collectMaps = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectMaps(filePath)
    else if (entry.isFile() && entry.name.endsWith('.js.map')) sourceMaps.push(filePath)
  }
}
await collectMaps(path.resolve(sourceMapRoot))

const mappedSources = new Set()
const mappedPackageRoots = new Set()
for (const mapPath of sourceMaps) {
  const map = await readJson(mapPath)
  if (!Array.isArray(map.sources)) throw new Error(`Source map has no sources array: ${mapPath}`)
  for (const source of map.sources) {
    const absoluteSource = path.resolve(path.dirname(mapPath), map.sourceRoot ?? '', source)
    mappedSources.add(absoluteSource)
    const normalized = absoluteSource.split(path.sep).join('/')
    const packageMatch = normalized.match(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+/)
    if (packageMatch) mappedPackageRoots.add(packageMatch[0].replace(/^\//, ''))
  }
}

const vulnerableInstallPaths = []
for (const [location, vulnerabilities] of vulnerableLocations) {
  const sources = [...mappedSources].filter(
    (source) => source === location || source.startsWith(`${location}${path.sep}`),
  )
  const installPath = path.relative(repoRoot, location)
  vulnerableInstallPaths.push({
    installPath,
    version: lockfilePackages[installPath]?.version,
    vulnerabilities,
    mappedSourceCount: sources.length,
    affectedWorkspaces: findAffectedWorkspaces(installPath),
    introducingWorkspaces: findIntroducingWorkspaces(installPath),
  })
}
vulnerableInstallPaths.sort((left, right) => left.installPath.localeCompare(right.installPath))
const intersections = vulnerableInstallPaths.filter(({ mappedSourceCount }) => mappedSourceCount > 0)
const bridgeProductionDependencyPaths = collectProductionDependencyPaths('packages/scratch-ai-bridge')
const bridgeProductionVulnerableInstallPaths = vulnerableInstallPaths.filter(({ installPath }) =>
  bridgeProductionDependencyPaths.has(installPath),
)

console.log(
  JSON.stringify(
    {
      sourceMapCount: sourceMaps.length,
      mappedSourceCount: mappedSources.size,
      mappedThirdPartyRootCount: mappedPackageRoots.size,
      bridgeProductionDependencyPathCount: bridgeProductionDependencyPaths.size,
      bridgeProductionVulnerableInstallPathCount: bridgeProductionVulnerableInstallPaths.length,
      bridgeProductionVulnerableInstallPaths,
      vulnerableInstallPathCount: vulnerableLocations.size,
      vulnerableInstallPaths,
      intersections,
    },
    null,
    2,
  ),
)

if (intersections.length > 0) process.exitCode = 1
