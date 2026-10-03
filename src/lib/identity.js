const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'identity.json')

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '{}\n')
}
function read() {
  ensure()
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}') } catch (_) { return {} }
}
function write(data) {
  ensure()
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
}
function digits(value) {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}
function bare(value) {
  return String(value || '').trim().toLowerCase()
}
function candidates(m = {}) {
  const key = m.key || {}
  const context = m.message?.extendedTextMessage?.contextInfo || {}
  const context2 = m.message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo || {}
  return [
    key.participant,
    key.participantPn,
    key.participantAlt,
    key.senderPn,
    key.senderLid,
    key.remoteJid,
    key.remoteJidAlt,
    context.participant,
    context.participantPn,
    context.participantAlt,
    context.remoteJid,
    context.remoteJidAlt,
    context.senderPn,
    context.senderLid,
    context2.participant,
    context2.participantPn,
    context2.participantAlt,
    context2.remoteJid,
    context2.remoteJidAlt
  ].filter(Boolean)
}

function remember(m) {
  const values = candidates(m)
  const numeric = values
    .filter(v => !/@lid$/i.test(bare(v)) && !/@g\.us$/i.test(bare(v)) && !/@broadcast$/i.test(bare(v)))
    .map(digits).filter(v => v.length >= 8)
  const lids = values.filter(v => /@lid$/i.test(bare(v)))
  if (!numeric.length || !lids.length) return false
  const data = read()
  let changed = false
  for (const lid of lids) {
    const k = bare(lid)
    if (data[k] !== numeric[0]) {
      data[k] = numeric[0]
      changed = true
    }
  }
  if (changed) write(data)
  return changed
}

// Uses Baileys' native LID mapping when available. This is important with
// WhatsApp accounts that deliver the sender as @lid instead of a phone JID.
async function rememberFromSocket(socket, m) {
  remember(m)
  const values = candidates(m)
  const lids = [...new Set(values.map(bare).filter(v => /@lid$/i.test(v)))]
  const mapping = socket?.signalRepository?.lidMapping
  if (!mapping || !lids.length) return

  const data = read()
  let changed = false
  for (const lid of lids) {
    try {
      const pn = await mapping.getPNForLID(lid)
      const number = digits(pn)
      if (number.length >= 8 && data[lid] !== number) {
        data[lid] = number
        changed = true
      }
    } catch (_) {}
  }
  if (changed) write(data)
}

function resolveNumber(value) {
  const normalized = bare(value)
  const number = digits(value)
  if (number && number.length >= 8 && !/@lid$/i.test(normalized)) return number
  if (normalized && /@lid$/i.test(normalized)) {
    const mapped = digits(read()[normalized])
    if (mapped.length >= 8) return mapped
  }
  return number
}

function resolveMessageNumber(m = {}) {
  const values = candidates(m)
  for (const value of values) {
    const normalized = bare(value)
    const n = digits(value)
    if (n.length >= 8 && !/@lid$/i.test(normalized)) return n
  }
  for (const value of values) {
    const n = resolveNumber(value)
    if (n.length >= 8) return n
  }
  return ''
}

function isOwner(m, config) {
  const ownerNumbers = (config.ownerNumbers || []).map(digits).filter(Boolean)
  const configuredLids = (config.ownerLids || []).map(bare)
  const data = read()
  for (const value of candidates(m)) {
    const normalized = bare(value)
    const number = resolveNumber(value)
    if (configuredLids.includes(normalized)) return true
    if (number && ownerNumbers.includes(number)) return true
    if (/@lid$/i.test(normalized) && ownerNumbers.includes(data[normalized])) return true
  }
  return false
}

module.exports = {
  remember,
  rememberFromSocket,
  isOwner,
  candidates,
  digits,
  resolveNumber,
  resolveMessageNumber
}
