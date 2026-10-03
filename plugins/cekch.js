const pending = new Map()

function extractInvite(url) {
  const match = String(url || '').trim().match(/^https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)(?:\/.*)?$/i)
  return match?.[1] || null
}

async function resolve(ctx, url) {
  const invite = extractInvite(url)
  if (!invite) {
    await ctx.reply('❌ URL Channel tidak valid.\n\nContoh: _https://whatsapp.com/channel/xxxxx_')
    return true
  }

  try {
    await ctx.reply('_⏳ Mengecek Channel dan mengambil JID..._')
    if (typeof ctx.Frogzz?.newsletterMetadata !== 'function') {
      await ctx.reply('❌ `newsletterMetadata()` tidak tersedia pada Baileys yang terpasang.')
      return true
    }

    const meta = await ctx.Frogzz.newsletterMetadata('invite', invite)
    if (!meta?.id) {
      await ctx.reply('❌ Channel tidak ditemukan atau URL sudah tidak valid.')
      return true
    }

    const name = typeof meta.name === 'string' ? meta.name : meta.name?.text || '-'
    const desc = typeof meta.description === 'string' ? meta.description : meta.description?.text || '-'
    const followers = meta.subscribers ?? meta.subscribers_count ?? '-'
    const verification = meta.verification || '-'

    await ctx.reply([
      '╭─「 *CHANNEL INFO* 」',
      '│',
      `│ *Nama* : ${name}`,
      `│ *JID* : \`${meta.id}\``,
      `│ *Followers* : ${followers}`,
      `│ *Verification* : ${verification}`,
      `│ *Deskripsi* : ${desc.slice(0, 300)}`,
      '│',
      `│ *URL* : ${url}`,
      '│',
      '╰────────────',
      '',
      '> _© Okta — formerly known as Frogzz_'
    ].join('\n'))
    return true
  } catch (error) {
    console.error('[CEKCH]', error)
    await ctx.reply(`❌ Gagal mengambil data Channel.\n\n_Error: ${String(error?.message || error).slice(0, 180)}_`)
    return true
  }
}

module.exports = {
  name: 'cekch',
  aliases: ['checkch', 'channelinfo'],
  command: ['cekch', 'checkch', 'channelinfo'],
  help: ['cekch', 'checkch', 'channelinfo'],
  tags: ['tools'],

  async run(ctx) {
    const url = String(ctx.args?.[0] || '').trim()
    if (url) return resolve(ctx, url)
    pending.set(ctx.sender || ctx.jid, Date.now())
    setTimeout(() => pending.delete(ctx.sender || ctx.jid), 120000)
    return ctx.reply([
      '╭─「 *CEK CHANNEL* 」',
      '│',
      '│ Kirim URL Channel WhatsApp',
      '│ pada pesan berikutnya.',
      '│',
      '│ Contoh:',
      '│ _https://whatsapp.com/channel/xxxxx_',
      '│',
      '╰────────────'
    ].join('\n'))
  },

  async onText(ctx) {
    const key = ctx.sender || ctx.jid
    if (!pending.has(key)) return false
    pending.delete(key)
    return resolve(ctx, ctx.text)
  }
}
