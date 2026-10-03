require('dotenv').config()
const P = require('pino')
const readline = require('readline')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const config = require('./config')
const identity = require('./src/lib/identity')
const messageStore = require('./src/lib/message-store')
let runCase = require('./src/core/Okta')

const ROOT = __dirname
const PLUGIN_DIR = path.resolve(ROOT, config.plugins.directory)
const SESSION_DIR = path.join(ROOT, 'session')
const plugins = new Map()
const limitStore = new Map()
const groupMetadataCache = new Map()
const sendQueues = new Map()
let Frogzz = null
let reconnectTimer = null
let reconnectAttempts = 0
let isStarting = false
let pairingRequested = false
let pairingNumber = null
let pairingInProgress = false
let shuttingDown = false
let botPublic = true
const CREATOR_FOOTER = '© Okta — formerly known as Frogzz'
const CREATOR_FOOTER_FORMATTED = `> _${CREATOR_FOOTER}_`
let lastOpenAt = 0
let baileys = null
let makeWASocket = null
let useMultiFileAuthState = null
let DisconnectReason = null
let Browsers = null
let makeCacheableSignalKeyStore = null
let channelJid = ''
let channelMetadata = null

async function resolveConfiguredChannel(socket) {
  const url = String(config.channel.url || '').trim()
  if (!url) { channelJid = ''; channelMetadata = null; return null }
  const match = url.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i)
  if (!match || typeof socket?.newsletterMetadata !== 'function') {
    console.error('[CHANNEL] CHANNEL_URL tidak valid atau newsletterMetadata tidak tersedia.')
    return null
  }
  try {
    const meta = await socket.newsletterMetadata('invite', match[1])
    if (meta?.id) {
      channelJid = meta.id
      channelMetadata = meta
      console.log(`[CHANNEL] ${meta.name?.text || meta.name || 'Channel'} -> ${channelJid}`)
      return meta
    }
  } catch (error) {
    logError('CHANNEL RESOLVE', error)
  }
  return null
}

function channelContextInfo() {
  if (!channelJid) return {}
  return {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: channelJid,
      serverMessageId: Number(config.channel.messageId || 1),
      newsletterName: channelMetadata?.name?.text || channelMetadata?.name || config.channel.name || 'WhatsApp Channel'
    }
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function isGroupJid(jid) { return String(jid || '').endsWith('@g.us') }
function logError(title, error) { console.error(`[${title}] ${String(error?.stack || error?.message || error)}`) }
function cleanNumber(value) { return String(value || '').replace(/\D/g, '') }
function question(text) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(resolve => rl.question(text, answer => { rl.close(); resolve(answer.trim()) })) }

function queueSend(jid, task) {
  const key = String(jid || '')
  const previous = sendQueues.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    if (isGroupJid(key) && config.connection.groupSendDebounceMs > 0) await sleep(config.connection.groupSendDebounceMs)
    return task()
  }).finally(() => { if (sendQueues.get(key) === next) sendQueues.delete(key) })
  sendQueues.set(key, next)
  return next
}

async function refreshGroupMetadata(socket, jid) {
  if (!isGroupJid(jid)) return null
  try {
    const metadata = await socket.groupMetadata(jid)
    if (metadata) groupMetadataCache.set(jid, { value: metadata, expiresAt: Date.now() + config.connection.groupMetadataTtlMs })
    return metadata
  } catch (error) {
    groupMetadataCache.delete(jid)
    return null
  }
}

async function getCachedGroupMetadata(socket, jid) {
  if (!isGroupJid(jid)) return undefined
  const cached = groupMetadataCache.get(jid)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  return refreshGroupMetadata(socket, jid)
}

async function resetGroupSenderKey(state, jid) {
  if (!isGroupJid(jid) || !config.connection.resetGroupSenderKeyOnSendError) return
  if (state?.keys?.set) await state.keys.set({ 'sender-key-memory': { [jid]: null } })
}

function isMediaContent(content) {
  if (!content || typeof content !== 'object') return false
  return Boolean(content.image || content.video || content.audio || content.document || content.sticker)
}

