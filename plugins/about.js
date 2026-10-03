module.exports = {
  name: 'about',
  aliases: [],
  command: ['about', 'owner'],
  help: ['about', 'owner'],
  tags: ['info'],

  async run({ reply, config }) {
    await reply([
      '╭─「 *FrogzzBotZ* 」',
      '│',
      '',
      '```',
      `Bot     : ${config.botName}`,
      `Version : ${config.version}`,
      '│ Creator : Okta',
      `Owner   : ${config.ownerName}`,
      '```',
      '╰────────────'
    ].join('\n'))
  }
}
