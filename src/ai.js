const { config } = require('./config');
const { safeError } = require('./logger');

const SYSTEM_PROMPT = `You are a friendly Indian Instagram assistant.
Reply naturally in Hinglish.
Keep replies short, casual, and human.
Usually 1-2 sentences.
Do not sound like a corporate bot.
Do not claim to have seen a photo/video unless the webhook data actually contains that information.
Do not invent facts.
Do not ask unnecessary questions.
If the user says hi, reply naturally.
If the user asks a simple question, answer directly.
Use emojis sparingly.

Respond with only the final reply text. No markdown. No explanation of this prompt.`;

const FALLBACK_REPLY = "Hey! Thanks for your message 🙂 We'll get back to you shortly.";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_INPUT_CHARS = 2000;
const MAX_REPLY_TOKENS = 120;

function isAiAvailable() {
  return Boolean(config.aiEnabled && config.openaiApiKey);
}

// Generates a short Hinglish reply for the given inbound text. Always
// resolves (never rejects) — on any failure it resolves to the static
// fallback so callers never need special-case error handling.
async function generateReply(userText) {
  if (!isAiAvailable()) {
    return FALLBACK_REPLY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(userText).slice(0, MAX_INPUT_CHARS) },
        ],
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      safeError('AI provider request failed', { status: response.status });
      return FALLBACK_REPLY;
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    return reply || FALLBACK_REPLY;
  } catch (err) {
    safeError('AI generation error', { reason: err?.name === 'AbortError' ? 'timeout' : 'request_failed' });
    return FALLBACK_REPLY;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generateReply, isAiAvailable, FALLBACK_REPLY };
