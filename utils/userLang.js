/**
 * Resolve user language from request (body / headers).
 * Matches Homework Snap app locales.
 */

const SUPPORTED_LANGS = [
  'tr',
  'en',
  'de',
  'it',
  'fr',
  'ja',
  'es',
  'ru',
  'ko',
  'hi',
  'pt',
  'ar',
];

const LANG_NAME_MAP = {
  tr: 'Turkish',
  en: 'English',
  de: 'German',
  it: 'Italian',
  fr: 'French',
  ja: 'Japanese',
  es: 'Spanish',
  ru: 'Russian',
  ko: 'Korean',
  hi: 'Hindi',
  pt: 'Portuguese',
  ar: 'Arabic',
};

function normalizeLang(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase().split(/[-_]/)[0].slice(0, 5);
  if (!code) return null;
  return SUPPORTED_LANGS.includes(code) ? code : null;
}

/**
 * @param {import('express').Request} req
 * @returns {string} ISO language code (default: en)
 */
function resolveUserLang(req) {
  const candidates = [
    req.body?.userLang,
    req.body?.language,
    req.body?.lang,
    req.headers['x-user-lang'],
    req.headers['x-app-lang'],
    req.query?.language,
    req.query?.lang,
    req.headers['accept-language']?.split(',')[0],
  ];

  for (const candidate of candidates) {
    const lang = normalizeLang(candidate);
    if (lang) return lang;
  }

  return 'en';
}

function langDisplayName(code) {
  return LANG_NAME_MAP[code] || code || 'English';
}

module.exports = {
  SUPPORTED_LANGS,
  resolveUserLang,
  langDisplayName,
  normalizeLang,
};
