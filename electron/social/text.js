// How each platform measures and assembles post text. The renderer mirrors
// these in renderer/src/pages/Social.jsx (keep both in step).
const URL_RE = /https?:\/\/[^\s]+/gi;

// Platforms without a separate link field get the link appended to the text.
function withLink(text, link) {
  if (!link || text.includes(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

// X, close to twitter-text: links 23, most Latin/Greek/Cyrillic and
// punctuation 1, everything else (CJK, emoji) 2.
function countX(text) {
  const s = String(text || '');
  let n = (s.match(URL_RE) || []).length * 23;
  for (const ch of s.replace(URL_RE, '')) {
    const c = ch.codePointAt(0);
    n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
  }
  return n;
}

// Mastodon: links count as `urlChars` (23 by default), a remote mention
// @user@server only as @user, everything else one per code point.
function countMastodon(text, urlChars = 23) {
  const s = String(text || '');
  let n = (s.match(URL_RE) || []).length * urlChars;
  const rest = s.replace(URL_RE, '').replace(/(@[\w.]+)@[\w.-]+\w/g, '$1');
  return n + [...rest].length;
}

// Bluesky: user-perceived characters (graphemes), so an emoji with skin tone
// is one.
function countGraphemes(text) {
  const s = String(text || '');
  if (typeof Intl.Segmenter === 'function') {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n++;
    return n;
  }
  return [...s].length;
}

module.exports = { URL_RE, withLink, countX, countMastodon, countGraphemes };
