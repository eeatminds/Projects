// Turn a parsed stock question into the WhatsApp reply text.
// WhatsApp formatting: *bold*, _italic_.

import { HELP_WORDS } from './vocab.js';
import { fmtNum, norm, zonedParts } from './util.js';

const MAX_LINES_PER_MESSAGE = 10;
const MAX_VARIANTS = 5;
const MAX_BATCHES = 6;
const MAX_REPLY_CHARS = 3500;

const SINGULAR = { boxes: 'box', pcs: 'pc', cartons: 'carton' };
function qtyText(n, unit) {
  const u = Math.abs(n) === 1 && SINGULAR[unit] ? SINGULAR[unit] : unit;
  return `${fmtNum(n)} ${u}`.trim();
}

function uniqueLabels(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const k = norm(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(v).trim());
  }
  return out;
}

/**
 * Group rows of one design into variants (type · finish · grade · size),
 * each with stock per godown and per batch.
 */
export function groupVariants(rows) {
  const variants = new Map();
  for (const r of rows) {
    const key = [r.category, r.polish, r.grade, r._size || r.size].map(norm).join('|');
    if (!variants.has(key)) {
      variants.set(key, {
        label: uniqueLabels([r.category, r.polish, r.grade, r.size]).join(' · '),
        total: 0,
        godowns: new Map(),
      });
    }
    const v = variants.get(key);
    const qty = Number(r.qty) || 0;
    v.total += qty > 0 ? qty : 0;
    const gname = r.godown || '';
    if (!v.godowns.has(gname)) v.godowns.set(gname, { name: gname, total: 0, batches: new Map() });
    const g = v.godowns.get(gname);
    if (qty <= 0) continue;
    g.total += qty;
    const bkey = norm(r.shade) || '-';
    if (!g.batches.has(bkey)) g.batches.set(bkey, { batch: r.shade || '', qty: 0, racks: new Set() });
    const b = g.batches.get(bkey);
    b.qty += qty;
    if (r.location) b.racks.add(r.location);
  }
  return [...variants.values()].sort((a, b) => b.total - a.total);
}

function variantLines(v, unit, opts) {
  const lines = [];
  if (v.label) lines.push(`*${v.label}*`);
  if (v.total <= 0) {
    lines.push('❌ Out of stock');
    return lines;
  }
  const godowns = [...v.godowns.values()].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  for (const g of godowns) {
    lines.push(`🏬 ${g.name || 'Stock'}: *${qtyText(g.total, unit)}*`);
    if (!opts.showBatch) continue;
    const batches = [...g.batches.values()].sort((a, b) => b.qty - a.qty);
    const named = batches.filter((b) => b.batch);
    if (!named.length) continue;
    for (const b of batches.slice(0, MAX_BATCHES)) {
      const rack = opts.showRack && b.racks.size ? ` (${[...b.racks].slice(0, 3).join(', ')})` : '';
      lines.push(`   • ${b.batch || 'No batch'} – ${fmtNum(b.qty)}${rack}`);
    }
    if (batches.length > MAX_BATCHES) {
      const rest = batches.slice(MAX_BATCHES);
      lines.push(`   • +${rest.length} more batches – ${fmtNum(rest.reduce((s, b) => s + b.qty, 0))}`);
    }
  }
  if (godowns.length > 1) lines.push(`Total: *${qtyText(v.total, unit)}*`);
  return lines;
}

function codeTitle(index, code) {
  const rows = index.byCode.get(code) || [];
  const shown = index.display.get(code) || code;
  const name = rows.find((r) => r.name && norm(r.name) !== norm(shown))?.name;
  return name ? `*${shown}* – ${name}` : `*${shown}*`;
}

function availableSummary(index, code, unit) {
  return groupVariants(index.byCode.get(code) || [])
    .slice(0, 8)
    .map((v) => `• ${v.label || 'Stock'}: ${v.total > 0 ? qtyText(v.total, unit) : 'out of stock'}`);
}

