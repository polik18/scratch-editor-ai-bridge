const FORMAT = 'scratch-ai-bridge/canonical-ir'
const VERSION = 1
const MAX_BLOCK_NESTING = 800

const VERIFIED_OPCODES = new Set([
  'event_whenflagclicked', 'event_broadcast', 'event_broadcastandwait', 'event_whenbroadcastreceived',
  'motion_movesteps', 'looks_say', 'control_wait', 'control_repeat', 'control_forever', 'control_if', 'control_if_else',
  'data_setvariableto', 'data_changevariableby', 'data_showvariable', 'data_hidevariable',
  'data_addtolist', 'data_deleteoflist', 'data_deletealloflist', 'data_insertatlist', 'data_replaceitemoflist',
  'data_itemoflist', 'data_itemnumoflist', 'data_lengthoflist', 'data_listcontainsitem', 'data_showlist', 'data_hidelist',
  'procedures_call', 'argument_reporter_string_number', 'argument_reporter_boolean',
])

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const bytesFrom = value => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return textEncoder.encode(value)
  throw new TypeError('Unsupported byte source')
}

const concatBytes = parts => {
  const arrays = parts.map(bytesFrom)
  const total = arrays.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of arrays) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = data => {
  const bytes = bytesFrom(data)
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear())
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f)
  const day = date.getDate() & 0x1f
  const month = (date.getMonth() + 1) & 0x0f
  const dosDate = (((year - 1980) & 0x7f) << 9) | (month << 5) | day
  return { time, date: dosDate }
}

const header = size => {
  const bytes = new Uint8Array(size)
  return { bytes, view: new DataView(bytes.buffer) }
}

const createZip = entries => {
  const localParts = []
  const centralParts = []
  let localOffset = 0
  const { time, date } = dosDateTime()

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name)
    const data = bytesFrom(entry.data)
    const crc = crc32(data)

    const local = header(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, 20, true)
    local.view.setUint16(6, 0x0800, true)
    local.view.setUint16(8, 0, true)
    local.view.setUint16(10, time, true)
    local.view.setUint16(12, date, true)
    local.view.setUint32(14, crc, true)
    local.view.setUint32(18, data.byteLength, true)
    local.view.setUint32(22, data.byteLength, true)
    local.view.setUint16(26, nameBytes.byteLength, true)
    local.view.setUint16(28, 0, true)
    localParts.push(local.bytes, nameBytes, data)

    const central = header(46)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, 20, true)
    central.view.setUint16(6, 20, true)
    central.view.setUint16(8, 0x0800, true)
    central.view.setUint16(10, 0, true)
    central.view.setUint16(12, time, true)
    central.view.setUint16(14, date, true)
    central.view.setUint32(16, crc, true)
    central.view.setUint32(20, data.byteLength, true)
    central.view.setUint32(24, data.byteLength, true)
    central.view.setUint16(28, nameBytes.byteLength, true)
    central.view.setUint16(30, 0, true)
    central.view.setUint16(32, 0, true)
    central.view.setUint16(34, 0, true)
    central.view.setUint16(36, 0, true)
    central.view.setUint32(38, 0, true)
    central.view.setUint32(42, localOffset, true)
    centralParts.push(central.bytes, nameBytes)

    localOffset += 30 + nameBytes.byteLength + data.byteLength
  }

  const centralBytes = concatBytes(centralParts)
  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(4, 0, true)
  end.view.setUint16(6, 0, true)
  end.view.setUint16(8, entries.length, true)
  end.view.setUint16(10, entries.length, true)
  end.view.setUint32(12, centralBytes.byteLength, true)
  end.view.setUint32(16, localOffset, true)
  end.view.setUint16(20, 0, true)

  return concatBytes([...localParts, centralBytes, end.bytes])
}

const findEndOfCentralDirectory = bytes => {
  const min = Math.max(0, bytes.byteLength - 65557)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = bytes.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  throw new Error('找不到 ZIP central directory；檔案可能不是有效的 .sb3')
}

