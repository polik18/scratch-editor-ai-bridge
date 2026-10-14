declare module 'scratch-audio' {
  export default class ScratchAudio {
    readonly audioContext: AudioContext
    decodeSoundPlayer(sound: unknown): Promise<unknown>
  }
}
