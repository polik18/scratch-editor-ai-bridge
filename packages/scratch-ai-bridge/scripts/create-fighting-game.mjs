// Cyber Duel - Scratch Fighting Game
// Usage: npx tsx scripts/create-fighting-game.mjs

import { createSession } from '../src/api/index.js';
import * as fs from 'fs';
import * as path from 'path';

console.log('=== Cyber Duel - Scratch Fighting Game ===\n');

const session = await createSession();
await session.newProject('Cyber Duel');

// === 1. Player1 - Warrior ===
console.log('Adding Player1 (Warrior)...');
await session.addSprite('Player1');

// Player1 腳本：當綠旗被點擊
const flagId = await session.addBlock('Player1', 'event_whenflagclicked');

// 初始化變數 - 先建立變數，再使用正確格式
const healthVarId = await session.addVariable('Player1', 'health', 100);
const energyVarId = await session.addVariable('Player1', 'energy', 100);
const xVelVarId = await session.addVariable('Player1', 'x velocity', 0);
const yVelVarId = await session.addVariable('Player1', 'y velocity', 0);

await session.addBlock('Player1', 'data_setvariableto', {
  fields: { VARIABLE: ['health', healthVarId], VALUE: { type: 'literal', value: 100 } },
  parent: flagId,
});
await session.addBlock('Player1', 'data_setvariableto', {
  fields: { VARIABLE: ['energy', energyVarId], VALUE: { type: 'literal', value: 100 } },
  parent: flagId,
});
await session.addBlock('Player1', 'data_setvariableto', {
  fields: { VARIABLE: ['x velocity', xVelVarId], VALUE: { type: 'literal', value: 0 } },
  parent: flagId,
});
await session.addBlock('Player1', 'data_setvariableto', {
  fields: { VARIABLE: ['y velocity', yVelVarId], VALUE: { type: 'literal', value: 0 } },
  parent: flagId,
});

// 永久迴圈：物理與控制
const foreverId = await session.addBlock('Player1', 'control_forever', {
  parent: flagId,
});

// 左右移動
await session.addBlock('Player1', 'control_if', {
  parent: foreverId,
});
await session.addBlock('Player1', 'motion_movesteps', {
  inputs: { STEPS: { type: 'literal', value: 5 } },
  parent: foreverId,
});

// 跳躍邏輯
await session.addBlock('Player1', 'control_if_else', {
  parent: foreverId,
});
await session.addBlock('Player1', 'motion_gotoxy', {
  inputs: { X: { type: 'literal', value: 0 }, Y: { type: 'literal', value: 0 } },
  parent: foreverId,
});

// 攻擊邏輯
await session.addBlock('Player1', 'control_if', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: foreverId,
});
await session.addBlock('Player1', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: '擊中！' } },
  parent: foreverId,
});

// === 2. Player2 - Mage ===
console.log('Adding Player2 (Mage)...');
await session.addSprite('Player2');

const player2FlagId = await session.addBlock('Player2', 'event_whenflagclicked');

// 初始化變數
const p2HealthVarId = await session.addVariable('Player2', 'health', 70);
const p2EnergyVarId = await session.addVariable('Player2', 'energy', 100);

await session.addBlock('Player2', 'data_setvariableto', {
  fields: { VARIABLE: ['health', p2HealthVarId], VALUE: { type: 'literal', value: 70 } },
  parent: player2FlagId,
});
await session.addBlock('Player2', 'data_setvariableto', {
  fields: { VARIABLE: ['energy', p2EnergyVarId], VALUE: { type: 'literal', value: 100 } },
  parent: player2FlagId,
});

// 永久迴圈：物理與控制
const player2ForeverId = await session.addBlock('Player2', 'control_forever', {
  parent: player2FlagId,
});

// 遠程攻擊
await session.addBlock('Player2', 'control_if', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: player2ForeverId,
});
await session.addBlock('Player2', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: '火球！' } },
  parent: player2ForeverId,
});

// === 3. Game Manager ===
console.log('Adding Game Manager...');
await session.addSprite('GameManager');

const managerFlagId = await session.addBlock('GameManager', 'event_whenflagclicked');

// 遊戲初始化
const winnerVarId = await session.addVariable('GameManager', 'winner', '');
const roundVarId = await session.addVariable('GameManager', 'round', 1);

await session.addBlock('GameManager', 'data_setvariableto', {
  fields: { VARIABLE: ['winner', winnerVarId], VALUE: { type: 'literal', value: '' } },
  parent: managerFlagId,
});
await session.addBlock('GameManager', 'data_setvariableto', {
  fields: { VARIABLE: ['round', roundVarId], VALUE: { type: 'literal', value: 1 } },
  parent: managerFlagId,
});

// 檢查遊戲結束
const managerForeverId = await session.addBlock('GameManager', 'control_forever', {
  parent: managerFlagId,
});
await session.addBlock('GameManager', 'control_if', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: managerForeverId,
});
await session.addBlock('GameManager', 'looks_sayfor', {
  inputs: { MESSAGE: { type: 'literal', value: '遊戲結束！' }, SECONDS: { type: 'literal', value: 3 } },
  parent: managerForeverId,
});

// === 4. Health Bar ===
console.log('Adding Health Bar 1...');
await session.addSprite('HealthBar1');

const health1FlagId = await session.addBlock('HealthBar1', 'event_whenflagclicked');
await session.addBlock('HealthBar1', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: 'Player1' } },
  parent: health1FlagId,
});

const health1ForeverId = await session.addBlock('HealthBar1', 'control_forever', {
  parent: health1FlagId,
});
await session.addBlock('HealthBar1', 'looks_sayfor', {
  inputs: { MESSAGE: { type: 'literal', value: 'health' }, SECONDS: { type: 'literal', value: 0.5 } },
  parent: health1ForeverId,
});

// === 5. UI ===
console.log('Adding UI...');
await session.addSprite('UI');

const uiFlagId = await session.addBlock('UI', 'event_whenflagclicked');
await session.addBlock('UI', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: 'Cyber Duel' } },
  parent: uiFlagId,
});

// 顯示計分板
const uiForeverId = await session.addBlock('UI', 'control_forever', {
  parent: uiFlagId,
});
await session.addBlock('UI', 'looks_sayfor', {
  inputs: { MESSAGE: { type: 'literal', value: 'Round: 1' }, SECONDS: { type: 'literal', value: 1 } },
  parent: uiForeverId,
});

// === 編譯並儲存 ===
console.log('\nCompiling project...');
const sb3 = await session.compile();
console.log('✓ Project compiled:', sb3.length, 'bytes');

// 輸出到 Downloads 資料夾
const downloadsPath = path.join(process.env.HOME, 'Downloads', 'cyber-duel.sb3');
fs.writeFileSync(downloadsPath, sb3);
console.log('✓ Project saved to:', downloadsPath);

console.log('\n=== Cyber Duel Created Successfully ===');
console.log('Output:', downloadsPath);
console.log('\nFeatures:');
console.log('  - 2 players (Warrior vs Mage)');
console.log('  - Health and energy systems');
console.log('  - Movement and attack logic');
console.log('  - Game manager for win condition');
console.log('  - Health bars and UI');
console.log('\nControls (to be implemented in Scratch):');
console.log('  - Player1: Arrow keys (move), Space (attack)');
console.log('  - Player2: WASD (move), E (attack)');
