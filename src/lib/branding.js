const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const THUMB_PATH = path.join(ROOT, 'image', 'thumb.png')

function channelConfig(config = {}) {
  const channel = config.channel || {}
  return {
    name: String(channel.name || '').trim(),
    url: String(channel.url || '').trim(),
    jid: String(channel.jid || '').trim(),
    messageId: Number(channel.messageId || 1) || 1
  }
}

function footer(config = {}) {
  const creator = String(config.creatorName || 'Okta').trim()
  const bot = String(config.botName || 'FrogzzBotZ').trim()
  return `> _© ${creator} • ${bot}_`
}

function channelHeader(config = {}) {
  const ch = channelConfig(config)
  if (!ch.name) return ''
  const link = ch.url ? `\n> ${ch.url}` : ''
  return `> 📢 *${ch.name}*${link}`
}

function decorateText(text, config = {}, options = {}) {
  const body = String(text ?? '').trim()
  const parts = []
  if (!options.skipChannel) {
    const header = channelHeader(config)
    if (header) parts.push(header)
  }
  if (body) parts.push(body)
  parts.push(footer(config))
  return parts.join('\n\n')
}

function contextInfo(config = {}, options = {}) {
  const ch = channelConfig(config)
  const info = {
    forwardingScore: 1,
    isForwarded: true
  }

  if (ch.jid && ch.jid.endsWith('@newsletter')) {
    info.forwardedNewsletterMessageInfo = {
      newsletterJid: ch.jid,
      serverMessageId: ch.messageId,
      newsletterName: ch.name || 'WhatsApp Channel'
    }
  }

  if (ch.url) {
    info.externalAdReply = {
      title: ch.name || config.botName || 'FrogzzBotZ',
      body: `Channel ${ch.name || ''}`.trim(),
      mediaType: 1,
      thumbnail: fs.existsSync(THUMB_PATH) ? fs.readFileSync(THUMB_PATH) : undefined,
      sourceUrl: ch.url,
      showAdAttribution: false,
      renderLargerThumbnail: false
    }
  }

  return info
}

function sendContent(config, content, options = {}) {
  const out = { ...content }
  const existing = out.contextInfo || {}
  out.contextInfo = { ...contextInfo(config, options), ...existing }
  return out
}

module.exports = {
  THUMB_PATH,
  channelConfig,
  footer,
  channelHeader,
  decorateText,
  contextInfo,
  sendContent
}
