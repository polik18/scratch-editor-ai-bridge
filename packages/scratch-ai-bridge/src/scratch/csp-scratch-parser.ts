import JSZip from 'jszip'
import { validateSb3Project, validateSb3Sprite } from '../core/validator/generated/scratch-parser.mjs'

type ScratchProject = Record<string, unknown> & { projectVersion?: number }
type ScratchParserResult = [ScratchProject, JSZip | null]
type ScratchParserCallback = (error: unknown, result?: ScratchParserResult) => void

class ScratchValidationError extends Error {
  readonly validationError = 'Could not parse as a valid SB3 project.'
  readonly sb2Errors = null
  readonly sb3Errors: unknown

  constructor(sb3Errors: unknown) {
    super('Could not parse as a valid SB3 project.')
    this.name = 'ScratchValidationError'
    this.sb3Errors = sb3Errors
  }
}

const stripBackspaces = (input: string): string =>
  input.replace(/(\\+)(b|u0008)/g, (match, backslash: string, code: string) =>
    backslash.length % 2 ? match.replace(`\\${code}`, '') : match,
  )

const unpack = async (
  input: string | ArrayBuffer | ArrayBufferView,
  isSprite: boolean,
): Promise<ScratchParserResult> => {
  let projectSource: string
  let zip: JSZip | null = null

  if (typeof input === 'string') {
    projectSource = input
  } else {
    const bytes =
      input instanceof ArrayBuffer ? input : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    zip = await JSZip.loadAsync(bytes)
    const filename = isSprite ? /^(?:[^/]+\/)?sprite\.json$/ : /^(?:[^/]+\/)?project\.json$/
    const projectFile = Object.values(zip.files).find((file) => !file.dir && filename.test(file.name))
    if (!projectFile) throw new Error(`SB3 archive is missing ${isSprite ? 'sprite.json' : 'project.json'}`)
    projectSource = await projectFile.async('string')
  }

  const project = JSON.parse(stripBackspaces(projectSource)) as ScratchProject
  const validate = isSprite ? validateSb3Sprite : validateSb3Project

  if (!validate(project)) {
    throw new ScratchValidationError(validate.errors)
  }

  project.projectVersion = 3
  return [project, zip]
}

const parseScratchProject = (
  input: string | ArrayBuffer | ArrayBufferView,
  isSprite: boolean,
  callback: ScratchParserCallback,
): void => {
  void unpack(input, isSprite).then((result) => callback(null, result), callback)
}

export default parseScratchProject
