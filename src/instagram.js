const { config } = require('./config');

class InstagramApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = status;
  }
}

function buildUrl(path) {
  const base = config.metaGraphBaseUrl.replace(/\/+$/, '');
  const version = config.graphApiVersion.replace(/^\/+|\/+$/g, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}/${version}${cleanPath}`;
}

// Trims text to fit maxBytes when UTF-8 encoded, without splitting a
// multi-byte character. Instagram's message endpoint caps text at 1000 bytes.
function truncateUtf8Bytes(text, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  let truncated = text;
  while (truncated.length > 0 && encoder.encode(truncated).length > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

// Reusable helper for all outbound Instagram Graph API calls.
// - Adds the access token via the Authorization header (never in the URL).
// - Times out instead of hanging forever.
// - Never includes the access token in a thrown error message.
async function instagramRequest(method, path, { body, timeoutMs = 10000 } = {}) {
  if (!config.instagramAccessToken) {
    throw new InstagramApiError('Instagram access token is not configured', 0);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(path), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.instagramAccessToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const raw = await response.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      const message = (data && data.error && data.error.message) || `Instagram API responded with status ${response.status}`;
      throw new InstagramApiError(message, response.status);
    }

    return data;
  } catch (err) {
    if (err instanceof InstagramApiError) throw err;
    if (err.name === 'AbortError') {
      throw new InstagramApiError('Instagram API request timed out', 0);
    }
    throw new InstagramApiError('Instagram API request failed', 0);
  } finally {
    clearTimeout(timeout);
  }
}

// Sends a text DM to an Instagram-scoped user who has already messaged
// this account (per Meta's messaging window rules). Uses the Instagram
// API with Instagram Login send endpoint: POST /<IG_ID>/messages.
async function sendInstagramMessage(recipientId, text) {
  if (!recipientId || !text) {
    throw new Error('recipientId and text are required to send a message');
  }
  if (!config.instagramUserId) {
    throw new InstagramApiError('INSTAGRAM_USER_ID is not configured', 0);
  }

  const safeText = truncateUtf8Bytes(String(text), 1000);

  return instagramRequest('POST', `/${config.instagramUserId}/messages`, {
    body: {
      recipient: { id: recipientId },
      message: { text: safeText },
    },
  });
}

// Replies to a comment via POST /<comment-id>/replies. Requires the
// instagram_business_manage_comments permission on the access token.
async function replyToComment(commentId, text) {
  if (!commentId || !text) {
    throw new Error('commentId and text are required to reply to a comment');
  }

  return instagramRequest('POST', `/${commentId}/replies`, {
    body: { message: String(text).slice(0, 2200) },
  });
}

// Reacts to a received message. This is currently only supported for
// message events (not comments) — POST /<IG_ID>/messages with
// sender_action: "react". Any other event type is logged and skipped
// rather than attempted, per the "don't pretend every event supports
// this" requirement.
async function reactToMessageOrSupportedEvent(event = {}) {
  const { type, messageId, recipientId } = event;

  if (type !== 'message' || !messageId || !recipientId || !config.instagramUserId) {
    console.log('Reaction not supported for this event');
    return null;
  }

  try {
    return await instagramRequest('POST', `/${config.instagramUserId}/messages`, {
      body: {
        recipient: { id: recipientId },
        sender_action: 'react',
        payload: {
          message_id: messageId,
          reaction: 'love',
        },
      },
    });
  } catch (err) {
    console.log('Reaction not supported for this event');
    return null;
  }
}

module.exports = {
  instagramRequest,
  sendInstagramMessage,
  replyToComment,
  reactToMessageOrSupportedEvent,
  InstagramApiError,
};
