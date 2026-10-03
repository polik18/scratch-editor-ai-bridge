declare module '@scratch/scratch-vm' {
  export default class VirtualMachine {
    runtime: object
    loadProject(input: string | object | ArrayBuffer | ArrayBufferView): Promise<void>
    saveProjectSb3(): Promise<Blob>
    toJSON(): string
    quit(): void
  }
}
