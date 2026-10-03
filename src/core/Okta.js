const fs = require('fs')
const path = require('path')
const config = require('../../config')
const { runtime } = require('../lib/myfunc')

const root = __dirname
const projectRoot = path.resolve(root, '../..')
const pluginDir = path.resolve(projectRoot, config.plugins.directory)
const bannerPath = path.resolve(projectRoot, config.banner.file)

const BOT_NAME = 'OktaXCode'

function getTanggalOktaGanteng() {
  const d = new Date()
  const hari = d.toLocaleDateString('id-ID', { weekday: 'long' })
  const tgl = d.getDate()
  const bulan = d.toLocaleDateString('id-ID', { month: 'short' })
  const tahun = d.getFullYear()
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  return `${hari}, ${tgl} ${bulan} ${tahun} | ${jam}`
}

function botHeader() {
  return `*OktaXCode* • ${getTanggalOktaGanteng()}`
}

async function reply(ctx, text) {
  const { Frogzz, jid, m } = ctx
  const body = String(text?? '').trim()
  const finalText = `${botHeader()}\n\n${body}\n\n> _© Okta — formerly known as Frogzz_`

  return Frogzz.sendMessage(jid, {
    text: finalText,
    contextInfo: typeof ctx.channelContextInfo === 'function'? ctx.channelContextInfo() : {}
  }, { quoted: m })
}

function unwrapQuotedMessage(message) {
  let current = message || {}
  for (let i = 0; i < 6; i++) {
    const nested = current?.ephemeralMessage?.message || current?.viewOnceMessage?.message || current?.viewOnceMessageV2?.message || current?.viewOnceMessageV2Extension?.message || current?.documentWithCaptionMessage?.message
    if (!nested || nested === current) break
    current = nested
  }
  return current || {}
}

