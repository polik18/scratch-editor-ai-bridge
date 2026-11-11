import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2] ?? 'test-results/performance.json'
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const budgetsMs = new Map([
  ['4 MiB DEFLATE asset · SB3 archive import', 250],
  ['2000 blocks · AI draft normalization', 12],
  ['2000 blocks · Canonical schema validation', 6],
  ['2000 blocks · project analysis', 6],
  ['2000 blocks · JSON parse', 8],
  ['2000 blocks · SB3 archive compilation', 75],
])
const benchmarks = report.files.flatMap((file) => file.groups.flatMap((group) => group.benchmarks))
const failures = []

for (const [name, budgetMs] of budgetsMs) {
  const benchmark = benchmarks.find((candidate) => candidate.name === name)
  if (!benchmark || !Number.isFinite(benchmark.mean)) {
    failures.push(`${name}: missing mean measurement`)
    continue
  }
  const result = `${name}: ${benchmark.mean.toFixed(3)} ms mean; budget ${budgetMs} ms`
  console.log(result)
  if (benchmark.mean > budgetMs) failures.push(`${result} — exceeded`)
}

if (failures.length > 0) {
  console.error(`Performance budget failed:\n${failures.join('\n')}`)
  process.exitCode = 1
}
