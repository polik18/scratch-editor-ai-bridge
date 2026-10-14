import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const browsers = ['chromium', 'firefox', 'webkit']
const pssFields = ['processTreePssSumPeakBytes', 'processTreePssSampleCount']

const requirePositivePss = (evidence, label) => {
  for (const field of pssFields) {
    if (!Number.isSafeInteger(evidence?.[field]) || evidence[field] <= 0) {
      throw new Error(`${label} is missing a positive ${field} measurement`)
    }
  }
}

const requireAiRepairRecoveryEvidence = (report, browser) => {
  const recovery = report.aiRepairRecoveryEvidence
  const loops = [
    ['schemaFailureCorrectionLoop', 'schema-type'],
    ['schemaAdditionalPropertyCorrectionLoop', 'schema-additionalProperties'],
    ['schemaEnumCorrectionLoop', 'schema-enum'],
    ['schemaConstCorrectionLoop', 'schema-const'],
    ['schemaRequiredCorrectionLoop', 'schema-required'],
    ['schemaMinLengthCorrectionLoop', 'schema-minLength'],
    ['currentCostumeCorrectionLoop', 'current-costume-out-of-range'],
    ['unknownSpriteCorrectionLoop', 'unknown-sprite'],
    ['unknownVariableCorrectionLoop', 'unknown-variable'],
    ['unknownBroadcastCorrectionLoop', 'unknown-broadcast'],
    ['unknownListCorrectionLoop', 'unknown-list'],
    ['unknownProcedureCorrectionLoop', 'unknown-procedure'],
    ['unknownProcedureArgumentCorrectionLoop', 'unknown-procedure-argument'],
    ['duplicateProcedureArgumentCorrectionLoop', 'duplicate-procedure-argument'],
  ]
  for (const [name, issueCode] of loops) {
    const evidence = recovery?.[name]
    if (evidence?.issueCode !== issueCode || evidence.recoveredDownload !== true) {
      throw new Error(`${browser} report is missing a recovered ${issueCode} AI repair loop`)
    }
  }
  const schema = recovery.schemaFailureCorrectionLoop
  if (schema.issuePath !== '/name' || schema.reimportedSpriteName !== 'Player') {
    throw new Error(`${browser} schema repair evidence is missing its path or re-import assertion`)
  }
  const schemaAdditionalProperty = recovery.schemaAdditionalPropertyCorrectionLoop
  if (
    schemaAdditionalProperty.issuePath !== '/unexpectedField' ||
    schemaAdditionalProperty.reportedProperty !== 'unexpectedField' ||
    schemaAdditionalProperty.reimportedPropertyPresent !== false
  ) {
    throw new Error(`${browser} additional-property repair evidence is missing its path or re-import assertion`)
  }
  const schemaEnum = recovery.schemaEnumCorrectionLoop
  if (
    schemaEnum.issuePath !== '/sprites/0/rotationStyle' ||
    schemaEnum.reportedValue !== 'sideways' ||
    schemaEnum.replacementValue !== 'all around' ||
    schemaEnum.reimportedValue !== schemaEnum.replacementValue
  ) {
    throw new Error(`${browser} enum repair evidence is missing its path or re-import assertion`)
  }
  const schemaConst = recovery.schemaConstCorrectionLoop
  if (
    schemaConst.issuePath !== '/stage/kind' ||
    schemaConst.reportedValue !== 'sprite' ||
    schemaConst.replacementValue !== 'stage' ||
    schemaConst.reimportedValue !== schemaConst.replacementValue
  ) {
    throw new Error(`${browser} const repair evidence is missing its path or re-import assertion`)
  }
  const schemaRequired = recovery.schemaRequiredCorrectionLoop
  if (
    schemaRequired.issuePath !== '/sprites/0/scripts/0/blocks/2/inputs/VALUE/value' ||
    schemaRequired.expected !== 'required property value' ||
    schemaRequired.reimportedInput?.type !== 'literal' ||
    schemaRequired.reimportedInput?.value !== 0
  ) {
    throw new Error(`${browser} required-property repair evidence is missing its path or re-import assertion`)
  }
  const schemaMinLength = recovery.schemaMinLengthCorrectionLoop
  if (
    schemaMinLength.issuePath !== '/name' ||
    schemaMinLength.reportedValue !== '' ||
    typeof schemaMinLength.replacementValue !== 'string' ||
    schemaMinLength.replacementValue.length === 0 ||
    schemaMinLength.submittedProjectName !== schemaMinLength.replacementValue ||
    !Array.isArray(schemaMinLength.reimportedSprites) ||
    !schemaMinLength.reimportedSprites.includes('Player')
  ) {
    throw new Error(`${browser} min-length repair evidence is missing its path or re-import assertion`)
  }
  const compileRecoveryChecks = [
    {
      name: 'SVG',
      evidence: report.compileRepairRecoveryEvidence?.svgCorrectionLoop,
      issuePath: '/sprites/0/costumes/0',
      stage: 'svg-preflight',
      collection: 'reimportedSprites',
      expectedItem: 'Player',
    },
    {
      name: 'raster',
      evidence: report.compileRepairRecoveryEvidence?.rasterCorrectionLoop,
      issuePath: '/sprites/0/costumes/0',
      stage: 'raster-preflight',
      collection: 'reimportedSprites',
      expectedItem: 'Player',
    },
    {
      name: 'audio',
      evidence: report.compileRepairRecoveryEvidence?.audioCorrectionLoop,
      issuePath: '/stage/sounds/0',
      stage: 'audio-preflight',
      collection: 'reimportedSounds',
      expectedItem: 'Truncated wav',
    },
  ]
  for (const check of compileRecoveryChecks) {
    const evidence = check.evidence
    if (
      evidence?.issueCode !== 'compile-failed' ||
      evidence.issuePath !== check.issuePath ||
      evidence.compileStage !== check.stage ||
      evidence.promptContainsIssueAndPath !== true ||
      evidence.submittedCorrectedResponse !== true ||
      evidence.recoveredDownload !== true ||
      evidence.reimportedAssetValid !== true ||
      !Array.isArray(evidence[check.collection]) ||
      !evidence[check.collection].includes(check.expectedItem)
    ) {
      throw new Error(
        `${browser} ${check.name} compile-repair recovery is missing its corrected download or re-import assertion`,
      )
    }
  }
  const costume = recovery.currentCostumeCorrectionLoop
  if (
    costume.issuePath !== '/stage/currentCostume' ||
    costume.replacementIndex !== 0 ||
    costume.reimportedIndex !== costume.replacementIndex
  ) {
    throw new Error(`${browser} costume repair evidence is missing its replacement or re-import assertion`)
  }
  const sprite = recovery.unknownSpriteCorrectionLoop
  if (
    sprite.issuePath !==
      '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/2/inputs/CONDITION/block/inputs/TOUCHINGOBJECTMENU' ||
    sprite.reportedSprite !== 'Missing Sprite' ||
    sprite.correctedSprite !== 'Platform' ||
    !Array.isArray(sprite.reimportedSprites) ||
    !sprite.reimportedSprites.includes('Platform') ||
    !sprite.reimportedSprites.includes('Player')
  ) {
    throw new Error(`${browser} sprite repair evidence is missing its path or re-import assertion`)
  }
  const variable = recovery.unknownVariableCorrectionLoop
  if (
    variable.issuePath !== '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/0/inputs/DY' ||
    variable.reportedName?.name !== 'missing y velocity' ||
    variable.correctedName !== 'y velocity' ||
    variable.reimportedVariableName !== variable.correctedName
  ) {
    throw new Error(`${browser} variable repair evidence is missing its path or re-import assertion`)
  }
  const broadcast = recovery.unknownBroadcastCorrectionLoop
  if (
    broadcast.issuePath !== '/sprites/0/scripts/1/blocks/0/fields/BROADCAST_OPTION' ||
    broadcast.reportedName !== 'Missing broadcast' ||
    broadcast.correctedName !== 'Missing broadcast' ||
    !Array.isArray(broadcast.reimportedBroadcastNames) ||
    !broadcast.reimportedBroadcastNames.includes(broadcast.correctedName)
  ) {
    throw new Error(`${browser} broadcast repair evidence is missing its path or re-import assertion`)
  }
  const list = recovery.unknownListCorrectionLoop
  if (
    list.issuePath !== '/sprites/0/scripts/0/blocks/2/fields/LIST' ||
    list.reportedName !== 'Missing list' ||
    list.correctedName !== 'Missing list' ||
    !Array.isArray(list.reimportedListNames) ||
    !list.reimportedListNames.includes(list.correctedName)
  ) {
    throw new Error(`${browser} list repair evidence is missing its path or re-import assertion`)
  }
  const procedure = recovery.unknownProcedureCorrectionLoop
  if (
    procedure.issuePath !== '/sprites/0/scripts/0/blocks/2' ||
    procedure.reportedName !== 'Missing procedure' ||
    procedure.correctedName !== 'Missing procedure' ||
    !Array.isArray(procedure.reimportedProcedureNames) ||
    !procedure.reimportedProcedureNames.includes(procedure.correctedName)
  ) {
    throw new Error(`${browser} procedure repair evidence is missing its path or re-import assertion`)
  }
  const procedureArgument = recovery.unknownProcedureArgumentCorrectionLoop
  if (
    procedureArgument.issuePath !== '/sprites/0/scripts/0/blocks/2/inputs/unexpected' ||
    procedureArgument.reportedName !== 'unexpected' ||
    procedureArgument.correctedName !== 'Known procedure' ||
    !Array.isArray(procedureArgument.reimportedProcedureNames) ||
    !procedureArgument.reimportedProcedureNames.includes(procedureArgument.correctedName) ||
    !Array.isArray(procedureArgument.reimportedCallInputs) ||
    procedureArgument.reimportedCallInputs.includes(procedureArgument.reportedName)
  ) {
    throw new Error(`${browser} procedure argument repair evidence is missing its path or re-import assertion`)
  }
  const duplicateProcedureArgument = recovery.duplicateProcedureArgumentCorrectionLoop
  if (
    duplicateProcedureArgument.issuePath !== '/sprites/0/procedures/0/parameters/1/name' ||
    duplicateProcedureArgument.reportedName !== 'value' ||
    duplicateProcedureArgument.correctedName !== 'amount' ||
    !Array.isArray(duplicateProcedureArgument.reimportedParameterNames) ||
    duplicateProcedureArgument.reimportedParameterNames.length !== 2 ||
    new Set(duplicateProcedureArgument.reimportedParameterNames).size !== 2 ||
    duplicateProcedureArgument.reimportedParameterNames[0] !== 'value' ||
    duplicateProcedureArgument.reimportedParameterNames[1] !== duplicateProcedureArgument.correctedName
  ) {
    throw new Error(
      `${browser} duplicate procedure argument repair evidence is missing its path or re-import assertion`,
    )
  }
}

