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

const REQUEST_TIMEOUT_MS = 30000;
const MAX_INPUT_CHARS = 2000;
const MAX_REPLY_TOKENS = 120;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.7-flash';

const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';

const MAX_RETRIES = 2;

function isAiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGenerationConfig(model) {
  if (model === 'gemini-3.7-flash') {
    return {
      maxOutputTokens: MAX_REPLY_TOKENS,
      thinkingConfig: {
        thinkingLevel: 'low'
      }
    };
  }

  return {
    maxOutputTokens: MAX_REPLY_TOKENS
  };
}

async function callGemini(model, prompt) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
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

        generationConfig: getGenerationConfig(model)
      }),

      signal: controller.signal
    });

    let data = null;
    let errorText = '';

    try {
      data = await response.json();
    } catch (_) {
      errorText = 'Invalid JSON response';
    }

    if (!response.ok) {
      errorText =
        data?.error?.message ||
        errorText ||
        `HTTP ${response.status}`;

      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 503 ||
        response.status === 504;

      const err = new Error(errorText);
      err.status = response.status;
      err.retryable = retryable;

      throw err;
    }

    const parts = data?.candidates?.[0]?.content?.parts;

    const reply = Array.isArray(parts)
      ? parts
          .map((part) => part?.text || '')
          .join('')
          .trim()
      : '';

    if (!reply) {
      const err = new Error('Gemini returned an empty response');
      err.status = 200;
      err.retryable = true;
      throw err;
    }

    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithRetry(model, prompt) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callGemini(model, prompt);
    } catch (err) {
      lastError = err;

      if (!err.retryable || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay =
        1000 * Math.pow(2, attempt);

      safeError('Gemini temporary error, retrying', {
        model,
        status: err.status || null,
        attempt: attempt + 1,
        retryInMs: delay
      });

      await sleep(delay);
    }
  }

  throw lastError || new Error('Gemini request failed');
}

async function generateReply(userText) {
  if (!isAiAvailable()) {
    safeError('GEMINI_API_KEY is missing');
    return FALLBACK_REPLY;
  }

  const prompt = String(userText || '')
    .slice(0, MAX_INPUT_CHARS)
    .trim();

  if (!prompt) {
    return FALLBACK_REPLY;
  }

  try {
    return await generateWithRetry(
      GEMINI_MODEL,
      prompt
    );
  } catch (primaryError) {
    safeError('Primary Gemini model failed', {
      model: GEMINI_MODEL,
      status: primaryError.status || null,
      reason: primaryError.message || 'unknown'
    });
  }

  // Try a second current Flash model if the primary
  // model is temporarily unavailable.
  if (GEMINI_FALLBACK_MODEL &&
      GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    try {
      safeError('Trying Gemini fallback model', {
        model: GEMINI_FALLBACK_MODEL
      });

      return await generateWithRetry(
        GEMINI_FALLBACK_MODEL,
        prompt
      );
    } catch (fallbackError) {
      safeError('Fallback Gemini model failed', {
        model: GEMINI_FALLBACK_MODEL,
        status: fallbackError.status || null,
        reason: fallbackError.message || 'unknown'
      });
    }
  }

  return FALLBACK_REPLY;
}

module.exports = {
  generateReply,
  isAiAvailable,
  FALLBACK_REPLY
};
