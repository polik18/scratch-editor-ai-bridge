import { ScratchSession } from './src/cli/session/session.js'

const session = new ScratchSession()
await session.loadSb3('./PinballRefined.sb3')
console.log('Loaded PinballRefined.sb3')
console.log('Targets:', session.inspect().targets.length)
