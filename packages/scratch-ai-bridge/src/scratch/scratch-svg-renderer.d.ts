declare module '@scratch/scratch-svg-renderer' {
  export class BitmapAdapter {
    resize(image: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement
    convertDataURIToBinary(dataURI: string): Uint8Array
  }
}