function quotedSource(input) {
  const q = input?.quoted || input?.m?.quoted
  if (q) {
    const candidates = [
      q.text, q.body, q.caption,
      q.message?.conversation,
      q.message?.extendedTextMessage?.text,
      q.message?.imageMessage?.caption,
      q.message?.videoMessage?.caption,
      q.message?.documentMessage?.caption,
      q.msg?.conversation,
      q.msg?.extendedTextMessage?.text,
      q.msg?.imageMessage?.caption,
      q.msg?.videoMessage?.caption,
      q.msg?.documentMessage?.caption,
      unwrapQuotedMessage(q.message)?.conversation,
      unwrapQuotedMessage(q.message)?.extendedTextMessage?.text,
      unwrapQuotedMessage(q.message)?.imageMessage?.caption,
      unwrapQuotedMessage(q.message)?.videoMessage?.caption,
      unwrapQuotedMessage(q.message)?.documentMessage?.caption
    ]
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  const message = unwrapQuotedMessage(input?.message || input?.m?.message || {})
  const contexts = [
    message?.extendedTextMessage?.contextInfo,
    message?.imageMessage?.contextInfo,
    message?.videoMessage?.contextInfo,
    message?.documentMessage?.contextInfo,
    message?.buttonsResponseMessage?.contextInfo,
    message?.listResponseMessage?.contextInfo,
    message?.templateButtonReplyMessage?.contextInfo,
  ].filter(Boolean)
  for (const context of contexts) {
    const quoted = context.quotedMessage
    if (!quoted) continue
    const candidates = [quoted.conversation, quoted.extendedTextMessage?.text, quoted.imageMessage?.caption, quoted.videoMessage?.caption, quoted.documentMessage?.caption]
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return ''
}

function menuText(ctx) {
  const { isOwner, prefix } = ctx
  return `Halo kak! 👋

Perkenalkan, saya *${BOT_NAME}*, asisten WhatsApp yang siap membantu kamu.

╭─「 *${BOT_NAME}* 」
│ Owner : ${ctx.config.ownerName}
│ Runtime : ${runtime(process.uptime())}
│ Prefix : ${prefix}
╰────────────

╭─「 *MAIN MENU* 」
│ • ${prefix}menu
│ • ${prefix}allmenu
│ • ${prefix}ping
│ • ${prefix}runtime
│ • ${prefix}owner
╰────────────
${isOwner? `
╭─「 *OWNER MENU* 」
│ • ${prefix}ownermenu
│ • ${prefix}listplugin
│ • ${prefix}addplugin
│ • ${prefix}editplugin
│ • ${prefix}dellplugin
╰────────────` : ''}`
}

async function menu(ctx) {
  // FIX DISINI - JANGAN PAKE footer() & JANGAN BUNGKUS botHeader() LAGI
  const text = menuText(ctx)
  if (config.banner.enabled && fs.existsSync(bannerPath)) {
    try {
      return ctx.Frogzz.sendMessage(ctx.jid, {
        image: fs.readFileSync(bannerPath),
        caption: `${botHeader()}\n\n${text}\n\n> _© Okta — formerly known as Frogzz_`,
        mimetype: 'image/png'
      }, { quoted: ctx.m, contextInfo: typeof ctx.channelContextInfo === 'function'? ctx.channelContextInfo() : {} })
    } catch (_) {}
  }
  // pake reply biar header otomatis
  return reply(ctx, text)
}

function allMenu(ctx) {
  const { isOwner, prefix } = ctx
  const body = `╭─「 *ALL COMMAND* 」
│ • ${prefix}menu
│ • ${prefix}allmenu
│ • ${prefix}ping
│ • ${prefix}runtime
│ • ${prefix}owner
│ • ${prefix}cekplugin
${isOwner? `│
│ • ${prefix}ownermenu
│ • ${prefix}listplugin
│ • ${prefix}addplugin <reply kode> <nama.js>
│ • ${prefix}editplugin <reply kode baru> <nama.js>
│ • ${prefix}dellplugin <nama.js>
│ • ${prefix}public
│ • ${prefix}self` : ''}
╰────────────`
  return reply(ctx, body)
}

function ownerMenu(ctx) {
  if (!ctx.isOwner) return reply(ctx, 'Command ini khusus owner.')
  const { prefix } = ctx
  return reply(ctx, `╭─「 *OWNER CONTROL* 」
│ • ${prefix}cekplugin
│ • ${prefix}listplugin
│ • ${prefix}addplugin
│ • ${prefix}editplugin
│ • ${prefix}dellplugin
│ • ${prefix}public
│ • ${prefix}self
╰────────────`)
}

async function checkPlugins(ctx) {
  const files = fs.existsSync(pluginDir)? fs.readdirSync(pluginDir).filter(name => name.endsWith('.js')).sort() : []
  const commandMap = new Map()
  for (const [command, plugin] of ctx.commands.entries()) {
    const source = plugin.source || '-'
    if (!commandMap.has(source)) commandMap.set(source, [])
    commandMap.get(source).push(command)
  }
  let lines = [`*Plugin Status - ${files.length} plugin*`, '```']
  files.forEach((file, i) => {
    const commands = [...new Set(commandMap.get(`plugins/${file}`) || [])].sort()
    lines.push(`${i + 1}. ${file}`)
    lines.push(` CMD: ${commands.length? commands.map(c => ctx.prefix + c).join(', ') : '-'}`)
  })
  lines.push('```', `Total CMD: ${ctx.commands.size}`)
  return reply(ctx, lines.join('\n'))
}

function safePluginFilename(value) {
  const raw = String(value || '').trim()
  const name = raw.endsWith('.js')? raw : `${raw}.js`
  return name.replace(/[^a-zA-Z0-9._-]/g, '')
}

async function validatePlugin(target) {
  try {
    delete require.cache[require.resolve(target)]
    require(target)
    return true
  } catch (requireError) {
    try {
      await import(`${require('url').pathToFileURL(target).href}?check=${Date.now()}`)
      return true
    } catch (importError) {
      throw new Error(importError.message || requireError.message)
    }
  }
}

async function ownerPluginAdmin(ctx, command) {
  const { isOwner, args, reloadPlugins } = ctx
  if (!isOwner) return reply(ctx, 'Command ini khusus owner.')
  fs.mkdirSync(pluginDir, { recursive: true })
  if (command === 'listplugin') {
    const files = fs.readdirSync(pluginDir).filter(name => name.endsWith('.js')).sort()
    return reply(ctx, files.length? `PLUGIN AKTIF\n\n${files.map((name, i) => `${i + 1}. ${name}`).join('\n')}` : 'Belum ada plugin.')
  }
  if (command === 'addplugin' || command === 'editplugin') {
    const source = quotedSource(ctx)
    const filename = safePluginFilename(args[0])
    if (!source) return reply(ctx, `Reply pesan berisi kode plugin.\nFormat: ${config.prefix}${command} nama.js`)
    if (!filename || filename === '.js') return reply(ctx, `Format: ${config.prefix}${command} nama.js`)
    if (Buffer.byteLength(source, 'utf8') > config.plugins.maxBytes) return reply(ctx, 'Ukuran plugin melebihi batas.')
    const target = path.resolve(pluginDir, filename)
    if (!target.startsWith(path.resolve(pluginDir) + path.sep)) return reply(ctx, 'Path plugin tidak valid.')
    if (command === 'editplugin' &&!fs.existsSync(target)) return reply(ctx, `Plugin ${filename} tidak ditemukan.`)
    const existed = fs.existsSync(target)
    const backup = existed? fs.readFileSync(target) : null
    try {
      fs.writeFileSync(target, source, 'utf8')
      await validatePlugin(target)
      reloadPlugins()
      return reply(ctx, `Plugin ${filename} berhasil ${command === 'editplugin'? 'diubah' : 'ditambahkan'}.`)
    } catch (error) {
      if (backup) fs.writeFileSync(target, backup)
      else if (fs.existsSync(target)) fs.unlinkSync(target)
      try { reloadPlugins() } catch (_) {}
      return reply(ctx, `Gagal ${command}: ${error.message}`)
    }
  }
  if (command === 'dellplugin') {
    const filename = safePluginFilename(args[0])
    if (!filename || filename === '.js') return reply(ctx, `Format: ${config.prefix}dellplugin nama.js`)
    const target = path.resolve(pluginDir, filename)
    if (!target.startsWith(path.resolve(pluginDir) + path.sep)) return reply(ctx, 'Nama plugin tidak valid.')
    if (!fs.existsSync(target)) return reply(ctx, `Plugin ${filename} tidak ditemukan.`)
    fs.unlinkSync(target)
    try { delete require.cache[require.resolve(target)] } catch (_) {}
    reloadPlugins()
    return reply(ctx, `Plugin ${filename} berhasil dihapus.`)
  }
}

module.exports = async function runCase(ctx) {
  const { command, isOwner } = ctx
  if (command === 'menu' || command === 'start' || command === 'help') return menu(ctx)
  if (command === 'allmenu') return allMenu(ctx)
  if (command === 'runtime') return reply(ctx, `Runtime : ${runtime(process.uptime())}`)
  if (command === 'ownermenu') return ownerMenu(ctx)
  if (command === 'cekplugin') return checkPlugins(ctx)
  if (command === 'public') {
    if (!isOwner) return reply(ctx, 'Command ini khusus owner.')
    ctx.setPublic(true)
    return reply(ctx, 'Mode public aktif.')
  }
  if (command === 'self') {
    if (!isOwner) return reply(ctx, 'Command ini khusus owner.')
    ctx.setPublic(false)
    return reply(ctx, 'Mode self aktif.')
  }
  if (['listplugin', 'addplugin', 'editplugin', 'dellplugin'].includes(command)) return ownerPluginAdmin(ctx, command)
  return false
}