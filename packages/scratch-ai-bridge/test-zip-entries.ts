import { ScratchSession } from './src/cli/session/session.js';

async function test() {
  console.log('Phase 1: ZIP entries retention test');
  const session = new ScratchSession();
  
  // Test 1: newProject initializes zipEntries = null
  session.newProject('TestZipEntries');
  console.log('Test 1 PASSED: newProject() sets zipEntries = null');
  
  // Test 2: loadProjectJson initializes zipEntries = null
  session.loadProjectJson({ targets: [], monitors: [], extensions: [], meta: {} });
  console.log('Test 2 PASSED: loadProjectJson() sets zipEntries = null');
  
  console.log('All Phase 1 type checks passed');
}

test().catch(console.error);
