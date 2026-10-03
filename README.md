# FrogzzBotZ

Clean CommonJS base for WhatsApp bots built on `@itsliaaa/baileys`.

Designed for small VPS deployments, personal bots, and plugin-based projects. The base keeps the runtime simple: one entry point, a small core, and independent plugins.

## Requirements

- Node.js 20+
- npm
- WhatsApp account for pairing

## Structure

```text
FrogzzBotZ/
├── index.js
├── config.js
├── package.json
├── .env.example
├── README.md
├── config/
│   └── index.js
├── src/
│   ├── core/
│   │   └── Okta.js
│   └── lib/
│       ├── identity.js
│       ├── message-store.js
│       ├── myfunc.js
│       ├── common.js
│       ├── env.js
│       ├── logs.js
│       └── settings.js
├── plugins/
│   ├── about.js
│   └── ping.js
├── assets/
│   └── thumb.png
├── data/
├── database/
└── session/
```

## Setup

```bash
cp .env.example .env
nano .env
npm install
npm start
```

The pairing number is entered directly in the terminal. It is not stored in `.env`.

Example:

```text
Masukan Nomor WhatsApp untuk pairing:
> 628xxxxxxxxxx
```

After the first successful pairing, the session is reused automatically.

## Configuration

`.env`:

```env
BOT_NAME=FrogzzBotZ
BOT_PREFIX=.
OWNER_NAME=Okta
OWNER_NUMBERS=628xxxxxxxxxx
CREATOR_NAME=Okta
PROCESSING_TEXT=🍜 *Sabar Ya Kak Lagi Di Proses*
```

Multiple owners can be separated with commas:

```env
OWNER_NUMBERS=628111111111,628222222222
```

## Commands

### General

```text
.menu
.allmenu
.ping
.runtime
.owner
.cekplugin
```

### Owner

```text
.ownermenu
.listplugin
.addplugin plugin.js
.editplugin plugin.js
.dellplugin plugin.js
.public
.self
```

`.self` limits command processing to the configured owner numbers. `.public` restores normal command processing.

## Plugin format

Plugins use CommonJS and export one object:

```js
module.exports = {
  name: 'hello',
  command: ['hello', 'hi'],
  aliases: ['h'],
  help: ['hello'],
  tags: ['main'],

  async run({ reply, args, pushname }) {
    await reply(`Hello ${pushname}`)
  }
}
```

A plugin can be placed directly inside `plugins/` or a subdirectory below it.

### Plugin context

Common context values include:

```text
Frogzz / sock       WhatsApp socket
m                   incoming message
jid                 current chat
args                command arguments
text / q            command text
command             current command
prefix              bot prefix
reply()             quoted reply helper
processing()        processing message helper
quoted              normalized quoted message
isOwner             owner status
isGroup             group status
groupMetadata       group metadata
isBotAdmin          bot admin status
isSenderAdmin       sender admin status
config              runtime config
commands            loaded plugin map
```

## Add or edit a plugin from WhatsApp

Reply to a message containing valid plugin source code.

```text
.addplugin example.js
```

To replace an existing plugin:

```text
.editplugin example.js
```

The source is syntax-checked before it is loaded. An invalid plugin does not replace the existing file.

## Shell command

Owner-only shell execution is available with `$` at the beginning of a message.

```text
$ pwd
$ ls -la
$ npm -v
$ node -v
```

The command runs on the same server where the bot is running. Output is returned in a code block and is limited to prevent oversized WhatsApp messages.

> Do not expose owner access to untrusted users. Shell commands have the same permissions as the bot process.

## Message style

The base keeps the visible branding compact:

```text
╭─「 *FrogzzBotZ* 」
│
│ ```MINIMAL • FAST • CLEAN```
│
╰────────────

_© Okta — formerly known as Frogzz_
```

The processing helper is intended for commands that actually perform a longer task:

```text
🍜 *Sabar Ya Kak Lagi Di Proses*
```

It is not part of the main menu.

## License

Use, modify, and adapt the base for your own project. Keep third-party package licenses and notices where applicable.

## WhatsApp Channel

Set only `CHANNEL_URL` in `.env`. The bot resolves the Channel JID automatically on connect using Baileys newsletter metadata; you do not need to enter `@newsletter` JID manually.

```env
CHANNEL_URL=https://whatsapp.com/channel/XXXXXXXXXXXX
CHANNEL_NAME=FrogzzBotZ Channel
CHANNEL_MESSAGE_ID=1
```

Baileys supports resolving a channel invite with `newsletterMetadata("invite", inviteCode)` and channel JIDs use the `@newsletter` suffix.
