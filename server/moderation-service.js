const leoProfanity = require("leo-profanity");

const EXTRA_BLOCKED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "idiot",
  "merda",
  "porra",
  "caralho",
  "puta",
  "otario",
  "otária",
  "burro",
  "burra",
];

const LINK_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b(discord\.gg|t\.me|bit\.ly|tinyurl\.com)\b/i,
];

let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  leoProfanity.clearList();
  leoProfanity.loadDictionary("en");
  leoProfanity.add(EXTRA_BLOCKED_WORDS);
  loaded = true;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLink(value) {
  return LINK_PATTERNS.some((pattern) => pattern.test(String(value || "")));
}

function hasProfanity(value) {
  ensureLoaded();
  return leoProfanity.check(normalize(value).toLowerCase());
}

function validateText(value, options = {}) {
  const {
    field = "text",
    maxLength = 240,
    allowEmpty = true,
    rejectLinks = true,
  } = options;
  const text = normalize(value).slice(0, maxLength);
  if (!allowEmpty && !text) return { ok: false, error: `${field}_required`, text };
  if (rejectLinks && hasLink(text)) return { ok: false, error: `${field}_link_blocked`, text };
  if (hasProfanity(text)) return { ok: false, error: `${field}_blocked`, text };
  return { ok: true, text };
}

function sanitizeText(value, maxLength = 240, fallback = "") {
  const validated = validateText(value, { maxLength, allowEmpty: true });
  if (validated.ok) return validated.text || fallback;
  return fallback;
}

module.exports = {
  hasLink,
  hasProfanity,
  normalize,
  sanitizeText,
  validateText,
};
