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

const FALLBACK_REPLY =
  "Hey! Thanks for your message 😊 We'll get back to you shortly.";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_INPUT_CHARS = 2000;
const MAX_REPLY_TOKENS = 120;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function isAiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generateReply(userText) {
  if (!isAiAvailable()) {
    return FALLBACK_REPLY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const prompt = String(userText || '')
      .slice(0, MAX_INPUT_CHARS)
      .trim();

    if (!prompt) {
      return FALLBACK_REPLY;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: SYSTEM_PROMPT
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: MAX_REPLY_TOKENS,
            temperature: 0.8
          }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      let errorBody = '';

      try {
        errorBody = await response.text();
      } catch (_) {
        errorBody = '';
      }

      safeError('Gemini provider request failed', {
        status: response.status,
        body: errorBody.slice(0, 300)
      });

      return FALLBACK_REPLY;
    }

    const data = await response.json();

    const reply = Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((part) => part?.text || '')
          .join('')
          .trim()
      : '';

    return reply || FALLBACK_REPLY;
  } catch (err) {
    safeError('AI generation error', {
      reason:
        err?.name === 'AbortError'
          ? 'timeout'
          : err?.message || 'request_failed'
    });

    return FALLBACK_REPLY;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateReply,
  isAiAvailable,
  FALLBACK_REPLY
};
