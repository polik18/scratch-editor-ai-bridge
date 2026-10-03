import { getProjectJson, loadSb3, type Sb3Input } from '../../scratch'
import type { CanonicalProject } from '../ir/types'
import { projectJsonToCanonical } from './project-json'

export const decompileSb3 = async (
  input: Sb3Input,
  projectName = 'Imported Scratch Project',
): Promise<CanonicalProject> => {
  const vm = await loadSb3(input)
  try {
    return projectJsonToCanonical(getProjectJson(vm), projectName)
  } finally {
    vm.quit()
  }
}
