import { LocalModelGateway, privateModelEndpoint } from './gateway.js'

const options = (): { endpoint: string; origins: string[]; port: number } => {
  let endpoint = ''
  let port = 43129
  const origins = ['https://polik18.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!value)
      throw new Error(
        'Usage: scratch-ai-bridge-model-gateway --endpoint <private-ip-model-url> [--origin <page-origin>] [--port <port>]',
      )
    if (key === '--endpoint') endpoint = value
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
        throw new Error('Origin must be an exact http(s) origin.')
      origins.push(url.origin)
    } else throw new Error(`Unknown option: ${key}`)
  }
  privateModelEndpoint(endpoint)
  return { endpoint, port, origins: [...new Set(origins)] }
}

const { endpoint, port, origins } = options()
const gateway = new LocalModelGateway(endpoint, origins)
await gateway.listen(port)
console.error(
  `Local model gateway listening at http://127.0.0.1:${port}; model destination ${privateModelEndpoint(endpoint).origin}`,
)
if (privateModelEndpoint(endpoint).protocol === 'http:')
  console.error('The model connection uses unencrypted HTTP on the local network.')
process.once('SIGINT', () => gateway.close())
process.once('SIGTERM', () => gateway.close())