const inflateRaw = async compressed => {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('這個瀏覽器不支援 Deflate 解壓縮，請改用最新版 Chrome / Edge / Firefox。')
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const readZip = async input => {
  const bytes = bytesFrom(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(bytes)
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const files = new Map()

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP central directory 已損壞')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const name = new TextDecoder((flags & 0x0800) ? 'utf-8' : 'utf-8').decode(nameBytes)

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error(`ZIP local header 已損壞：${name}`)
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize)
    let data
    if (method === 0) data = compressed.slice()
    else if (method === 8) data = await inflateRaw(compressed)
    else throw new Error(`不支援 ZIP 壓縮格式 ${method}（${name}）`)

    if (uncompressedSize !== data.byteLength) throw new Error(`ZIP 檔案大小不一致：${name}`)
    files.set(name, data)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

const issue = (path, message) => ({ path, message })
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isScalar = value => ['string', 'number', 'boolean'].includes(typeof value)

const validateCanonicalProject = input => {
  const errors = []
  const warnings = []
  if (!isObject(input)) return { valid: false, errors: [issue('$', '最外層必須是 JSON object')], warnings }
  if (input.format !== FORMAT) errors.push(issue('$.format', `必須是 ${FORMAT}`))
  if (input.version !== VERSION) errors.push(issue('$.version', `目前只支援 version ${VERSION}`))
  if (typeof input.name !== 'string' || !input.name.trim()) errors.push(issue('$.name', '專案名稱不可空白'))
  if (!isObject(input.stage) || input.stage.kind !== 'stage') errors.push(issue('$.stage', '缺少合法 Stage'))
  if (!Array.isArray(input.sprites)) errors.push(issue('$.sprites', 'sprites 必須是陣列'))
  if (!Array.isArray(input.broadcasts)) errors.push(issue('$.broadcasts', 'broadcasts 必須是陣列'))
  if (input.monitors !== undefined && !Array.isArray(input.monitors)) errors.push(issue('$.monitors', 'monitors 必須是陣列'))
  if (input.extensions !== undefined && !Array.isArray(input.extensions)) errors.push(issue('$.extensions', 'extensions 必須是陣列'))

  // Iterative depth guard: avoid browser call-stack crashes on pathological nested reporters/C-blocks.
  const depthStack = []
  const addTargetRoots = (target, basePath) => {
    if (!isObject(target)) return
    ;(target.scripts || []).forEach((script, si) => (script?.blocks || []).forEach((block, bi) => depthStack.push({ block, path: `${basePath}.scripts[${si}].blocks[${bi}]`, depth: 1 })))
    ;(target.procedures || []).forEach((proc, pi) => (proc?.body || []).forEach((block, bi) => depthStack.push({ block, path: `${basePath}.procedures[${pi}].body[${bi}]`, depth: 1 })))
  }
  addTargetRoots(input.stage, '$.stage')
  ;(input.sprites || []).forEach((sprite, i) => addTargetRoots(sprite, `$.sprites[${i}]`))
  let depthNodes = 0
  while (depthStack.length) {
    const { block, path, depth } = depthStack.pop()
    if (!isObject(block)) continue
    depthNodes += 1
    if (depthNodes > 500000) {
      errors.push(issue(path.length > 220 ? `${path.slice(0, 180)}…` : path, '專案積木節點超過 500,000 個安全上限'))
      break
    }
    if (depth > MAX_BLOCK_NESTING) {
      errors.push(issue(path.length > 220 ? `${path.slice(0, 180)}…(depth ${depth})` : path, `積木巢狀超過安全上限 ${MAX_BLOCK_NESTING} 層；為避免瀏覽器 stack overflow，請拆開過深的巢狀結構`))
      break
    }
    for (const [name, value] of Object.entries(block.inputs || {})) {
      if (value?.type === 'block' && value.block) depthStack.push({ block: value.block, path: `${path}.inputs.${name}.block`, depth: depth + 1 })
      else if (value?.type === 'stack') (value.blocks || []).forEach((child, i) => depthStack.push({ block: child, path: `${path}.inputs.${name}.blocks[${i}]`, depth: depth + 1 }))
      if (value?.shadow?.type === 'block' && value.shadow.block) depthStack.push({ block: value.shadow.block, path: `${path}.inputs.${name}.shadow.block`, depth: depth + 1 })
    }
  }
  if (errors.length) return { valid: false, errors, warnings }

  const checkBlock = (block, blockPath) => {
    if (!isObject(block) || typeof block.opcode !== 'string' || !block.opcode.trim()) {
      errors.push(issue(blockPath, 'block 必須有 opcode'))
      return
    }
    if (!/^[A-Za-z0-9-]+_[A-Za-z0-9_:-]+$/.test(block.opcode)) warnings.push(issue(`${blockPath}.opcode`, `opcode「${block.opcode}」格式特殊，會嘗試原樣輸出`))
    if (block.inputs !== undefined && !isObject(block.inputs)) errors.push(issue(`${blockPath}.inputs`, 'inputs 必須是 object'))
    if (block.fields !== undefined && !isObject(block.fields)) errors.push(issue(`${blockPath}.fields`, 'fields 必須是 object'))
    if (block.mutation !== undefined && !isObject(block.mutation)) errors.push(issue(`${blockPath}.mutation`, 'mutation 必須是 object'))
    if (block.shadow !== undefined && typeof block.shadow !== 'boolean') errors.push(issue(`${blockPath}.shadow`, 'shadow 必須是 boolean'))
    if (block.procedure !== undefined && typeof block.procedure !== 'string') errors.push(issue(`${blockPath}.procedure`, 'procedure 必須是字串'))
    if (isObject(block.inputs)) {
      for (const [name, value] of Object.entries(block.inputs)) {
        const p = `${blockPath}.inputs.${name}`
        if (!isObject(value) || typeof value.type !== 'string') { errors.push(issue(p, 'input 必須含 type')); continue }
        if (value.type === 'literal' && !isScalar(value.value)) errors.push(issue(p, 'literal 需要 string / number / boolean'))
        else if (['variable','list','broadcast'].includes(value.type) && (typeof value.name !== 'string' || !value.name)) errors.push(issue(p, `${value.type} 需要 name`))
        else if (value.type === 'block') checkBlock(value.block, `${p}.block`)
        else if (value.type === 'stack') {
          if (!Array.isArray(value.blocks)) errors.push(issue(p, 'stack 需要 blocks[]'))
          else value.blocks.forEach((child, index) => checkBlock(child, `${p}.blocks[${index}]`))
        } else if (!['literal','variable','list','broadcast','block','stack','empty'].includes(value.type)) errors.push(issue(p, `未知 input type：${value.type}`))
        if (value.shadow !== undefined) {
          if (!isObject(value.shadow) || !['literal','variable','list','broadcast','block','empty'].includes(value.shadow.type)) errors.push(issue(`${p}.shadow`, 'shadow 格式不合法'))
          else if (value.shadow.type === 'block') checkBlock(value.shadow.block, `${p}.shadow.block`)
        }
      }
    }
  }

  const validateTarget = (target, path, isStage) => {
    if (!isObject(target)) { errors.push(issue(path, 'target 必須是 object')); return }
    if (target.kind !== (isStage ? 'stage' : 'sprite')) errors.push(issue(`${path}.kind`, `必須是 ${isStage ? 'stage' : 'sprite'}`))
    if (typeof target.name !== 'string' || !target.name.trim()) errors.push(issue(`${path}.name`, '名稱不可空白'))
    for (const key of ['variables', 'lists', 'costumes', 'sounds', 'scripts', 'procedures']) {
      if (!Array.isArray(target[key])) errors.push(issue(`${path}.${key}`, `${key} 必須是陣列`))
    }
    if (!isStage) {
      for (const [key, type] of [['x','number'],['y','number'],['direction','number'],['size','number']]) {
        if (typeof target[key] !== type) errors.push(issue(`${path}.${key}`, `${key} 必須是數字`))
      }
      for (const key of ['visible','draggable']) if (typeof target[key] !== 'boolean') errors.push(issue(`${path}.${key}`, `${key} 必須是 boolean`))
    }
    ;(target.variables || []).forEach((v, i) => {
      if (!isObject(v) || typeof v.name !== 'string' || !isScalar(v.value)) errors.push(issue(`${path}.variables[${i}]`, '變數需要 name 與 scalar value'))
    })
    ;(target.lists || []).forEach((v, i) => {
      if (!isObject(v) || typeof v.name !== 'string' || !Array.isArray(v.value) || !v.value.every(isScalar)) errors.push(issue(`${path}.lists[${i}]`, '清單需要 name 與 scalar[] value'))
    })
    ;(target.scripts || []).forEach((script, i) => {
      if (!isObject(script) || !Array.isArray(script.blocks) || script.blocks.length === 0) errors.push(issue(`${path}.scripts[${i}]`, 'script 需要至少一個 block'))
      else script.blocks.forEach((block, j) => checkBlock(block, `${path}.scripts[${i}].blocks[${j}]`))
    })
    ;(target.procedures || []).forEach((proc, i) => {
      const pp = `${path}.procedures[${i}]`
      if (!isObject(proc)) { errors.push(issue(pp, 'procedure 必須是 object')); return }
      if (typeof (proc.proccode || proc.name) !== 'string' || !(proc.proccode || proc.name).trim()) errors.push(issue(`${pp}.proccode`, 'procedure 需要 proccode 或 name'))
      if (proc.parameters !== undefined && !Array.isArray(proc.parameters)) errors.push(issue(`${pp}.parameters`, 'parameters 必須是陣列'))
      ;(proc.parameters || []).forEach((arg, ai) => {
        if (!isObject(arg) || typeof arg.name !== 'string' || !arg.name) errors.push(issue(`${pp}.parameters[${ai}]`, '參數需要 name'))
        if (arg?.type !== undefined && !['string_number','boolean'].includes(arg.type)) errors.push(issue(`${pp}.parameters[${ai}].type`, 'type 必須是 string_number 或 boolean'))
      })
      if (!Array.isArray(proc.body)) errors.push(issue(`${pp}.body`, 'procedure 需要 body[]'))
      else proc.body.forEach((block, bi) => checkBlock(block, `${pp}.body[${bi}]`))
    })
  }

  if (isObject(input.stage)) validateTarget(input.stage, '$.stage', true)
  if (Array.isArray(input.sprites)) input.sprites.forEach((sprite, i) => validateTarget(sprite, `$.sprites[${i}]`, false))
  if (Array.isArray(input.broadcasts)) input.broadcasts.forEach((b, i) => {
    if (!isObject(b) || typeof b.name !== 'string' || !b.name) errors.push(issue(`$.broadcasts[${i}]`, 'broadcast 需要 name'))
  })
  return { valid: errors.length === 0, errors, warnings, data: errors.length === 0 ? input : undefined }
}

const hashId = text => {
  let h1 = 0x811c9dc5
  for (const ch of String(text)) {
    h1 ^= ch.codePointAt(0)
    h1 = Math.imul(h1, 0x01000193)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0')
}
const makeId = text => `sab_${hashId(text)}_${hashId(`x:${text}`)}`

const DEFAULT_BACKDROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#ffffff"/></svg>`
const DEFAULT_SPRITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#4c97ff"/><circle cx="36" cy="42" r="5" fill="#fff"/><circle cx="64" cy="42" r="5" fill="#fff"/><path d="M30 62 Q50 78 70 62" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`
const DEFAULT_SILENCE_WAV = Uint8Array.from([
  82,73,70,70,38,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,68,172,0,0,136,88,1,0,2,0,16,0,100,97,116,97,2,0,0,0,0,0,
])
const DEFAULT_BACKDROP_ID = 'sab00000000000000000000000000001'
const DEFAULT_SPRITE_ID = 'sab00000000000000000000000000002'
const DEFAULT_SOUND_ID = 'sab00000000000000000000000000003'

const decodeAssetData = data => {
  if (typeof data !== 'string' || !data) return null
  if (data.startsWith('data:')) {
    const comma = data.indexOf(',')
    if (comma < 0) return null
    const header = data.slice(0, comma)
    const body = data.slice(comma + 1)
    if (/;base64/i.test(header)) {
      const binary = atob(body)
      return Uint8Array.from(binary, ch => ch.charCodeAt(0))
    }
    return textEncoder.encode(decodeURIComponent(body))
  }
  try {
    const binary = atob(data.replace(/\s/g, ''))
    return Uint8Array.from(binary, ch => ch.charCodeAt(0))
  } catch {
    return textEncoder.encode(data)
  }
}

const encodeAssetData = input => {
  const bytes = bytesFrom(input)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

const safeJsonParseArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback } catch { return fallback }
}

const cloneJson = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

const literalShadow = (value, inputName = '') => {
  if (typeof value === 'number') return [4, String(value)]
  if (typeof value === 'boolean') return [10, value ? 'true' : 'false']
  if (/COLOR/i.test(inputName) && /^#[0-9a-f]{6}$/i.test(String(value))) return [9, String(value)]
  return [10, String(value)]
}

const normalizeRotation = value => ['all around','left-right',"don't rotate"].includes(value) ? value : 'all around'

const makeAsset = (asset, role, index, warnings) => {
  const isStage = role === 'stage'
  const format = String(asset?.dataFormat || 'svg').toLowerCase()
  const supplied = decodeAssetData(asset?.data)
  let bytes = supplied
  let safeFormat = format
  let id = asset?.assetId ? String(asset.assetId) : ''
  let fileName = asset?.md5ext ? String(asset.md5ext) : ''
  if (!bytes) {
    safeFormat = 'svg'
    bytes = textEncoder.encode(isStage ? DEFAULT_BACKDROP_SVG : DEFAULT_SPRITE_SVG)
    id = isStage ? DEFAULT_BACKDROP_ID : DEFAULT_SPRITE_ID
    fileName = `${id}.${safeFormat}`
    if (asset?.name || asset?.md5ext) warnings.push(`素材「${asset?.name || fileName}」沒有內嵌 data，已使用內建${isStage ? '空白背景' : '角色圖'}代替。`)
  } else {
    if (!id) id = makeId(`asset:${role}:${index}:${bytes.byteLength}:${asset?.name || ''}`).replace(/^sab_/, '').slice(0, 32).padEnd(32, '0')
    if (!fileName) fileName = `${id}.${safeFormat}`
  }
  return {
    descriptor: {
      assetId: id,
      name: asset?.name || (isStage ? `backdrop${index + 1}` : `costume${index + 1}`),
      bitmapResolution: asset?.bitmapResolution || 1,
      md5ext: fileName,
      dataFormat: safeFormat,
      rotationCenterX: Number.isFinite(asset?.rotationCenterX) ? asset.rotationCenterX : (isStage ? 240 : 50),
      rotationCenterY: Number.isFinite(asset?.rotationCenterY) ? asset.rotationCenterY : (isStage ? 180 : 50),
    },
    file: { name: fileName, data: bytes },
  }
}

const makeSound = (sound, index, warnings) => {
  let bytes = decodeAssetData(sound?.data)
  let format = String(sound?.dataFormat || 'wav').toLowerCase()
  let id = sound?.assetId ? String(sound.assetId) : ''
  let fileName = sound?.md5ext ? String(sound.md5ext) : ''
  if (!bytes) {
    bytes = DEFAULT_SILENCE_WAV
    format = 'wav'
    id = DEFAULT_SOUND_ID
    fileName = `${id}.${format}`
    warnings.push(`音效「${sound?.name || `sound${index + 1}`}」沒有內嵌 data，已使用極短靜音 WAV 代替。`)
  } else {
    if (!id) id = makeId(`sound:${index}:${bytes.byteLength}:${sound?.name || ''}`).replace(/^sab_/, '').slice(0, 32).padEnd(32, '0')
    if (!fileName) fileName = `${id}.${format}`
  }
  return {
    descriptor: {
      assetId: id,
      name: sound?.name || `sound${index + 1}`,
      dataFormat: format,
      format: sound?.format || '',
      rate: sound?.rate || 44100,
      sampleCount: sound?.sampleCount || 1,
      md5ext: fileName,
    },
    file: { name: fileName, data: bytes },
  }
}

const uniqueEntries = entries => {
  const map = new Map()
  for (const entry of entries) if (!map.has(entry.name)) map.set(entry.name, entry)
  return [...map.values()]
}

const CORE_PREFIXES = new Set(['event','motion','looks','sound','control','sensing','operator','data','procedures','argument','math'])

const inferExtensions = targets => {
  const found = new Set()
  const visitBlock = block => {
    if (!block || typeof block.opcode !== 'string') return
    const prefix = block.opcode.split('_')[0]
    if (prefix && !CORE_PREFIXES.has(prefix)) found.add(prefix.replace(/[^\w-]/g, '-'))
    for (const input of Object.values(block.inputs || {})) {
      if (input?.type === 'block') visitBlock(input.block)
      else if (input?.type === 'stack') input.blocks?.forEach(visitBlock)
    }
  }
  for (const target of targets) {
    target.scripts?.forEach(s => s.blocks?.forEach(visitBlock))
    target.procedures?.forEach(p => p.body?.forEach(visitBlock))
  }
  return found
}

const normalizeProcedure = (proc, index) => {
  const proccode = String(proc?.proccode || proc?.name || `procedure ${index + 1}`)
  const placeholders = [...proccode.matchAll(/%([snb])/g)].map(m => m[1])
  const parameters = (proc?.parameters || []).map((arg, i) => ({
    id: `arg${i}`,
    name: String(arg?.name || `arg${i + 1}`),
    type: arg?.type || (placeholders[i] === 'b' ? 'boolean' : 'string_number'),
    default: arg?.default ?? (placeholders[i] === 'b' ? false : ''),
  }))
  while (parameters.length < placeholders.length) {
    const i = parameters.length
    parameters.push({ id: `arg${i}`, name: `arg${i + 1}`, type: placeholders[i] === 'b' ? 'boolean' : 'string_number', default: placeholders[i] === 'b' ? false : '' })
  }
  return { ...proc, proccode, parameters, warp: Boolean(proc?.warp), body: Array.isArray(proc?.body) ? proc.body : [] }
}

const compileProject = canonical => {
  const validation = validateCanonicalProject(canonical)
  if (!validation.valid) {
    const message = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n')
    throw new Error(`Canonical IR 驗證失敗：\n${message}`)
  }
  const warnings = validation.warnings.map(w => `${w.path}: ${w.message}`)
  const assetFiles = []
  const broadcastIds = new Map()
  for (const b of canonical.broadcasts || []) broadcastIds.set(b.name, makeId(`broadcast:${b.name}`))

  const stageVars = new Map((canonical.stage.variables || []).map(v => [v.name, makeId(`stage:var:${v.name}`)]))
  const stageLists = new Map((canonical.stage.lists || []).map(v => [v.name, makeId(`stage:list:${v.name}`)]))
  const targetMaps = new Map()

  const compileTarget = (target, targetIndex, isStage) => {
    const variableIds = new Map()
    const listIds = new Map()
    for (const v of target.variables || []) variableIds.set(v.name, makeId(`${isStage ? 'stage' : target.name}:var:${v.name}`))
    for (const l of target.lists || []) listIds.set(l.name, makeId(`${isStage ? 'stage' : target.name}:list:${l.name}`))
    targetMaps.set(target.name, { variableIds, listIds, isStage })

    const resolveVariable = name => variableIds.get(name) || stageVars.get(name) || makeId(`unresolved:var:${name}`)
    const resolveList = name => listIds.get(name) || stageLists.get(name) || makeId(`unresolved:list:${name}`)
    const resolveBroadcast = name => {
      if (!broadcastIds.has(name)) broadcastIds.set(name, makeId(`broadcast:${name}`))
      return broadcastIds.get(name)
    }

    const procedures = (target.procedures || []).map(normalizeProcedure)
    const procedureRegistry = new Map(procedures.map(p => [p.proccode, p]))
    const blocks = {}
    let blockCounter = 0
    const nextBlockId = () => `sab_${targetIndex}_${(++blockCounter).toString(36)}`

    const convertFields = canonicalFields => {
      const fields = {}
      for (const [name, value] of Object.entries(canonicalFields || {})) {
        const str = String(value)
        if (name === 'VARIABLE') fields[name] = [str, resolveVariable(str)]
        else if (name === 'LIST') fields[name] = [str, resolveList(str)]
        else if (name === 'BROADCAST_OPTION') fields[name] = [str, resolveBroadcast(str)]
        else fields[name] = [str]
      }
      return fields
    }

    const mutationFor = canonicalBlock => {
      if (canonicalBlock.opcode === 'procedures_call') {
        const code = canonicalBlock.procedure || canonicalBlock.mutation?.proccode || ''
        const proc = procedureRegistry.get(code)
        const argIds = proc?.parameters.map((_, i) => `arg${i}`) || safeJsonParseArray(canonicalBlock.mutation?.argumentids, Object.keys(canonicalBlock.inputs || {}))
        return { tagName: 'mutation', children: [], ...(cloneJson(canonicalBlock.mutation) || {}), proccode: code, argumentids: JSON.stringify(argIds) }
      }
      return cloneJson(canonicalBlock.mutation)
    }

    const compileReporter = (canonicalBlock, parentId, forceShadow = false) => {
      const id = nextBlockId()
      const scratchBlock = {
        opcode: canonicalBlock.opcode,
        next: null,
        parent: parentId,
        inputs: {},
        fields: convertFields(canonicalBlock.fields),
        shadow: forceShadow || canonicalBlock.shadow === true,
        topLevel: false,
      }
      const mutation = mutationFor(canonicalBlock)
      if (mutation) scratchBlock.mutation = mutation
      blocks[id] = scratchBlock
      scratchBlock.inputs = convertInputs(canonicalBlock.inputs, id, canonicalBlock)
      return id
    }

    const boolReporter = (value, parentId) => {
      const id = nextBlockId()
      blocks[id] = {
        opcode: 'operator_equals', next: null, parent: parentId,
        inputs: { OPERAND1: [1, [10, '1']], OPERAND2: [1, [10, value ? '1' : '0']] },
        fields: {}, shadow: false, topLevel: false,
      }
      return id
    }

    const encodeShadow = (shadow, inputName, parentId) => {
      if (!shadow || shadow.type === 'empty') return null
      if (shadow.type === 'literal') return literalShadow(shadow.value, inputName)
      if (shadow.type === 'variable') return [12, shadow.name, resolveVariable(shadow.name)]
      if (shadow.type === 'list') return [13, shadow.name, resolveList(shadow.name)]
      if (shadow.type === 'broadcast') return [11, shadow.name, resolveBroadcast(shadow.name)]
      if (shadow.type === 'block' && shadow.block) return compileReporter(shadow.block, parentId, true)
      return null
    }

    const convertInput = (input, inputName, parentId, ownerBlock) => {
      if (!input) return undefined
      if (input.type === 'empty') return [2, null]
      if (input.type === 'literal') {
        if (typeof input.value === 'boolean') {
          const proc = ownerBlock?.opcode === 'procedures_call' ? procedureRegistry.get(ownerBlock.procedure || ownerBlock.mutation?.proccode || '') : null
          const argIndex = /^arg(\d+)$/.exec(inputName)?.[1]
          const booleanProcedureArg = argIndex !== undefined && proc?.parameters?.[Number(argIndex)]?.type === 'boolean'
          if (booleanProcedureArg || /CONDITION|OPERAND/i.test(inputName)) return [2, boolReporter(input.value, parentId)]
        }
        return [1, literalShadow(input.value, inputName)]
      }
      if (input.type === 'variable') return [3, [12, input.name, resolveVariable(input.name)], literalShadow('', inputName)]
      if (input.type === 'list') return [3, [13, input.name, resolveList(input.name)], literalShadow('', inputName)]
      if (input.type === 'broadcast') return [1, [11, input.name, resolveBroadcast(input.name)]]
      if (input.type === 'block') {
        const active = compileReporter(input.block, parentId)
        const shadow = encodeShadow(input.shadow, inputName, parentId)
        return shadow ? [3, active, shadow] : [2, active]
      }
      if (input.type === 'stack') {
        const first = compileStack(input.blocks || [], parentId, false)
        return first ? [2, first] : [2, null]
      }
      return undefined
    }

    const convertInputs = (canonicalInputs, parentId, ownerBlock) => {
      const inputs = {}
      for (const [name, input] of Object.entries(canonicalInputs || {})) {
        const value = convertInput(input, name, parentId, ownerBlock)
        if (value) inputs[name] = value
      }
      return inputs
    }

    const compileStack = (canonicalBlocks, initialParent, topLevel, position) => {
      if (!canonicalBlocks?.length) return null
      const ids = canonicalBlocks.map(() => nextBlockId())
      canonicalBlocks.forEach((canonicalBlock, index) => {
        const id = ids[index]
        const parent = index === 0 ? initialParent : ids[index - 1]
        const scratchBlock = {
          opcode: canonicalBlock.opcode,
          next: ids[index + 1] || null,
          parent: parent || null,
          inputs: {},
          fields: convertFields(canonicalBlock.fields),
          shadow: canonicalBlock.shadow === true,
          topLevel: topLevel && index === 0,
        }
        const mutation = mutationFor(canonicalBlock)
        if (mutation) scratchBlock.mutation = mutation
        if (topLevel && index === 0) {
          scratchBlock.x = Number.isFinite(position?.x) ? position.x : 60 + ((blockCounter * 23) % 180)
          scratchBlock.y = Number.isFinite(position?.y) ? position.y : 60 + ((blockCounter * 31) % 240)
        }
        blocks[id] = scratchBlock
      })
      canonicalBlocks.forEach((canonicalBlock, index) => {
        blocks[ids[index]].inputs = convertInputs(canonicalBlock.inputs, ids[index], canonicalBlock)
      })
      return ids[0]
    }

    for (const script of target.scripts || []) compileStack(script.blocks, null, true, script.position)

    procedures.forEach((proc, procIndex) => {
      const defId = nextBlockId()
      const protoId = nextBlockId()
      const argIds = proc.parameters.map((_, i) => `arg${i}`)
      const argNames = proc.parameters.map(p => p.name)
      const argDefaults = proc.parameters.map(p => p.default ?? (p.type === 'boolean' ? false : ''))
      const pos = proc.position || { x: 340 + (procIndex % 3) * 220, y: 60 + Math.floor(procIndex / 3) * 220 }
      blocks[defId] = {
        opcode: 'procedures_definition', next: null, parent: null,
        inputs: { custom_block: [2, protoId] }, fields: {}, shadow: false, topLevel: true,
        x: Number(pos.x) || 0, y: Number(pos.y) || 0,
      }
      blocks[protoId] = {
        opcode: 'procedures_prototype', next: null, parent: defId, inputs: {}, fields: {}, shadow: false, topLevel: false,
        mutation: { tagName: 'mutation', children: [], proccode: proc.proccode, argumentids: JSON.stringify(argIds), argumentnames: JSON.stringify(argNames), argumentdefaults: JSON.stringify(argDefaults), warp: String(Boolean(proc.warp)) },
      }
      const first = compileStack(proc.body || [], defId, false)
      blocks[defId].next = first
    })

    const costumeSource = (target.costumes?.length ? target.costumes : [{}]).map((asset, i) => makeAsset(asset, isStage ? 'stage' : 'sprite', i, warnings))
    const soundSource = (target.sounds || []).map((sound, i) => makeSound(sound, i, warnings))
    assetFiles.push(...costumeSource.map(x => x.file), ...soundSource.map(x => x.file))

    const result = {
      isStage,
      name: target.name || (isStage ? 'Stage' : `Sprite${targetIndex}`),
      variables: Object.fromEntries((target.variables || []).map(v => [resolveVariable(v.name), [v.name, v.value, ...(v.cloud ? [true] : [])]])),
      lists: Object.fromEntries((target.lists || []).map(v => [resolveList(v.name), [v.name, v.value]])),
      broadcasts: isStage ? Object.fromEntries([...broadcastIds.entries()].map(([name, id]) => [id, name])) : {},
      blocks,
      comments: {},
      currentCostume: Number.isInteger(target.currentCostume) ? target.currentCostume : 0,
      costumes: costumeSource.map(x => x.descriptor),
      sounds: soundSource.map(x => x.descriptor),
      volume: Number.isFinite(target.volume) ? target.volume : 100,
      layerOrder: Number.isFinite(target.layerOrder) ? target.layerOrder : (isStage ? 0 : targetIndex),
    }
    if (isStage) Object.assign(result, {
      tempo: Number.isFinite(target.tempo) ? target.tempo : 60,
      videoTransparency: Number.isFinite(target.videoTransparency) ? target.videoTransparency : 50,
      videoState: target.videoState || 'on',
      textToSpeechLanguage: target.textToSpeechLanguage ?? null,
    })
    else Object.assign(result, {
      visible: target.visible ?? true,
      x: Number(target.x) || 0,
      y: Number(target.y) || 0,
      size: Number(target.size) || 100,
      direction: Number(target.direction) || 90,
      draggable: target.draggable ?? false,
      rotationStyle: normalizeRotation(target.rotationStyle),
    })
    return result
  }

  const stage = compileTarget(canonical.stage, 0, true)
  const sprites = (canonical.sprites || []).map((sprite, index) => compileTarget(sprite, index + 1, false))
  stage.broadcasts = Object.fromEntries([...broadcastIds.entries()].map(([name, id]) => [id, name]))

  const resolveMonitorId = monitor => {
    const targetName = monitor.spriteName || monitor.target || 'Stage'
    const maps = targetMaps.get(targetName) || targetMaps.get('Stage')
    if (monitor.opcode === 'data_variable') {
      const name = monitor.variable || monitor.params?.VARIABLE || ''
      return maps?.variableIds.get(name) || stageVars.get(name) || makeId(`monitor:var:${targetName}:${name}`)
    }
    if (monitor.opcode === 'data_listcontents') {
      const name = monitor.list || monitor.params?.LIST || ''
      return maps?.listIds.get(name) || stageLists.get(name) || makeId(`monitor:list:${targetName}:${name}`)
    }
    return makeId(`monitor:${monitor.opcode || 'unknown'}:${targetName}:${JSON.stringify(monitor.params || {})}`)
  }
  const monitors = (canonical.monitors || []).map(m => {
    const out = cloneJson(m) || {}
    delete out.target; delete out.variable; delete out.list
    out.id = resolveMonitorId(m)
    out.params = cloneJson(m.params || {})
    if (m.variable) out.params.VARIABLE = m.variable
    if (m.list) out.params.LIST = m.list
    out.spriteName = m.spriteName || (m.target && m.target !== 'Stage' ? m.target : null)
    if (!out.mode) out.mode = m.opcode === 'data_listcontents' ? 'list' : 'default'
    if (out.visible === undefined) out.visible = true
    return out
  })

  const inferred = inferExtensions([canonical.stage, ...(canonical.sprites || [])])
  const extensions = [...new Set([...(canonical.extensions || []), ...inferred])]
  const project = {
    targets: [stage, ...sprites],
    monitors,
    extensions,
    meta: { semver: '3.0.0', vm: 'scratch-ai-bridge-2.0.0', agent: 'Scratch AI Bridge standalone', ...(canonical.meta?.origin ? { origin: canonical.meta.origin } : {}) },
  }
  const entries = [{ name: 'project.json', data: JSON.stringify(project) }, ...uniqueEntries(assetFiles)]
  return { project, sb3: createZip(entries), warnings }
}

const primitiveToCanonical = primitive => {
  if (!Array.isArray(primitive)) return { type: 'empty' }
  const code = primitive[0]
  if (code === 12) return { type: 'variable', name: String(primitive[1] ?? '') }
  if (code === 13) return { type: 'list', name: String(primitive[1] ?? '') }
  if (code === 11) return { type: 'broadcast', name: String(primitive[1] ?? '') }
  if ([4,5,6,7,8].includes(code)) {
    const num = Number(primitive[1])
    return { type: 'literal', value: Number.isNaN(num) ? String(primitive[1] ?? '') : num }
  }
  return { type: 'literal', value: primitive[1] ?? '' }
}

const fieldValue = field => Array.isArray(field) ? field[0] : field

const procedureTypesFromCode = code => [...String(code || '').matchAll(/%([snb])/g)].map(m => m[1] === 'b' ? 'boolean' : 'string_number')

const decompileProjectJson = (project, files = new Map(), mapping = []) => {
  if (!isObject(project) || !Array.isArray(project.targets)) throw new Error('project.json 缺少 targets')
  const originals = project.targets.filter(t => t.isOriginal !== false)
  const stageRaw = originals.find(t => t.isStage) || originals[0]
  if (!stageRaw) throw new Error('找不到 Stage')
  const broadcastNames = Object.values(stageRaw.broadcasts || {}).map(String)

  const targetResults = originals.map((raw, targetOriginalIndex) => {
    const rawBlocks = raw.blocks || {}
    const targetPath = raw.isStage ? 'stage' : `sprites[${originals.filter(t => !t.isStage).indexOf(raw)}]`
    const rawDepthStack = Object.entries(rawBlocks).filter(([, b]) => b && !Array.isArray(b) && b.topLevel).map(([id]) => ({ id, depth: 1 }))
    const rawDepthSeen = new Set()
    while (rawDepthStack.length) {
      const item = rawDepthStack.pop()
      if (!item?.id || rawDepthSeen.has(item.id)) continue
      rawDepthSeen.add(item.id)
      if (item.depth > MAX_BLOCK_NESTING) throw new Error(`角色「${raw.name || 'Stage'}」的積木巢狀超過安全上限 ${MAX_BLOCK_NESTING} 層；已停止解析以避免瀏覽器 stack overflow。`)
      const block = rawBlocks[item.id]
      if (!block || Array.isArray(block)) continue
      if (block.next) rawDepthStack.push({ id: block.next, depth: item.depth })
      for (const encoded of Object.values(block.inputs || {})) {
        if (!Array.isArray(encoded)) continue
        for (let i = 1; i < encoded.length; i++) if (typeof encoded[i] === 'string') rawDepthStack.push({ id: encoded[i], depth: item.depth + 1 })
      }
    }
    const procRegistry = new Map()
    for (const [id, block] of Object.entries(rawBlocks)) {
      if (block?.opcode !== 'procedures_prototype') continue
      const mutation = block.mutation || {}
      const code = String(mutation.proccode || '')
      if (!code) continue
      const names = safeJsonParseArray(mutation.argumentnames)
      const ids = safeJsonParseArray(mutation.argumentids, names.map((_, i) => `arg${i}`))
      const defaults = safeJsonParseArray(mutation.argumentdefaults)
      const types = procedureTypesFromCode(code)
      procRegistry.set(code, { protoId: id, names, ids, defaults, types, warp: mutation.warp === true || mutation.warp === 'true' })
    }

    const mapPush = (path, id, source) => {
      if (!path || !id || !source || Array.isArray(source)) return
      mapping.push({ irPath: path, blockId: id, target: raw.name || (raw.isStage ? 'Stage' : 'Sprite'), opcode: source.opcode })
    }

    const decodeShadow = (encoded, parentPath, seen) => {
      if (encoded === null || encoded === undefined) return undefined
      if (Array.isArray(encoded)) return primitiveToCanonical(encoded)
      if (typeof encoded === 'string' && rawBlocks[encoded]) {
        const child = decodeBlock(encoded, `${parentPath}.block`, new Set(seen))
        return child ? { type: 'block', block: child } : undefined
      }
      return undefined
    }

    const decodeBlock = (id, path, seen = new Set()) => {
      if (!id || !rawBlocks[id] || seen.has(id)) return null
      const source = rawBlocks[id]
      if (Array.isArray(source)) return null
      seen.add(id)
      mapPush(path, id, source)
      const block = { opcode: source.opcode }
      if (source.shadow) block.shadow = true
      if (source.mutation && source.opcode !== 'procedures_call') block.mutation = cloneJson(source.mutation)
      const fields = {}
      for (const [name, value] of Object.entries(source.fields || {})) fields[name] = fieldValue(value)
      if (Object.keys(fields).length) block.fields = fields
      if (source.opcode === 'procedures_call') {
        const code = String(source.mutation?.proccode || '')
        block.procedure = code
        const ids = safeJsonParseArray(source.mutation?.argumentids)
        const inputs = {}
        const entries = Object.entries(source.inputs || {})
        entries.forEach(([rawName, encoded], index) => {
          const argIndex = ids.indexOf(rawName)
          const canonicalName = `arg${argIndex >= 0 ? argIndex : index}`
          let decoded = decodeInput(encoded, canonicalName, `${path}.inputs.${canonicalName}`, seen)
          const procInfo = procRegistry.get(code)
          const expectedType = procInfo?.types?.[argIndex >= 0 ? argIndex : index]
          if (expectedType === 'boolean' && decoded?.type === 'block' && decoded.block?.opcode === 'operator_equals') {
            const a = decoded.block.inputs?.OPERAND1
            const b = decoded.block.inputs?.OPERAND2
            if (a?.type === 'literal' && b?.type === 'literal' && String(a.value) === '1' && ['0','1'].includes(String(b.value))) decoded = { type: 'literal', value: String(b.value) === '1' }
          }
          if (decoded) inputs[canonicalName] = decoded
        })
        if (Object.keys(inputs).length) block.inputs = inputs
        return block
      }
      const inputs = {}
      for (const [name, encoded] of Object.entries(source.inputs || {})) {
        const decoded = decodeInput(encoded, name, `${path}.inputs.${name}`, seen)
        if (decoded) inputs[name] = decoded
      }
      if (Object.keys(inputs).length) block.inputs = inputs
      return block
    }

    const decodeInput = (encoded, name, path, seen) => {
      if (!Array.isArray(encoded)) return undefined
      const kind = encoded[0]
      const active = encoded[1]
      if (/^SUBSTACK/.test(name)) {
        const firstId = typeof active === 'string' ? active : null
        return { type: 'stack', blocks: firstId ? decodeChain(firstId, `${path}.blocks`, new Set(seen)) : [] }
      }
      if (typeof active === 'string') {
        const child = decodeBlock(active, `${path}.block`, new Set(seen))
        if (!child) return { type: 'empty' }
        const out = { type: 'block', block: child }
        if (kind === 3 && encoded.length > 2) {
          const shadowDecoded = decodeShadow(encoded[2], `${path}.shadow`, seen)
          if (shadowDecoded) out.shadow = shadowDecoded
        }
        return out
      }
      if (Array.isArray(active)) return primitiveToCanonical(active)
      if (kind === 3 && Array.isArray(encoded[2])) return primitiveToCanonical(encoded[2])
      return { type: 'empty' }
    }

    const decodeChain = (firstId, basePath, seen = new Set()) => {
      const out = []
      let id = firstId
      let i = 0
      while (id && rawBlocks[id] && !seen.has(id)) {
        const b = decodeBlock(id, `${basePath}[${i}]`, new Set(seen))
        if (b) out.push(b)
        seen.add(id)
        const rawBlock = rawBlocks[id]
        id = !Array.isArray(rawBlock) ? rawBlock.next : null
        i += 1
        if (i > 200000) throw new Error('積木鏈超過安全上限，可能存在循環引用')
      }
      return out
    }

    const top = Object.entries(rawBlocks)
      .filter(([, b]) => b && !Array.isArray(b) && b.topLevel)
      .sort((a, b) => ((a[1].y ?? 0) - (b[1].y ?? 0)) || ((a[1].x ?? 0) - (b[1].x ?? 0)))

    const procedures = []
    const scripts = []
    for (const [id, b] of top) {
      if (b.opcode === 'procedures_definition') {
        const encodedProto = b.inputs?.custom_block
        const protoId = Array.isArray(encodedProto) && typeof encodedProto[1] === 'string' ? encodedProto[1] : null
        const proto = protoId ? rawBlocks[protoId] : null
        const code = String(proto?.mutation?.proccode || '')
        const info = procRegistry.get(code) || { names: [], ids: [], defaults: [], types: [], warp: false }
        const pi = procedures.length
        mapPush(`${targetPath}.procedures[${pi}]`, id, b)
        if (protoId && proto) mapPush(`${targetPath}.procedures[${pi}].prototype`, protoId, proto)
        procedures.push({
          name: code.replace(/\s*%[snb]/g, '').trim() || code,
          proccode: code,
          warp: info.warp,
          parameters: info.names.map((name, i) => ({ id: `arg${i}`, name: String(name), type: info.types[i] || 'string_number', default: info.defaults[i] ?? (info.types[i] === 'boolean' ? false : '') })),
          body: b.next ? decodeChain(b.next, `${targetPath}.procedures[${pi}].body`) : [],
          position: Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: b.x, y: b.y } : undefined,
        })
      } else {
        const si = scripts.length
        const decoded = decodeChain(id, `${targetPath}.scripts[${si}].blocks`)
        if (decoded.length) scripts.push({ blocks: decoded, position: Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: b.x, y: b.y } : undefined })
      }
    }

    const readCostume = c => {
      const fileName = c.md5ext || `${c.assetId}.${c.dataFormat}`
      const bytes = files.get(fileName)
      return {
        name: c.name, assetId: c.assetId, md5ext: fileName, dataFormat: c.dataFormat,
        ...(c.rotationCenterX !== undefined ? { rotationCenterX: c.rotationCenterX } : {}),
        ...(c.rotationCenterY !== undefined ? { rotationCenterY: c.rotationCenterY } : {}),
        ...(c.bitmapResolution !== undefined ? { bitmapResolution: c.bitmapResolution } : {}),
        ...(bytes ? { data: encodeAssetData(bytes) } : {}),
      }
    }
    const readSound = snd => {
      const fileName = snd.md5ext || `${snd.assetId}.${snd.dataFormat}`
      const bytes = files.get(fileName)
      return {
        name: snd.name, assetId: snd.assetId, md5ext: fileName, dataFormat: snd.dataFormat,
        ...(snd.format !== undefined ? { format: snd.format } : {}), ...(snd.rate ? { rate: snd.rate } : {}),
        ...(snd.sampleCount !== undefined ? { sampleCount: snd.sampleCount } : {}), ...(bytes ? { data: encodeAssetData(bytes) } : {}),
      }
    }

    const base = {
      kind: raw.isStage ? 'stage' : 'sprite',
      name: raw.name || (raw.isStage ? 'Stage' : 'Sprite'),
      variables: Object.values(raw.variables || {}).map(v => ({ name: String(v[0]), value: isScalar(v[1]) ? v[1] : String(v[1] ?? ''), ...(v[2] ? { cloud: true } : {}) })),
      lists: Object.values(raw.lists || {}).map(v => ({ name: String(v[0]), value: Array.isArray(v[1]) ? v[1].map(x => isScalar(x) ? x : String(x ?? '')) : [] })),
      costumes: (raw.costumes || []).map(readCostume),
      sounds: (raw.sounds || []).map(readSound),
      scripts, procedures,
      currentCostume: Number.isInteger(raw.currentCostume) ? raw.currentCostume : 0,
      volume: Number.isFinite(raw.volume) ? raw.volume : 100,
      layerOrder: Number.isFinite(raw.layerOrder) ? raw.layerOrder : targetOriginalIndex,
    }
    if (raw.isStage) Object.assign(base, { tempo: raw.tempo ?? 60, videoTransparency: raw.videoTransparency ?? 50, videoState: raw.videoState ?? 'on', textToSpeechLanguage: raw.textToSpeechLanguage ?? null })
    else Object.assign(base, {
      x: raw.x ?? 0, y: raw.y ?? 0, direction: raw.direction ?? 90, size: raw.size ?? 100,
      visible: raw.visible ?? true, draggable: raw.draggable ?? false, rotationStyle: normalizeRotation(raw.rotationStyle),
    })
    return base
  })

  const stage = targetResults.find(t => t.kind === 'stage') || targetResults[0]
  const sprites = targetResults.filter(t => t.kind === 'sprite')
  const monitors = (project.monitors || []).map(m => ({
    opcode: m.opcode, mode: m.mode, params: cloneJson(m.params || {}), spriteName: m.spriteName ?? null,
    ...(m.opcode === 'data_variable' ? { variable: String(m.params?.VARIABLE || '') } : {}),
    ...(m.opcode === 'data_listcontents' ? { list: String(m.params?.LIST || '') } : {}),
    value: cloneJson(m.value), width: m.width, height: m.height, x: m.x, y: m.y, visible: m.visible,
    ...(m.mode !== 'list' ? { sliderMin: m.sliderMin, sliderMax: m.sliderMax, isDiscrete: m.isDiscrete } : {}),
  }))
  return {
    format: FORMAT, version: VERSION, name: 'Imported Scratch Project', stage, sprites,
    broadcasts: broadcastNames.map(name => ({ name })), monitors, extensions: [...(project.extensions || [])],
    meta: project.meta?.origin ? { origin: project.meta.origin } : {},
  }
}

const loadSb3 = async (input, fileName = '') => {
  const files = await readZip(input)
  const projectBytes = files.get('project.json')
  if (!projectBytes) throw new Error('這個 .sb3 裡沒有 project.json')
  let project
  try { project = JSON.parse(textDecoder.decode(projectBytes)) } catch { throw new Error('project.json 不是合法 JSON') }
  const mapping = []
  const canonical = decompileProjectJson(project, files, mapping)
  if (fileName) canonical.name = String(fileName).replace(/\.sb3$/i, '') || canonical.name
  return { project, files, canonical, mapping }
}

const collectPrimitiveVariables = encoded => {
  const names = []
  const walk = value => {
    if (Array.isArray(value)) {
      if (value[0] === 12 && typeof value[1] === 'string') names.push(value[1])
      else value.forEach(walk)
    } else if (isObject(value)) Object.values(value).forEach(walk)
  }
  walk(encoded)
  return names
}

const HAT_PREFIXES = ['event_', 'control_start_as_clone']
const isHat = opcode => HAT_PREFIXES.some(prefix => opcode?.startsWith(prefix)) && !['event_broadcast','event_broadcastandwait'].includes(opcode)

const traverseChain = (rawBlocks, firstId, visit, seen = new Set()) => {
  let id = firstId
  while (id && rawBlocks[id] && !seen.has(id)) {
    seen.add(id)
    const block = rawBlocks[id]
    visit(block, id)
    for (const [name, encoded] of Object.entries(block.inputs || {})) {
      const active = Array.isArray(encoded) ? encoded[1] : null
      if ((/^SUBSTACK/.test(name) || typeof active === 'string') && typeof active === 'string') traverseChain(rawBlocks, active, visit, seen)
    }
    id = block.next
  }
}

const analyzeProject = project => {
  const targets = (project.targets || []).filter(t => t.isOriginal !== false)
  const stage = targets.find(t => t.isStage)
  const broadcastMap = stage?.broadcasts || {}
  const senders = new Map()
  const receivers = new Map()
  const diagnostics = []
  let totalBlocks = 0
  let totalVariables = 0
  let totalLists = 0
  let totalProcedures = 0
  let totalCostumes = 0
  let totalSounds = 0
  const procedureDependencies = []

  const targetSummaries = targets.map(target => {
    const blocks = target.blocks || {}
    totalBlocks += Object.keys(blocks).length
    totalVariables += Object.keys(target.variables || {}).length
    totalLists += Object.keys(target.lists || {}).length
    totalCostumes += (target.costumes || []).length
    totalSounds += (target.sounds || []).length

    const procedureDefs = new Map()
    for (const [id, block] of Object.entries(blocks)) {
      if (!block || Array.isArray(block) || block.opcode !== 'procedures_definition') continue
      const protoId = Array.isArray(block.inputs?.custom_block) ? block.inputs.custom_block[1] : null
      const proto = typeof protoId === 'string' ? blocks[protoId] : null
      const code = proto?.mutation?.proccode
      if (code) procedureDefs.set(String(code), id)
    }
    totalProcedures += procedureDefs.size
    const procedureCalls = new Map()
    const top = Object.entries(blocks).filter(([, b]) => b && !Array.isArray(b) && b.topLevel)
    const scripts = top.map(([id, first], index) => {
      const opcodes = []
      const reads = new Set()
      const writes = new Set()
      const listReads = new Set()
      const listWrites = new Set()
      const broadcasts = new Set()
      const receives = new Set()
      const calls = new Set()
      let containsYield = false
      let containsForever = false
      let foreverInitializes = false
      traverseChain(blocks, id, block => {
        opcodes.push(block.opcode)
        for (const name of collectPrimitiveVariables(block.inputs || {})) reads.add(name)
        if (['data_setvariableto','data_changevariableby'].includes(block.opcode)) {
          const name = fieldValue(block.fields?.VARIABLE)
          if (name !== undefined) writes.add(String(name))
        }
        if (['data_addtolist','data_deleteoflist','data_deletealloflist','data_insertatlist','data_replaceitemoflist'].includes(block.opcode)) {
          const name = fieldValue(block.fields?.LIST)
          if (name !== undefined) listWrites.add(String(name))
        }
        if (['data_itemoflist','data_itemnumoflist','data_lengthoflist','data_listcontainsitem','data_listcontents'].includes(block.opcode)) {
          const name = fieldValue(block.fields?.LIST)
          if (name !== undefined) listReads.add(String(name))
        }
        if (['control_wait','motion_glidesecstoxy','motion_glideto','sensing_askandwait','event_broadcastandwait'].includes(block.opcode)) containsYield = true
        if (block.opcode === 'control_forever') {
          containsForever = true
          const sub = block.inputs?.SUBSTACK?.[1]
          if (typeof sub === 'string') traverseChain(blocks, sub, child => {
            if (child.opcode === 'data_setvariableto') foreverInitializes = true
            if (['control_wait','event_broadcastandwait','sensing_askandwait'].includes(child.opcode)) containsYield = true
          }, new Set())
        }
        if (['event_broadcast','event_broadcastandwait'].includes(block.opcode)) {
          const primitive = block.inputs?.BROADCAST_INPUT?.[1]
          const name = Array.isArray(primitive) ? primitive[1] : undefined
          if (name) broadcasts.add(String(name))
        }
        if (block.opcode === 'event_whenbroadcastreceived') {
          const name = fieldValue(block.fields?.BROADCAST_OPTION)
          if (name) receives.add(String(name))
        }
        if (block.opcode === 'procedures_call') {
          const code = String(block.mutation?.proccode || '')
          if (code) {
            calls.add(code)
            if (!procedureCalls.has(code)) procedureCalls.set(code, [])
            procedureCalls.get(code).push(index + 1)
          }
        }
      })
      for (const name of broadcasts) {
        if (!senders.has(name)) senders.set(name, [])
        senders.get(name).push(`${target.name}#${index + 1}`)
      }
      for (const name of receives) {
        if (!receivers.has(name)) receivers.set(name, [])
        receivers.get(name).push(`${target.name}#${index + 1}`)
      }
      const isProcedureDefinition = first.opcode === 'procedures_definition'
      if (!isProcedureDefinition && !isHat(first.opcode)) diagnostics.push({ severity: 'warning', code: 'detached-script', target: target.name, script: index + 1, message: `腳本從「${first.opcode}」開始，沒有事件帽積木；一般執行時可能不會自動啟動。` })
      if (containsForever && !containsYield) diagnostics.push({ severity: 'warning', code: 'forever-without-yield', target: target.name, script: index + 1, message: '偵測到 forever 腳本中沒有明顯 wait/yield；請確認是否造成高 CPU 或其他腳本飢餓。' })
      if (foreverInitializes) diagnostics.push({ severity: 'info', code: 'forever-reinitialize', target: target.name, script: index + 1, message: 'forever 內反覆設定變數初值；若原意是只初始化一次，應移到迴圈外。' })
      return {
        index: index + 1,
        trigger: isProcedureDefinition ? 'custom_block_definition' : first.opcode,
        blockCount: opcodes.length,
        opcodes,
        reads: [...reads], writes: [...writes], listReads: [...listReads], listWrites: [...listWrites],
        broadcasts: [...broadcasts], receives: [...receives], procedureCalls: [...calls],
        summary: `${isProcedureDefinition ? '自訂積木定義' : first.opcode} → ${opcodes.slice(1, 5).join(' → ')}${opcodes.length > 5 ? ' …' : ''}`,
      }
    })

    for (const [code, scriptIndexes] of procedureCalls) {
      procedureDependencies.push({ target: target.name, proccode: code, defined: procedureDefs.has(code), callers: scriptIndexes })
      if (!procedureDefs.has(code)) diagnostics.push({ severity: 'warning', code: 'procedure-call-no-definition', target: target.name, message: `自訂積木呼叫「${code}」找不到同一角色中的定義。` })
    }

    return {
      name: target.name,
      kind: target.isStage ? 'stage' : 'sprite',
      blockCount: Object.keys(blocks).length,
      variableCount: Object.keys(target.variables || {}).length,
      listCount: Object.keys(target.lists || {}).length,
      costumeCount: (target.costumes || []).length,
      soundCount: (target.sounds || []).length,
      procedureCount: procedureDefs.size,
      scripts,
    }
  })

  const broadcastNames = new Set([...Object.values(broadcastMap).map(String), ...senders.keys(), ...receivers.keys()])
  for (const name of broadcastNames) {
    if ((senders.get(name)?.length || 0) > 0 && (receivers.get(name)?.length || 0) === 0) diagnostics.push({ severity: 'warning', code: 'broadcast-no-receiver', message: `廣播「${name}」有送出者，但沒有接收腳本。` })
    if ((receivers.get(name)?.length || 0) > 0 && (senders.get(name)?.length || 0) === 0) diagnostics.push({ severity: 'info', code: 'receiver-no-sender', message: `「當收到 ${name}」存在，但專案內找不到明顯的 broadcast 發送者。` })
  }

  return {
    format: 'scratch-ai-bridge/analysis-ir',
    version: 2,
    summary: {
      targets: targets.length,
      sprites: targets.filter(t => !t.isStage).length,
      blocks: totalBlocks,
      variables: totalVariables,
      lists: totalLists,
      broadcasts: broadcastNames.size,
      procedures: totalProcedures,
      monitors: (project.monitors || []).length,
      costumes: totalCostumes,
      sounds: totalSounds,
      scripts: targetSummaries.reduce((sum, t) => sum + t.scripts.length, 0),
    },
    targets: targetSummaries,
    dependencies: {
      broadcasts: [...broadcastNames].map(name => ({ name, senders: senders.get(name) || [], receivers: receivers.get(name) || [] })),
      procedures: procedureDependencies,
    },
    diagnostics,
  }
}

const stripAssetPayloads = canonical => {
  const copy = cloneJson(canonical)
  for (const target of [copy.stage, ...(copy.sprites || [])]) {
    for (const asset of [...(target.costumes || []), ...(target.sounds || [])]) {
      if (typeof asset.data === 'string') asset.data = `<base64 omitted: ${asset.data.length} chars>`
    }
  }
  return copy
}

const canonicalStructureSignature = canonical => {
  const simplifyInput = input => {
    if (!input) return null
    if (input.type === 'block') return { type: 'block', block: simplifyBlock(input.block) }
    if (input.type === 'stack') return { type: 'stack', blocks: (input.blocks || []).map(simplifyBlock) }
    if (input.type === 'literal') return { type: 'literal', value: input.value }
    if (['variable','list','broadcast'].includes(input.type)) return { type: input.type, name: input.name }
    return { type: input.type }
  }
  const simplifyBlock = block => ({
    opcode: block?.opcode,
    ...(block?.procedure ? { procedure: block.procedure } : {}),
    ...(block?.fields ? { fields: block.fields } : {}),
    ...(block?.inputs ? { inputs: Object.fromEntries(Object.entries(block.inputs).map(([k,v]) => [k, simplifyInput(v)])) } : {}),
    ...(block?.mutation && block.opcode !== 'procedures_call' ? { mutation: block.mutation } : {}),
  })
  const simplifyTarget = t => ({
    kind: t.kind, name: t.name,
    variables: (t.variables || []).map(v => [v.name, v.value, Boolean(v.cloud)]),
    lists: (t.lists || []).map(v => [v.name, v.value]),
    scripts: (t.scripts || []).map(s => (s.blocks || []).map(simplifyBlock)),
    procedures: (t.procedures || []).map(p => ({ proccode: p.proccode || p.name, warp: Boolean(p.warp), parameters: (p.parameters || []).map(a => [a.name,a.type,a.default]), body: (p.body || []).map(simplifyBlock) })),
    costumes: (t.costumes || []).map(a => [a.name,a.dataFormat,a.assetId,a.md5ext]),
    sounds: (t.sounds || []).map(a => [a.name,a.dataFormat,a.assetId,a.md5ext]),
  })
  return JSON.stringify({
    stage: simplifyTarget(canonical.stage), sprites: (canonical.sprites || []).map(simplifyTarget),
    broadcasts: (canonical.broadcasts || []).map(b => b.name).sort(),
    monitors: (canonical.monitors || []).map(m => [m.opcode,m.spriteName,m.variable,m.list,m.params]),
    extensions: [...(canonical.extensions || [])].sort(),
  })
}

const makeAiPrompt = ({ analysis, canonical, question = '', mode = 'student', hintLevel = 2 }) => {
  const modeRule = mode === 'teacher'
    ? '你是 Scratch 教師助理。請分析結構、指出可能錯誤、說明原因，並列出相關角色與腳本。'
    : `你是 Scratch 學習助教。不要一開始就直接給完整答案。提示層級 ${hintLevel}/4：${['','只給方向提示','指出相關角色與腳本','指出積木位置與修改方向','完整解釋與修正步驟'][hintLevel] || '循序提示'}。`
  const payload = JSON.stringify({ analysis, canonical: stripAssetPayloads(canonical) }, null, 2)
  const clipped = payload.length > 140000 ? `${payload.slice(0, 140000)}\n...（資料過長，已截斷）` : payload
  return `${modeRule}\n\n學生／使用者問題：${question.trim() || '請檢查這個 Scratch 專案的結構、可能問題與可改善處。'}\n\n以下資料由 Scratch AI Bridge 在本機解析：\n\n${clipped}`
}

const SAMPLE_PROJECT = {
  format: FORMAT,
  version: 1,
  name: 'Move and Say',
  stage: { kind: 'stage', name: 'Stage', variables: [{ name: 'score', value: 0 }], lists: [], costumes: [], sounds: [], scripts: [], procedures: [] },
  sprites: [{
    kind: 'sprite', name: 'Sprite1', x: 0, y: 0, direction: 90, size: 100, visible: true, draggable: false, rotationStyle: 'all around',
    variables: [], lists: [], costumes: [], sounds: [], procedures: [],
    scripts: [{ position: { x: 60, y: 60 }, blocks: [
      { opcode: 'event_whenflagclicked' },
      { opcode: 'data_setvariableto', fields: { VARIABLE: 'score' }, inputs: { VALUE: { type: 'literal', value: 0 } } },
      { opcode: 'control_repeat', inputs: { TIMES: { type: 'literal', value: 10 }, SUBSTACK: { type: 'stack', blocks: [
        { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 10 } } },
        { opcode: 'data_changevariableby', fields: { VARIABLE: 'score' }, inputs: { VALUE: { type: 'literal', value: 1 } } },
        { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.1 } } },
      ] } } },
      { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '完成！' } } },
    ] }],
  }],
  broadcasts: [],
}

