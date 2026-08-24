// Small logging helper. The rule for every call site in this project:
// log event types, ids (partially redacted), and success/failure —
// never tokens, secrets, or full request/response bodies.

function redactId(id) {
  if (id === null || id === undefined || id === '') return 'unknown';
  const str = String(id);
  if (str.length <= 4) return '*'.repeat(str.length);
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

function safeLog(message, meta) {
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[info] ${message}`, JSON.stringify(meta));
  } else {
    console.log(`[info] ${message}`);
  }
}

function safeError(message, meta) {
  if (meta && Object.keys(meta).length > 0) {
    console.error(`[error] ${message}`, JSON.stringify(meta));
  } else {
    console.error(`[error] ${message}`);
  }
}

module.exports = { redactId, safeLog, safeError };
