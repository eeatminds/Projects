// Small shared helpers.

/** Uppercase and keep only A-Z and 0-9 ("NT-80 25" -> "NT8025"). */
export function norm(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Digits-only phone number with country code. 10-digit numbers get the default country code. */
export function normPhone(value, defaultCountryCode = '91') {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && defaultCountryCode) d = defaultCountryCode + d;
  return d;
}

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export function fmtNum(n) {
  return nf.format(Number(n) || 0);
}

/** Date/time parts in a timezone, e.g. { date: '2026-11-26', time: '09:15', hour: 9, minute: 15 }. */
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Minutes the timezone is ahead of UTC at this moment (IST = 330). */
export function tzOffsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute);
  const actual = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asUtc - actual) / 60000);
}

/** The moment local midnight started today in the timezone. */
export function startOfLocalDay(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const offset = tzOffsetMinutes(date, timeZone);
  return new Date(Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10)) - offset * 60000);
}

export function fmtDateTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
}

export function fmtDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Levenshtein distance, small strings only. */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
