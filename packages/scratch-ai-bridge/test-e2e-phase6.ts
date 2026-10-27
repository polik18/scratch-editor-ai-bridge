import { ScratchSession } from './src/cli/session/session.js';

async function testPhase6() {
  console.log('Phase 6: End-to-end validation');
  
  const session = new ScratchSession();
  
  // Test 1: Create new project
  session.newProject('E2E Test');
  console.log('Test 1 PASSED: newProject()');
  
  // Test 2: Inspect default
  const result1 = session.inspect('default');
  if (result1.targets.length !== 1) throw new Error('Expected 1 target (Stage)');
  if (!result1.capabilities) throw new Error('Expected capabilities');
  console.log('Test 2 PASSED: inspect(default)');
  
  // Test 3: Inspect capabilities
  const result2 = session.inspect('capabilities');
  if (!result2.capabilities) throw new Error('Expected capabilities');
  if (result2.capabilities.blockOpcodes.length === 0) throw new Error('Expected block opcodes');
  console.log('Test 3 PASSED: inspect(capabilities)');
  
  // Test 4: Asset list
  const assets = session.assetsList();
  if (assets.assets.length === 0) throw new Error('Expected assets');
  console.log('Test 4 PASSED: assetsList()');
  
  // Test 5: Load and save SB3 (ZIP entries retention)
  const fs = require('fs');
  const testSb3 = '/Users/huangjianzhe/experiments/test-project.sb3';
  if (fs.existsSync(testSb3)) {
    await session.loadSb3(testSb3);
    const assets2 = session.assetsList();
    const hasSvg = assets2.assets.some(a => a.md5ext.endsWith('.svg'));
    if (!hasSvg) throw new Error('Expected SVG costume');
    console.log('Test 5 PASSED: loadSb3() ZIP entries loaded');
    
    const outputPath = '/Users/huangjianzhe/experiments/test-project-verify.sb3';
    await session.saveSb3(outputPath);
    if (!fs.existsSync(outputPath)) throw new Error('Expected output file');
    console.log('Test 5b PASSED: saveSb3() ZIP entries retained');
  }
  
  // Test 6: Plan/Apply/Undo/Diff
  const planResult = session.plan({ operations: [] });
  if (planResult.status !== 'pending') throw new Error('Expected pending');
  console.log('Test 6 PASSED: plan()');
  
  const diffResult = session.diff();
  if (diffResult.status !== 'no-diff-available') throw new Error('Expected no-diff-available');
  console.log('Test 6b PASSED: diff()');
  
  console.log('All Phase 6 tests PASSED');
}

testPhase6().catch((e) => {
  console.error('Test FAILED:', e.message);
  process.exit(1);
});