function wrapSocketSend(socket, state) {
  if (socket.__frogzzWrapped) return
  const original = socket.sendMessage.bind(socket)
  socket.sendMessage = (jid, content, options) => queueSend(jid, async () => {
    if (isGroupJid(jid)) await getCachedGroupMetadata(socket, jid)
    if (channelJid && content && typeof content === 'object' && !content.contextInfo && !String(jid || '').endsWith('@newsletter')) {
      content = { ...content, contextInfo: channelContextInfo() }
    }
    let lastError = null
    const attempts = isMediaContent(content) ? 3 : 1
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const sent = await original(jid, content, options)
        if (sent?.message && sent?.key?.id) messageStore.save(sent)
        return sent
      } catch (error) {
        lastError = error
        if (isGroupJid(jid) && config.connection.resetGroupSenderKeyOnSendError) {
          try { await resetGroupSenderKey(state, jid) } catch (_) {}
        }
        if (attempt < attempts) {
          console.error(`[SEND] Percobaan ${attempt}/${attempts} gagal${isMediaContent(content) ? ' (media)' : ''}: ${error?.message || error}`)
          await sleep(800 * attempt)
          continue
        }
      }
    }
    throw lastError
  })
  socket.__frogzzWrapped = true
}

function walkJsFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkJsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function normalizePluginExport(exported, file) {
  const value = exported?.default || exported
  const list = Array.isArray(value) ? value : [value]
  const result = []
  for (const item of list) {
    if (typeof item === 'function') result.push({ name: path.basename(file, '.js'), aliases: [], run: item })
    else if (item && typeof item.run === 'function') {
      const declared = []
      for (const field of [item.name, item.command, item.cmd, item.help]) {
        if (Array.isArray(field)) declared.push(...field)
        else if (field) declared.push(field)
      }
      const aliases = Array.isArray(item.aliases) ? item.aliases : []
      const commands = [...new Set([...declared, ...aliases].map(v => String(v).trim()).filter(Boolean))]
      const primary = String(item.name || commands[0] || path.basename(file, '.js'))
      for (const name of commands) result.push({ name: String(name), aliases: [primary, ...aliases].filter(Boolean), run: item.run, before: item.before, onText: item.onText })
    }
  }
  return result
}

function loadPlugins() {
  fs.mkdirSync(PLUGIN_DIR, { recursive: true })
  plugins.clear()
  let failed = 0
  for (const file of walkJsFiles(PLUGIN_DIR)) {
    try {
      delete require.cache[require.resolve(file)]
      const exported = require(file)
      for (const plugin of normalizePluginExport(exported, file)) {
        const names = [plugin.name, ...plugin.aliases].map(v => String(v).trim().toLowerCase()).filter(Boolean)
        for (const name of names) plugins.set(name, { ...plugin, source: path.relative(ROOT, file) })
      }
    } catch (requireError) {
      failed++
      import(pathToFileURL(file).href + `?reload=${Date.now()}`).then(module => {
        for (const plugin of normalizePluginExport(module, file)) {
          const names = [plugin.name, ...plugin.aliases].map(v => String(v).trim().toLowerCase()).filter(Boolean)
          for (const name of names) plugins.set(name, { ...plugin, source: path.relative(ROOT, file) })
        }
      }).catch(error => logError(`PLUGIN ${path.relative(ROOT, file)}`, error))
    }
  }
  if (failed) console.error(`[PLUGIN] ${failed} plugin membutuhkan loader ESM atau gagal dimuat.`)
}

function reloadPlugins() { loadPlugins() }
function reloadCase() {
  const file = path.join(ROOT, 'src/core/Okta.js')
  try {
    if (!fs.existsSync(file)) { runCase = async () => false; return false }
    delete require.cache[require.resolve(file)]
    runCase = require(file)
    return true
  } catch (error) {
    logError('CASE LOAD', error)
    return false
  }
}
function getPlugin(command) { return plugins.get(String(command || '').toLowerCase()) }
function getErrorLocation(error) {
  const match = String(error?.stack || '').match(/(?:\(|\s)([^()\s]+):(\d+):(\d+)\)?/)
  return match ? { file: path.relative(ROOT, match[1]) || match[1], line: match[2], column: match[3] } : { file: '?', line: '?', column: '?' }
}
function commandError(error, command) {
  const p = getErrorLocation(error)
  return `⚠️ ${config.botName} Error\n\nCommand: ${command}\nFile: ${p.file}\nLine: ${p.line}\nColumn: ${p.column}\nError: ${String(error?.message || error).slice(0, 500)}`
}

