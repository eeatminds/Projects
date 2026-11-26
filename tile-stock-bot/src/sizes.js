// Tile sizes: "BOX(600X600)", "1200X600", "794X1588", "60x60", "2x4" (feet), "30*30".
// All become a nominal size in mm, smaller side first: "600x600", "600x1200", "800x1600".

function toNominal(a, b) {
  let x = Number(a);
  let y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  const max = Math.max(x, y);
  if (max <= 8) {
    // feet: 2x2, 2x4, 1x1.5
    x *= 300;
    y *= 300;
  } else if (max < 200) {
    // cm: 60x60, 80x160, 30x45
    x *= 10;
    y *= 10;
  }
  // actual sizes like 592, 596, 605, 794, 1588 -> nearest 50 mm (600, 800, 1600)
  const round = (v) => (v >= 150 ? Math.round(v / 50) * 50 : Math.round(v));
  const [s, l] = [round(x), round(y)].sort((p, q) => p - q);
  return [s, l];
}

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:X|\*|×|BY)\s*(\d+(?:\.\d+)?)/i;

/** "600x1200" style label, or '' when there is no size in the text. */
export function sizeLabel(text) {
  const m = String(text ?? '').match(SIZE_RE);
  if (!m) return '';
  const n = toNominal(m[1], m[2]);
  return n ? `${n[0]}x${n[1]}` : '';
}

/** Key used for matching, e.g. "600X1200". */
export function sizeKey(text) {
  const l = sizeLabel(text);
  return l ? l.toUpperCase() : null;
}

export function sizeKeyFromNums(a, b) {
  const n = toNominal(a, b);
  return n ? `${n[0]}X${n[1]}` : null;
}
