import { ScratchSession } from './src/cli/session/session.js'

const session = new ScratchSession()
session.newProject('PinballTest')

// Add ball sprite
session.addSprite('Ball', { x: 0, y: 100, size: 50 })

// Add left wall
session.addSprite('LeftWall', { x: -220, y: 0, size: 20 })

// Add right wall
session.addSprite('RightWall', { x: 220, y: 0, size: 20 })

// Add bottom paddle
session.addSprite('Paddle', { x: 0, y: -150, size: 60 })

// Save to disk
session.saveSb3('/tmp/pinball-test-new.sb3')
console.log('Created PinballTest')
console.log('Targets:', session.inspect().targets.length)
console.log('Saved to /tmp/pinball-test-new.sb3')
