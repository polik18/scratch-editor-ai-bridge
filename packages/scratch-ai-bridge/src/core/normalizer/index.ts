export {
  addExtractionRepair,
  normalizeAiDraft,
  normalizeAiResponse,
  parseAiResponse,
  type AiDraftNormalizationResult,
  type AiDraftRepair,
  type AiDraftWarning,
  type AiResponseParseResult,
} from './ai-draft'
export { parseAiProjectResponse } from './response-envelope'
export {
  PROJECT_FRAGMENT_FORMAT,
  PROJECT_FRAGMENT_VERSION,
  createEmptyProjectFragmentSession,
  mergeProjectFragment,
  parseProjectFragment,
  type ProjectFragment,
  type ProjectFragmentSession,
} from './project-fragment'
export {
  LIVE_PATCH_FORMAT,
  LIVE_PATCH_MAX_BYTES,
  LIVE_PATCH_MAX_OPERATIONS,
  LIVE_PATCH_VERSION,
  applyLiveVariablePatchToProject,
  createLiveVariablePatchInstruction,
  getLivePatchScriptSelector,
  listLivePatchScripts,
  parseLiveVariablePatch,
  type LiveScriptPatchOperation,
  type LiveVariablePatchOperation,
  type LivePatchOperation,
  type LiveTargetPropertyPatchOperation,
  type LiveStagePropertyPatchOperation,
  type LiveTargetProperty,
  type LiveStageProperty,
  type ParsedLiveVariablePatch,
} from './live-patch'
export type {
  AiProjectResponse,
  ParsedAiProjectResponse,
  RequirementCoverageEntry,
  RequirementCoverageStatus,
} from './response-envelope'
