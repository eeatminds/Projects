// Understand a stock question ("1055 pgvt", "pls check 4029 GVT 60x60 hubli sir")
// and find the matching stock rows across all godowns.

import { codeKey } from './describe.js';
import { sizeKey, sizeKeyFromNums } from './sizes.js';
import { ALIAS_GROUPS, FILLER, QUERY_HINTS, aliasGroupOf, canon } from './vocab.js';
import { editDistance, norm } from './util.js';

const FILTER_FIELDS = ['polish', 'category', 'grade'];
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:X|\*|×|BY)\s*(\d+(?:\.\d+)?)(?:\s*(?:MM|CM|FT|FEET|INCH|INCHES))?/g;
const ALL_ALIAS_FORMS = new Set(ALIAS_GROUPS.flat());

const hasDigit = (s) => /\d/.test(s);
const isPhoneLike = (n) => /^\d{10,}$/.test(n);

/** Filter keys of one field value: the whole value plus each word ("Nano Shine" -> NANOSHINE, NANO, GLOSSY). */
function keysOf(value) {
  const out = [];
  const whole = norm(value);
  if (!whole) return out;
  out.push(canon(whole));
  for (const w of String(value).split(/[\s\-/&,]+/)) {
    const n = norm(w);
    if (n && n !== whole) out.push(canon(n));
  }
  return out;
}

export { sizeKey };

export class StockIndex {
  /**
   * @param {Array<object>} rows stock rows ({key, code, raw, name, polish, category, size, grade, shade, location, qty, sqft, godown})
   * @param {{unit?: string, godowns?: Array<{name: string, uploadedAt: string|null, stockDate: string|null}>}} meta
   */
  constructor(rows = [], meta = {}) {
    this.meta = { unit: 'boxes', godowns: [], ...meta };
    this.byCode = new Map(); // key -> rows
    this.display = new Map(); // key -> code as people write it
    this.names = new Map(); // key -> normalised name
    this.designs = new Map(); // "1055P" -> "1055"
    this.vocab = new Map(); // normalised word/phrase -> canonical filter key
    this.vocabLabel = new Map();
    this.godownWords = new Map(); // normalised godown name -> godown name
    this.rowCount = 0;
    const codeVotes = new Map();

    for (const r of rows) {
      const key = r.key || codeKey(r.code);
      if (!key) continue;
      this.rowCount++;
      const row = {
        ...r,
        key,
        _keys: new Set(FILTER_FIELDS.flatMap((f) => keysOf(r[f]))),
        _size: sizeKey(r.size),
        _design: norm(r.code),
        _godown: norm(r.godown),
      };
      if (!this.byCode.has(key)) this.byCode.set(key, []);
      this.byCode.get(key).push(row);
      if (!this.names.has(key) && (r.name || !hasDigit(key))) this.names.set(key, norm(r.name || r.code));
      if (row._design && row._design !== key) this.designs.set(row._design, key);

      // the shortest spelling wins for display: "1055" over "1055P"
      const votes = codeVotes.get(key) || new Map();
      votes.set(r.code, (votes.get(r.code) || 0) + 1);
      codeVotes.set(key, votes);

      for (const f of FILTER_FIELDS) {
        const value = String(r[f] || '').trim();
        if (!value) continue;
        const whole = norm(value);
        const parts = [whole, ...value.split(/[\s\-/&,]+/).map(norm).filter(Boolean)];
        for (const p of parts) {
          const k = canon(p);
          this.vocab.set(p, k);
          if (!this.vocabLabel.has(k)) this.vocabLabel.set(k, p === whole ? value : p);
          const group = aliasGroupOf(p);
          if (group) for (const form of group) this.vocab.set(form, k);
        }
      }
      if (r.godown) this.godownWords.set(norm(r.godown), r.godown);
    }
    for (const g of this.meta.godowns || []) if (g.name) this.godownWords.set(norm(g.name), g.name);
    for (const [key, votes] of codeVotes) {
      const best = [...votes.entries()].sort((a, b) => a[0].length - b[0].length || b[1] - a[1])[0][0];
      this.display.set(key, codeKey(best) === key && /^\d/.test(key) ? best.replace(/[A-Z]+$/i, '') || best : best);
    }
    this.codes = [...this.byCode.keys()];
  }

  get isEmpty() {
    return this.byCode.size === 0;
  }

  godownMeta(name) {
    return (this.meta.godowns || []).find((g) => g.name === name) || null;
  }

