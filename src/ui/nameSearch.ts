// Name search that also works when the name is typed in Arabic. The names in the records are written in English letters, so an
// Arabic word is matched by sound: both sides are cut down to a skeleton of consonant classes (vowels left out, like letters
// that sound alike joined: ق ك q k g, ث ت th t, ذ د dh d …), so "ياسر" finds Yaser, "محمد" finds Mohammad / Mohammed / Muhammad,
// "العجمي" finds Alajmi, "عبد الله" finds Abdullah. English search works as before; digits typed in Arabic numerals are accepted.
const ARABIC = /[؀-ۿݐ-ݿ]/;
export const hasArabic = (s: string) => ARABIC.test(s);

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toAsciiDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

const AR: Record<string, string> = {
  ب: 'b', پ: 'b', ت: 't', ث: 't', ج: 'j', چ: 'c', ح: 'h', خ: 'x', د: 'd', ذ: 'd', ر: 'r', ز: 'z', ژ: 'z', س: 's', ش: 'c', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  غ: 'g', ف: 'f', ڤ: 'f', ق: 'k', ك: 'k', ک: 'k', گ: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'h', ھ: 'h'
  // vowels and ع ء are left out; و and ي count as consonants only at the start of a word
};
const LATIN: Record<string, string> = {
  sh: 'c', kh: 'x', gh: 'g', th: 't', dh: 'd', ph: 'f', ch: 'c', ck: 'k',
  b: 'b', c: 'k', d: 'd', f: 'f', g: 'k', h: 'h', j: 'j', k: 'k', l: 'l', m: 'm', n: 'n', p: 'b', q: 'k', r: 'r', s: 's', t: 't', v: 'f', x: 'x', z: 'z'
};
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

/** The sound skeleton of one Arabic word (marks removed, the leading "ال" taken off). */
export function skeletonArabic(word: string, keepAl = false): string {
  let w = word.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا');
  let out = '';
  if (/^ال.{2,}/.test(w)) { w = w.slice(2); if (keepAl) out = 'l'; }
  [...w].forEach((ch, i) => { out += AR[ch] ?? ((ch === 'و' && i === 0) ? 'w' : (ch === 'ي' && i === 0) ? 'y' : ''); });
  return collapse(out);
}
/** The same skeleton for one name written in English letters ("Al-"/"Al" taken off when a real name is left). */
export function skeletonLatin(word: string): string {
  let w = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^(al|el).{3,}/.test(w)) w = w.slice(2);
  const out = w.replace(/sh|kh|gh|th|dh|ph|ch|ck|[a-z]/g, (m, i: number) => LATIN[m] ?? ((m === 'y' || m === 'w') && i === 0 ? m : ''));
  return collapse(out);
}

const words = (s: string) => s.split(/[\s\-_/.]+/).filter(Boolean);

/**
 * A filter for the typed text: empty text lets everybody through. English words must all be found in the fields (any part of a
 * name or the number); an Arabic word is matched by sound against the words of the names. `fields` are the name(s) and the number.
 */
export function nameFilter(query: string): (fields: (string | null | undefined)[]) => boolean {
  const q = toAsciiDigits(query.trim());
  if (!q) return () => true;
  const parts = words(q);
  const arabic = parts.filter(hasArabic).map((w) => ({ w, key: skeletonArabic(w) }));
  const plain = parts.filter((w) => !hasArabic(w)).map((w) => w.toLowerCase());
  const keys = arabic.map((a) => a.key).filter(Boolean);
  // the words run together, the ال kept (عبد العزيز → Abdulaziz)
  const joined = collapse(arabic.map((a) => skeletonArabic(a.w, true)).join(''));
  return (fields) => {
    const list = fields.filter((f): f is string => !!f);
    const hay = list.join(' ').toLowerCase();
    if (!plain.every((w) => hay.includes(w))) return false;
    if (!arabic.length) return true;
    if (!keys.length) return false;
    const names = list.flatMap(words).map(skeletonLatin).filter(Boolean);
    if (keys.every((k) => names.some((n) => n.startsWith(k)))) return true;
    // a name written as one word in English but two in Arabic (عبد الله / Abdullah)
    return keys.length > 1 && list.some((f) => words(f).map(skeletonLatin).join('').includes(joined));
  };
}
