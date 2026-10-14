import { describe, expect, it } from 'vitest'
import { validateBrowserReleaseEvidence } from '../../scripts/check-browser-release-evidence.mjs'

const browsers = ['chromium', 'firefox', 'webkit']
const makeReport = (browser) => ({
  browser,
  runtime: { platform: 'linux', browserVersion: 'test-version' },
  processTreePssSumPeakBytes: 1000,
  processTreePssSampleCount: 5,
  offlineReload: {
    scope: '/scratch-editor-ai-bridge/',
    networkMode: 'browser-offline',
    serviceWorkerInstalled: true,
    serviceWorkerControlledPage: true,
    browserNetworkDisabled: true,
    reloadSucceeded: true,
    appInputVisible: true,
  },
  nearLimitArchive: {
    aggregateUncompressedBytes: 268435456,
    processTreePssSumPeakBytes: 2000,
    processTreePssSampleCount: 3,
  },
  aiRepairRecoveryEvidence: {
    schemaFailureCorrectionLoop: {
      issueCode: 'schema-type',
      issuePath: '/name',
      recoveredDownload: true,
      reimportedSpriteName: 'Player',
    },
    schemaAdditionalPropertyCorrectionLoop: {
      issueCode: 'schema-additionalProperties',
      issuePath: '/unexpectedField',
      reportedProperty: 'unexpectedField',
      recoveredDownload: true,
      reimportedPropertyPresent: false,
    },
    schemaEnumCorrectionLoop: {
      issueCode: 'schema-enum',
      issuePath: '/sprites/0/rotationStyle',
      reportedValue: 'sideways',
      replacementValue: 'all around',
      recoveredDownload: true,
      reimportedValue: 'all around',
    },
    schemaConstCorrectionLoop: {
      issueCode: 'schema-const',
      issuePath: '/stage/kind',
      reportedValue: 'sprite',
      replacementValue: 'stage',
      recoveredDownload: true,
      reimportedValue: 'stage',
    },
    schemaRequiredCorrectionLoop: {
      issueCode: 'schema-required',
      issuePath: '/sprites/0/scripts/0/blocks/2/inputs/VALUE/value',
      expected: 'required property value',
      recoveredDownload: true,
      reimportedInput: { type: 'literal', value: 0 },
    },
    schemaMinLengthCorrectionLoop: {
      issueCode: 'schema-minLength',
      issuePath: '/name',
      reportedValue: '',
      replacementValue: 'Scratch Project',
      submittedProjectName: 'Scratch Project',
      recoveredDownload: true,
      reimportedSprites: ['Player'],
    },
    currentCostumeCorrectionLoop: {
      issueCode: 'current-costume-out-of-range',
      issuePath: '/stage/currentCostume',
      replacementIndex: 0,
      recoveredDownload: true,
      reimportedIndex: 0,
    },
    unknownSpriteCorrectionLoop: {
      issueCode: 'unknown-sprite',
      issuePath:
        '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/2/inputs/CONDITION/block/inputs/TOUCHINGOBJECTMENU',
      reportedSprite: 'Missing Sprite',
      correctedSprite: 'Platform',
      recoveredDownload: true,
      reimportedSprites: ['Player', 'Platform'],
    },
    unknownVariableCorrectionLoop: {
      issueCode: 'unknown-variable',
      issuePath: '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/0/inputs/DY',
      reportedName: { type: 'variable', name: 'missing y velocity' },
      correctedName: 'y velocity',
      recoveredDownload: true,
      reimportedVariableName: 'y velocity',
    },
    unknownBroadcastCorrectionLoop: {
      issueCode: 'unknown-broadcast',
      issuePath: '/sprites/0/scripts/1/blocks/0/fields/BROADCAST_OPTION',
      reportedName: 'Missing broadcast',
      correctedName: 'Missing broadcast',
      recoveredDownload: true,
      reimportedBroadcastNames: ['Missing broadcast'],
    },
    unknownListCorrectionLoop: {
      issueCode: 'unknown-list',
      issuePath: '/sprites/0/scripts/0/blocks/2/fields/LIST',
      reportedName: 'Missing list',
      correctedName: 'Missing list',
      recoveredDownload: true,
      reimportedListNames: ['Missing list'],
    },
    unknownProcedureCorrectionLoop: {
      issueCode: 'unknown-procedure',
      issuePath: '/sprites/0/scripts/0/blocks/2',
      reportedName: 'Missing procedure',
      correctedName: 'Missing procedure',
      recoveredDownload: true,
      reimportedProcedureNames: ['Missing procedure'],
    },
    unknownProcedureArgumentCorrectionLoop: {
      issueCode: 'unknown-procedure-argument',
      issuePath: '/sprites/0/scripts/0/blocks/2/inputs/unexpected',
      reportedName: 'unexpected',
      correctedName: 'Known procedure',
      recoveredDownload: true,
      reimportedProcedureNames: ['Known procedure'],
      reimportedCallInputs: [],
    },
    duplicateProcedureArgumentCorrectionLoop: {
      issueCode: 'duplicate-procedure-argument',
      issuePath: '/sprites/0/procedures/0/parameters/1/name',
      reportedName: 'value',
      correctedName: 'amount',
      recoveredDownload: true,
      reimportedParameterNames: ['value', 'amount'],
    },
  },
  compileRepairRecoveryEvidence: {
    svgCorrectionLoop: {
      issueCode: 'compile-failed',
      issuePath: '/sprites/0/costumes/0',
      compileStage: 'svg-preflight',
      promptContainsIssueAndPath: true,
      submittedCorrectedResponse: true,
      recoveredDownload: true,
      reimportedSprites: ['Player'],
      reimportedAssetValid: true,
    },
    rasterCorrectionLoop: {
      issueCode: 'compile-failed',
      issuePath: '/sprites/0/costumes/0',
      compileStage: 'raster-preflight',
      promptContainsIssueAndPath: true,
      submittedCorrectedResponse: true,
      recoveredDownload: true,
      reimportedSprites: ['Player'],
      reimportedAssetValid: true,
    },
    audioCorrectionLoop: {
      issueCode: 'compile-failed',
      issuePath: '/stage/sounds/0',
      compileStage: 'audio-preflight',
      promptContainsIssueAndPath: true,
      submittedCorrectedResponse: true,
      recoveredDownload: true,
      reimportedSounds: ['Truncated wav'],
      reimportedAssetValid: true,
    },
  },
  officialDraggablePreview: {
    fixture: 'draggable.sb3',
    targetName: 'Sprite1',
    importedDraggable: true,
    dragDeltaStageUnits: { x: 50, y: 40 },
    visibleCanvasChangedAfterDrag: true,
  },
  officialEventHatPreview: {
    fixture: 'edge-triggered-hat.sb3',
    targetName: 'Sprite1',
    timerHatOpcode: 'event_whengreaterthan',
    timerThreshold: -1,
    movementOpcode: 'motion_movesteps',
    movementSteps: 10,
    canvasDimensions: { before: { width: 480, height: 360 }, after: { width: 480, height: 360 } },
    visibleCanvasChangedAfterRuntime: true,
  },
  combinedAudioEffects: {
    fixture: 'default.sb3-derived-combined-effects',
    pitchOpcode: 'sound_seteffectto',
    pitchValue: 120,
    panOpcode: 'sound_seteffectto',
    panValue: -100,
    volumeOpcode: 'sound_setvolumeto',
    volumeValue: 40,
    playbackRate: 2,
    panLeftGain: 1,
    panRightGain: 0,
    volumeGain: 0.4,
  },
})