function checkRateLimit(jid, command) {
  if (!config.limits.enabled) return { allowed: true }
  const key = `${jid}:${command}`
  const now = Date.now()
  const current = limitStore.get(key)
  if (!current || now >= current.resetAt) { limitStore.set(key, { count: 1, resetAt: now + config.limits.windowMs }); return { allowed: true } }
  if (current.count >= config.limits.max) return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) }
  current.count++
  return { allowed: true }
}

setInterval(() => {
  const now = Date.now()
  for (const [key, value] of limitStore) if (now >= value.resetAt) limitStore.delete(key)
}, 60_000).unref()

async function getPairingNumber() {
  if (pairingNumber) return pairingNumber
  let number = await question('\nMasukan Nomor WhatsApp untuk pairing (contoh 628123456789):\n> ')
  number = cleanNumber(number)
  if (number.length < 8) throw new Error('Nomor WhatsApp tidak valid.')
  pairingNumber = number
  return number
}

async function loadBaileys() {
  if (baileys) return baileys
  baileys = await import('@itsliaaa/baileys')
  makeWASocket = baileys.default || baileys.makeWASocket
  useMultiFileAuthState = baileys.useMultiFileAuthState
  DisconnectReason = baileys.DisconnectReason
  Browsers = baileys.Browsers
  makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore
  if (typeof makeWASocket !== 'function') throw new Error('makeWASocket tidak tersedia dari @itsliaaa/baileys')
  return baileys
}

async function requestPairing(socket, number) {
  if (pairingInProgress || stateRegistered(socket)) return
  pairingInProgress = true
  try {
    await sleep(1200)
    if (socket !== Frogzz || socket.authState?.creds?.registered) return
    const code = await socket.requestPairingCode(number)
    console.log(`\nPAIRING CODE: ${code?.match(/.{1,4}/g)?.join('-') || code}\n`)
    pairingRequested = true
  } catch (error) {
    pairingRequested = false
    logError('PAIRING', error)
  } finally {
    pairingInProgress = false
  }
}

function stateRegistered(socket) {
  return Boolean(socket?.authState?.creds?.registered)
}

function disconnectCode(lastDisconnect) {
  const error = lastDisconnect?.error
  return error?.output?.statusCode || error?.statusCode || null
}

function reconnectDelay() {
  const base = Math.min(config.connection.maxReconnectDelayMs, config.connection.baseReconnectDelayMs * 2 ** Math.min(reconnectAttempts, 6))
  return Math.min(config.connection.maxReconnectDelayMs, base + Math.floor(Math.random() * 1200))
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return
  const delay = reconnectDelay()
  reconnectAttempts++
  console.log(`[CONNECTION] Reconnect dalam ${Math.ceil(delay / 1000)} detik.`)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; startBot().catch(error => logError('RECONNECT', error)) }, delay)
}

function unwrapMessage(message) {
  let current = message || {}
  for (let i = 0; i < 6; i++) {
    const nested = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message
    if (!nested || nested === current) break
    current = nested
  }
  return current || {}
}

function extractText(message) {
  const content = unwrapMessage(message)
  return (content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || content?.documentMessage?.caption || content?.buttonsResponseMessage?.selectedButtonId || content?.listResponseMessage?.singleSelectReply?.selectedRowId || '').trim()
}

function extractQuotedMessage(m) {
  const message = unwrapMessage(m?.message || {})
  const context =
    message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    message?.buttonsResponseMessage?.contextInfo ||
    message?.listResponseMessage?.contextInfo ||
    message?.templateButtonReplyMessage?.contextInfo ||
    message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo ||
    message?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo ||
    message?.viewOnceMessageV2Extension?.message?.extendedTextMessage?.contextInfo ||
    null
  const quoted = context?.quotedMessage
  if (!quoted) return null

  const text = extractText(quoted)
  const participant = context.participant || context.participantPn || context.participantAlt || ''
  const stanzaId = context.stanzaId || ''
  return {
    message: quoted,
    msg: quoted,
    text,
    body: text,
    caption: text,
    participant,
    stanzaId,
    key: {
      remoteJid: m.key?.remoteJid,
      id: stanzaId,
      participant
    },
    isQuoted: true,
    download: async () => {
      if (!isMediaContent(quoted)) return null
      const mod = await loadBaileys()
      if (typeof mod.downloadContentFromMessage !== 'function') return null
      const media = quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.documentMessage || quoted.stickerMessage
      if (!media) return null
      const type = quoted.imageMessage ? 'image' : quoted.videoMessage ? 'video' : quoted.audioMessage ? 'audio' : quoted.documentMessage ? 'document' : 'sticker'
      const stream = await mod.downloadContentFromMessage(media, type)
      const chunks = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks)
    }
  }
}

