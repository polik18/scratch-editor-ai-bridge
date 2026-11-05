/**
 * Session Validator - Validate ScratchSession structure.
 */

/**
 * Result structure returned by session structure validation.
 */
export interface SessionValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a ScratchSession's internal structure.
 * @param project - Scratch project JSON object to validate.
 * @returns Validation result with errors and warnings.
 */
export function validateSession(project: unknown): SessionValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check if project is valid
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.push('Project is not a valid object')
    return { valid: false, errors, warnings }
  }

  const projectRecord = project as Record<string, unknown>

  // Check targets
  const targets = projectRecord.targets
  if (!Array.isArray(targets)) {
    errors.push('Project has no targets array')
    return { valid: false, errors, warnings }
  }

  if (targets.length === 0) {
    errors.push('Project has no targets')
    return { valid: false, errors, warnings }
  }

  // Validate each target
  for (let i = 0; i < targets.length; i++) {
    const rawTarget = targets[i] as unknown
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      errors.push(`Target at index ${i} is not a valid object`)
      continue
    }

    const target = rawTarget as Record<string, unknown>
    const targetPath = i === 0 && target.isStage === true ? '/stage' : `/sprites/${i}`

    // Validate variables
    const variables = target.variables
    if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
      for (const [name, value] of Object.entries(variables as Record<string, unknown>)) {
        if (!Array.isArray(value) || value.length < 2) {
          errors.push(`Invalid variable format for "${name}" in ${targetPath}`)
        }
      }
    } else if (variables) {
      errors.push(`Variables in ${targetPath} is not a valid object`)
    }

    // Validate lists
    const lists = target.lists
    if (lists && typeof lists === 'object' && !Array.isArray(lists)) {
      for (const [name, value] of Object.entries(lists as Record<string, unknown>)) {
        if (!Array.isArray(value) || value.length < 2) {
          errors.push(`Invalid list format for "${name}" in ${targetPath}`)
        }
      }
    } else if (lists) {
      errors.push(`Lists in ${targetPath} is not a valid object`)
    }

    // Validate costumes
    const costumes = target.costumes
    if (costumes && Array.isArray(costumes)) {
      for (let j = 0; j < costumes.length; j++) {
        const costume = costumes[j] as unknown
        if (!costume || typeof costume !== 'object' || Array.isArray(costume)) {
          errors.push(`Invalid costume format at index ${j} in ${targetPath}`)
        }
      }
    } else if (costumes) {
      warnings.push(`Costumes in ${targetPath} is not an array`)
    }

    // Validate sounds
    const sounds = target.sounds
    if (sounds && Array.isArray(sounds)) {
      for (let j = 0; j < sounds.length; j++) {
        const sound = sounds[j] as unknown
        if (!sound || typeof sound !== 'object' || Array.isArray(sound)) {
          errors.push(`Invalid sound format at index ${j} in ${targetPath}`)
        }
      }
    } else if (sounds) {
      warnings.push(`Sounds in ${targetPath} is not an array`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate a CanonicalProject structure.
 * @param project - The canonical project data to check.
 * @returns Validation outcome detailing errors and warnings.
 */
export function validateCanonicalProject(project: unknown): SessionValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check project structure
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.push('Project is not a valid object')
    return { valid: false, errors, warnings }
  }

  const proj = project as Record<string, unknown>

  // Check stage
  const stage = proj.stage
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
    errors.push('Project has no stage')
    return { valid: false, errors, warnings }
  }

  const stageObj = stage as Record<string, unknown>

  // Validate stage structure
  if (stageObj.kind !== 'stage') {
    errors.push('Stage kind is not "stage"')
  }

  // Validate stage variables
  if (stageObj.variables && Array.isArray(stageObj.variables)) {
    for (let i = 0; i < stageObj.variables.length; i++) {
      const variable = stageObj.variables[i] as unknown
      if (!variable || typeof variable !== 'object' || Array.isArray(variable)) {
        errors.push(`Invalid stage variable at index ${i}`)
        continue
      }
      const v = variable as Record<string, unknown>
      if (!v.name || v.value === undefined) {
        errors.push(`Invalid stage variable at index ${i}`)
      }
    }
  }

  // Validate stage lists
  if (stageObj.lists && Array.isArray(stageObj.lists)) {
    for (let i = 0; i < stageObj.lists.length; i++) {
      const list = stageObj.lists[i] as unknown
      if (!list || typeof list !== 'object' || Array.isArray(list)) {
        errors.push(`Invalid stage list at index ${i}`)
        continue
      }
      const l = list as Record<string, unknown>
      if (!l.name || !Array.isArray(l.value)) {
        errors.push(`Invalid stage list at index ${i}`)
      }
    }
  }

  // Validate sprites
  if (proj.sprites && Array.isArray(proj.sprites)) {
    for (let i = 0; i < proj.sprites.length; i++) {
      const rawSprite = proj.sprites[i] as unknown
      if (!rawSprite || typeof rawSprite !== 'object' || Array.isArray(rawSprite)) {
        errors.push(`Sprite at index ${i} is not a valid object`)
        continue
      }

      const sprite = rawSprite as Record<string, unknown>
      const spriteName = typeof sprite.name === 'string' ? sprite.name : `sprite_${i}`

      if (!sprite.name) {
        errors.push(`Sprite at index ${i} has no name`)
      }

      // Validate sprite variables
      if (sprite.variables && Array.isArray(sprite.variables)) {
        for (let j = 0; j < sprite.variables.length; j++) {
          const variable = sprite.variables[j] as unknown
          if (!variable || typeof variable !== 'object' || Array.isArray(variable)) {
            errors.push(`Invalid sprite variable at index ${j} in sprite "${spriteName}"`)
            continue
          }
          const v = variable as Record<string, unknown>
          if (!v.name || v.value === undefined) {
            errors.push(`Invalid sprite variable at index ${j} in sprite "${spriteName}"`)
          }
        }
      }

      // Validate sprite lists
      if (sprite.lists && Array.isArray(sprite.lists)) {
        for (let j = 0; j < sprite.lists.length; j++) {
          const list = sprite.lists[j] as unknown
          if (!list || typeof list !== 'object' || Array.isArray(list)) {
            errors.push(`Invalid sprite list at index ${j} in sprite "${spriteName}"`)
            continue
          }
          const l = list as Record<string, unknown>
          if (!l.name || !Array.isArray(l.value)) {
            errors.push(`Invalid sprite list at index ${j} in sprite "${spriteName}"`)
          }
        }
      }

      // Validate sprite costumes
      if (sprite.costumes && Array.isArray(sprite.costumes)) {
        for (let j = 0; j < sprite.costumes.length; j++) {
          const costume = sprite.costumes[j] as unknown
          if (!costume || typeof costume !== 'object' || Array.isArray(costume)) {
            errors.push(`Invalid sprite costume at index ${j} in sprite "${spriteName}"`)
            continue
          }
          const c = costume as Record<string, unknown>
          if (!c.name || !c.dataFormat) {
            errors.push(`Invalid sprite costume at index ${j} in sprite "${spriteName}"`)
          }
        }
      }

      // Validate sprite sounds
      if (sprite.sounds && Array.isArray(sprite.sounds)) {
        for (let j = 0; j < sprite.sounds.length; j++) {
          const sound = sprite.sounds[j] as unknown
          if (!sound || typeof sound !== 'object' || Array.isArray(sound)) {
            errors.push(`Invalid sprite sound at index ${j} in sprite "${spriteName}"`)
            continue
          }
          const s = sound as Record<string, unknown>
          if (!s.name || !s.dataFormat) {
            errors.push(`Invalid sprite sound at index ${j} in sprite "${spriteName}"`)
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