const $ = selector => document.querySelector(selector)
const $$ = selector => [...document.querySelectorAll(selector)]

const state = {
  generated: null,
  analyzed: null,
  roundtrip: null,
  activeMode: 'generate',
}

const pretty = value => JSON.stringify(value, null, 2)
const safeFileName = value => String(value || 'scratch-project').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'scratch-project'

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const downloadText = (text, filename, type = 'application/json;charset=utf-8') => {
  downloadBlob(new Blob([text], { type }), filename)
}

const copyText = async text => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  return ok
}

const toast = (message, kind = 'ok') => {
  const el = $('#toast')
  el.textContent = message
  el.dataset.kind = kind
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600)
}

const setStatus = (el, title, details = [], kind = 'neutral') => {
  el.dataset.kind = kind
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${details.length ? `<ul>${details.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}`
}

const escapeHtml = value => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))

const setMode = mode => {
  state.activeMode = mode
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode))
  $$('.mode-panel').forEach(panel => panel.hidden = panel.id !== `panel-${mode}`)
  location.hash = mode
}

const AI_INSTRUCTION = `你要輸出 Scratch AI Bridge Canonical IR v1 的純 JSON，不要 Markdown code fence，不要解釋文字。

基本格式：
{
  "format": "scratch-ai-bridge/canonical-ir",
  "version": 1,
  "name": "專案名稱",
  "stage": {"kind":"stage","name":"Stage","variables":[],"lists":[],"costumes":[],"sounds":[],"scripts":[],"procedures":[]},
  "sprites": [],
  "broadcasts": [],
  "monitors": [],
  "extensions": []
}

Sprite 必填：kind/name/x/y/direction/size/visible/draggable/rotationStyle/variables/lists/costumes/sounds/scripts/procedures。
rotationStyle 可用："all around"、"left-right"、"don't rotate"。

已驗證核心 opcode 包含：
event_whenflagclicked, event_broadcast, event_broadcastandwait, event_whenbroadcastreceived,
motion_movesteps, looks_say, control_wait, control_repeat, control_forever, control_if, control_if_else,
data_setvariableto, data_changevariableby, data_showvariable, data_hidevariable,
data_addtolist, data_deleteoflist, data_deletealloflist, data_insertatlist, data_replaceitemoflist,
data_itemoflist, data_itemnumoflist, data_lengthoflist, data_listcontainsitem, data_showlist, data_hidelist,
procedures_call, argument_reporter_string_number, argument_reporter_boolean。
其他 Scratch opcode 也可用通用 block graph 表示；需要特殊資訊時可在 block 加 mutation object。

input 格式：
- 常數：{"type":"literal","value":10}
- 空輸入：{"type":"empty"}
- 變數：{"type":"variable","name":"score"}
- 清單：{"type":"list","name":"items"}
- 廣播：{"type":"broadcast","name":"start"}
- reporter block：{"type":"block","block":{...block...}}
- C 型積木內容：{"type":"stack","blocks":[...blocks...]}

常用 input/field：
- motion_movesteps.inputs.STEPS
- looks_say.inputs.MESSAGE
- control_wait.inputs.DURATION
- control_repeat.inputs.TIMES + inputs.SUBSTACK
- control_forever.inputs.SUBSTACK
- control_if.inputs.CONDITION + inputs.SUBSTACK
- control_if_else.inputs.CONDITION + inputs.SUBSTACK + inputs.SUBSTACK2
- data_setvariableto.fields.VARIABLE + inputs.VALUE
- data_changevariableby.fields.VARIABLE + inputs.VALUE
- data_addtolist.fields.LIST + inputs.ITEM
- data_deleteoflist.fields.LIST + inputs.INDEX
- data_insertatlist.fields.LIST + inputs.INDEX + inputs.ITEM
- data_replaceitemoflist.fields.LIST + inputs.INDEX + inputs.ITEM
- event_broadcast / event_broadcastandwait 的 inputs.BROADCAST_INPUT 使用 broadcast input
- event_whenbroadcastreceived.fields.BROADCAST_OPTION

自訂積木放在 target.procedures：
{
  "name":"Move Player",
  "proccode":"Move Player %n %b",
  "warp":false,
  "parameters":[
    {"name":"speed","type":"string_number","default":10},
    {"name":"boost","type":"boolean","default":false}
  ],
  "body":[...blocks...]
}
呼叫自訂積木：
{"opcode":"procedures_call","procedure":"Move Player %n %b","inputs":{"arg0":{"type":"literal","value":10},"arg1":{"type":"literal","value":false}}}
自訂積木內的參數 reporter：
{"opcode":"argument_reporter_string_number","fields":{"VALUE":"speed"}}
或 {"opcode":"argument_reporter_boolean","fields":{"VALUE":"boost"}}

costumes / sounds 可包含 data（base64）、assetId、md5ext、dataFormat；從既有 .sb3 解析出的 Canonical IR 會保留素材 bytes。所有 script.blocks 必須至少有一個積木。請維持合法 JSON。`