async function startBot() {
  if (shuttingDown || isStarting) return
  isStarting = true
  try {
    await loadBaileys()
    fs.mkdirSync(SESSION_DIR, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
    const needsPairing = !state.creds.registered && config.pairing.enabled

    // Nomor selalu diminta manual di terminal, bukan dari .env/config.
    if (needsPairing) {
      await getPairingNumber()
    }

    const logger = P({ level: config.logging.level || 'silent' })
    const auth = {
      creds: state.creds,
      keys: typeof makeCacheableSignalKeyStore === 'function'
        ? makeCacheableSignalKeyStore(state.keys, logger)
        : state.keys
    }

    const socket = makeWASocket({
      auth,
      browser: typeof Browsers?.ubuntu === 'function'
        ? Browsers.ubuntu('Chrome')
        : undefined,
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: config.connection.connectTimeoutMs,
      defaultQueryTimeoutMs: config.connection.defaultQueryTimeoutMs,
      keepAliveIntervalMs: config.connection.keepAliveIntervalMs,
      maxMsgRetryCount: config.connection.maxMsgRetryCount,
      retryRequestDelayMs: config.connection.retryRequestDelayMs,
      getMessage: async key => messageStore.get(key),
      cachedGroupMetadata: async jid => getCachedGroupMetadata(socket, jid)
    })

    socket.public = botPublic
    socket.authState = state
    wrapSocketSend(socket, state)
    Frogzz = socket
    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('connection.update', update => handleConnectionUpdate(socket, state, update))
    socket.ev.on('messages.upsert', event => handleMessages(socket, event))
    socket.ev.on('groups.update', async events => { for (const event of events || []) if (event?.id) await refreshGroupMetadata(socket, event.id) })
    socket.ev.on('group-participants.update', async event => { if (event?.id) await refreshGroupMetadata(socket, event.id) })
    socket.ev.on('error', error => logError('SOCKET', error))

    // Pairing mengikuti flow resmi Itsliaaa: tunggu event `connecting`,
    // lalu beri waktu ~1500ms sebelum requestPairingCode().
  } finally {
    isStarting = false
  }
}

async function handleConnectionUpdate(socket, state, update) {
  const { connection, lastDisconnect } = update

  if (connection === 'connecting') {
    console.log('[CONNECTION] Menghubungkan ke WhatsApp...')
    if (!state.creds.registered && config.pairing.enabled && pairingNumber && !pairingRequested) {
      requestPairing(socket, pairingNumber).catch(error => logError('PAIRING', error))
    }
    return
  }

  if (connection === 'open') {
    Frogzz = socket
    lastOpenAt = Date.now()
    reconnectAttempts = 0
    pairingRequested = true
    pairingInProgress = false
    loadPlugins()
    await resolveConfiguredChannel(socket)
    console.log(`\n${config.botName} ${config.version} CONNECTED\nOwner: ${config.ownerName}`)
    return
  }

  if (connection !== 'close') return

  const statusCode = disconnectCode(lastDisconnect)
  const stable = lastOpenAt > 0 && Date.now() - lastOpenAt > config.connection.stableConnectionMs
  const pairingPending = !state.creds.registered && Boolean(pairingNumber)

  if (socket !== Frogzz) return
  Frogzz = null
  pairingInProgress = false
  console.log(`[CONNECTION] Terputus${statusCode ? ` | status ${statusCode}` : ''}.`)

  if (statusCode === DisconnectReason?.loggedOut || statusCode === DisconnectReason?.connectionReplaced) return

  // 515/restartRequired adalah alur normal setelah pairing diterima.
  // Jangan menunggu backoff panjang dan jangan minta nomor lagi.
  if (statusCode === 515 || statusCode === 5150) {
    reconnectAttempts = 0
    if (!shuttingDown && !reconnectTimer) {
      console.log('[CONNECTION] Restart setelah pairing, tunggu 2 detik...')
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        startBot().catch(error => logError('RECONNECT', error))
      }, 2000)
    }
    return
  }

  if (stable) reconnectAttempts = 0
  if (pairingPending) {
    reconnectAttempts = 0
    console.log('[PAIRING] Sesi pairing belum selesai, mencoba konek ulang tanpa meminta nomor lagi...')
    if (!reconnectTimer && !shuttingDown) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        startBot().catch(error => logError('RECONNECT', error))
      }, 2000)
    }
    return
  }

  scheduleReconnect()
}

