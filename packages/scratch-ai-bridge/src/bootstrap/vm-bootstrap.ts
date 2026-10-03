import { createVM, type ScratchVMHandle } from '../scratch/vm'

export const initializeScratchVM = (): ScratchVMHandle => createVM()