/** Reply block + log outcome for one found code. */
function foundBlock(index, item, parsed, opts) {
  const unit = index.meta.unit || 'boxes';
  const lines = [codeTitle(index, item.code)];
  const rows = index.filterRows(item, parsed);
  const godownsUsed = new Set();
  if (!rows.length) {
    const asked = [item.design, ...parsed.filterWords, ...parsed.sizes.map((s) => s.toLowerCase()), ...parsed.godowns].filter(Boolean).join(' ');
    lines.push(`❌ Not available in ${asked}.`);
    const avail = availableSummary(index, item.code, unit);
    if (avail.length) lines.push('Available:', ...avail);
    for (const r of index.byCode.get(item.code) || []) godownsUsed.add(r.godown);
    return { text: lines.join('\n'), outcome: 'unavailable', godowns: godownsUsed };
  }
  for (const r of rows) godownsUsed.add(r.godown);
  const variants = groupVariants(rows);
  const inStock = variants.filter((v) => v.total > 0);
  const empty = variants.filter((v) => v.total <= 0);
  inStock.slice(0, MAX_VARIANTS).forEach((v, i) => {
    if (i > 0) lines.push('');
    lines.push(...variantLines(v, unit, opts));
  });
  if (inStock.length > MAX_VARIANTS) {
    lines.push('', `…${inStock.length - MAX_VARIANTS} more types in stock. Send type/size too, e.g. *${index.display.get(item.code)} PGVT 600x1200*`);
  }
  if (empty.length) {
    if (!inStock.length && empty.length === 1) lines.push(...variantLines(empty[0], unit, opts));
    else {
      const labels = empty.slice(0, 4).map((v) => v.label || 'stock').join(', ');
      lines.push('', `❌ Out of stock: ${labels}${empty.length > 4 ? ` +${empty.length - 4} more` : ''}`);
    }
  }
  return { text: lines.join('\n'), outcome: inStock.length ? 'in_stock' : 'out_of_stock', godowns: godownsUsed };
}

function optionsText(index, codes) {
  return codes
    .map((c) => {
      const name = index.byCode.get(c)?.find((r) => r.name)?.name || '';
      return `• ${index.display.get(c) || c}${name ? ` – ${name}` : ''}`;
    })
    .join('\n');
}

export function helpText(businessName, { isAdmin = false } = {}) {
  const lines = [
    `🙏 *${businessName} – Stock Check*`,
    '',
    'Send the design code with type, for example:',
    '• *1055 PGVT*',
    '• *4029 GVT 600x600*',
    '• *5091 DC premium*',
    '',
    'You can ask for many codes at once – one code per line.',
  ];
  if (isAdmin) {
    lines.push(
      '',
      '*Admin:*',
      '• Send a godown\'s stock Excel here to update it (file name or caption must have the godown name, e.g. *Hubli*)',
      '• *status* – see when each godown was last updated',
    );
  }
  return lines.join('\n');
}

const shortDate = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short' }).format(new Date(iso));

/** "Stock as on 25 Nov: Hubli, Bhatkal" + warning for godowns not updated today. */
export function stockFooter(index, godownNames, { timeZone, now = new Date() }) {
  const today = zonedParts(now, timeZone).date;
  const byDate = new Map();
  const stale = [];
  for (const name of godownNames) {
    const g = index.godownMeta(name);
    if (!g?.uploadedAt) continue;
    const label = g.stockDate ? shortDate(`${g.stockDate}T12:00:00Z`, 'UTC') : shortDate(g.uploadedAt, timeZone);
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label).push(name);
    if (zonedParts(new Date(g.uploadedAt), timeZone).date !== today) stale.push(name);
  }
  if (!byDate.size) return '';
  const parts = [...byDate.entries()].map(([d, names]) => `${names.join(', ')} ${d}`);
  const lines = [`_Stock as on: ${parts.join(' · ')}_`];
  if (stale.length) lines.push(`⚠️ _${stale.join(', ')} not updated today – stock may have changed._`);
  return lines.join('\n');
}