async function handleMessages(socket, { messages }) {
  const list = messages || []
  messageStore.saveMany(list.filter(m => m?.message && m?.key?.id))
  await Promise.allSettled(list.map(async m => {
    try { await handleMessage(socket, m) } catch (error) { logError('MESSAGE', error) }
  }))
}

function runShell(command) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 30000, maxBuffer: 1024 * 1024, shell: '/bin/bash' }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) return reject(error)
      resolve({ stdout: stdout || '', stderr: stderr || '', code: error?.code ?? 0 })
    })
  })
}

async function handleShellCommand(socket, m, command) {
  const jid = m.key?.remoteJid
  if (!identity.isOwner(m, config)) return
  const source = String(command || '').trim()
  if (!source) {
    await socket.sendMessage(jid, { text: '```$ <command>```\n\nContoh: `$ ls -la`\n\n> _© Okta — formerly known as Frogzz_' }, { quoted: m, contextInfo: channelContextInfo() })
    return
  }
  try {
    const result = await runShell(source)
    const output = [result.stdout.trim(), result.stderr.trim() ? `STDERR\n${result.stderr.trim()}` : ''].filter(Boolean).join('\n') || '(no output)'
    const clipped = output.length > 12000 ? `${output.slice(0, 12000)}\n... output dipotong` : output
    await socket.sendMessage(jid, { text: `╭─「 *SHELL* 」\n│ $ ${source}\n╰────────────\n\n\`\`\`\n${clipped}\n\`\`\`\n\nExit: ${result.code}\n\n> _© Okta — formerly known as Frogzz_` }, { quoted: m, contextInfo: channelContextInfo() })
  } catch (error) {
    await socket.sendMessage(jid, { text: `❌ Shell error\n\n\`\`\`\n${String(error?.message || error)}\n\`\`\`\n\n> _© Okta — formerly known as Frogzz_` }, { quoted: m, contextInfo: channelContextInfo() })
  }
}