const renderGenerateSummary = project => {
  const targetCount = 1 + (project.sprites?.length || 0)
  const scriptCount = [project.stage, ...(project.sprites || [])].reduce((n, t) => n + (t.scripts?.length || 0), 0)
  const variableCount = [project.stage, ...(project.sprites || [])].reduce((n, t) => n + (t.variables?.length || 0), 0)
  const procedureCount = [project.stage, ...(project.sprites || [])].reduce((n, t) => n + (t.procedures?.length || 0), 0)
  $('#generate-summary').innerHTML = `
    <div><b>${escapeHtml(project.name)}</b><span>專案</span></div>
    <div><b>${targetCount}</b><span>角色＋舞台</span></div>
    <div><b>${scriptCount}</b><span>腳本</span></div>
    <div><b>${variableCount}</b><span>變數</span></div>
    <div><b>${procedureCount}</b><span>自訂積木</span></div>`
}

const parseEditor = () => {
  const text = $('#json-editor').value.trim()
  if (!text) throw new Error('請先貼入 Canonical IR JSON。')
  try { return JSON.parse(text) } catch (error) { throw new Error(`JSON 語法錯誤：${error.message}`) }
}

const validateEditor = () => {
  try {
    const project = parseEditor()
    const result = validateCanonicalProject(project)
    renderGenerateSummary(project)
    if (result.valid) {
      const warnings = result.warnings.map(x => `${x.path} — ${x.message}`)
      setStatus($('#validation-result'), warnings.length ? 'JSON 合法，可產生 .sb3（有警告）' : 'JSON 合法，可以產生 .sb3', warnings, warnings.length ? 'warn' : 'ok')
      return project
    }
    setStatus($('#validation-result'), `驗證失敗：${result.errors.length} 個問題`, result.errors.map(x => `${x.path} — ${x.message}`), 'error')
    return null
  } catch (error) {
    setStatus($('#validation-result'), error.message, [], 'error')
    return null
  }
}

