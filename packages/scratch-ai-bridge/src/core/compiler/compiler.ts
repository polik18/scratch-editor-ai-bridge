import { loadSb3, saveSb3, type ScratchVMHandle } from '../../scratch'
import type { CanonicalProject } from '../ir/types'
import { validateCanonicalProject, validateCanonicalSemantics } from '../validator'
import { buildScratchProjectArchive } from './project-json'

export interface CompileResult {
  vm: ScratchVMHandle
  sb3: Blob
}

export type ProjectCompileFailureStage =
  | 'svg-preflight'
  | 'raster-preflight'
  | 'audio-preflight'
  | 'archive-generation'
  | 'scratch-vm-load'
  | 'scratch-vm-save'
  | 'unknown'

export class ProjectCompileError extends Error {
  readonly stage: ProjectCompileFailureStage

  constructor(stage: ProjectCompileFailureStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'ProjectCompileError'
    this.stage = stage
  }
}

const MEDIA_DECODE_PER_ASSET_TIMEOUT_MS = 10_000
const MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS = 30_000

const svgText = (data: string): string => {
  const dataUrl = /^data:[^,]*?(;base64)?,(.*)$/s.exec(data)
  if (dataUrl) {
    return dataUrl[1]
      ? new TextDecoder().decode(Uint8Array.from(atob(dataUrl[2].replace(/\s/g, '')), (char) => char.charCodeAt(0)))
      : decodeURIComponent(dataUrl[2])
  }
  if (data.trimStart().startsWith('<')) return data
  return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/\s/g, '')), (char) => char.charCodeAt(0)))
}

