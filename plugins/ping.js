const { runtime } = require('../src/lib/myfunc')

module.exports = {
  name: 'ping',
  aliases: ['p'],
  command: ['ping', 'p'],
  help: ['ping', 'p'],
  tags: ['info'],

  async run({ reply, m, config, Frogzz, commands }) {
    const sentAt = Date.now()

    const messageAt = m?.messageTimestamp
      ? Number(m.messageTimestamp) * 1000
      : sentAt

    const messageLatency = Math.max(
      0,
      sentAt - messageAt
    )

    const totalFitur =
      commands instanceof Map
        ? commands.size
        : '-'

    const response = Date.now() - sentAt

    return reply([
      '╭─「 *INFO BOT* 」',
      `│ Bot : OktaXCode`,
      `│ Versi : 2.0`,
      `│ Mode : ${config.self ? 'Self' : 'Public'}`,
      `│ Total Fitur : ${totalFitur}`,
      `│ Runtime : ${runtime(process.uptime())}`,
      '╰────────────',
      '',
      '╭─「 *PONG* 」',
      `│ Response : ${response} ms`,
      `│ Message  : ${messageLatency} ms`,
      `│ Status   : ${Frogzz?.user ? 'Connected' : 'Connecting'}`,
      `│ Bot      : ${config.botName || 'OktaXCode'}`,
      '╰────────────'
    ].join('\n'))
  }
}