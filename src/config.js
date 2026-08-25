// Central place for reading environment variables. Nothing in this file
// ever logs a secret value — only booleans/derived status are exposed
// via getConfigStatus() for the /status endpoint.

require('dotenv').config();

function toBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

function toInt(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const config = {
  port: toInt(process.env.PORT, 3000),

  verifyToken: process.env.VERIFY_TOKEN || '',

  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
  instagramUserId: process.env.INSTAGRAM_USER_ID || '',
  metaGraphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.instagram.com',
  // Meta ships new Graph API versions periodically. Keep this current —
  // see the note in .env.example for where to check.
  graphApiVersion: process.env.GRAPH_API_VERSION || 'v26.0',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  aiEnabled: toBool(process.env.AI_ENABLED, true),
  autoReplyEnabled: toBool(process.env.AUTO_REPLY_ENABLED, true),
  autoCommentReplyEnabled: toBool(process.env.AUTO_COMMENT_REPLY_ENABLED, false),
  autoReactionEnabled: toBool(process.env.AUTO_REACTION_ENABLED, false),

  defaultReplyLanguage: process.env.DEFAULT_REPLY_LANGUAGE || 'hinglish',
};

// Safe, non-secret snapshot of configuration — this is what GET /status returns.
function getConfigStatus() {
  return {
    instagramConfigured: Boolean(config.instagramAccessToken && config.instagramUserId),
    aiConfigured: Boolean(config.aiEnabled && config.geminiApiKey),
    webhookConfigured: Boolean(config.verifyToken),
    autoReplyEnabled: config.autoReplyEnabled,
    autoCommentReplyEnabled: config.autoCommentReplyEnabled,
    autoReactionEnabled: config.autoReactionEnabled,
  };
}

// The server must start even when optional variables are missing — this
// only warns so misconfiguration is visible in the logs without crashing.
function logStartupStatus() {
  const status = getConfigStatus();
  console.log('[startup] configuration status:', JSON.stringify(status));

  if (!status.webhookConfigured) {
    console.warn('[startup] VERIFY_TOKEN is not set — GET /webhook will always return 403.');
  }
  if (!status.instagramConfigured) {
    console.warn('[startup] INSTAGRAM_ACCESS_TOKEN and/or INSTAGRAM_USER_ID missing — outbound Instagram API calls will fail until both are set.');
  }
  if (config.aiEnabled && !config.geminiApiKey) {
  console.warn('[startup] AI_ENABLED=true but GEMINI_API_KEY is missing — replies will use the static fallback message.');
  }
  
  if (!config.aiEnabled) {
    console.log('[startup] AI_ENABLED=false — replies will use the static fallback message.');
  }
}

module.exports = { config, getConfigStatus, logStartupStatus };