const validateSvgAssetXml = (project: CanonicalProject): void => {
  if (typeof DOMParser === 'undefined') return
  const targets = [project.stage, ...project.sprites]
  for (const target of targets) {
    for (const [index, costume] of target.costumes.entries()) {
      if (costume.dataFormat !== 'svg' || typeof costume.data !== 'string' || costume.data.length === 0) continue
      try {
        const document = new DOMParser().parseFromString(svgText(costume.data), 'text/xml')
        if (document.documentElement.localName !== 'svg' || document.getElementsByTagName('parsererror').length > 0) {
          throw new Error('Costume data is not well-formed SVG')
        }
      } catch (error) {
        throw new Error(
          `Cannot compile SVG costume "${costume.name}" at ${target.kind === 'stage' ? '/stage' : `/sprites/${project.sprites.indexOf(target)}`}/costumes/${index}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}

const validateRasterCostumeData = async (project: CanonicalProject, deadline: number): Promise<void> => {
  if (typeof Image === 'undefined') return
  const mimeTypes: Readonly<Record<string, string>> = {
    bmp: 'image/bmp',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
  }
  const targets = [project.stage, ...project.sprites]
  for (const [targetIndex, target] of targets.entries()) {
    for (const [costumeIndex, costume] of target.costumes.entries()) {
      if (!costume.data || costume.dataFormat === 'svg') continue
      const mimeType = mimeTypes[costume.dataFormat]
      if (!mimeType) continue
      const comma = costume.data.startsWith('data:') ? costume.data.indexOf(',') : -1
      const payload = comma < 0 ? costume.data : costume.data.slice(comma + 1)
      const source = `data:${mimeType};base64,${payload.replace(/\s/g, '')}`
      const targetPath = target.kind === 'stage' ? '/stage' : `/sprites/${targetIndex - 1}`
      const remainingTimeMs = deadline - Date.now()
      if (remainingTimeMs <= 0) {
        throw new Error(
          `Cannot compile raster costume "${costume.name}" at ${targetPath}/costumes/${costumeIndex}: Browser media preflight exceeded its ${MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS}ms total time budget`,
        )
      }
      const timeoutMs = Math.min(MEDIA_DECODE_PER_ASSET_TIMEOUT_MS, remainingTimeMs)
      const timeoutMessage =
        remainingTimeMs <= MEDIA_DECODE_PER_ASSET_TIMEOUT_MS
          ? `Browser media preflight exceeded its ${MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS}ms total time budget`
          : 'Browser image decoding timed out'
      let image: HTMLImageElement | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const decodedImage = new Image()
        image = decodedImage
        await Promise.race([
          (async () => {
            if (typeof decodedImage.decode === 'function') {
              decodedImage.src = source
              await decodedImage.decode()
            } else {
              await new Promise<void>((resolve, reject) => {
                decodedImage.onload = () => resolve()
                decodedImage.onerror = () => reject(new Error('Browser could not decode the image'))
                decodedImage.src = source
              })
            }
          })(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
          }),
        ])
        if (decodedImage.naturalWidth === 0 || decodedImage.naturalHeight === 0) {
          throw new Error('Browser decoded the image without dimensions')
        }
      } catch (error) {
        throw new Error(
          `Cannot compile raster costume "${costume.name}" at ${targetPath}/costumes/${costumeIndex}: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
        if (image) {
          image.onload = null
          image.onerror = null
          image.removeAttribute('src')
        }
      }
    }
  }
}

const validateSoundData = async (project: CanonicalProject, deadline: number): Promise<void> => {
  if (typeof Audio === 'undefined') return
  const mimeTypes: Readonly<Record<string, string>> = { mp3: 'audio/mpeg', wav: 'audio/wav' }
  const targets = [project.stage, ...project.sprites]
  for (const [targetIndex, target] of targets.entries()) {
    for (const [soundIndex, sound] of target.sounds.entries()) {
      if (!sound.data) continue
      const mimeType = mimeTypes[sound.dataFormat]
      if (!mimeType) continue
      const targetPath = target.kind === 'stage' ? '/stage' : `/sprites/${targetIndex - 1}`
      const comma = sound.data.startsWith('data:') ? sound.data.indexOf(',') : -1
      const payload = comma < 0 ? sound.data : sound.data.slice(comma + 1)
      const source = `data:${mimeType};base64,${payload.replace(/\s/g, '')}`
      const audio = new Audio()
      audio.preload = 'metadata'
      try {
        const remainingTimeMs = deadline - Date.now()
        if (remainingTimeMs <= 0) {
          throw new Error(
            `Browser media preflight exceeded its ${MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS}ms total time budget`,
          )
        }
        const timeoutMs = Math.min(MEDIA_DECODE_PER_ASSET_TIMEOUT_MS, remainingTimeMs)
        const timeoutMessage =
          remainingTimeMs <= MEDIA_DECODE_PER_ASSET_TIMEOUT_MS
            ? `Browser media preflight exceeded its ${MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS}ms total time budget`
            : 'Browser audio decoding timed out'
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = (error?: Error): void => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            audio.oncanplay = null
            audio.onerror = null
            if (error) reject(error)
            else resolve()
          }
          const timeout = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs)
          audio.oncanplay = () => finish()
          audio.onerror = () => finish(new Error('Browser could not decode the audio'))
          audio.src = source
          audio.load()
        })
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
          throw new Error('Browser decoded the audio without a positive duration')
        }
      } catch (error) {
        throw new Error(
          `Cannot compile sound "${sound.name}" at ${targetPath}/sounds/${soundIndex}: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
    }
  }
}

export const compileCanonicalProject = async (project: CanonicalProject): Promise<CompileResult> => {
  const validation = validateCanonicalProject(project)
  if (!validation.valid) {
    const detail = validation.errors.map((error) => `${error.instancePath || '/'}: ${error.message}`).join('\n')
    throw new Error(`Canonical IR validation failed:\n${detail}`)
  }

  const semanticErrors = validateCanonicalSemantics(validation.data).filter((issue) => issue.severity === 'error')
  if (semanticErrors.length > 0) {
    const detail = semanticErrors.map((issue) => `${issue.path} [${issue.code}]: ${issue.message}`).join('\n')
    throw new Error(`Canonical IR semantic validation failed:\n${detail}`)
  }

  try {
    validateSvgAssetXml(validation.data)
  } catch (error) {
    throw new ProjectCompileError('svg-preflight', error)
  }

  const mediaPreflightDeadline = Date.now() + MEDIA_PREFLIGHT_TOTAL_TIMEOUT_MS

  try {
    await validateRasterCostumeData(validation.data, mediaPreflightDeadline)
  } catch (error) {
    throw new ProjectCompileError('raster-preflight', error)
  }

  try {
    await validateSoundData(validation.data, mediaPreflightDeadline)
  } catch (error) {
    throw new ProjectCompileError('audio-preflight', error)
  }

  let archive: Awaited<ReturnType<typeof buildScratchProjectArchive>>
  try {
    archive = await buildScratchProjectArchive(validation.data)
  } catch (error) {
    throw new ProjectCompileError('archive-generation', error)
  }

  let vm: ScratchVMHandle
  try {
    vm = await loadSb3(archive)
  } catch (error) {
    throw new ProjectCompileError('scratch-vm-load', error)
  }

  try {
    const sb3 = await saveSb3(vm)
    return { vm, sb3 }
  } catch (error) {
    vm.quit()
    throw new ProjectCompileError('scratch-vm-save', error)
  }
}

export const compileCanonicalProjectToSb3 = async (project: CanonicalProject): Promise<Blob> => {
  const { vm, sb3 } = await compileCanonicalProject(project)
  vm.quit()
  return sb3
}