const compileAndDownload = () => {
  const project = validateEditor()
  if (!project) return
  try {
    const result = compileProject(project)
    state.generated = result
    const filename = `${safeFileName(project.name)}.sb3`
    downloadBlob(new Blob([result.sb3], { type: 'application/x.scratch.sb3' }), filename)
    const details = result.warnings.length ? result.warnings : ['已建立 project.json、Scratch block graph 與必要素材。']
    setStatus($('#compile-result'), `已產生並下載 ${filename}`, details, result.warnings.length ? 'warn' : 'ok')
    $('#redownload').hidden = false
    toast('Scratch .sb3 已下載')
  } catch (error) {
    setStatus($('#compile-result'), `產生失敗：${error.message}`, [], 'error')
  }
}

const renderDiagnostics = diagnostics => {
  const container = $('#diagnostics')
  if (!diagnostics.length) {
    container.innerHTML = '<div class="empty-good">沒有偵測到規則型警告。</div>'
    return
  }
  container.innerHTML = diagnostics.map(item => `
    <article class="diagnostic ${escapeHtml(item.severity)}">
      <div class="diag-head"><span>${item.severity === 'warning' ? '警告' : '提示'}</span><code>${escapeHtml(item.code)}</code></div>
      <p>${escapeHtml(item.message)}</p>
      ${item.target ? `<small>${escapeHtml(item.target)}${item.script ? ` · Script ${item.script}` : ''}</small>` : ''}
    </article>`).join('')
}

