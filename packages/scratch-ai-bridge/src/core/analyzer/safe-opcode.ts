import { CANONICAL_OPCODES, CORE_PROCEDURE_GRAPH_OPCODES } from '../capabilities'
import { SCRATCH_EXTENSION_CATALOG } from '../extensions/catalog'

const knownOpcodes = new Set<string>([
  ...CANONICAL_OPCODES,
  ...CORE_PROCEDURE_GRAPH_OPCODES,
  ...SCRATCH_EXTENSION_CATALOG.map(({ opcode }) => opcode),
  'asset-costume',
  'asset-sound',
  'variable-declaration',
  'monitor-declaration',
  'extension-declaration',
])

/**
 * Keep arbitrary project-supplied opcode strings out of shared reports.
 * @param opcode Project-supplied opcode.
 * @returns A known opcode or a generic placeholder.
 */
export const safeOpcode = (opcode: string): string => (knownOpcodes.has(opcode) ? opcode : 'unknown-extension')
