import { readFile } from 'node:fs/promises'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CANONICAL_OPCODES } from '../../src/core/capabilities'

const behaviorTestPaths = [
  new URL('./registry.test.ts', import.meta.url),
  new URL('../extensions/music.test.ts', import.meta.url),
]
const behaviorTitlePattern =
  /\b(executes|fires|waits|runs|stops|moves|glides|points|bounces|changes|reports|reads|switches|handles|clears|emits|clamps|routes|repeats)\b/i
const runtimeCallNames = new Set([
  'runForTicks',
  'runForTicksAsync',
  'greenFlag',
  'start',
  'executePrimitive',
  'runVisibilityCase',
  'getVariable',
  'getTargets',
  'createVM',
  'loadSb3',
  'runForTicks',
])

interface BehaviorTestCase {
  readonly title: string
  readonly callback: ts.ArrowFunction
  readonly literals: ReadonlySet<string>
  readonly hasExpectation: boolean
  readonly hasRuntimeExecution: boolean
}

const containsNode = (node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean => {
  if (predicate(node)) return true
  return node.forEachChild((child) => containsNode(child, predicate)) ?? false
}

const behaviorTestCases: BehaviorTestCase[] = []
const collectBehaviorTestCases = (node: ts.Node): void => {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'it' &&
    node.arguments.length >= 2 &&
    ts.isStringLiteral(node.arguments[0]) &&
    behaviorTitlePattern.test(node.arguments[0].text)
  ) {
    const callback = node.arguments.find(ts.isArrowFunction)
    if (callback) {
      const literals = new Set<string>()
      containsNode(callback.body, (candidate) => {
        if (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
          literals.add(candidate.text)
        }
        return false
      })
      behaviorTestCases.push({
        title: node.arguments[0].text,
        callback,
        literals,
        hasExpectation: containsNode(
          callback.body,
          (candidate) =>
            ts.isCallExpression(candidate) &&
            ts.isIdentifier(candidate.expression) &&
            candidate.expression.text === 'expect',
        ),
        hasRuntimeExecution: containsNode(
          callback.body,
          (candidate) =>
            ts.isCallExpression(candidate) &&
            ((ts.isIdentifier(candidate.expression) && runtimeCallNames.has(candidate.expression.text)) ||
              (ts.isPropertyAccessExpression(candidate.expression) &&
                runtimeCallNames.has(candidate.expression.name.text))),
        ),
      })
    }
  }
  node.forEachChild(collectBehaviorTestCases)
}
for (const behaviorTestPath of behaviorTestPaths) {
  const behaviorTestSource = await readFile(behaviorTestPath, 'utf8')
  const behaviorTestFile = ts.createSourceFile(
    behaviorTestPath.pathname,
    behaviorTestSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  collectBehaviorTestCases(behaviorTestFile)
}

describe('strict capability runtime coverage gate', () => {
  it('requires each strict opcode to be named and asserted in a VM-executing behavior test', () => {
    const missing = CANONICAL_OPCODES.filter(
      (opcode) =>
        !behaviorTestCases.some(
          ({ literals, hasExpectation, hasRuntimeExecution }) =>
            literals.has(opcode) && hasExpectation && hasRuntimeExecution,
        ),
    )

    expect(missing, 'Add a VM-executing behavior test with an observable assertion for every capability').toEqual([])
  })
})
