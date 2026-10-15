#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/feedback-corpus')
const lit = (value) => ({ type: 'literal', value })
const nested = (opcode, inputs = {}, fields = {}) => ({ opcode, inputs, fields })
const hat = (opcode, fields = {}) => nested(opcode, {}, fields)
const script = (...blocks) => ({ blocks })
const json = async (value, path) => {
  const filepath = resolve(root, path)
  const config = (await prettier.resolveConfig(filepath)) ?? {}
  return prettier.format(JSON.stringify(value), { ...config, filepath })
}

const spriteBase = {
  kind: 'sprite',
  name: 'Sample sprite',
  variables: [],
  lists: [],
  costumes: [{ name: 'generic-character', dataFormat: 'svg' }],
  sounds: [],
  scripts: [],
  procedures: [],
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  visible: true,
  draggable: false,
  rotationStyle: 'all around',
}
const stageBase = {
  kind: 'stage',
  name: 'Stage',
  variables: [],
  lists: [],
  costumes: [{ name: 'platform-day', dataFormat: 'svg' }],
  sounds: [],
  scripts: [],
  procedures: [],
}
const cases = [
  {
    id: 'synthetic-motion-green-flag',
    category: 'motion',
    expected: ['event_whenflagclicked', 'motion_changexby'],
    notClaim: ['runtime-tested'],
    scripts: [script(hat('event_whenflagclicked'), nested('motion_changexby', { DX: lit(10) }))],
  },
  {
    id: 'synthetic-keyboard-control',
    category: 'input',
    expected: ['event_whenkeypressed', 'left arrow'],
    notClaim: ['key press behavior was executed'],
    scripts: [
      script(hat('event_whenkeypressed', { KEY_OPTION: 'left arrow' }), nested('motion_changexby', { DX: lit(-10) })),
    ],
  },
  {
    id: 'synthetic-sprite-click',
    category: 'events',
    expected: ['event_whenthisspriteclicked'],
    notClaim: ['student intent'],
    scripts: [script(hat('event_whenthisspriteclicked'), nested('looks_say', { MESSAGE: lit('Hello') }))],
  },
  {
    id: 'synthetic-dialogue-story',
    category: 'story',
    expected: ['looks_say', 'Hello from a synthetic story'],
    notClaim: ['full story meaning'],
    scripts: [
      script(hat('event_whenflagclicked'), nested('looks_say', { MESSAGE: lit('Hello from a synthetic story') })),
    ],
  },
  {
    id: 'synthetic-costume-animation',
    category: 'animation',
    expected: ['looks_switchcostumeto'],
    notClaim: ['animation appearance quality'],
    scripts: [
      script(hat('event_whenflagclicked'), nested('looks_switchcostumeto', {}, { COSTUME: 'generic-character' })),
    ],
  },
  {
    id: 'synthetic-score-variable',
    category: 'state',
    expected: ['data_setvariableto', 'score'],
    notClaim: ['game is balanced'],
    variables: [{ name: 'score', value: 0 }],
    scripts: [
      script(hat('event_whenflagclicked'), nested('data_setvariableto', { VALUE: lit(0) }, { VARIABLE: 'score' })),
    ],
  },
  {
    id: 'synthetic-list-inventory',
    category: 'lists',
    expected: ['data_addtolist', 'items'],
    notClaim: ['inventory works at runtime'],
    lists: [{ name: 'items', value: [] }],
    scripts: [
      script(hat('event_whenflagclicked'), nested('data_addtolist', { ITEM: lit('key') }, { LIST: 'items' })),
    ],
  },
  {
    id: 'synthetic-broadcast-pair',
    category: 'broadcast',
    expected: ['event_broadcast', 'event_whenbroadcastreceived'],
    notClaim: ['timing order between scripts'],
    broadcasts: [{ name: 'begin' }],
    scripts: [
      script(
        hat('event_whenflagclicked'),
        nested('event_broadcast', { BROADCAST_INPUT: { type: 'broadcast', name: 'begin' } }),
      ),
      script(
        hat('event_whenbroadcastreceived', {}, { BROADCAST_OPTION: 'begin' }),
        nested('motion_movesteps', { STEPS: lit(10) }),
      ),
    ],
  },
  {
    id: 'synthetic-broadcast-orphan',
    category: 'broadcast',
    expected: ['event_broadcast', 'orphan'],
    notClaim: ['message is definitely unused at runtime'],
    broadcasts: [{ name: 'orphan' }],
    scripts: [
      script(
        hat('event_whenflagclicked'),
        nested('event_broadcast', { BROADCAST_INPUT: { type: 'broadcast', name: 'orphan' } }),
      ),
    ],
  },
  {
    id: 'synthetic-custom-procedure',
    category: 'procedures',
    expected: ['procedure definition is present'],
    notClaim: ['procedure always runs'],
    procedures: [
      { name: 'move once', parameters: [], warp: false, body: [nested('motion_movesteps', { STEPS: lit(10) })] },
    ],
    scripts: [script(hat('event_whenflagclicked'))],
  },
  {
    id: 'synthetic-parallel-scripts',
    category: 'events',
    expected: ['event_whenflagclicked', 'event_whenkeypressed'],
    notClaim: ['sequential ordering across scripts'],
    scripts: [
      script(hat('event_whenflagclicked'), nested('motion_changeyby', { DY: lit(1) })),
      script(hat('event_whenkeypressed', { KEY_OPTION: 'space' }), nested('motion_changeyby', { DY: lit(10) })),
    ],
  },
  {
    id: 'synthetic-conditional-branch',
    category: 'control',
    expected: ['control_if', 'operator_equals'],
    notClaim: ['branch result without input values'],
    variables: [{ name: 'score', value: 0 }],
    scripts: [
      script(
        hat('event_whenflagclicked'),
        nested('control_if', {
          CONDITION: {
            type: 'block',
            block: nested('operator_equals', { OPERAND1: { type: 'variable', name: 'score' }, OPERAND2: lit(10) }),
          },
          SUBSTACK: { type: 'stack', blocks: [nested('looks_say', { MESSAGE: lit('Target reached') })] },
        }),
      ),
    ],
  },
  {
    id: 'synthetic-repeat-loop',
    category: 'control',
    expected: ['control_repeat'],
    notClaim: ['measured performance'],
    scripts: [
      script(
        hat('event_whenflagclicked'),
        nested('control_repeat', {
          TIMES: lit(3),
          SUBSTACK: { type: 'stack', blocks: [nested('motion_movesteps', { STEPS: lit(10) })] },
        }),
      ),
    ],
  },
  {
    id: 'synthetic-forever-state-update',
    category: 'diagnostic-negative',
    expected: ['forever-reinitialize is informational'],
    notClaim: ['must move initialization'],
    variables: [{ name: 'score', value: 0 }],
    scripts: [
      script(
        hat('event_whenflagclicked'),
        nested('control_forever', {
          SUBSTACK: {
            type: 'stack',
            blocks: [
              nested('data_changevariableby', { VALUE: lit(1) }, { VARIABLE: 'score' }),
              nested('control_wait', { DURATION: lit(0.1) }),
            ],
          },
        }),
      ),
    ],
  },
  {
    id: 'synthetic-opaque-extension',
    category: 'extension',
    expected: ['thirdparty_sensor_read is opaque'],
    notClaim: ['extension sensor value'],
    rawGraphs: [
      {
        targetIndex: 1,
        targetName: 'Sample sprite',
        isStage: false,
        blocks: { opaqueExtension: { opcode: 'thirdparty_sensor_read', shadow: false } },
        issues: [],
      },
    ],
  },
  {
    id: 'synthetic-camera-disabled',
    category: 'extension',
    expected: ['videoSensing_videoOn is preserved'],
    notClaim: ['camera output'],
    extensions: ['videoSensing'],
    rawGraphs: [
      {
        targetIndex: 1,
        targetName: 'Sample sprite',
        isStage: false,
        blocks: { cameraExtension: { opcode: 'videoSensing_videoOn', shadow: false } },
        issues: [],
      },
    ],
  },
  {
    id: 'synthetic-malformed-graph',
    category: 'malformed',
    expected: ['graph issue with block ID'],
    notClaim: ['complete script behavior'],
    rawGraphs: [
      {
        targetIndex: 1,
        targetName: 'Sample sprite',
        isStage: false,
        blocks: { broken: { opcode: 'event_whenflagclicked', shadow: false } },
        issues: [{ code: 'missing-block', blockId: 'broken', message: 'next block reference is missing' }],
      },
    ],
  },
  {
    id: 'synthetic-missing-asset',
    category: 'assets',
    expected: ['missing-archive-entry'],
    notClaim: ['visual appearance'],
    costumeIssue: 'missing-archive-entry',
  },
  {
    id: 'synthetic-legacy-procedure',
    category: 'legacy',
    expected: ['procedure metadata is visible'],
    notClaim: ['original argument value if absent'],
    procedures: [{ name: 'legacy sample', parameters: [], warp: false, body: [] }],
  },
  {
    id: 'synthetic-incomplete-project',
    category: 'incomplete',
    expected: ['empty scripts are retained as an observable state'],
    notClaim: ['incomplete means poor quality'],
    scripts: [],
  },
]

