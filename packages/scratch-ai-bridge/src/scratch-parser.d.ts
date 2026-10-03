declare module 'scratch-parser' {
  type ParseCallback = (error: unknown, project?: unknown) => void

  const parseScratchProject: (input: Buffer | string, isSprite: boolean, callback: ParseCallback) => void

  export default parseScratchProject
}
