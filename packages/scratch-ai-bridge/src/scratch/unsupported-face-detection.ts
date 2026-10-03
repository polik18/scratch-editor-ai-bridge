export const SupportedModels = {
  MediaPipeFaceDetector: 'MediaPipeFaceDetector',
}

export const createDetector = (): Promise<never> =>
  Promise.reject(new Error('The face sensing extension is not supported by Scratch AI Bridge.'))
