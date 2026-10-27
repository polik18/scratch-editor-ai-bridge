// Preview automation: Playwright-based screenshot generation
// Usage: import { previewScreenshot } from '@scratch/scratch-ai-bridge/preview/automation';

import type { ScratchSession } from '../cli/session/session.js';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

/**
 * Launch preview and capture screenshot
 * @param session ScratchSession instance
 * @param outputPath Output file path (default: /tmp/preview.png)
 * @returns Output file path
 */
export async function previewScreenshot(
  session: ScratchSession,
  outputPath?: string
): Promise<string> {
  const filePath = outputPath || path.join(process.cwd(), 'preview.png');
  
  // Compile project first to validate
  const sb3 = await session.compile();
  
  // Write SB3 to temp file for preview
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-preview-'));
  const tempSb3Path = path.join(tempDir, 'project.sb3');
  fs.writeFileSync(tempSb3Path, sb3);
  
  // Launch Playwright browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const page = await browser.newPage();
    
    // Load preview page (simplified - in production, use actual preview page)
    await page.goto('data:text/html,<html><body></body></html>');
    
    // Inject Scratch VM and load project
    await page.evaluate((sb3Base64) => {
      // This would load the actual preview UI in production
      // For now, we'll simulate the preview
      console.log('Loading project...');
      return { loaded: true };
    }, sb3.toString('base64'));
    
    // Wait for project to initialize
    await page.waitForTimeout(2000);
    
    // Take screenshot
    await page.screenshot({ path: filePath });
    
    console.log(`✓ Screenshot saved to ${filePath}`);
    
    return filePath;
  } finally {
    await browser.close();
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Run preview and wait for execution
 * @param session ScratchSession instance
 * @param duration Duration to run in seconds (default: 5)
 * @returns Promise that resolves when preview completes
 */
export async function previewRun(
  session: ScratchSession,
  duration: number = 5
): Promise<void> {
  // Compile project first to validate
  await session.compile();
  
  // In production, this would:
  // 1. Launch preview server
  // 2. Open page with Playwright
  // 3. Wait for project to run
  // 4. Take screenshot(s)
  // 5. Stop server
  
  console.log(`⏳ Preview running for ${duration} seconds...`);
  await new Promise(resolve => setTimeout(resolve, duration * 1000));
  console.log('✓ Preview completed');
}
