import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const useCspParser = mode !== 'test'

  return {
    base: './',
    define: {
      global: 'globalThis',
    },
    plugins: useCspParser
      ? [
          {
            name: 'scratch-ai-bridge-csp-parser-interop',
            enforce: 'pre',
            transform(code, id) {
              if (!id.includes('/scratch-vm/src/virtual-machine.js')) return
              return code.replaceAll("require('scratch-parser')", "require('scratch-parser').default")
            },
          },
        ]
      : [],
    resolve: {
      alias: {
        '@scratch/scratch-vm': fileURLToPath(new URL('../scratch-vm/src/index.js', import.meta.url)),
        ...(useCspParser
          ? { 'scratch-parser': fileURLToPath(new URL('./src/scratch/csp-scratch-parser.ts', import.meta.url)) }
          : {}),
        '@tensorflow-models/face-detection': fileURLToPath(
          new URL('./src/scratch/unsupported-face-detection.ts', import.meta.url),
        ),
        'node:buffer': fileURLToPath(new URL('../../node_modules/buffer/index.js', import.meta.url)),
        buffer: fileURLToPath(new URL('../../node_modules/buffer/index.js', import.meta.url)),
        events: fileURLToPath(new URL('../../node_modules/events/events.js', import.meta.url)),
      },
    },
    test: {
      environment: 'node',
    },
  }
})