const renderTargetList = targets => {
  $('#target-list').innerHTML = targets.map(target => `
    <details class="target-card">
      <summary><span>${target.kind === 'stage' ? '舞台' : '角色'} · ${escapeHtml(target.name)}</span><b>${target.blockCount} blocks</b></summary>
      <div class="target-meta">${target.scripts.length} scripts · ${target.procedureCount || 0} procedures · ${target.variableCount} variables · ${target.listCount} lists · ${target.costumeCount} costumes · ${target.soundCount} sounds</div>
      <div class="script-list">${target.scripts.map(script => `
        <div class="script-row">
          <div><b>#${script.index}</b> <code>${escapeHtml(script.trigger)}</code></div>
          <p>${escapeHtml(script.summary)}</p>
          <small>讀取：${escapeHtml(script.reads.join(', ') || '—')}　寫入：${escapeHtml(script.writes.join(', ') || '—')}　清單讀：${escapeHtml((script.listReads || []).join(', ') || '—')}　清單寫：${escapeHtml((script.listWrites || []).join(', ') || '—')}　廣播：${escapeHtml(script.broadcasts.join(', ') || '—')}　自訂積木：${escapeHtml((script.procedureCalls || []).join(', ') || '—')}</small>
        </div>`).join('') || '<div class="muted">無腳本</div>'}</div>
    </details>`).join('')
}

