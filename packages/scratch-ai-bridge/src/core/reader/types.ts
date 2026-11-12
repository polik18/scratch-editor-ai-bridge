export interface ReaderSection {
  readonly id: string
  readonly text: string
  readonly targetIndex?: number
  readonly blockIds?: readonly string[]
}

export interface ReaderLineLocation {
  readonly targetIndex: number
  readonly blockId: string
}

export interface ReaderCoverage {
  readonly blocks: number
  readonly readable: number
  readonly opaque: number
}

export interface ReaderAssets {
  readonly entries?: readonly { readonly name: string; readonly bytes?: Uint8Array }[]
}

export interface ReaderOptions {
  readonly title?: string
  readonly author?: string
  readonly sourceUrl?: string
  readonly license?: string
  readonly authorInstructions?: string
  readonly notesAndCredits?: string
  readonly maxChars?: number
  readonly hideTargetNames?: boolean
  readonly visualHints?: Readonly<Record<string, string>>
}

export interface ProjectReaderResult {
  readonly text: string
  readonly sections: readonly ReaderSection[]
  readonly lineMap: ReadonlyMap<string, ReaderLineLocation>
  readonly coverage: ReaderCoverage
}