const manifest = {
  format: 'scratch-ai-bridge/feedback-corpus',
  version: 1,
  privacy: 'synthetic-only; no student archives or names',
  cases: [],
}

for (const entry of cases) {
  const sprite = structuredClone(spriteBase)
  sprite.variables = entry.variables ?? []
  sprite.lists = entry.lists ?? []
  sprite.scripts = entry.scripts ?? []
  sprite.procedures = entry.procedures ?? []
  if (entry.costumeIssue) sprite.costumes[0].assetIssue = entry.costumeIssue

  const stage = structuredClone(stageBase)
  stage.scripts = entry.stageScripts ?? []
  const project = {
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: entry.id,
    stage,
    sprites: [sprite],
    broadcasts: entry.broadcasts ?? [],
    ...(entry.extensions ? { extensions: entry.extensions } : {}),
  }
  const projectPath = `projects/${entry.id}.json`
  await mkdir(resolve(root, 'projects'), { recursive: true })
  await writeFile(resolve(root, projectPath), await json(project, projectPath))
  let rawGraphPath
  if (entry.rawGraphs) {
    rawGraphPath = `raw-graphs/${entry.id}.json`
    await mkdir(resolve(root, 'raw-graphs'), { recursive: true })
    await writeFile(resolve(root, rawGraphPath), await json(entry.rawGraphs, rawGraphPath))
  }
  manifest.cases.push({
    id: entry.id,
    category: entry.category,
    source: 'generated',
    projectFile: projectPath,
    ...(rawGraphPath ? { rawGraphFile: rawGraphPath } : {}),
    review: 'pending',
    expected: entry.expected,
    'must-not-claim': entry.notClaim,
  })
}

await writeFile(resolve(root, 'cases.json'), await json(manifest, 'cases.json'))
process.stdout.write(
  `Generated ${manifest.cases.length} synthetic Canonical IR cases. All remain pending human review.\n`,
)