const reports = () => Object.fromEntries(browsers.map((browser) => [browser, makeReport(browser)]))

describe('Linux browser release evidence gate', () => {
  it('accepts all three engines with PSS samples for the normal and exact-cap imports', () => {
    const summary = validateBrowserReleaseEvidence(reports())
    expect(summary).toHaveLength(3)
    expect(summary.map(({ aiRepairRecoveryLoops }) => aiRepairRecoveryLoops)).toEqual([14, 14, 14])
  })

  it('rejects a missing browser report', () => {
    const evidence = reports()
    delete evidence.webkit
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow('Missing or mismatched webkit')
  })

  it('rejects a report without nested-path offline reload evidence', () => {
    const evidence = reports()
    evidence.webkit.offlineReload.reloadSucceeded = false
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit report is missing the nested-path offline reload assertion',
    )
  })

  it('accepts an origin-unavailable offline reload mode for WebKit', () => {
    const evidence = reports()
    evidence.webkit.offlineReload = {
      scope: '/scratch-editor-ai-bridge/',
      networkMode: 'origin-unavailable',
      serviceWorkerInstalled: true,
      serviceWorkerControlledPage: true,
      browserNetworkDisabled: false,
      originUnavailable: true,
      reloadSucceeded: true,
      appInputVisible: true,
    }
    expect(validateBrowserReleaseEvidence(evidence)).toHaveLength(3)
  })

  it('rejects non-Linux reports', () => {
    const evidence = reports()
    evidence.firefox.runtime.platform = 'darwin'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow('firefox report platform must be linux')
  })

  it('requires positive normal-flow PSS peak and sample count', () => {
    const evidence = reports()
    evidence.chromium.processTreePssSampleCount = 0
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow('chromium process-tree is missing a positive')
  })

  it('requires PSS evidence during the exact-cap import', () => {
    const evidence = reports()
    delete evidence.webkit.nearLimitArchive.processTreePssSumPeakBytes
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit exact-cap import process-tree is missing a positive processTreePssSumPeakBytes',
    )
  })

  it('requires the declared 256 MiB exact-cap workload', () => {
    const evidence = reports()
    evidence.firefox.nearLimitArchive.aggregateUncompressedBytes += 1
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow('firefox did not import exactly 268435456')
  })

  it('requires all AI repair recovery loops and successful re-import evidence', () => {
    const evidence = reports()
    evidence.firefox.aiRepairRecoveryEvidence.unknownVariableCorrectionLoop.reimportedVariableName = 'lost variable'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox variable repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires rendered movement from the imported official draggable fixture', () => {
    const evidence = reports()
    evidence.firefox.officialDraggablePreview.visibleCanvasChangedAfterDrag = false
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox report is missing the official draggable fixture preview assertion',
    )
  })

  it('requires the official edge-triggered timer fixture to execute in preview', () => {
    const evidence = reports()
    evidence.webkit.officialEventHatPreview.visibleCanvasChangedAfterRuntime = false
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit report is missing the official edge-triggered preview execution assertion',
    )
  })

  it('rejects edge-triggered preview screenshots with mismatched dimensions', () => {
    const evidence = reports()
    evidence.chromium.officialEventHatPreview.canvasDimensions.after.width = 479
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium report is missing the official edge-triggered preview execution assertion',
    )
  })

  it('requires combined pitch, pan, and volume behavior from one Scratch audio fixture', () => {
    const evidence = reports()
    evidence.firefox.combinedAudioEffects.playbackRate = 1
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox report is missing combined Scratch pitch, pan, and volume playback evidence',
    )
  })

  it('requires both expected pan channels in combined audio evidence', () => {
    const evidence = reports()
    evidence.webkit.combinedAudioEffects.panRightGain = 1
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit report is missing combined Scratch pitch, pan, and volume playback evidence',
    )
  })

  it('requires the combined audio volume gain to match the Scratch input', () => {
    const evidence = reports()
    evidence.chromium.combinedAudioEffects.volumeGain = 1
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium report is missing combined Scratch pitch, pan, and volume playback evidence',
    )
  })

  it('requires the corrected SVG compile response to download and survive SB3 re-import', () => {
    const evidence = reports()
    evidence.webkit.compileRepairRecoveryEvidence.svgCorrectionLoop.reimportedSprites = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit SVG compile-repair recovery is missing its corrected download or re-import assertion',
    )
  })

  it.each([
    ['raster', 'rasterCorrectionLoop', 'reimportedSprites'],
    ['audio', 'audioCorrectionLoop', 'reimportedSounds'],
  ])('requires the corrected %s compile response to download and survive SB3 re-import', (label, key, collection) => {
    const evidence = reports()
    evidence.webkit.compileRepairRecoveryEvidence[key][collection] = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      `webkit ${label} compile-repair recovery is missing its corrected download or re-import assertion`,
    )
  })

  it.each([
    ['SVG', 'svgCorrectionLoop'],
    ['raster', 'rasterCorrectionLoop'],
    ['audio', 'audioCorrectionLoop'],
  ])('requires the %s asset bytes to be valid after re-import', (label, key) => {
    const evidence = reports()
    evidence.webkit.compileRepairRecoveryEvidence[key].reimportedAssetValid = false
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      `webkit ${label} compile-repair recovery is missing its corrected download or re-import assertion`,
    )
  })

  it('requires the repaired additional property to be removed after SB3 re-import', () => {
    const evidence = reports()
    evidence.webkit.aiRepairRecoveryEvidence.schemaAdditionalPropertyCorrectionLoop.reimportedPropertyPresent = true
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit additional-property repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the suggested schema enum value to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.firefox.aiRepairRecoveryEvidence.schemaEnumCorrectionLoop.reimportedValue = 'sideways'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox enum repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the schema const replacement to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.chromium.aiRepairRecoveryEvidence.schemaConstCorrectionLoop.reimportedValue = 'sprite'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium const repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the repaired required input value to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.firefox.aiRepairRecoveryEvidence.schemaRequiredCorrectionLoop.reimportedInput.value = 'lost'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox required-property repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the suggested min-length name to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.webkit.aiRepairRecoveryEvidence.schemaMinLengthCorrectionLoop.reimportedSprites = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit min-length repair evidence is missing its path or re-import assertion',
    )
  })

  it('rejects recovery evidence that records the wrong issue path', () => {
    const evidence = reports()
    evidence.chromium.aiRepairRecoveryEvidence.currentCostumeCorrectionLoop.issuePath = '/sprites/0/currentCostume'
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium costume repair evidence is missing its replacement or re-import assertion',
    )
  })

  it('requires the corrected collision sprite to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.webkit.aiRepairRecoveryEvidence.unknownSpriteCorrectionLoop.reimportedSprites = ['Player']
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit sprite repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the repaired broadcast declaration to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.chromium.aiRepairRecoveryEvidence.unknownBroadcastCorrectionLoop.reimportedBroadcastNames = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium broadcast repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the repaired list declaration to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.firefox.aiRepairRecoveryEvidence.unknownListCorrectionLoop.reimportedListNames = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'firefox list repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the repaired procedure definition to survive SB3 re-import', () => {
    const evidence = reports()
    evidence.webkit.aiRepairRecoveryEvidence.unknownProcedureCorrectionLoop.reimportedProcedureNames = []
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'webkit procedure repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires the invalid procedure argument to be removed after SB3 re-import', () => {
    const evidence = reports()
    evidence.chromium.aiRepairRecoveryEvidence.unknownProcedureArgumentCorrectionLoop.reimportedCallInputs = [
      'unexpected',
    ]
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium procedure argument repair evidence is missing its path or re-import assertion',
    )
  })

  it('requires duplicate procedure arguments to be renamed and survive SB3 re-import', () => {
    const evidence = reports()
    evidence.chromium.aiRepairRecoveryEvidence.duplicateProcedureArgumentCorrectionLoop.reimportedParameterNames = [
      'value',
      'value',
    ]
    expect(() => validateBrowserReleaseEvidence(evidence)).toThrow(
      'chromium duplicate procedure argument repair evidence is missing its path or re-import assertion',
    )
  })
})