const updatePromptPreview = () => {
  if (!state.analyzed) return
  const mode = $('input[name="ai-mode"]:checked')?.value || 'student'
  const hintLevel = Number($('#hint-level').value || 2)
  $('#hint-value').textContent = String(hintLevel)
  const prompt = makeAiPrompt({
    analysis: state.analyzed.analysis,
    canonical: state.analyzed.canonical,
    question: $('#student-question').value,
    mode,
    hintLevel,
  })
  $('#prompt-preview').value = prompt
}

const processSb3 = async file => {
  if (!file) return
  const fileStatus = $('#file-status')
  state.roundtrip = null
  const rebuiltBtn = $('#download-rebuilt'); if (rebuiltBtn) rebuiltBtn.hidden = true
  const rtResult = $('#roundtrip-result'); if (rtResult) rtResult.innerHTML = ''
  setStatus(fileStatus, `正在解析 ${file.name}…`, [], 'neutral')
  try {
    const buffer = await file.arrayBuffer()
    const loaded = await loadSb3(buffer, file.name)
    const analysis = analyzeProject(loaded.project)
    state.analyzed = { ...loaded, analysis, fileName: file.name }
    const s = analysis.summary
    $('#analysis-stats').innerHTML = `
      <div><b>${s.sprites}</b><span>Sprites</span></div>
      <div><b>${s.blocks}</b><span>Blocks</span></div>
      <div><b>${s.variables}</b><span>Variables</span></div>
      <div><b>${s.broadcasts}</b><span>Broadcasts</span></div>
      <div><b>${s.procedures}</b><span>Procedures</span></div>
      <div><b>${s.monitors}</b><span>Monitors</span></div>
      <div><b>${s.scripts}</b><span>Scripts</span></div>`
    renderDiagnostics(analysis.diagnostics)
    renderTargetList(analysis.targets)
    $('#analysis-json').textContent = pretty(analysis)
    $('#canonical-json').textContent = pretty(stripAssetPayloads(loaded.canonical))
    const mappingEl = $('#mapping-json')
    if (mappingEl) mappingEl.textContent = pretty(loaded.mapping)
    $('#analysis-output').hidden = false
    setStatus(fileStatus, `解析完成：${file.name}`, [`${s.blocks} blocks、${s.scripts} scripts、${loaded.mapping.length} 個 block mappings、${analysis.diagnostics.length} 個診斷訊息`], 'ok')
    updatePromptPreview()
    toast('Scratch 專案解析完成')
  } catch (error) {
    state.analyzed = null
    $('#analysis-output').hidden = true
    setStatus(fileStatus, `解析失敗：${error.message}`, ['請確認檔案是 Scratch 3 的 .sb3。'], 'error')
  }
}

