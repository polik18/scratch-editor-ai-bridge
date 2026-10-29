import { createVM, type ScratchVMHandle } from '../scratch/vm'

export const initializeScratchVM = async (): Promise<ScratchVMHandle> => createVM()
