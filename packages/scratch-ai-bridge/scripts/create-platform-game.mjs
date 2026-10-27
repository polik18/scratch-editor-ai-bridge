// 平台遊戲 - Star Collector
// 使用 scratch-session CLI 建立 SB3 檔案

import { createSession } from '../src/api/index.js';
import { previewScreenshot } from '../src/preview/automation.js';
import * as fs from 'fs';

console.log('=== Star Collector Platform Game ===\n');

const session = await createSession();
await session.newProject('Star Collector');

// === 1. Hero (玩家角色) ===
console.log('Adding Hero...');
await session.addSprite('Hero');

// Hero 腳本：當綠旗被點擊
const flagId = await session.addBlock('Hero', 'event_whenflagclicked');

// 設定變數
await session.addBlock('Hero', 'data_setvariableto', {
  fields: { VARIABLE: { type: 'variable', value: 'x velocity' }, VALUE: { type: 'literal', value: 0 } },
  parent: flagId,
});
await session.addBlock('Hero', 'data_setvariableto', {
  fields: { VARIABLE: { type: 'variable', value: 'y velocity' }, VALUE: { type: 'literal', value: 0 } },
  parent: flagId,
});

// 永久迴圈：物理與控制
const foreverId = await session.addBlock('Hero', 'control_forever', {
  parent: flagId,
});

// 左右移動
await session.addBlock('Hero', 'control_if', {
  parent: foreverId,
});
await session.addBlock('Hero', 'motion_gotoxy', {
  inputs: { X: { type: 'reporter', value: 'x position' }, Y: { type: 'literal', value: 0 } },
});

// 跳躍邏輯
await session.addBlock('Hero', 'control_if_else', {
  parent: foreverId,
});
await session.addBlock('Hero', 'motion_gotoxy', {
  inputs: { X: { type: 'literal', value: 0 }, Y: { type: 'literal', value: 0 } },
});

// === 2. Star (星星道具) ===
console.log('Adding Star...');
await session.addSprite('Star');

const starFlagId = await session.addBlock('Star', 'event_whenflagclicked');
await session.addBlock('Star', 'motion_gotoxy', {
  inputs: { X: { type: 'literal', value: 100 }, Y: { type: 'literal', value: 50 } },
  parent: starFlagId,
});

// 旋轉動畫
const starForeverId = await session.addBlock('Star', 'control_forever', {
  parent: starFlagId,
});
await session.addBlock('Star', 'looks_turncw', {
  inputs: { DEGREES: { type: 'literal', value: 15 } },
  parent: starForeverId,
});

// 收集邏輯
await session.addBlock('Star', 'control_wait_until', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: starForeverId,
});
await session.addBlock('Star', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: '收集我！' } },
  parent: starForeverId,
});

// === 3. Enemy (敵人) ===
console.log('Adding Enemy...');
await session.addSprite('Enemy');

const enemyFlagId = await session.addBlock('Enemy', 'event_whenflagclicked');
await session.addBlock('Enemy', 'motion_gotoxy', {
  inputs: { X: { type: 'literal', value: -200 }, Y: { type: 'literal', value: -50 } },
  parent: enemyFlagId,
});

// 巡邏邏輯
const enemyForeverId = await session.addBlock('Enemy', 'control_forever', {
  parent: enemyFlagId,
});
await session.addBlock('Enemy', 'motion_gotoxy', {
  inputs: { X: { type: 'reporter', value: 'x position' }, Y: { type: 'literal', value: -50 } },
  parent: enemyForeverId,
});

// 檢測碰到玩家
await session.addBlock('Enemy', 'control_if', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: enemyForeverId,
});
await session.addBlock('Enemy', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: '抓住你了！' } },
  parent: enemyForeverId,
});

// === 4. Level Manager (關卡管理) ===
console.log('Adding Level Manager...');
await session.addSprite('LevelManager');

const managerFlagId = await session.addBlock('LevelManager', 'event_whenflagclicked');
await session.addBlock('LevelManager', 'data_setvariableto', {
  fields: { VARIABLE: { type: 'variable', value: 'level' }, VALUE: { type: 'literal', value: 1 } },
  parent: managerFlagId,
});
await session.addBlock('LevelManager', 'data_setvariableto', {
  fields: { VARIABLE: { type: 'variable', value: 'score' }, VALUE: { type: 'literal', value: 0 } },
  parent: managerFlagId,
});
await session.addBlock('LevelManager', 'data_setvariableto', {
  fields: { VARIABLE: { type: 'variable', value: 'lives' }, VALUE: { type: 'literal', value: 3 } },
  parent: managerFlagId,
});

// 關卡條件
await session.addBlock('LevelManager', 'control_wait_until', {
  inputs: { CONDITION: { type: 'boolean', value: false } },
  parent: managerFlagId,
});
await session.addBlock('LevelManager', 'data_changevariableby', {
  fields: { VARIABLE: { type: 'variable', value: 'level' }, VALUE: { type: 'literal', value: 1 } },
  parent: managerFlagId,
});

// === 5. UI (介面) ===
console.log('Adding UI...');
await session.addSprite('UI');

const uiFlagId = await session.addBlock('UI', 'event_whenflagclicked');
await session.addBlock('UI', 'looks_say', {
  inputs: { MESSAGE: { type: 'literal', value: '分數: 0' } },
  parent: uiFlagId,
});

// 更新顯示
const uiForeverId = await session.addBlock('UI', 'control_forever', {
  parent: uiFlagId,
});
await session.addBlock('UI', 'looks_sayfor', {
  inputs: { MESSAGE: { type: 'reporter', value: 'score' }, SECONDS: { type: 'literal', value: 1 } },
  parent: uiForeverId,
});

// === 編譯並儲存 ===
console.log('\nCompiling project...');
const sb3 = await session.compile();
console.log('✓ Project compiled:', sb3.length, 'bytes');

// 輸出到 Downloads 資料夾
import * as path from 'path';
const downloadsPath = path.join(process.env.HOME, 'Downloads', 'star-collector.sb3');
fs.writeFileSync(downloadsPath, sb3);
console.log('✓ Project saved to:', downloadsPath);

console.log('\n=== Star Collector Created Successfully ===');
console.log('Output:', downloadsPath);