/**
 * Answer a whole message.
 * @returns {{relevant: boolean, help: boolean, reply: string, outcomes: Array<{code: string|null, token: string|null, outcome: string}>}}
 *   relevant=false means "this is not a stock question - stay silent".
 * @param {object} opts { timeZone, now, strict, businessName, showBatch, showRack }
 *   strict=true in groups: reply only when sure it is a stock question.
 */
export function answerMessage(index, text, opts = {}) {
  const { timeZone = 'Asia/Kolkata', now = new Date(), strict = false, businessName = 'Stock' } = opts;
  const view = { showBatch: opts.showBatch !== false, showRack: !!opts.showRack };
  const body = String(text || '').trim();
  if (!body) return { relevant: false, help: false, reply: '', outcomes: [] };
  if (HELP_WORDS.has(norm(body))) return { relevant: true, help: true, reply: helpText(businessName), outcomes: [] };

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES_PER_MESSAGE);
  const blocks = [];
  const outcomes = [];
  const godownsUsed = new Set();
  let relevant = false;

  for (const line of lines) {
    const p = index.parse(line);
    const strongSignal = p.hint || p.filters.length > 0 || p.sizes.length > 0 || p.aliasWord || p.godowns.length > 0;
    const shortCodeOnly = p.tokenCount <= 2;

    if (index.isEmpty) {
      const codeTok = p.leftovers.find((t) => /\d/.test(t) && norm(t).length >= 3);
      if (codeTok && (strongSignal || (!strict && shortCodeOnly))) {
        relevant = true;
        outcomes.push({ code: null, token: norm(codeTok), outcome: 'no_stock_list' });
      }
      continue;
    }

    for (const item of p.items) {
      if (item.type === 'found') {
        relevant = true;
        const b = foundBlock(index, item, p, view);
        blocks.push(b.text);
        for (const g of b.godowns) godownsUsed.add(g);
        outcomes.push({ code: index.display.get(item.code) || item.code, token: item.token || null, outcome: b.outcome });
      } else if (item.type === 'ambiguous') {
        if (strict && !strongSignal && !item.byName) continue;
        relevant = true;
        const head = item.byName ? `🔎 Found these designs for *${item.token.toLowerCase()}*:` : `🔎 *${item.token}* matches more than one design:`;
        const more = item.more ? `\n…and ${item.more} more` : '';
        blocks.push(`${head}\n${optionsText(index, item.options)}${more}\nPlease send the full code.`);
        outcomes.push({ code: null, token: item.token, outcome: 'ambiguous' });
      } else if (item.type === 'notfound') {
        if (!(strongSignal || (!strict && shortCodeOnly))) continue;
        relevant = true;
        const sugg = item.options.length ? `\nDid you mean: ${item.options.map((c) => `*${index.display.get(c) || c}*`).join(', ')}?` : '';
        blocks.push(`❌ *${item.token}* is not in the stock list.${sugg}`);
        outcomes.push({ code: null, token: item.token, outcome: 'not_found' });
      }
    }
  }

  if (!relevant) return { relevant: false, help: false, reply: '', outcomes: [] };
  if (index.isEmpty) {
    return { relevant: true, help: false, reply: "⏳ Today's stock list is not uploaded yet. Please try again a little later.", outcomes };
  }

  let reply = blocks.join('\n\n');
  if (reply.length > MAX_REPLY_CHARS) reply = `${reply.slice(0, MAX_REPLY_CHARS)}\n…\n(Reply too long – please ask fewer codes at a time.)`;
  const footer = stockFooter(index, [...godownsUsed].filter(Boolean), { timeZone, now });
  if (footer) reply += `\n\n${footer}`;
  return { relevant: true, help: false, reply, outcomes };
}
