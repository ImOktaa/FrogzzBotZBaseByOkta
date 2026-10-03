const env = (k, fallback = '') => {
  const v = process.env[k]
  if (v == null || String(v).trim() === '') return fallback
  return String(v).trim().replace(/^['"]|['"]$/g, '')
}

module.exports = {
  botName: env('BOT_NAME', 'FrogzzBotZ'),
  version: '1.0.0',
  creatorName: env('CREATOR_NAME', env('OWNER_NAME', 'Okta')),
  ownerName: env('OWNER_NAME', 'Okta'),
  ownerNumbers: env('OWNER_NUMBERS', '').split(',').map(v => v.replace(/\D/g, '')).filter(Boolean),
  ownerLids: [],
  prefix: env('BOT_PREFIX', '.'),
  processingText: env('PROCESSING_TEXT', '🍜 *Sabar Ya Kak Lagi Di Proses*'),

  pairing: { enabled: true },

  limits: {
    enabled: true,
    max: 8,
    windowMs: 10000
  },

  connection: {
    baseReconnectDelayMs: 5000,
    maxReconnectDelayMs: 60000,
    stableConnectionMs: 30000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    maxMsgRetryCount: 6,
    retryRequestDelayMs: 500,
    groupSendDebounceMs: 0,
    groupMetadataTtlMs: 300000,
    resetGroupSenderKeyOnSendError: true
  },

  logging: { level: 'silent' },

  banner: {
    enabled: true,
    file: './image/thumb.png'
  },

  channel: {
    url: env('CHANNEL_URL', ''),
    name: env('CHANNEL_NAME', 'FrogzzBotZ Channel'),
    messageId: env('CHANNEL_MESSAGE_ID', '1')
  },

  plugins: {
    directory: './plugins',
    allowRemoteInstall: true,
    maxBytes: 524288
  }
}
