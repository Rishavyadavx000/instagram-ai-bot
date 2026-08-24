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
// --- Privacy Policy ---
app.get('/privacy-policy', (req, res) => {
  res.type('html').send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Personal Social AI</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: auto;
      padding: 25px;
      line-height: 1.6;
      color: #222;
    }
    h1, h2 {
      color: #111;
    }
  </style>
</head>
<body>

<h1>Privacy Policy</h1>
<p><strong>Personal Social AI</strong></p>
<p>Last updated: August 24, 2026</p>

<h2>1. Information We Collect</h2>
<p>
Personal Social AI may receive information necessary to provide its
Instagram messaging functionality, including Instagram messages and
basic account information made available through the Instagram API.
</p>

<h2>2. How We Use Information</h2>
<p>
Information is used only to provide, operate, maintain, and improve the
Instagram messaging service, including generating automated responses.
</p>

<h2>3. AI Processing</h2>
<p>
Messages may be processed by an AI service to generate responses.
Only information necessary to process the user's request is sent for
this purpose.
</p>

<h2>4. Data Sharing</h2>
<p>
We do not sell personal information. Information may be processed by
service providers required to operate the application and its AI
functionality.
</p>

<h2>5. Data Retention</h2>
<p>
We retain information only for as long as reasonably necessary to
provide and maintain the service, unless a longer period is required
by law.
</p>

<h2>6. Data Deletion</h2>
<p>
Users may request deletion of their data by contacting us using the
contact information associated with this application.
</p>

<h2>7. Security</h2>
<p>
Reasonable technical measures are used to protect information handled
by the application.
</p>

<h2>8. Changes to This Policy</h2>
<p>
This Privacy Policy may be updated from time to time. Any changes will
be reflected on this page.
</p>

<h2>9. Contact</h2>
<p>
For privacy-related questions or data deletion requests, please
contact the application owner through the contact email associated
with this app.
</p>

</body>
</html>
  `);
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