async function handleMessage(socket, m) {
  const prefix = config.prefix || '.'
  if (!m?.message || m.key?.fromMe) return
  const jid = m.key?.remoteJid
  if (!jid || jid === 'status@broadcast') return
  await identity.rememberFromSocket(socket, m)
  const text = extractText(m.message)
  if (!text) return
  const trimmedText = text.trim()
  if (!trimmedText.startsWith(prefix)) {
    const textContext = {
      Frogzz: socket, sock: socket, jid, m, text: trimmedText, q: trimmedText, args: [], command: '', config, commands: plugins,
      sender: m.key?.participant || m.key?.senderPn || jid, isGroup: jid.endsWith('@g.us'), isOwner: identity.isOwner(m, config),
      prefix, quoted: extractQuotedMessage(m), pushname: m.pushName || 'No Name', budy: text, store: messageStore,
      reply: replyText => {
        const body = String(replyText ?? '')
        const finalText = body.includes(CREATOR_FOOTER) ? body : `${body}\n\n${CREATOR_FOOTER_FORMATTED}`
        return socket.sendMessage(jid, { text: finalText }, { quoted: m, contextInfo: channelContextInfo() })
      }
    }
    for (const [pluginName, plugin] of plugins) {
      if (typeof plugin.onText !== 'function') continue
      try {
        const handled = await plugin.onText(textContext)
        if (handled) return
      } catch (error) {
        logError(`TEXT ${pluginName}`, error)
      }
    }
    if (!trimmedText.startsWith('$')) return
  }
  if (trimmedText.startsWith('$')) {
    await handleShellCommand(socket, m, trimmedText.slice(1).trim())
    return
  }
  if (!text.startsWith(prefix)) return
  const raw = text.slice(prefix.length).trim()
  if (!raw) return
  const parts = raw.split(/\s+/)
  const command = String(parts.shift() || '').toLowerCase()
  if (!command) return
  const isOwner = identity.isOwner(m, config)
  // Self mode is a hard command gate: only owner messages are processed.
  if (!botPublic && !isOwner) return
  const rate = checkRateLimit(jid, command)
  if (!rate.allowed) { await socket.sendMessage(jid, { text: `⏳ Tunggu ${rate.retryAfter} detik sebelum memakai ${prefix}${command}.\n\n${CREATOR_FOOTER_FORMATTED}` }, { quoted: m, contextInfo: channelContextInfo() }); return }
  const isGroup = jid.endsWith('@g.us')
  let groupMetadata = null
  let isBotAdmin = false
  let isSenderAdmin = false
  if (isGroup) {
    groupMetadata = await getCachedGroupMetadata(socket, jid)
    const same = (a, b) => {
      const aa = identity.resolveNumber(a)
      const bb = identity.resolveNumber(b)
      return Boolean(aa && bb && aa === bb) || String(a || '').toLowerCase() === String(b || '').toLowerCase()
    }
    const botId = socket.user?.id || ''
    const senderId = m.key?.participant || m.key?.senderPn || ''
    const botPart = (groupMetadata?.participants || []).find(p => same(p.id || p.jid, botId))
    const senderPart = (groupMetadata?.participants || []).find(p => same(p.id || p.jid, senderId) || identity.resolveNumber(p.id || p.jid) === identity.resolveMessageNumber(m))
    isBotAdmin = ['admin', 'superadmin'].includes(botPart?.admin)
    isSenderAdmin = ['admin', 'superadmin'].includes(senderPart?.admin)
  }
  const pushname = m.pushName || 'No Name'
  const messageText = parts.join(' ')
  const context = {
    Frogzz: socket, sock: socket, jid, m, text: messageText, q: messageText, args: parts, command, config, commands: plugins,
    sender: m.key?.participant || m.key?.senderPn || jid, isGroup, isOwner, isCreator: isOwner, isPremium: false,
    isBotAdmin, isBotAdmins: isBotAdmin, isSenderAdmin, isAdmins: isSenderAdmin, isGroupAdmins: isSenderAdmin,
    groupMetadata, participants: groupMetadata?.participants || [], groupName: groupMetadata?.subject || '', pushname,
    budy: text, prefix, quoted: extractQuotedMessage(m), mime: '', isMedia: false, chatUpdate: null, store: messageStore,
    reply: replyText => {
      const body = String(replyText ?? '')
      const finalText = body.includes(CREATOR_FOOTER) ? body : `${body}\n\n${CREATOR_FOOTER_FORMATTED}`
      return socket.sendMessage(jid, { text: finalText }, { quoted: m, contextInfo: channelContextInfo() })
    },
    processing: () => socket.sendMessage(jid, { text: `${config.processingText}\n\n${CREATOR_FOOTER_FORMATTED}` }, { quoted: m, contextInfo: channelContextInfo() }),
    wait: () => socket.sendMessage(jid, { text: `${config.processingText}\n\n${CREATOR_FOOTER_FORMATTED}` }, { quoted: m, contextInfo: channelContextInfo() }),
    channelJid, channelMetadata, channelContextInfo, reloadPlugins, reloadCase, isPublic: () => botPublic, setPublic: value => { botPublic = Boolean(value); socket.public = botPublic }
  }
  try {
    const handled = await runCase(context)
    if (handled !== false) return
  } catch (error) {
    logError(`CASE ${command}`, error)
    try { await socket.sendMessage(jid, { text: `${commandError(error, command)}\n\n${CREATOR_FOOTER_FORMATTED}` }, { quoted: m }) } catch (sendError) { logError('SEND ERROR', sendError) }
    return
  }
  const plugin = getPlugin(command)
  if (!plugin) return
  try {
    const result = await plugin.run(context)
    if (result === false) return
  } catch (error) {
    logError(`COMMAND ${command}`, error)
    try { await socket.sendMessage(jid, { text: `${commandError(error, command)}\n\n${CREATOR_FOOTER_FORMATTED}` }, { quoted: m }) } catch (sendError) { logError('SEND ERROR', sendError) }
  }
}

function shutdown() {
  shuttingDown = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  try { messageStore.flush() } catch (_) {}
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', error => logError('UNCAUGHT', error))
process.on('unhandledRejection', error => logError('UNHANDLED', error))

loadPlugins()
startBot().catch(error => { logError('START', error); scheduleReconnect() })