  /** Break one line of a message into codes, filters, sizes, godowns and leftovers. */
  parse(line) {
    let s = String(line || '').toUpperCase();
    const sizes = [];
    s = s.replace(SIZE_RE, (_, a, b) => {
      const k = sizeKeyFromNums(a, b);
      if (k) sizes.push(k);
      return ' ';
    });
    const rawTokens = s
      .split(/[^A-Z0-9\-._]+/)
      .map((t) => t.replace(/^[-._]+|[-._]+$/g, ''))
      .filter((t) => norm(t));
    const hint = rawTokens.some((t) => QUERY_HINTS.has(norm(t)));
    const aliasWord = rawTokens.some((t) => ALL_ALIAS_FORMS.has(norm(t)));
    // "1005GVT" typed without a space -> "1005" + "GVT" (but keep real designs like "1055P", "213SF")
    const tokens = rawTokens
      .filter((t) => !FILLER.has(norm(t)))
      .flatMap((t) => {
        const n = norm(t);
        const m = n.match(/^(\d+)([A-Z]{2,})$/);
        if (m && !this.designs.has(n) && (this.vocab.has(m[2]) || ALL_ALIAS_FORMS.has(m[2]))) return [m[1], m[2]];
        return [t];
      });

    // 1. Design codes first ("1055", "1055P", "0708", also "PL WHITE" written with a space).
    const exact = [];
    const rest = [];
    for (let i = 0; i < tokens.length; ) {
      let hit = 0;
      for (let len = Math.min(3, tokens.length - i); len >= 1 && !hit; len--) {
        const joined = tokens.slice(i, i + len).map(norm).join('');
        let key = null;
        let design = null;
        if (len === 1) {
          key = codeKey(joined);
          if (this.designs.has(joined)) design = joined;
        } else if (this.byCode.has(joined)) key = joined; // "PL WHITE"
        else if (this.designs.has(joined)) {
          key = this.designs.get(joined);
          design = joined;
        }
        if (key && this.byCode.has(key)) {
          if (!exact.some((x) => x.code === key && x.design === design)) exact.push({ code: key, design });
          hit = len;
        }
      }
      if (hit) i += hit;
      else rest.push(tokens[i++]);
    }

    // 2. Type / finish / grade words ("pgvt", "high gloss", "premium") and godown names ("hubli").
    const filters = [];
    const filterWords = [];
    const godowns = [];
    const leftovers = [];
    for (let i = 0; i < rest.length; ) {
      let hit = 0;
      for (let len = Math.min(3, rest.length - i); len >= 1 && !hit; len--) {
        const key = rest.slice(i, i + len).map(norm).join('');
        if (this.godownWords.has(key)) {
          const g = this.godownWords.get(key);
          if (!godowns.includes(g)) godowns.push(g);
          hit = len;
        } else if (this.vocab.has(key)) {
          const k = this.vocab.get(key);
          if (!filters.includes(k)) {
            filters.push(k);
            filterWords.push(this.vocabLabel.get(k) || rest.slice(i, i + len).join(' '));
          }
          hit = len;
        }
      }
      if (hit) i += hit;
      else leftovers.push(rest[i++]);
    }

    // 3. Leftovers: typos, partial codes, design names.
    const items = exact.map((x) => ({ type: 'found', code: x.code, design: x.design, by: 'exact' }));
    const codeLike = leftovers.map(norm).filter((n) => hasDigit(n) && !isPhoneLike(n) && n.length >= (exact.length ? 4 : 3));
    for (const t of codeLike) {
      const item = this.resolveLoose(t);
      if (item.type === 'found' && items.some((x) => x.code === item.code)) continue;
      items.push(item);
    }
    if (!items.length) {
      const words = leftovers.map(norm).filter((n) => !hasDigit(n) && n.length >= 3);
      if (words.length) {
        const item = this.resolveName(words);
        if (item) items.push(item);
      }
    }

    return { items, filters, filterWords, sizes, godowns, hint, aliasWord, tokenCount: tokens.length, leftovers };
  }

  /** A token that is not an exact code: unique partial match, list of options, or not found. */
  resolveLoose(t) {
    const key = codeKey(t);
    const partial = this.codes.filter((c) => c.startsWith(key) || (key.length >= 4 && c.includes(key)));
    if (partial.length === 1) return { type: 'found', code: partial[0], by: 'partial', token: t };
    if (partial.length > 1 && partial.length <= 8) return { type: 'ambiguous', token: t, options: partial };
    if (partial.length > 8) return { type: 'ambiguous', token: t, options: partial.slice(0, 8), more: partial.length - 8 };
    const maxDist = key.length >= 6 ? 2 : 1;
    const close = this.codes
      .filter((c) => Math.abs(c.length - key.length) <= maxDist && hasDigit(c) === hasDigit(key))
      .map((c) => [c, editDistance(c, key)])
      .filter(([, d]) => d <= maxDist)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([c]) => c);
    return { type: 'notfound', token: t, options: close };
  }

  /** Search by design name ("paranat", "grand crema"). */
  resolveName(words) {
    const joined = words.join('');
    let hits = this.codes.filter((c) => (this.names.get(c) || '').includes(joined));
    if (!hits.length && words.length > 1) {
      hits = this.codes.filter((c) => words.every((w) => (this.names.get(c) || '').includes(w)));
    }
    if (hits.length === 1) return { type: 'found', code: hits[0], by: 'name', token: joined };
    if (hits.length > 1) return { type: 'ambiguous', token: words.join(' '), options: hits.slice(0, 8), more: Math.max(0, hits.length - 8), byName: true };
    return null;
  }

  /** Rows of a code that match the requested design, type/finish/grade, size and godown. */
  filterRows(item, parsed) {
    const rows = this.byCode.get(item.code) || [];
    const gset = new Set(parsed.godowns.map(norm));
    return rows.filter(
      (r) =>
        (!item.design || r._design === item.design) &&
        (r._keys.size === 0 || parsed.filters.every((k) => r._keys.has(k))) &&
        (!parsed.sizes.length || !r._size || parsed.sizes.includes(r._size)) &&
        (!gset.size || gset.has(r._godown)),
    );
  }
}
