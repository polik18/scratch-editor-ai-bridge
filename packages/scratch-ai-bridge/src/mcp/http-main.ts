import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { BrowserBridgeRelay } from './companion.js'
import { TunnelMcpHttp } from './http.js'

const parseOptions = (): { tokenFile: string; relayPort: number; httpPort: number; origins: string[] } => {
  let tokenFile = ''
  let relayPort = 43128
  let httpPort = 43130
  const origins = ['https://polik18.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!value)
      throw new Error(
        'Usage: scratch-ai-bridge-mcp-http --token-file <path> [--http-port <port>] [--relay-port <port>] [--origin <origin>]',
      )
    if (key === '--token-file') tokenFile = value
    else if (key === '--http-port' || key === '--relay-port') {
      const port = Number(value)
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
        throw new Error('Port must be between 1024 and 65535.')
      if (key === '--http-port') httpPort = port
      else relayPort = port
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
  if (!tokenFile || relayPort === httpPort) throw new Error('Token file and distinct relay/HTTP ports are required.')
  return { tokenFile, relayPort, httpPort, origins: [...new Set(origins)] }
}

const readToken = async (path: string): Promise<string> => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.size > 256 ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())
    )
      throw new Error('Token file must be owned by the current user and accessible only by that user.')
    const token = (await file.readFile('utf8')).trim()
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Token file must contain exactly 64 hexadecimal characters.')
    return token
  } finally {
    await file.close()
  }
}

const options = parseOptions()
const token = await readToken(options.tokenFile)
const relay = new BrowserBridgeRelay(options.origins)
await relay.listen(options.relayPort)
const server = new TunnelMcpHttp(relay, token)
try {
  await server.listen(options.httpPort)
} catch (error) {
  relay.close()
  throw error
}
console.error(
  `MCP HTTP is restricted to 127.0.0.1:${options.httpPort}/mcp; browser relay uses 127.0.0.1:${options.relayPort}. Expires in 30 minutes.`,
)
const close = (): void => {
  relay.close()
  void server.close()
}
const expiry = setTimeout(close, 30 * 60_000)
expiry.unref()
process.once('SIGINT', close)
process.once('SIGTERM', close)
