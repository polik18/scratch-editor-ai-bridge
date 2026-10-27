// CLI 門禁驗證範例 - 驗證 SB3 生成結果
// Usage: npx tsx scripts/validate-sb3.mjs <path-to-sb3>

import { readFileSync } from 'fs';
import { default as JSZip } from 'jszip';

async function validateSB3File(sb3Path) {
  const errors = [];
  const warnings = [];

  try {
    // Read SB3 as ZIP (sync)
    const zip = await JSZip.loadAsync(readFileSync(sb3Path));

    // Check for project.json
    if (!zip.files['project.json']) {
      errors.push('Missing project.json in SB3');
      return { valid: false, errors, warnings };
    }

    // Extract project.json
    const projectJsonStr = await zip.files['project.json'].async('string');
    const projectJson = JSON.parse(projectJsonStr);

    // Validate structure (Scratch uses {targets, monitors, extensions, meta} format)
    if (!Array.isArray(projectJson.targets)) {
      errors.push('"targets" must be an array');
      return { valid: false, errors, warnings };
    }

    // Validate each target
    const allBlockIds = new Set();
    const allReporterIds = new Set();

    for (const target of projectJson.targets) {
      if (!target.id) {
        errors.push("Target missing \"id\": " + (target.name || '(unnamed)'));
      }
      if (!target.name) {
        errors.push("Target missing \"name\": ID=" + (target.id || '(unnamed)'));
      }

      // Collect blocks
      if (target.blocks) {
        for (const blockId of Object.keys(target.blocks)) {
          allBlockIds.add(blockId);
          const block = target.blocks[blockId];
          if (block.opcode?.includes('reporter')) {
            allReporterIds.add(blockId);
          }
        }
      }
    }

    // Validate each block
    for (const target of projectJson.targets) {
      if (!target.blocks) continue;

      for (const [blockId, block] of Object.entries(target.blocks)) {
        // Check required fields
        if (!block.opcode) {
          errors.push("Block \"" + blockId + "\" missing \"opcode\"");
        }

        // Validate topLevel
        if (block.topLevel === undefined) {
          warnings.push("Block \"" + blockId + "\" missing \"topLevel\" field (auto-set based on parent)");
        }

        // Validate parent-child relationship
        if (block.parent !== undefined && block.parent !== null) {
          if (!allBlockIds.has(block.parent)) {
            errors.push("Block \"" + blockId + "\" has parent \"" + block.parent + "\" but parent not found");
          }
        }

        // Validate inputs
        if (block.inputs) {
          for (const [inputName, inputValue] of Object.entries(block.inputs)) {
            // Check for reporter format
            if (typeof inputValue === 'object' && inputValue !== null) {
              if (inputValue.block !== undefined && inputValue.shadow !== undefined) {
                // New format: { block: 'ID', shadow: 'ID' }
                if (typeof inputValue.block !== 'string') {
                  errors.push("Block \"" + blockId + "\" input \"" + inputName + "\" has non-string \"block\"");
                }
              } else if (inputValue.type === 'literal' && inputValue.value !== undefined) {
                // Old format: { type: 'literal', value: ... }
                errors.push("Block \"" + blockId + "\" input \"" + inputName + "\" uses old \"literal\" format. Expected: { block: \"reporter_id\", shadow: \"reporter_shadow\" }");
              } else if (inputValue.type === 'reporter' && inputValue.id !== undefined) {
                // Old format: { type: 'reporter', id: ... }
                errors.push("Block \"" + blockId + "\" input \"" + inputName + "\" uses old \"reporter\" format. Expected: { block: \"reporter_id\", shadow: \"reporter_shadow\" }");
              }
            } else {
              errors.push("Block \"" + blockId + "\" input \"" + inputName + "\" is not an object");
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (err) {
    errors.push("Failed to validate SB3: " + err.message);
    return { valid: false, errors, warnings };
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/validate-sb3.mjs <path-to-sb3>');
    process.exit(1);
  }

  const sb3Path = args[0];
  console.log("Validating: " + sb3Path + "\n");

  const result = await validateSB3File(sb3Path);

  if (result.valid) {
    console.log('✅ SB3 validation PASSED');
    if (result.warnings.length > 0) {
      console.log("\n⚠️  Warnings (" + result.warnings.length + "):");
      for (const warning of result.warnings) {
        console.log("  - " + warning);
      }
    }
    process.exit(0);
  } else {
    console.log('❌ SB3 validation FAILED');
    console.log("\nErrors (" + result.errors.length + "):");
    for (const error of result.errors) {
      console.log("  - " + error);
    }
    if (result.warnings.length > 0) {
      console.log("\nWarnings (" + result.warnings.length + "):");
      for (const warning of result.warnings) {
        console.log("  - " + warning);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
