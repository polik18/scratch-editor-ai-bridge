import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeNonstandardMetadata = async (project: ScratchProject, zip: JSZip | null): Promise<void> => {
  if (
    isRecord(project.meta) &&
    'vm' in project.meta &&
    (typeof project.meta.vm !== 'string' || !/^\d+\.\d+\.\d+(?:$|-)/u.test(project.meta.vm))
  ) {
    // `meta.vm` is optional in SB3. Some generators put a product name here;
    // discard that nonstandard value so the official schema can validate it.
    delete project.meta.vm
  }

  if (!zip || !Array.isArray(project.targets)) return
  const validAssetId = /^[a-f\d]{32}$/iu
  const validAssetPath = /^[a-f\d]{32}\.[a-z]+$/iu
  for (const target of project.targets) {
    if (!isRecord(target)) continue
    for (const property of ['costumes', 'sounds']) {
      const assets = target[property]
      if (!Array.isArray(assets)) continue
      for (const asset of assets) {
        if (!isRecord(asset)) continue
        const assetId = asset.assetId
        const dataFormat = asset.dataFormat
        const md5ext = asset.md5ext
        if (
          typeof dataFormat !== 'string' ||
          (typeof assetId === 'string' &&
            validAssetId.test(assetId) &&
            typeof md5ext === 'string' &&
            validAssetPath.test(md5ext))
        )
          continue

        const candidates = [md5ext, typeof assetId === 'string' ? `${assetId}.${dataFormat}` : undefined]
        const source = candidates.find(
          (candidate): candidate is string => typeof candidate === 'string' && zip.file(candidate) !== null,
        )
        if (!source) continue
        const sourceFile = zip.file(source)
        if (!sourceFile) continue
        const bytes = await sourceFile.async('uint8array')
        const normalizedId = bytesToHex(md5(bytes))
        const normalizedPath = `${normalizedId}.${dataFormat}`
        zip.file(normalizedPath, bytes)
        asset.assetId = normalizedId
        asset.md5ext = normalizedPath
      }
    }
  }
}

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
    projectSource = new TextDecoder('utf-8', { fatal: true }).decode(await projectFile.async('uint8array'))
  }

  const project = JSON.parse(stripBackspaces(projectSource)) as ScratchProject
  await normalizeNonstandardMetadata(project, zip)
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