export const validateBrowserReleaseEvidence = (
  reports,
  { expectedPlatform = 'linux', exactCapBytes = 256 * 1024 * 1024 } = {},
) => {
  const summary = []
  for (const browser of browsers) {
    const report = reports[browser]
    if (!report || report.browser !== browser) throw new Error(`Missing or mismatched ${browser} browser report`)
    if (report.runtime?.platform !== expectedPlatform) {
      throw new Error(`${browser} report platform must be ${expectedPlatform}`)
    }
    if (typeof report.runtime?.browserVersion !== 'string' || report.runtime.browserVersion.length === 0) {
      throw new Error(`${browser} report is missing its browser version`)
    }
    requirePositivePss(report, `${browser} process-tree`)
    requireAiRepairRecoveryEvidence(report, browser)

    const nearLimit = report.nearLimitArchive
    if (nearLimit?.aggregateUncompressedBytes !== exactCapBytes) {
      throw new Error(`${browser} did not import exactly ${exactCapBytes} uncompressed bytes`)
    }
    requirePositivePss(nearLimit, `${browser} exact-cap import process-tree`)
    const offlineReload = report.offlineReload
    const offlineNetworkBlocked =
      (offlineReload?.networkMode === 'browser-offline' && offlineReload.browserNetworkDisabled === true) ||
      (offlineReload?.networkMode === 'origin-unavailable' && offlineReload.originUnavailable === true)
    if (
      offlineReload?.scope !== '/scratch-editor-ai-bridge/' ||
      offlineReload.serviceWorkerInstalled !== true ||
      offlineReload.serviceWorkerControlledPage !== true ||
      !offlineNetworkBlocked ||
      offlineReload.reloadSucceeded !== true ||
      offlineReload.appInputVisible !== true
    ) {
      throw new Error(`${browser} report is missing the nested-path offline reload assertion`)
    }
    const draggable = report.officialDraggablePreview
    if (
      draggable?.fixture !== 'draggable.sb3' ||
      draggable.targetName !== 'Sprite1' ||
      draggable.importedDraggable !== true ||
      draggable.dragDeltaStageUnits?.x !== 50 ||
      draggable.dragDeltaStageUnits?.y !== 40 ||
      draggable.visibleCanvasChangedAfterDrag !== true
    ) {
      throw new Error(`${browser} report is missing the official draggable fixture preview assertion`)
    }
    const eventHat = report.officialEventHatPreview
    if (
      eventHat?.fixture !== 'edge-triggered-hat.sb3' ||
      eventHat.targetName !== 'Sprite1' ||
      eventHat.timerHatOpcode !== 'event_whengreaterthan' ||
      eventHat.timerThreshold !== -1 ||
      eventHat.movementOpcode !== 'motion_movesteps' ||
      eventHat.movementSteps !== 10 ||
      !Number.isInteger(eventHat.canvasDimensions?.before?.width) ||
      !Number.isInteger(eventHat.canvasDimensions?.before?.height) ||
      eventHat.canvasDimensions.before.width <= 0 ||
      eventHat.canvasDimensions.before.height <= 0 ||
      eventHat.canvasDimensions.before.width !== eventHat.canvasDimensions.after?.width ||
      eventHat.canvasDimensions.before.height !== eventHat.canvasDimensions.after?.height ||
      eventHat.visibleCanvasChangedAfterRuntime !== true
    ) {
      throw new Error(`${browser} report is missing the official edge-triggered preview execution assertion`)
    }
    const combinedAudio = report.combinedAudioEffects
    if (
      combinedAudio?.fixture !== 'default.sb3-derived-combined-effects' ||
      combinedAudio.pitchOpcode !== 'sound_seteffectto' ||
      combinedAudio.pitchValue !== 120 ||
      combinedAudio.panOpcode !== 'sound_seteffectto' ||
      combinedAudio.panValue !== -100 ||
      combinedAudio.volumeOpcode !== 'sound_setvolumeto' ||
      combinedAudio.volumeValue !== 40 ||
      !Number.isFinite(combinedAudio.playbackRate) ||
      Math.abs(combinedAudio.playbackRate - 2) >= 0.05 ||
      !Number.isFinite(combinedAudio.panLeftGain) ||
      Math.abs(combinedAudio.panLeftGain - 1) >= 0.01 ||
      !Number.isFinite(combinedAudio.panRightGain) ||
      Math.abs(combinedAudio.panRightGain) >= 0.01 ||
      !Number.isFinite(combinedAudio.volumeGain) ||
      Math.abs(combinedAudio.volumeGain - 0.4) >= 0.01
    ) {
      throw new Error(`${browser} report is missing combined Scratch pitch, pan, and volume playback evidence`)
    }
    summary.push({
      browser,
      browserVersion: report.runtime.browserVersion,
      processTreePssSumPeakBytes: report.processTreePssSumPeakBytes,
      processTreePssSampleCount: report.processTreePssSampleCount,
      exactCapPssSumPeakBytes: nearLimit.processTreePssSumPeakBytes,
      exactCapPssSampleCount: nearLimit.processTreePssSampleCount,
      aiRepairRecoveryLoops: 14,
      officialDraggablePreview: true,
      officialEventHatPreview: true,
      combinedAudioEffects: true,
      offlineReload: true,
    })
  }
  return summary
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const paths = process.argv.slice(2)
  if (paths.length !== browsers.length) {
    throw new Error(
      `Usage: node scripts/check-browser-release-evidence.mjs ${browsers.map((name) => `${name}.json`).join(' ')}`,
    )
  }
  const reports = Object.fromEntries(
    await Promise.all(
      browsers.map(async (browser, index) => [browser, JSON.parse(await readFile(paths[index], 'utf8'))]),
    ),
  )
  const summary = validateBrowserReleaseEvidence(reports)
  process.stdout.write(`${JSON.stringify({ platform: process.platform, browsers: summary }, null, 2)}\n`)
}
