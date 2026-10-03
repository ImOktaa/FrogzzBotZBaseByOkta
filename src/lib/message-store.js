const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const FILE = path.join(ROOT, 'session', 'message-store.json')
const MAX_MESSAGES = 3000
const MAX_FILE_BYTES = 25 * 1024 * 1024

let cache = new Map()
let loaded = false
let dirty = false
let flushTimer = null

function keyOf(key = {}) {
  const jid = String(key.remoteJid || '').trim()
  const id = String(key.id || '').trim()
  return jid && id ? `${jid}|${id}` : ''
}

function revive(value) {
  if (Buffer.isBuffer(value)) return value
  if (!value || typeof value !== 'object') return value
  if (value.__frogzzBuffer === true && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64')
  }
  if (Array.isArray(value)) return value.map(revive)
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = revive(v)
  return out
}

function replacer(_key, value) {
  if (Buffer.isBuffer(value)) {
    return { __frogzzBuffer: true, data: value.toString('base64') }
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return { __frogzzBuffer: true, data: Buffer.from(value.data).toString('base64') }
  }
  if (value instanceof Uint8Array) {
    return { __frogzzBuffer: true, data: Buffer.from(value).toString('base64') }
  }
  return value
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  if (!fs.existsSync(FILE)) return
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}')
    for (const [k, v] of Object.entries(raw.messages || {})) {
      cache.set(k, revive(v))
    }
  } catch (_) {
    cache.clear()
  }
}

function scheduleFlush() {
  dirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 500)
  flushTimer.unref?.()
}

function flush() {
  ensureLoaded()
  if (!dirty) return
  dirty = false

  try {
    const messages = Object.fromEntries(cache)
    const body = JSON.stringify({ version: 1, messages }, replacer)
    if (Buffer.byteLength(body, 'utf8') > MAX_FILE_BYTES) {
      const entries = [...cache.entries()].slice(-Math.floor(MAX_MESSAGES * 0.65))
      cache = new Map(entries)
    }
    const finalBody = JSON.stringify({ version: 1, messages: Object.fromEntries(cache) }, replacer)
    const tmp = `${FILE}.tmp`
    fs.writeFileSync(tmp, finalBody)
    fs.renameSync(tmp, FILE)
  } catch (_) {
    dirty = true
  }
}

function save(message) {
  ensureLoaded()
  const key = keyOf(message?.key)
  const content = message?.message
  if (!key || !content) return
  cache.set(key, content)

  while (cache.size > MAX_MESSAGES) {
    const first = cache.keys().next().value
    if (first === undefined) break
    cache.delete(first)
  }
  scheduleFlush()
}

function saveMany(messages = []) {
  for (const message of messages) save(message)
  flush()
}

function get(key) {
  ensureLoaded()
  const value = cache.get(keyOf(key))
  return value ? revive(value) : undefined
}

function close() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (dirty) flush()
}

module.exports = { save, saveMany, get, flush, close, FILE }
