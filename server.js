const express = require('express');
const { config, logStartupStatus, getConfigStatus } = require('./src/config');
const { verifyWebhook, handleWebhookEvent } = require('./src/webhook');
const { safeLog, safeError } = require('./src/logger');

const app = express();

app.use(express.json({ limit: '1mb' }));

// --- Health & status ---

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'instagram-ai-bot' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Safe config snapshot only — never tokens, keys, or secrets.
app.get('/status', (req, res) => {
  res.json(getConfigStatus());
});

// --- Webhook ---

app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookEvent);

// --- Error handling ---
// Malformed JSON bodies are thrown by express.json() before reaching any
// route handler, so they're caught here rather than in webhook.js.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    safeLog('Received malformed JSON body');
    return res.sendStatus(400);
  }
  safeError('Unhandled request error', { message: err?.message || 'unknown' });
  return res.sendStatus(500);
});

app.listen(config.port, '0.0.0.0', () => {
  safeLog(`instagram-ai-bot listening on 0.0.0.0:${config.port}`);
  logStartupStatus();
});

// Visibility for bugs that slip past the try/catch blocks in webhook
// processing — logged, not silently swallowed.
process.on('unhandledRejection', (reason) => {
  safeError('Unhandled promise rejection', { message: reason?.message || String(reason) });
});

process.on('uncaughtException', (err) => {
  safeError('Uncaught exception — shutting down', { message: err?.message || 'unknown' });
  process.exit(1);
});
