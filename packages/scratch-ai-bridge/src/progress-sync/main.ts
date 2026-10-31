import { readPrivateToken } from '../local/private-token.js'
import { ProgressSyncServer } from './server.js'
import { EncryptedSaveStore } from './store.js'

const options = (): { root: string; tokenFile: string; port: number; origins: string[] } => {
  let root = ''
  let tokenFile = ''
  let port = 43131
  const origins = ['https://polik18.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!value)
      throw new Error(
        'Usage: scratch-ai-bridge-sync --root <directory> --token-file <path> [--port <port>] [--origin <origin>]',
      )
    if (key === '--root') root = value
    else if (key === '--token-file') tokenFile = value
    else if (key === '--port') {
      port = Number(value)
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
        throw new Error('Port must be between 1024 and 65535.')
    } else if (key === '--origin') {
      const url = new URL(value)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.origin !== value.replace(/\/$/, '')
      )
        throw new Error('Origin must be an exact HTTP(S) origin.')
      origins.push(url.origin)
    } else throw new Error(`Unknown option: ${key}`)
  }
  if (!root || !tokenFile) throw new Error('Storage root and token file are required.')
  return { root, tokenFile, port, origins: [...new Set(origins)] }
}

const config = options()
const token = await readPrivateToken(config.tokenFile)
const store = new EncryptedSaveStore(config.root)
await store.start()
const server = new ProgressSyncServer(store, token, config.origins)
try {
  await server.listen(config.port)
} catch (error) {
  await store.close()
  throw error
}
console.error(
  `Encrypted save sync server is restricted to 127.0.0.1:${config.port}. Use an SSH tunnel for another device.`,
)
const close = (): void => {
  void server.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
