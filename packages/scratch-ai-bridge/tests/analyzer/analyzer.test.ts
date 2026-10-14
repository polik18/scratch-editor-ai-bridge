import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject } from '../../src/core/analyzer'
import { extractProjectBlockGraphs } from '../../src/core/graph'
import broadcastExample from '../../src/core/ir/examples/04-broadcast-flow.json'
import fullEntitiesExample from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('analysis IR', () => {
  it('summarizes scripts and broadcast dependencies', () => {
    const result = analyzeCanonicalProject(broadcastExample as CanonicalProject)
    expect(result.summary.scripts).toBe(2)
    expect(result.summary.broadcasts).toBe(1)
    expect(result.dependencies.broadcasts[0]).toMatchObject({
      name: 'game_over',
      senders: ['Stage#1'],
      receivers: ['Stage#2'],
    })
  })

  it('warns for offline cloud variables without changing their declarations', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.variables = [
      { name: 'cloud score', value: 12, cloud: true },
      { name: 'local score', value: 7, cloud: false },
    ]
    const before = structuredClone(project.stage.variables)

    const result = analyzeCanonicalProject(project)

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'cloud-variable-offline',
        target: 'Stage',
        variable: 'cloud score',
      }),
    )
    const cloudWarnings = result.diagnostics.filter(({ code }) => code === 'cloud-variable-offline')
    expect(cloudWarnings).toHaveLength(1)
    expect(cloudWarnings[0].message).toContain('不會同步到 Scratch 雲端')
    expect(project.stage.variables).toEqual(before)
  })

  it('checks yield behavior inside each forever loop rather than elsewhere in the script', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_forever',
            inputs: { SUBSTACK: { type: 'stack', blocks: [{ opcode: 'motion_movesteps' }] } },
          },
          { opcode: 'control_wait' },
        ],
      },
    ]

    expect(analyzeCanonicalProject(project).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )

    project.stage.scripts[0].blocks = [
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'control_forever',
        inputs: { SUBSTACK: { type: 'stack', blocks: [{ opcode: 'control_wait' }] } },
      },
      { opcode: 'control_wait' },
    ]
    expect(analyzeCanonicalProject(project).diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )

    project.stage.procedures = [
      {
        name: 'waitIndirectly',
        parameters: [],
        warp: false,
        body: [{ opcode: 'procedures_call', procedure: { name: 'waitDirectly' } }],
      },
      {
        name: 'waitDirectly',
        parameters: [],
        warp: false,
        body: [{ opcode: 'control_wait' }],
      },
    ]
    project.stage.scripts[0].blocks = [
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'control_forever',
        inputs: {
          SUBSTACK: {
            type: 'stack',
            blocks: [{ opcode: 'procedures_call', procedure: { name: 'waitIndirectly' } }],
          },
        },
      },
    ]
    expect(analyzeCanonicalProject(project).diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )
  })

  it('includes raw graph preservation and structural diagnostics', () => {
    const canonical = broadcastExample as CanonicalProject
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            reporter: {
              opcode: 'thirdparty_reporter',
              next: null,
              parent: null,
              topLevel: true,
              inputs: {},
              mutation: { extension: 'kept' },
            },
            broken: { opcode: 'control_repeat', next: 'missing', parent: null, inputs: {} },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(canonical, graphs)

    const preserved = result.diagnostics.find(({ code }) => code === 'raw-block-graph-preserved')
    const unmodeled = result.diagnostics.find(({ code }) => code === 'raw-block-graph-unmodeled-opcodes')
    const broken = result.diagnostics.find(({ code }) => code === 'block-graph-missing-block')

    expect(preserved?.message).toContain('2 個積木')
    expect(unmodeled?.message).toContain('thirdparty_reporter')
    expect(broken).toMatchObject({ severity: 'warning', target: 'Stage' })
  })

  it('tracks variable and list reads and writes from Scratch reporter fields', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_changevariableby',
            fields: { VARIABLE: 'score' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
          {
            opcode: 'data_addtolist',
            fields: { LIST: 'items' },
            inputs: { ITEM: { type: 'literal', value: 'coin' } },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'total' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'data_variable', fields: { VARIABLE: 'score' } },
              },
            },
          },
          {
            opcode: 'operator_join',
            inputs: {
              STRING1: { type: 'variable', name: 'externalScore' },
              STRING2: { type: 'list', name: 'externalItems' },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'total' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'data_lengthoflist', fields: { LIST: 'items' } },
              },
            },
          },
        ],
      },
    ]

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].scripts[0]).toMatchObject({
      reads: ['score', 'externalScore'],
      writes: ['score', 'total'],
      listReads: ['externalItems', 'items'],
      listWrites: ['items'],
    })
    expect(result.targets[0].scripts[0].reads).toContain('externalScore')
  })

  it('counts procedure bodies and reports procedure call dependencies', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.procedures[0].body = [
      { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'inside procedure' } } },
      { opcode: 'data_changevariableby', fields: { VARIABLE: 'score' } },
      { opcode: 'data_lengthoflist', fields: { LIST: 'items' } },
      { opcode: 'procedures_call', procedure: { name: 'helper' } },
    ]
    project.stage.procedures.push({
      name: 'helper',
      parameters: [],
      warp: false,
      body: [
        {
          opcode: 'data_setvariableto',
          fields: { VARIABLE: 'score' },
          inputs: {
            VALUE: { type: 'variable', name: 'externalScore' },
            EXTRA: { type: 'list', name: 'externalItems' },
          },
        },
        { opcode: 'data_setvariableto', fields: { VARIABLE: 'helperScore' } },
        { opcode: 'data_addtolist', fields: { LIST: 'items' } },
        { opcode: 'procedures_call', procedure: { name: 'announce' } },
      ],
    })
    project.stage.scripts[0].blocks.push({ opcode: 'procedures_call', procedure: { name: 'announce' } })
    project.stage.scripts[0].blocks.push({ opcode: 'procedures_call', procedure: { name: 'missing' } })

    const result = analyzeCanonicalProject(project)
    expect(result.summary.procedures).toBe(2)
    expect(result.targets[0].procedures).toEqual([
      {
        name: 'announce',
        blockCount: 4,
        calls: ['helper'],
        broadcasts: [],
        reads: ['score', 'externalScore'],
        writes: ['score', 'helperScore'],
        listReads: ['items', 'externalItems'],
        listWrites: ['items'],
      },
      {
        name: 'helper',
        blockCount: 4,
        calls: ['announce'],
        broadcasts: [],
        reads: ['externalScore', 'score'],
        writes: ['score', 'helperScore'],
        listReads: ['externalItems', 'items'],
        listWrites: ['items'],
      },
    ])
    expect(result.dependencies.procedures).toEqual([
      { target: 'Stage', name: 'announce', callees: ['helper'] },
      { target: 'Stage', name: 'helper', callees: ['announce'] },
    ])
    expect(result.targets[0].scripts[0]).toMatchObject({
      reads: ['score', 'externalScore'],
      writes: ['score', 'helperScore'],
      listReads: ['items', 'externalItems'],
      listWrites: ['items'],
    })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'procedure-no-definition', target: 'Stage' }),
    )
    expect(result.summary.blocks).toBeGreaterThan(result.targets.reduce((sum, target) => sum + target.blockCount, 0))
  })

  it('tracks broadcasts emitted directly and transitively by custom procedures', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.procedures = [
      {
        name: 'sendNotice',
        parameters: [],
        warp: false,
        body: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'notice' } } }],
      },
      {
        name: 'relay',
        parameters: [],
        warp: false,
        body: [{ opcode: 'procedures_call', procedure: { name: 'sendNotice' } }],
      },
    ]
    project.stage.scripts.push({
      blocks: [{ opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'notice' } }],
    })

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].procedures.map(({ name, broadcasts }) => ({ name, broadcasts }))).toEqual([
      { name: 'sendNotice', broadcasts: ['notice'] },
      { name: 'relay', broadcasts: ['notice'] },
    ])
    expect(result.dependencies.broadcasts.find(({ name }) => name === 'notice')?.senders).toEqual([
      'Stage::procedure:sendNotice',
      'Stage::procedure:relay',
    ])
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'broadcast-no-receiver', message: '廣播「notice」有送出者，但沒有接收腳本。' }),
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'receiver-no-sender',
        message: '「當收到 notice」存在，但專案內找不到明顯的 broadcast 發送者。',
      }),
    )
  })

  it('propagates effects through long procedure chains without recursion', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    const procedureCount = 1_024
    project.stage.procedures = Array.from({ length: procedureCount }, (_, index) => ({
      name: `chain-${index}`,
      parameters: [],
      warp: false,
      body:
        index + 1 < procedureCount
          ? [{ opcode: 'procedures_call', procedure: { name: `chain-${index + 1}` } }]
          : [{ opcode: 'data_setvariableto', fields: { VARIABLE: 'terminalValue' } }],
    }))
    project.stage.scripts = [
      {
        blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'procedures_call', procedure: { name: 'chain-0' } }],
      },
    ]

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].procedures[0].writes).toEqual(['terminalValue'])
    expect(result.targets[0].scripts[0].writes).toEqual(['terminalValue'])
  })

  it('reports monitor, asset, and extension dependencies from semantic and raw project data', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['pen']
    project.stage.costumes[0].assetIssue = 'missing-archive-entry'
    project.stage.sounds[0].assetIssue = 'checksum-mismatch'
    project.monitors = [
      {
        id: 'score-monitor',
        opcode: 'data_variable',
        params: { VARIABLE: 'missing-score' },
        spriteName: null,
        mode: 'default',
        value: 0,
        visible: true,
      },
      {
        id: 'items-monitor',
        opcode: 'data_listcontents',
        params: { LIST: 'items' },
        spriteName: null,
        mode: 'list',
        value: [],
        visible: true,
      },
    ]
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            penBlock: { opcode: 'pen_penDown', next: null, parent: null, topLevel: true },
            penBlock2: { opcode: 'pen_penDown', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)
    expect(result.dependencies.monitors).toEqual([
      { id: 'score-monitor', opcode: 'data_variable', target: null, variable: 'missing-score' },
      { id: 'items-monitor', opcode: 'data_listcontents', target: null, list: 'items' },
    ])
    expect(result.dependencies.assets).toEqual([
      { target: 'Stage', kind: 'costume', name: project.stage.costumes[0].name, issue: 'missing-archive-entry' },
      { target: 'Stage', kind: 'sound', name: project.stage.sounds[0].name, issue: 'checksum-mismatch' },
    ])
    expect(result.dependencies.extensions).toEqual([
      { id: 'pen', declared: true, blockCount: 2, opcodes: ['pen_penDown'] },
    ])
    expect(result.diagnostics.map(({ code }) => code)).toContain('monitor-variable-missing')
    expect(result.diagnostics.map(({ code }) => code)).toContain('asset-checksum-mismatch')
  })

  it('explains whether extensions can execute in this Bridge runtime', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['wedo2', 'microbit', 'ev3', 'boost', 'gdxfor', 'faceSensing', 'videoSensing']
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            vendorBlock: { opcode: 'vendor_custom', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'extension-runtime-unavailable' }),
    )
    expect(result.diagnostics.find(({ code }) => code === 'extension-runtime-unavailable')?.message).toContain(
      'vendor',
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'info', code: 'extension-runtime-unverified' }),
    )
    expect(
      result.diagnostics
        .filter(({ code }) => code === 'extension-runtime-unverified')
        .some(({ message }) => message.includes('wedo2')),
    ).toBe(true)
    const hardwarePreviewMessages = result.diagnostics
      .filter(({ code }) => code === 'extension-hardware-unverified')
      .map(({ message }) => message)
    expect(hardwarePreviewMessages).toHaveLength(5)
    expect(hardwarePreviewMessages.every((message) => message.includes('Scratch Link 搜尋與配對入口'))).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'extension-runtime-disabled' }),
    )
    const disabledMessages = result.diagnostics
      .filter(({ code }) => code === 'extension-runtime-disabled')
      .map(({ message }) => message)
    expect(disabledMessages).toHaveLength(2)
    expect(disabledMessages.find((message) => message.includes('faceSensing'))).toContain('MediaPipe')
    expect(disabledMessages.find((message) => message.includes('videoSensing'))).toContain('自動啟用攝影機')
  })

  it('warns that Text to Speech sends spoken text to the Scratch service', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['text2speech']
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            speechBlock: { opcode: 'text2speech_speakAndWait', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)
    const warning = result.diagnostics.find(({ code }) => code === 'extension-data-egress')

    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('最多 128 個字元')
    expect(warning?.message).toContain('Scratch 合成服務')
    expect(warning?.message).toContain('個人或敏感資料')
  })
})
