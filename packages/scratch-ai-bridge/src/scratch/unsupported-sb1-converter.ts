/**
 * Scratch AI Bridge accepts SB3 projects and does not convert legacy Scratch 1 archives.
 * This implementation replaces the upstream converter in the production bundle so that
 * its Node-specific js-md5 fallback is not shipped into the strict-CSP browser app.
 */
export class ValidationError extends Error {}

export class SB1File {
  constructor() {
    throw new ValidationError('Scratch 1 projects are not supported by Scratch AI Bridge')
  }
}
