/**
 * Design to Canonical IR - Convert GameDesign to Canonical Project
 */

import type {
  CanonicalProject,
  CanonicalSprite,
  CanonicalVariable,
  CanonicalList,
  CanonicalScript,
  CanonicalCostume,
  CanonicalStage,
} from '../core/ir/types.js';
import type { GameDesign } from '../core/ir/design-interface.js';

/**
 * Convert GameDesign to Canonical Project
 * @param design - GameDesign object
 * @returns CanonicalProject object
 */
export function designToCanonicalIR(design: GameDesign): CanonicalProject {
  // Process spritesDef
  const sprites: CanonicalSprite[] = [];
  
  if (design.spritesDef && design.spritesDef.length > 0) {
    for (const spriteDef of design.spritesDef) {
      // Process costumes
      const costumes: CanonicalCostume[] = [];
      if (spriteDef.costumes && spriteDef.costumes.length > 0) {
        for (const costumeName of spriteDef.costumes) {
          costumes.push({
            name: costumeName,
            dataFormat: 'png', // Default format
            data: undefined, // Will be filled by compiler
          });
        }
      } else {
        // Add default costume
        costumes.push({
          name: 'costume1',
          dataFormat: 'png',
          data: undefined,
        });
      }
      
      // Process scripts for this sprite
      const spriteScripts: CanonicalScript[] = [];
      if (design.scripts) {
        for (const scriptDef of design.scripts) {
          if (scriptDef.target === spriteDef.name) {
            // Process blocks for this script
            const blocks: any[] = [];
            let prevBlockId: string | null = null;
            
            for (const blockDef of scriptDef.blocks) {
              const block: any = {
                opcode: blockDef.opcode,
                inputs: blockDef.inputs ? processInputs(blockDef.inputs) : undefined,
                fields: blockDef.fields ? processFields(blockDef.fields) : undefined,
              };
              
              blocks.push(block);
              
              // Update next/parent pointers
              if (prevBlockId !== null) {
                block.next = prevBlockId;
              }
              
              prevBlockId = blockDef.id || null;
            }
            
            const script: CanonicalScript = {
              blocks: blocks,
              position: {
                x: scriptDef.x ?? 0,
                y: scriptDef.y ?? 0,
              },
            };
            
            spriteScripts.push(script);
          }
        }
      }
      
      // Process variables for this sprite
      const spriteVariables: CanonicalVariable[] = [];
      if (design.variables) {
        for (const varDef of design.variables) {
          if (varDef.sprite === spriteDef.name || (!varDef.sprite && sprites.length === 0)) {
            spriteVariables.push({
              name: varDef.name,
              value: varDef.value,
            });
          }
        }
      }
      
      // Process lists for this sprite
      const spriteLists: CanonicalList[] = [];
      if (design.lists) {
        for (const listDef of design.lists) {
          if (listDef.sprite === spriteDef.name || (!listDef.sprite && sprites.length === 0)) {
            spriteLists.push({
              name: listDef.name,
              value: listDef.values as number[] | string[],
            });
          }
        }
      }
      
      const sprite: CanonicalSprite = {
        kind: 'sprite',
        name: spriteDef.name,
        x: spriteDef.x ?? 0,
        y: spriteDef.y ?? 0,
        direction: spriteDef.direction ?? 90,
        size: 100,
        visible: spriteDef.visible ?? true,
        draggable: spriteDef.draggable ?? false,
        rotationStyle: 'all around' as const,
        currentCostume: 0,
        volume: 100,
        costumes,
        sounds: [],
        variables: spriteVariables,
        lists: spriteLists,
        scripts: spriteScripts,
        procedures: [],
      };
      
      sprites.push(sprite);
    }
  }
  
  // Create stage
  const stage: CanonicalStage = {
    kind: 'stage',
    name: 'Stage',
    tempo: 60,
    videoTransparency: 50,
    textToSpeechLanguage: 'en',
    currentCostume: 0,
    volume: 100,
    costumes: [
      {
        name: 'backdrop1',
        dataFormat: 'png',
        data: undefined,
      },
    ],
    sounds: [],
    variables: [],
    lists: [],
    scripts: [],
    procedures: [],
  };
  
  // Process global variables
  const globalVariables: CanonicalVariable[] = [];
  if (design.variables) {
    for (const varDef of design.variables) {
      if (!varDef.sprite) {
        globalVariables.push({
          name: varDef.name,
          value: varDef.value,
        });
      }
    }
  }
  
  // Process global lists
  const globalLists: CanonicalList[] = [];
  if (design.lists) {
    for (const listDef of design.lists) {
      if (!listDef.sprite) {
        globalLists.push({
          name: listDef.name,
          value: listDef.values as number[] | string[],
        });
      }
    }
  }
  
  // Create Canonical Project
  const project: CanonicalProject = {
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: design.title,
    stage,
    sprites,
    broadcasts: [],
    extensions: [],
    meta: {
      version: design.version || '1.0',
      scratch: '3.0',
      language: 'en',
    },
    monitors: [],
  };
  
  return project;
}

/**
 * Process inputs for a block
 * @param inputs - Input record (simple values like number/string/Array)
 * @returns Processed input record (objects with type/value for Scratch IR)
 */
function processInputs(inputs: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      // SUBSTACK: array of blocks -> StackInput
      result[key] = {
        type: 'stack',
        blocks: value,
      };
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Check if it's already a proper input object (has type field)
      if (value.type && ['literal', 'variable', 'list', 'broadcast', 'block', 'stack'].includes(value.type)) {
        // Already a proper input object, keep as is
        result[key] = value;
      } else {
        // Nested input object that needs conversion (e.g., MESSAGE: {value: "x"})
        // This is the design format -> convert to LiteralInput
        if (value.value !== undefined) {
          result[key] = {
            type: 'literal',
            value: value.value,
          };
        } else {
          // Unknown format, keep as is (may be fields instead of inputs)
          result[key] = value;
        }
      }
    } else {
      // Simple value (number, string, boolean) -> literal
      result[key] = {
        type: 'literal',
        value: value,
      };
    }
  }
  
  return result;
}

/**
 * Process fields for a block
 * @param fields - Field record
 * @returns Processed field record
 */
function processFields(fields: Record<string, any>): Record<string, any> {
  return fields;
}
