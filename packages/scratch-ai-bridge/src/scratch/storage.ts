/**
 * Create storage for local SB3 assets without starting Scratch Storage's fetch worker.
 *
 * The bridge does not register remote asset stores: every generated or imported asset
 * comes from the SB3 archive. Disabling the worker during synchronous construction also
 * avoids the upstream Webpack bundle requesting an absolute `/chunks/...` URL, which is
 * incompatible with GitHub Pages project subpaths.
 * @returns Scratch storage configured for archive-local assets.
 */
export const createOfflineScratchStorage = async (): Promise<any> => {
  const hadOwnWorker = Object.prototype.hasOwnProperty.call(globalThis, 'Worker')
  const originalWorker = globalThis.Worker
  Reflect.set(globalThis, 'Worker', undefined)

  try {
    // 使用動態 import 以支援 webpack 打包的 CommonJS
    const scratchStorageModule = await import('@scratch/scratch-storage')
    return new scratchStorageModule.ScratchStorage()
  } finally {
    if (hadOwnWorker) Reflect.set(globalThis, 'Worker', originalWorker)
    else Reflect.deleteProperty(globalThis, 'Worker')
  }
}
