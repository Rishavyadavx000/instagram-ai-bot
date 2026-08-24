const { config } = require('./config');
const { safeLog, safeError, redactId } = require('./logger');
const { generateReply } = require('./ai');
const {
  sendInstagramMessage,
  replyToComment,
  reactToMessageOrSupportedEvent,
} = require('./instagram');
const { processedEventIds } = require('./dedupe');

// ---------------------------------------------------------------------
// GET /webhook — Meta's verification handshake
// ---------------------------------------------------------------------
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const tokenMatches = Boolean(config.verifyToken) && token === config.verifyToken;

  if (mode === 'subscribe' && tokenMatches) {
    safeLog('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  // Deliberately not logging the token value itself, only whether mode was present.
  safeLog('Webhook verification failed', { mode: mode || 'missing' });
  return res.sendStatus(403);
}

// ---------------------------------------------------------------------
// POST /webhook — event receiver
// ---------------------------------------------------------------------
function handleWebhookEvent(req, res) {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    safeLog('Unsupported event received');
    return res.sendStatus(200);
  }

  // Acknowledge immediately — Meta retries aggressively if it doesn't get a
  // fast 200, and AI generation / outbound API calls are too slow to do
  // before responding. Everything else happens after this line.
  res.sendStatus(200);

  setImmediate(() => {
    processWebhookBody(body).catch((err) => {
      safeError('Unhandled error while processing webhook body', { message: err?.message || 'unknown' });
    });
  });
}

async function processWebhookBody(body) {
  const events = extractEventsFromBody(body);

  if (events.length === 0) {
    safeLog('Unsupported event received');
    return;
  }

  for (const event of events) {
    try {
      await routeEvent(event);
    } catch (err) {
      safeError('Error while handling event', { type: event.type, message: err?.message || 'unknown' });
    }
  }
}

// ---------------------------------------------------------------------
// Defensive parsing — Meta/Instagram payloads vary in shape depending on
// which webhook fields are subscribed, so nothing here assumes a fixed
// nesting beyond "entry is an array".
// ---------------------------------------------------------------------
function extractEventsFromBody(body) {
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const events = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const m of messagingEvents) {
      const parsed = parseMessagingEvent(entry, m);
      if (parsed) events.push(parsed);
    }

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const parsed = parseChangeEvent(entry, change);
      if (parsed) events.push(parsed);
    }
  }

  return events;
}

function parseMessagingEvent(entry, m) {
  if (!m || typeof m !== 'object') return null;

  const senderId = m.sender?.id || null;
  const recipientId = m.recipient?.id || null;
  const timestamp = m.timestamp || entry.time || null;

  if (m.message && typeof m.message === 'object') {
    // Echoes of messages this bot itself sent — never reply to these.
    if (m.message.is_echo) {
      return { type: 'message_echo', senderId, recipientId, messageId: m.message.mid || null, timestamp };
    }

    return {
      type: 'message',
      senderId,
      recipientId,
      messageId: m.message.mid || null,
      text: typeof m.message.text === 'string' ? m.message.text : null,
      timestamp,
    };
  }

  if (m.reaction) {
    return { type: 'message_reaction', senderId, recipientId, messageId: m.reaction.mid || null, timestamp };
  }

  // Postbacks, referrals, reads, etc. — not required by this bot, but
  // parsed as a known-unknown so they're logged cleanly instead of crashing.
  return { type: 'unknown_messaging_event', senderId, recipientId, timestamp };
}

function parseChangeEvent(entry, change) {
  if (!change || typeof change !== 'object') return null;

  const field = change.field;
  const value = (change.value && typeof change.value === 'object') ? change.value : {};
if (field === 'messages') {
  return {
    type: 'message',
    senderId: value.sender?.id || null,
    recipientId: value.recipient?.id || null,
    messageId: value.message?.mid || null,
    text: typeof value.message?.text === 'string'
      ? value.message.text
      : null,
    timestamp: value.timestamp || entry.time || null,
  };
}
  if (field === 'comments') {
    return {
      type: 'comment',
      commentId: value.id || null,
      text: typeof value.text === 'string' ? value.text : null,
      senderId: value.from?.id || value.sender_id || null,
      mediaId: value.media?.id || null,
      timestamp: entry.time || null,
    };
  }

  return { type: `unknown_change:${field || 'unknown'}`, timestamp: entry.time || null };
}

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------
async function routeEvent(event) {
  switch (event.type) {
    case 'message':
      return handleIncomingMessage(event);
    case 'comment':
      return handleIncomingComment(event);
    case 'message_echo':
      safeLog('Ignoring echo of our own outbound message');
      return;
    case 'message_reaction':
      safeLog('Ignoring inbound message reaction event');
      return;
    default:
      safeLog('Unsupported event received', { type: event.type });
      return;
  }
}

// ---------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------
async function handleIncomingMessage(event) {
  const { senderId, messageId, text } = event;

  if (!senderId || !text || !text.trim()) {
    safeLog('Ignoring message: missing sender or empty text');
    return;
  }

  if (config.instagramUserId && senderId === config.instagramUserId) {
    safeLog('Ignoring message from bot account itself');
    return;
  }

  if (!markProcessedOnce(messageId ? `msg:${messageId}` : null, senderId)) {
    return;
  }

  if (!config.autoReplyEnabled) {
    safeLog('Auto-reply disabled, skipping reply', { senderId: redactId(senderId) });
    return;
  }

  const replyText = await generateReply(text);

  try {
    await sendInstagramMessage(senderId, replyText);
    safeLog('Reply sent', { eventType: 'message', senderId: redactId(senderId), success: true });
  } catch (err) {
    safeError('Reply failed', { eventType: 'message', senderId: redactId(senderId), success: false });
    return;
  }

  if (config.autoReactionEnabled && messageId) {
    await reactToMessageOrSupportedEvent({ type: 'message', messageId, recipientId: senderId });
  }
}

// ---------------------------------------------------------------------
// Comment handling
// ---------------------------------------------------------------------
async function handleIncomingComment(event) {
  const { commentId, text } = event;

  if (!config.autoCommentReplyEnabled) {
    safeLog('Auto comment reply disabled, skipping', { commentId: redactId(commentId) });
    return;
  }

  if (!commentId || !text || !text.trim()) {
    safeLog('Ignoring comment: missing id or empty text');
    return;
  }

  if (!markProcessedOnce(`comment:${commentId}`, commentId)) {
    return;
  }

  const replyText = await generateReply(text);

  try {
    await replyToComment(commentId, replyText);
    safeLog('Comment reply sent', { commentId: redactId(commentId), success: true });
  } catch (err) {
    safeError('Comment reply failed', { commentId: redactId(commentId), success: false });
  }
}

// ---------------------------------------------------------------------
// Duplicate-event protection
// ---------------------------------------------------------------------
function markProcessedOnce(dedupeKey, logIdForDuplicate) {
  if (!dedupeKey) return true; // nothing to key on — proceed rather than silently drop
  if (processedEventIds.has(dedupeKey)) {
    safeLog('Duplicate event ignored', { id: redactId(logIdForDuplicate) });
    return false;
  }
  processedEventIds.add(dedupeKey);
  return true;
}

module.exports = { verifyWebhook, handleWebhookEvent };
