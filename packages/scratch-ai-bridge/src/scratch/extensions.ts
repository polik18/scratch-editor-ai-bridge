/** Extension modules bundled in this Scratch VM build. */
export const LOCAL_SCRATCH_EXTENSION_IDS = new Set([
  'pen',
  'wedo2',
  'music',
  'microbit',
  'text2speech',
  'translate',
  'videoSensing',
  'ev3',
  'makeymakey',
  'boost',
  'gdxfor',
  'faceSensing',
])

/** Runtime behavior currently covered by focused Bridge tests. */
export const VERIFIED_SCRATCH_EXTENSION_IDS = new Set(['pen', 'music'])

/** Hardware extensions whose pairing controls are absent from the isolated stage preview. */
export const SCRATCH_LINK_HARDWARE_EXTENSION_IDS = new Set(['wedo2', 'microbit', 'ev3', 'boost', 'gdxfor'])

/** Bundled extensions disabled because merely loading a project accesses camera/model resources. */
export const DISABLED_SCRATCH_EXTENSION_REASONS = {
  faceSensing: '初始化會啟用攝影機並載入 MediaPipe 模型（失敗時回退至 jsDelivr）',
  videoSensing: '首次載入會自動啟用攝影機',
} as const

export const DISABLED_SCRATCH_EXTENSION_IDS = new Set(Object.keys(DISABLED_SCRATCH_EXTENSION_REASONS))

/** Opcode prefixes Scratch VM treats as core blocks rather than extensions. */
export const SCRATCH_CORE_OPCODE_PREFIXES = new Set([
  'argument',
  'colour',
  'control',
  'data',
  'event',
  'looks',
  'math',
  'motion',
  'operator',
  'procedures',
  'sensing',
  'sound',
])