const init = () => {
  $('#json-editor').value = pretty(SAMPLE_PROJECT)
  $('#ai-instruction').value = AI_INSTRUCTION
  renderGenerateSummary(SAMPLE_PROJECT)
  validateEditor()

  const requested = location.hash.replace('#', '')
  setMode(['generate','analyze','about'].includes(requested) ? requested : 'generate')
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)))

  $('#load-sample').addEventListener('click', () => {
    $('#json-editor').value = pretty(SAMPLE_PROJECT)
    validateEditor()
    toast('已載入範例 JSON')
  })
  $('#download-sample').addEventListener('click', () => downloadText(pretty(SAMPLE_PROJECT), 'scratch-ai-bridge-example.json'))
  $('#copy-ai-instruction').addEventListener('click', async () => toast(await copyText(AI_INSTRUCTION) ? 'AI 指令已複製' : '複製失敗', 'neutral'))
  $('#validate-json').addEventListener('click', validateEditor)
  $('#compile-sb3').addEventListener('click', compileAndDownload)
  $('#redownload').addEventListener('click', () => {
    if (!state.generated) return
    const name = safeFileName(parseEditor().name)
    downloadBlob(new Blob([state.generated.sb3], { type: 'application/x.scratch.sb3' }), `${name}.sb3`)
  })
  $('#json-editor').addEventListener('input', () => {
    $('#compile-result').innerHTML = ''
    $('#compile-result').dataset.kind = 'neutral'
    $('#redownload').hidden = true
    state.generated = null
  })

  const fileInput = $('#sb3-file')
  fileInput.addEventListener('change', () => processSb3(fileInput.files?.[0]))
  const drop = $('#drop-zone')
  for (const event of ['dragenter','dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag') })
  for (const event of ['dragleave','drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag') })
  drop.addEventListener('drop', e => processSb3(e.dataTransfer?.files?.[0]))

  $('input[name="ai-mode"][value="student"]').checked = true
  $$('input[name="ai-mode"]').forEach(el => el.addEventListener('change', updatePromptPreview))
  $('#hint-level').addEventListener('input', updatePromptPreview)
  $('#student-question').addEventListener('input', updatePromptPreview)
  $('#copy-ai-prompt').addEventListener('click', async () => toast(await copyText($('#prompt-preview').value) ? '分析 Prompt 已複製' : '複製失敗'))
  $('#download-analysis').addEventListener('click', () => {
    if (state.analyzed) downloadText(pretty(state.analyzed.analysis), `${safeFileName(state.analyzed.fileName.replace(/\.sb3$/i,''))}-analysis.json`)
  })
  $('#download-canonical').addEventListener('click', () => {
    if (state.analyzed) downloadText(pretty(state.analyzed.canonical), `${safeFileName(state.analyzed.fileName.replace(/\.sb3$/i,''))}-canonical.json`)
  })
  const downloadMapping = $('#download-mapping')
  if (downloadMapping) downloadMapping.addEventListener('click', () => {
    if (state.analyzed) downloadText(pretty(state.analyzed.mapping), `${safeFileName(state.analyzed.fileName.replace(/\.sb3$/i,''))}-block-mapping.json`)
  })
  const rebuildSb3 = $('#rebuild-sb3')
  if (rebuildSb3) rebuildSb3.addEventListener('click', async () => {
    if (!state.analyzed) return
    try {
      setStatus($('#roundtrip-result'), '正在重建並驗證 Round-trip…', [], 'neutral')
      const compiled = compileProject(state.analyzed.canonical)
      const reloaded = await loadSb3(compiled.sb3, state.analyzed.fileName)
      const same = canonicalStructureSignature(state.analyzed.canonical) === canonicalStructureSignature(reloaded.canonical)
      setStatus($('#roundtrip-result'), same ? 'Round-trip 結構驗證通過' : 'Round-trip 可重新載入，但結構存在差異', [
        `原始 mapping：${state.analyzed.mapping.length}；重建 mapping：${reloaded.mapping.length}`,
        `重建檔案：${compiled.sb3.byteLength.toLocaleString()} bytes`,
        ...(compiled.warnings || []).slice(0, 8),
      ], same ? 'ok' : 'warn')
      state.roundtrip = { compiled, reloaded, same }
      const btn = $('#download-rebuilt')
      if (btn) btn.hidden = false
    } catch (error) {
      setStatus($('#roundtrip-result'), `Round-trip 失敗：${error.message}`, [], 'error')
    }
  })
  const downloadRebuilt = $('#download-rebuilt')
  if (downloadRebuilt) downloadRebuilt.addEventListener('click', () => {
    if (!state.roundtrip?.compiled) return
    const base = safeFileName(state.analyzed.fileName.replace(/\.sb3$/i,''))
    downloadBlob(new Blob([state.roundtrip.compiled.sb3], { type: 'application/x.scratch.sb3' }), `${base}-roundtrip.sb3`)
  })
  $('#copy-analysis').addEventListener('click', async () => {
    if (state.analyzed) toast(await copyText(pretty(state.analyzed.analysis)) ? 'Analysis IR 已複製' : '複製失敗')
  })
  $('#copy-canonical').addEventListener('click', async () => {
    if (state.analyzed) toast(await copyText(pretty(state.analyzed.canonical)) ? 'Canonical IR 已複製' : '複製失敗')
  })

  const deflateSupport = typeof DecompressionStream === 'function'
  $('#compat').innerHTML = deflateSupport
    ? '<span class="dot ok"></span> 瀏覽器離線處理已就緒'
    : '<span class="dot warn"></span> 這個瀏覽器可能無法解析壓縮的 .sb3；建議使用最新版 Chrome / Edge / Firefox'
}

init()
