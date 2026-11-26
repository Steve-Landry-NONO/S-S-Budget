// Secure-by-default server configuration (R-01).
// APP_SECRET protects the API (x-ss-budget-secret) AND signs session tokens.
// There is no fallback key and no development bypass: the server refuses to start
// when the secret is unsafe, whatever NODE_ENV is. The secret value is never logged.
const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;

// Values that are public (repository, documentation, former fallback key).
const PUBLIC_SECRETS = [
  'change-moi-avec-une-phrase-longue',
  'une-phrase-longue-et-privee',
  'ss-budget-dev-insecure-secret-changez-moi',
  'app_secret',
];
const PUBLIC_FRAGMENTS = ['change-moi', 'changez-moi', 'changeme', 'change-me', 'insecure', 'example', 'exemple'];

const GENERATE_HINT = "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

function validateAppSecret(value) {
  if (value === undefined || value === null || value === '') return { ok: false, reason: 'absent' };
  const secret = String(value);
  if (secret !== secret.trim()) return { ok: false, reason: 'entouré d’espaces (les en-têtes HTTP les suppriment)' };
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: `trop court (${secret.length} < ${MIN_SECRET_LENGTH} caractères)` };
  const lower = secret.toLowerCase();
  if (PUBLIC_SECRETS.includes(lower) || PUBLIC_FRAGMENTS.some((f) => lower.includes(f))) return { ok: false, reason: 'public ou valeur d’exemple' };
  if (new Set(secret).size < MIN_DISTINCT_CHARS) return { ok: false, reason: `trop peu varié (< ${MIN_DISTINCT_CHARS} caractères distincts)` };
  return { ok: true };
}

// Constant-time comparison independent of the input length.
function secretsEqual(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided ?? ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { validateAppSecret, secretsEqual, MIN_SECRET_LENGTH, MIN_DISTINCT_CHARS, GENERATE_HINT };
