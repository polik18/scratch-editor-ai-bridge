import { loadSb3, saveSb3, type ScratchVMHandle } from '../../scratch'
import type { CanonicalProject } from '../ir/types'
import { validateCanonicalProject } from '../validator'
import { buildScratchProjectArchive } from './project-json'

export interface CompileResult {
  vm: ScratchVMHandle
  sb3: Blob
}

export const compileCanonicalProject = async (project: CanonicalProject): Promise<CompileResult> => {
  const validation = validateCanonicalProject(project)
  if (!validation.valid) {
    const detail = validation.errors.map((error) => `${error.instancePath || '/'}: ${error.message}`).join('\n')
    throw new Error(`Canonical IR validation failed:\n${detail}`)
  }

  const archive = await buildScratchProjectArchive(validation.data)
  const vm = await loadSb3(archive)

  try {
    const sb3 = await saveSb3(vm)
    return { vm, sb3 }
  } catch (error) {
    vm.quit()
    throw error
  }
}

export const compileCanonicalProjectToSb3 = async (project: CanonicalProject): Promise<Blob> => {
  const { vm, sb3 } = await compileCanonicalProject(project)
  vm.quit()
  return sb3
}
