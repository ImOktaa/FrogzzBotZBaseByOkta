const crypto = require('crypto')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Number(ms) || 0))
}

function runtime(seconds) {
  let value = Math.floor(Number(seconds) || 0)
  const days = Math.floor(value / 86400)
  value %= 86400
  const hours = Math.floor(value / 3600)
  value %= 3600
  const minutes = Math.floor(value / 60)
  const secs = value % 60
  return `${days}d ${hours}h ${minutes}m ${secs}s`
}

function formatDate(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(timestamp))
}

function tanggal(timestamp = Date.now()) {
  return formatDate(timestamp)
}

function getTime(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestamp))
}

function processTime(start) {
  return `${Date.now() - Number(start || Date.now())} ms`
}

function generateMessageTag() {
  return `${Date.now()}.${crypto.randomBytes(3).toString('hex')}`
}

function isUrl(value) {
  try { return Boolean(new URL(value)) } catch (_) { return false }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`)
  return data
}

async function getBuffer(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function parseMention(text = '') {
  return [...String(text).matchAll(/@([0-9]{5,16})/g)].map(match => `${match[1]}@s.whatsapp.net`)
}

function normalizeJid(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+(?=@)/, '')
}

function jidToNumber(value) {
  return normalizeJid(value).split('@')[0].replace(/\D/g, '')
}

function smsg(sock, message) {
  if (!message) return message
  message.chat = message.key?.remoteJid || ''
  message.sender = message.key?.participant || message.key?.senderPn || message.key?.remoteJid || ''
  message.fromMe = Boolean(message.key?.fromMe)
  message.text = message.message?.conversation || message.message?.extendedTextMessage?.text || message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || ''
  message.mtype = message.message ? Object.keys(message.message)[0] : ''
  return message
}

module.exports = { sleep, runtime, formatDate, tanggal, getTime, processTime, generateMessageTag, isUrl, fetchJson, getBuffer, parseMention, normalizeJid, jidToNumber, smsg }
