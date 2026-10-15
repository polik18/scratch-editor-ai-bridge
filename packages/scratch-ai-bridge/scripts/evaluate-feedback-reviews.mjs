#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { evaluateTeacherReviewGate, parseTeacherReviewRecords } from '../src/core/feedback/review-gate.ts'

const usage = 'Usage: npm run feedback:review -- <reviews.json> [report.json]'
const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || process.argv.length > 4) {
  process.stderr.write(`${usage}\n`)
  process.exitCode = 2
} else {
  try {
    const payload = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
    const records = parseTeacherReviewRecords(payload)
    const corpus = JSON.parse(
      await readFile(new URL('../tests/fixtures/feedback-corpus/cases.json', import.meta.url), 'utf8'),
    )
    const expectedCaseIds = corpus.cases.map(({ id }) => id)
    const report = evaluateTeacherReviewGate(records, expectedCaseIds)
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (outputPath) await writeFile(resolve(outputPath), json, { flag: 'wx' })
    else process.stdout.write(json)
    if (report.status !== 'passed') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
