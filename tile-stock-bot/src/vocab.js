// Words people use for polish / finish / tile type, and filler words to ignore.
// Every group lists spellings of ONE thing (all in "norm" form: A-Z and 0-9 only).
// A group only becomes active when that value exists in the uploaded Excel, so a
// short alias like "MT" can never hide a design code that is not a finish.

export const ALIAS_GROUPS = [
  ['PGVT', 'POLISHEDGLAZEDVITRIFIED', 'POLISHEDGLAZEDVITRIFIEDTILES', 'POLISHEDGLAZEDVITRIFIEDTILE', 'POLISHEDGVT', 'PGVTTILES', 'PGVTTILE'],
  ['GVT', 'GLAZEDVITRIFIED', 'GLAZEDVITRIFIEDTILES', 'GLAZEDVITRIFIEDTILE', 'GVTTILES', 'GVTTILE'],
  ['DC', 'DOUBLECHARGE', 'DOUBLECHARGED', 'DOUBLECHARGEVITRIFIED', 'DCVT', 'DCTILES'],
  ['FB', 'FULLBODY', 'FULLBODYVITRIFIED', 'FULLBODYTILES', 'FBVT'],
  ['SS', 'SOLUBLESALT', 'SOLUBLESALTVITRIFIED', 'SSVT'],
  ['GVTMATT', 'GVTMATTE', 'MATTGVT', 'MATTEGVT'],
  ['MATT', 'MATTE', 'MAT', 'MT', 'MATTFINISH', 'MATTEFINISH'],
  ['GLOSSY', 'SHINE', 'SHINY', 'GLOSS', 'GLOSY', 'GLOSSI', 'GL', 'GLOSSYFINISH'],
  ['HG', 'HIGHGLOSS', 'HIGHGLOSSY', 'SUPERGLOSS', 'SUPERGLOSSY', 'HIGLOSS'],
  ['CARVING', 'CARV', 'CRV', 'CARVINGFINISH', 'CARVE', 'CARVED'],
  ['SATIN', 'SATINFINISH', 'SATINMATT'],
  ['RUSTIC', 'RUSTRIC', 'RUSTICFINISH', 'RUSTICMATT'],
  ['SUGAR', 'SUGARFINISH', 'SUGARHONE'],
  ['LAPPATO', 'LAPATO', 'LAPPATTO', 'LAPATTO'],
  ['NANO', 'NANOPOLISH', 'NANOPOLISHED', 'SUPERNANO'],
  ['POLISHED', 'POLISH', 'PL', 'POLISHD'],
  ['METALLIC', 'METALIC', 'METAL'],
  ['WOODEN', 'WOOD', 'WOODFINISH'],
  ['CERAMIC', 'CERAMICS'],
  ['DIGITAL', 'DIGI'],
  ['PREMIUM', 'PREM', 'PRM', 'FIRST', 'GRADE1', 'AGRADE'],
  ['STANDARD', 'STD', 'STAND', 'SECOND', 'GRADE2', 'BGRADE'],
  ['ECONOMY', 'ECO', 'ECON', 'THIRD', 'GRADE3', 'CGRADE'],
  ['COMMERCIAL', 'COMM'],
  ['RGVT', 'RUSTICGVT'],
  ['CEGRES', 'CEGRESS'],
];

const GROUP_OF = new Map();
for (const group of ALIAS_GROUPS) for (const form of group) if (!GROUP_OF.has(form)) GROUP_OF.set(form, group);

/** The alias group a normalised word belongs to, or null. */
export function aliasGroupOf(n) {
  return GROUP_OF.get(n) || null;
}

/** Canonical key for a normalised value: the head of its alias group, or the value itself. */
export function canon(n) {
  const g = GROUP_OF.get(n);
  return g ? g[0] : n;
}

// Words that carry no meaning in a stock question ("pls check stock of 8025 pgvt sir").
export const FILLER = new Set([
  'STOCK', 'STOCKS', 'STK', 'AVAILABLE', 'AVAILABILITY', 'AVL', 'AVAIL', 'PLEASE', 'PLS', 'PLZ', 'PLEASECHECK',
  'HOW', 'MUCH', 'MANY', 'QTY', 'QUANTITY', 'CHECK', 'CHK', 'OF', 'IN', 'FOR', 'THE', 'IS', 'ARE', 'THERE', 'ANY',
  'KITNA', 'KITNE', 'HAI', 'HE', 'H', 'SIR', 'BHAI', 'JI', 'MADAM', 'MAAM', 'BOX', 'BOXES', 'TILE', 'TILES',
  'DESIGN', 'CODE', 'NO', 'NUMBER', 'NOS', 'WHAT', 'WHERE', 'LOCATION', 'GODOWN', 'TELL', 'ME', 'SEND', 'GIVE',
  'KINDLY', 'HI', 'HELLO', 'HII', 'DEAR', 'TEAM', 'AND', 'ALSO', 'WITH', 'NEED', 'WANT', 'REQUIRED',
  'REQ', 'REQUIREMENT', 'IT', 'THIS', 'THAT', 'U', 'YOU', 'HAVE', 'DO', 'WE', 'I', 'A', 'AN', 'OK', 'OKAY',
  'SIZE', 'POLISH', 'FINISH', 'DETAILS', 'DETAIL', 'STATUS', 'UPDATE', 'TODAY', 'NOW', 'ASAP', 'URGENT',
]);

// Words that tell us a message is a stock question even if the code is unknown.
export const QUERY_HINTS = new Set(['STOCK', 'STOCKS', 'STK', 'AVAILABLE', 'AVAILABILITY', 'AVL', 'QTY', 'QUANTITY', 'KITNA', 'KITNE']);

export const HELP_WORDS = new Set(['HELP', 'MENU', 'STOCKHELP', 'BOTHELP', 'START', 'INFO']);
