/**
 * Session Validator - Validate ScratchSession structure
 */

import type { ScratchProjectJson } from '../core/compiler/project-json.js';
import type { CanonicalProject } from '../core/ir/types.js';

/**
 * Session validation result
 */
export interface SessionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a ScratchSession's internal structure
 * @param project - Scratch project JSON
 * @returns SessionValidationResult
 */
export function validateSession(project: ScratchProjectJson | Record<string, unknown>): SessionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check if project is valid
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.push('Project is not a valid object');
    return { valid: false, errors, warnings };
  }
  
  // Check targets
  const targets = (project as { targets?: unknown }).targets;
  if (!Array.isArray(targets)) {
    errors.push('Project has no targets array');
    return { valid: false, errors, warnings };
  }
  
  if (targets.length === 0) {
    errors.push('Project has no targets');
    return { valid: false, errors, warnings };
  }
  
  // Validate each target
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const targetPath = i === 0 && (target as { isStage?: boolean }).isStage ? '/stage' : `/sprites/${i}`;
    
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      errors.push(`Target ${targetPath} is not a valid object`);
      continue;
    }
    
    // Validate variables
    const variables = (target as { variables?: unknown }).variables;
    if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
      for (const [name, value] of Object.entries(variables)) {
        if (!Array.isArray(value) || value.length < 2) {
          errors.push(`Invalid variable format for "${name}" in ${targetPath}`);
        }
      }
    } else if (variables) {
      errors.push(`Variables in ${targetPath} is not a valid object`);
    }
    
    // Validate lists
    const lists = (target as { lists?: unknown }).lists;
    if (lists && typeof lists === 'object' && !Array.isArray(lists)) {
      for (const [name, value] of Object.entries(lists)) {
        if (!Array.isArray(value) || value.length < 2) {
          errors.push(`Invalid list format for "${name}" in ${targetPath}`);
        }
      }
    } else if (lists) {
      errors.push(`Lists in ${targetPath} is not a valid object`);
    }
    
    // Validate costumes
    const costumes = (target as { costumes?: unknown }).costumes;
    if (costumes && Array.isArray(costumes)) {
      for (let j = 0; j < costumes.length; j++) {
        const costume = costumes[j];
        if (!costume || typeof costume !== 'object' || Array.isArray(costume)) {
          errors.push(`Invalid costume format at index ${j} in ${targetPath}`);
        }
      }
    } else if (costumes) {
      warnings.push(`Costumes in ${targetPath} is not an array`);
    }
    
    // Validate sounds
    const sounds = (target as { sounds?: unknown }).sounds;
    if (sounds && Array.isArray(sounds)) {
      for (let j = 0; j < sounds.length; j++) {
        const sound = sounds[j];
        if (!sound || typeof sound !== 'object' || Array.isArray(sound)) {
          errors.push(`Invalid sound format at index ${j} in ${targetPath}`);
        }
      }
    } else if (sounds) {
      warnings.push(`Sounds in ${targetPath} is not an array`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a CanonicalProject structure
 * @param project - Canonical project
 * @returns SessionValidationResult
 */
export function validateCanonicalProject(project: CanonicalProject): SessionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check project structure
  if (!project) {
    errors.push('Project is not a valid object');
    return { valid: false, errors, warnings };
  }
  
  // Check stage
  if (!project.stage) {
    errors.push('Project has no stage');
    return { valid: false, errors, warnings };
  }
  
  // Validate stage structure
  if (project.stage.kind !== 'stage') {
    errors.push('Stage kind is not "stage"');
  }
  
  // Validate stage variables
  if (project.stage.variables && Array.isArray(project.stage.variables)) {
    for (let i = 0; i < project.stage.variables.length; i++) {
      const variable = project.stage.variables[i];
      if (!variable.name || variable.value === undefined) {
        errors.push(`Invalid stage variable at index ${i}`);
      }
    }
  }
  
  // Validate stage lists
  if (project.stage.lists && Array.isArray(project.stage.lists)) {
    for (let i = 0; i < project.stage.lists.length; i++) {
      const list = project.stage.lists[i];
      if (!list.name || !Array.isArray(list.value)) {
        errors.push(`Invalid stage list at index ${i}`);
      }
    }
  }
  
  // Validate sprites
  if (project.sprites && Array.isArray(project.sprites)) {
    for (let i = 0; i < project.sprites.length; i++) {
      const sprite = project.sprites[i];
      
      if (!sprite.name) {
        errors.push(`Sprite at index ${i} has no name`);
      }
      
      // Validate sprite variables
      if (sprite.variables && Array.isArray(sprite.variables)) {
        for (let j = 0; j < sprite.variables.length; j++) {
          const variable = sprite.variables[j];
          if (!variable.name || variable.value === undefined) {
            errors.push(`Invalid sprite variable at index ${j} in sprite "${sprite.name}"`);
          }
        }
      }
      
      // Validate sprite lists
      if (sprite.lists && Array.isArray(sprite.lists)) {
        for (let j = 0; j < sprite.lists.length; j++) {
          const list = sprite.lists[j];
          if (!list.name || !Array.isArray(list.value)) {
            errors.push(`Invalid sprite list at index ${j} in sprite "${sprite.name}"`);
          }
        }
      }
      
      // Validate sprite costumes
      if (sprite.costumes && Array.isArray(sprite.costumes)) {
        for (let j = 0; j < sprite.costumes.length; j++) {
          const costume = sprite.costumes[j];
          if (!costume.name || !costume.dataFormat) {
            errors.push(`Invalid sprite costume at index ${j} in sprite "${sprite.name}"`);
          }
        }
      }
      
      // Validate sprite sounds
      if (sprite.sounds && Array.isArray(sprite.sounds)) {
        for (let j = 0; j < sprite.sounds.length; j++) {
          const sound = sprite.sounds[j];
          if (!sound.name || !sound.dataFormat) {
            errors.push(`Invalid sprite sound at index ${j} in sprite "${sprite.name}"`);
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
}
