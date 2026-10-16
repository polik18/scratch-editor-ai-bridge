/**
 * Static analysis labels copied from the pinned Scratch VM extension metadata.
 * These describe the block's requested action; they do not claim that its
 * runtime, device, camera, audio, or external service was available.
 */
export const SCRATCH_EXTENSION_CATALOG_VM_VERSION = '15.2.0'

export interface ScratchExtensionBlockDescription {
  readonly extensionId: string
  readonly extensionName: string
  readonly opcode: string
  readonly blockText: string
  readonly studentLabel: string
  readonly blockType: 'command' | 'reporter'
  readonly arguments: readonly ScratchExtensionArgumentDescription[]
  readonly analysis: 'intent-known'
}

export interface ScratchExtensionArgumentDescription {
  readonly name: string
  readonly type: 'string' | 'number' | 'note'
  readonly menu?: string
  readonly defaultValue?: string | number
  /** Defaults supplied dynamically by Scratch VM are intentionally not guessed. */
  readonly dynamicDefault?: boolean
}

const extensionBlocks: readonly ScratchExtensionBlockDescription[] = [
  {
    extensionId: 'faceSensing',
    extensionName: '臉部感測',
    opcode: 'faceSensing_goToPart',
    blockText: 'go to [PART]',
    studentLabel: '移動到臉部指定部位',
    blockType: 'command',
    arguments: [{ name: 'PART', type: 'string', menu: 'PART', defaultValue: '2' }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'music',
    extensionName: '音樂',
    opcode: 'music_playDrumForBeats',
    blockText: 'play drum [DRUM] for [BEATS] beats',
    studentLabel: '播放指定鼓聲一段拍數',
    blockType: 'command',
    arguments: [
      { name: 'DRUM', type: 'number', menu: 'DRUM', defaultValue: 1 },
      { name: 'BEATS', type: 'number', defaultValue: 0.25 },
    ],
    analysis: 'intent-known',
  },
  {
    extensionId: 'music',
    extensionName: '音樂',
    opcode: 'music_playNoteForBeats',
    blockText: 'play note [NOTE] for [BEATS] beats',
    studentLabel: '播放指定音符一段拍數',
    blockType: 'command',
    arguments: [
      { name: 'NOTE', type: 'note', menu: 'NOTE', defaultValue: 60 },
      { name: 'BEATS', type: 'number', defaultValue: 0.25 },
    ],
    analysis: 'intent-known',
  },
  {
    extensionId: 'music',
    extensionName: '音樂',
    opcode: 'music_setInstrument',
    blockText: 'set instrument to [INSTRUMENT]',
    studentLabel: '設定後續音符使用的樂器',
    blockType: 'command',
    arguments: [{ name: 'INSTRUMENT', type: 'number', menu: 'INSTRUMENT', defaultValue: 1 }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'text2speech',
    extensionName: '文字轉語音',
    opcode: 'text2speech_speakAndWait',
    blockText: 'speak [WORDS]',
    studentLabel: '朗讀輸入的文字',
    blockType: 'command',
    arguments: [{ name: 'WORDS', type: 'string', defaultValue: 'hello' }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'text2speech',
    extensionName: '文字轉語音',
    opcode: 'text2speech_setVoice',
    blockText: 'set voice to [VOICE]',
    studentLabel: '選擇朗讀聲音',
    blockType: 'command',
    arguments: [{ name: 'VOICE', type: 'string', menu: 'voices', defaultValue: 'ALTO' }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'text2speech',
    extensionName: '文字轉語音',
    opcode: 'text2speech_setLanguage',
    blockText: 'set language to [LANGUAGE]',
    studentLabel: '選擇朗讀語言',
    blockType: 'command',
    arguments: [{ name: 'LANGUAGE', type: 'string', menu: 'languages', dynamicDefault: true }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'videoSensing',
    extensionName: '視訊感測',
    opcode: 'videoSensing_videoOn',
    blockText: 'video [ATTRIBUTE] on [SUBJECT]',
    studentLabel: '讀取攝影機畫面的動作或方向數值',
    blockType: 'reporter',
    arguments: [
      { name: 'ATTRIBUTE', type: 'number', menu: 'ATTRIBUTE', defaultValue: 'motion' },
      { name: 'SUBJECT', type: 'number', menu: 'SUBJECT', defaultValue: 'this sprite' },
    ],
    analysis: 'intent-known',
  },
  {
    extensionId: 'videoSensing',
    extensionName: '視訊感測',
    opcode: 'videoSensing_videoToggle',
    blockText: 'turn video [VIDEO_STATE]',
    studentLabel: '控制攝影機畫面開關',
    blockType: 'command',
    arguments: [{ name: 'VIDEO_STATE', type: 'number', menu: 'VIDEO_STATE', defaultValue: 'on' }],
    analysis: 'intent-known',
  },
  {
    extensionId: 'videoSensing',
    extensionName: '視訊感測',
    opcode: 'videoSensing_setVideoTransparency',
    blockText: 'set video transparency to [TRANSPARENCY]',
    studentLabel: '設定攝影機畫面的透明度',
    blockType: 'command',
    arguments: [{ name: 'TRANSPARENCY', type: 'number', defaultValue: 50 }],
    analysis: 'intent-known',
  },
]

const catalogByOpcode = new Map(extensionBlocks.map((block) => [block.opcode, block]))

export const getScratchExtensionBlockDescription = (opcode: string): ScratchExtensionBlockDescription | undefined =>
  catalogByOpcode.get(opcode)

export const SCRATCH_EXTENSION_CATALOG: readonly ScratchExtensionBlockDescription[] = extensionBlocks

export const SCRATCH_EXTENSION_CATALOG_SOURCES = {
  faceSensing: 'packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js',
  music: 'packages/scratch-vm/src/extensions/scratch3_music/index.js',
  text2speech: 'packages/scratch-vm/src/extensions/scratch3_text2speech/index.js',
  videoSensing: 'packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js',
} as const
