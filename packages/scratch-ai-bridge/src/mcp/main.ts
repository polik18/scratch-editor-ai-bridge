import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { BrowserBridgeRelay } from './companion.js'
import { createBridgeMcpFactory } from './tools.js'

const parseOptions = (): { readonly origins: string[]; readonly port: number } => {
  const origins = ['https://polik18.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']
  let port = 43128
  for (let index = 2; index < process.argv.length; index += 1) {
    const option = process.argv[index]
    const value = process.argv[index + 1]
    if (option === '--origin' && value) {
      const url = new URL(value)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
        throw new Error('--origin must be an http(s) page origin without credentials.')
      origins.push(url.origin)
      index += 1
    } else if (option === '--port' && value) {
      port = Number(value)
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
        throw new Error('--port must be an integer between 1024 and 65535.')
      index += 1
    } else {
      throw new Error('Usage: scratch-ai-bridge-mcp [--origin <Bridge-page-origin>] [--port <1024-65535>]')
    }
  }
  return { origins: [...new Set(origins)], port }
}

const main = async (): Promise<void> => {
  const { origins, port } = parseOptions()
  const relay = new BrowserBridgeRelay(origins)
  await relay.listen(port)

  process.stdin.once('end', () => relay.close())
  process.once('SIGINT', () => relay.close())
  process.once('SIGTERM', () => relay.close())
  console.error(`Scratch AI Bridge MCP relay listening on 127.0.0.1:${port}.`)
  console.error(`Allowed Bridge page origins: ${origins.join(', ')}`)
  serveStdio(createBridgeMcpFactory(relay))
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
