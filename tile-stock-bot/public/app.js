// Admin panel (no build step, no framework).

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = 'icon') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const num = (n) => nf.format(Number(n) || 0);

let state = { status: null, tz: 'Asia/Kolkata', page: 'home', reportDays: 7 };
let waTimer = null;
let statusTimer = null;

// ---------- api ----------
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['X-Requested-With'] = 'tsb';
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && path !== 'api/login') {
    showLogin();
    throw new Error('Please log in');
  }
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

/** WhatsApp formatting (*bold*, _italic_) to safe HTML. */
function waHtml(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,)])/gm, '$1<i>$2</i>')
    .replace(/\n/g, '<br>');
}

const fmt = {
  dateTime: (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: state.tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
  time: (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: state.tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
  day: (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d),
  today: () => new Intl.DateTimeFormat('en-IN', { timeZone: state.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
  hour: () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: state.tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date())),
  phone: (p) => {
    if (!p || p === 'self') return p === 'self' ? 'Shop phone' : '';
    if (p.startsWith('91') && p.length === 12) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
    return `+${p}`;
  },
};

// ---------- auth ----------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  clearInterval(statusTimer);
  clearInterval(waTimer);
  setTimeout(() => $('#login-password').focus(), 50);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    await api('api/login', { method: 'POST', body: { password: $('#login-password').value } });
    $('#login-password').value = '';
    startApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$$('.js-logout').forEach((b) =>
  b.addEventListener('click', async () => {
    await api('api/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  }),
);

// ---------- status ----------
function waPill(wa) {
  const map = {
    open: ['good', 'WhatsApp connected'],
    qr: ['warn', 'Scan QR to link'],
    connecting: ['info', 'Connecting…'],
    logged_out: ['bad', 'Not linked'],
    stopped: ['bad', 'WhatsApp stopped'],
    disabled: ['', 'WhatsApp off'],
  };
  const [cls, label] = map[wa?.status] || ['', wa?.status || '—'];
  return `<a href="#whatsapp" class="pill ${cls}" style="text-decoration:none"><span class="dot"></span>${label}</a>`;
}

async function loadStatus() {
  const s = await api('api/status');
  state.status = s;
  state.tz = s.timeZone || state.tz;
  $$('.js-business').forEach((el) => (el.textContent = s.businessName || 'Stock Bot'));
  document.title = `${s.businessName || 'Stock'} · Stock Bot`;
  $('#wa-pill-side').innerHTML = waPill(s.whatsapp);
  $('#wa-pill-top').innerHTML = waPill(s.whatsapp);
  if (state.page === 'home') renderHome();
  return s;
}

// ---------- router ----------
const loaders = {
  home: () => renderHome(),
  stock: () => loadStock(),
  whatsapp: () => loadWhatsApp(),
  people: () => loadPeople(),
  reports: () => loadReports(),
  settings: () => loadSettings(),
};

function route() {
  const page = (location.hash || '#home').slice(1);
  state.page = loaders[page] ? page : 'home';
  $$('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== state.page));
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page));
  clearInterval(waTimer);
  Promise.resolve().then(() => loaders[state.page]()).catch((e) => toast(e.message));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

async function startApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  await loadStatus();
  route();
  clearInterval(statusTimer);
  statusTimer = setInterval(() => loadStatus().catch(() => {}), 30_000);
}

// ---------- home ----------
function stat(label, value, note = '') {
  return `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
}

function godownPill(g) {
  if (!g.upload) return '<span class="pill bad"><span class="dot"></span>Never uploaded</span>';
  if (g.today) return `<span class="pill good"><span class="dot"></span>Today ${esc(fmt.time(g.upload.uploadedAt))}</span>`;
  return `<span class="pill warn"><span class="dot"></span>Old · ${esc(fmt.dateTime(g.upload.uploadedAt))}</span>`;
}

function renderHome() {
  const s = state.status;
  if (!s) return;
  const h = fmt.hour();
  $('#greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#today-label').textContent = fmt.today();

  const banners = [];
  if (!s.godowns.length) {
    banners.push(`<div class="banner warn">${icon('alert')}<div class="banner-text"><b>No stock uploaded yet</b><span class="small">Upload the first godown's Excel below – the bot cannot answer until then.</span></div></div>`);
  } else if (s.pending.length) {
    const rem = s.reminder?.enabled ? ` Reminder goes to Admin at ${esc(s.reminder.time)}.` : '';
    banners.push(`<div class="banner warn">${icon('alert')}<div class="banner-text"><b>Not updated today: ${s.pending.map(esc).join(', ')}</b><span class="small">The bot still answers with their last list, and tells people it is old.${rem}</span></div></div>`);
  }
  if (s.whatsapp?.status !== 'open' && s.whatsapp?.status !== 'disabled') {
    banners.push(`<div class="banner bad">${icon('x')}<div class="banner-text"><b>WhatsApp is not linked</b><span class="small">The bot cannot reply until you link the shop's WhatsApp number.</span></div><a class="btn sm" href="#whatsapp">Link now</a></div>`);
  }
  $('#home-banners').innerHTML = banners.join('');

  const done = s.godowns.filter((g) => g.today).length;
  $('#home-kpis').innerHTML = [
    stat('Godowns updated today', s.godowns.length ? `${done} / ${s.godowns.length}` : '—',
      !s.godowns.length ? '' : done === s.godowns.length ? '<span class="pill good"><span class="dot"></span>All done</span>' : `<span class="pill warn"><span class="dot"></span>${s.godowns.length - done} pending</span>`),
    stat('Designs in stock lists', num(s.designs), `across ${s.godowns.length} godown${s.godowns.length === 1 ? '' : 's'}`),
    stat('Questions today', num(s.today?.total), `from ${num(s.today?.people)} people`),
    stat('Not found today', num(s.today?.notFound), 'codes not in any list'),
  ].join('');

  $('#godown-list').innerHTML = s.godowns.length
    ? s.godowns.map((g) => `
      <div class="list-item">
        <div class="grow">
          <div class="title">${esc(g.name)}</div>
          <div class="small muted">${g.upload ? `${g.upload.stockDate ? `As on ${esc(fmtIso(g.upload.stockDate))} · ` : ''}${num(g.upload.itemCount)} designs · ${num(g.upload.totalQty)} ${esc(g.upload.unit)}` : 'No stock list yet'}</div>
        </div>
        ${godownPill(g)}
        <button class="btn sm js-up" type="button" data-id="${g.id}">${icon('upload')}<span>Upload</span></button>
      </div>`).join('')
    : '<p class="empty">No godowns yet. Upload a godown\'s Excel to add it.</p>';
  $$('#godown-list .js-up').forEach((b) => b.addEventListener('click', () => {
    state.forceGodown = Number(b.dataset.id);
    $('#file').click();
  }));
}

const fmtIso = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

// upload: pick file -> confirm godown -> upload
const drop = $('#drop');
let pendingFile = null;
$('#file').addEventListener('change', (e) => e.target.files[0] && pickGodown(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && pickGodown(e.dataTransfer.files[0]));

async function pickGodown(file) {
  pendingFile = file;
  const form = $('#godown-pick');
  const godowns = state.status?.godowns || [];
  const d = await api(`api/upload/detect?filename=${encodeURIComponent(file.name)}`).catch(() => ({}));
  const chosen = state.forceGodown || d.godown?.id || '';
  state.forceGodown = null;
  $('#pick-godown').innerHTML = [
    ...(chosen ? [] : ['<option value="">— choose godown —</option>']),
    ...godowns.map((g) => `<option value="${g.id}" ${g.id === chosen ? 'selected' : ''}>${esc(g.name)}</option>`),
    `<option value="new" ${!chosen && !godowns.length ? 'selected' : ''}>+ New godown…</option>`,
  ].join('');
  if (!chosen && d.suggestion && !godowns.length) $('#pick-godown').value = 'new';
  $('#pick-new').value = d.suggestion || '';
  $('#pick-file').innerHTML = `${icon('box')}<span>${esc(file.name)}</span>${d.godown && chosen === d.godown.id ? '<span class="pill info"><span class="dot"></span>Godown found from file name</span>' : ''}`;
  syncPick();
  form.hidden = false;
  $('#upload-result').innerHTML = '';
}

function syncPick() {
  const v = $('#pick-godown').value;
  $('#pick-new-wrap').hidden = v !== 'new';
  const g = (state.status?.godowns || []).find((x) => String(x.id) === v);
  $('#pick-go').textContent = g ? `Update ${g.name} stock` : v === 'new' ? 'Add godown & upload' : 'Update stock';
  $('#pick-go').disabled = !v;
}
$('#pick-godown').addEventListener('change', syncPick);
$('#pick-cancel').addEventListener('click', () => {
  $('#godown-pick').hidden = true;
  pendingFile = null;
  $('#file').value = '';
});
$('#godown-pick').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#pick-godown').value;
  if (v === 'new' && !$('#pick-new').value.trim()) return toast('Type the godown name');
  upload(pendingFile, v === 'new' ? { name: $('#pick-new').value.trim() } : { id: v });
});

const FIELD_LABELS = { code: 'Code', name: 'Name', polish: 'Finish', category: 'Type', size: 'Size', grade: 'Grade', shade: 'Batch', location: 'Rack', qty: 'Quantity', sqft: 'Sq.ft' };

async function upload(file, godown) {
  if (!file) return;
  $('#godown-pick').hidden = true;
  const out = $('#upload-result');
  out.innerHTML = `<div class="row muted"><span class="spinner"></span> Reading ${esc(file.name)}…</div>`;
  try {
    const headers = { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' };
    if (godown.name) headers['X-Godown-Name'] = encodeURIComponent(godown.name);
    const r = await api(`api/upload${godown.id ? `?godown=${godown.id}` : ''}`, { method: 'POST', raw: file, headers });
    const u = r.upload;
    const cols = Object.entries(r.columns).map(([f, h]) => `<span class="chip">${FIELD_LABELS[f] || f}: <b>${esc(h)}</b></span>`);
    const warn = r.warnings.length ? `<div class="banner warn" style="margin:12px 0 0">${icon('alert')}<div class="banner-text small">${r.warnings.map(esc).join('<br>')}</div></div>` : '';
    const preview = r.preview.map((p) => `<tr><td class="code">${esc(p.code)}</td><td>${esc([p.category, p.polish, p.grade].filter(Boolean).join(' · '))}</td><td>${esc(p.size)}</td><td>${esc(p.shade)}</td><td class="num">${num(p.qty)}</td></tr>`).join('');
    out.innerHTML = `
      <div class="banner good" style="margin-bottom:12px">${icon('check')}<div class="banner-text"><b>${esc(u.godown)} stock updated</b><span class="small">${num(u.itemCount)} designs · ${num(u.rowCount)} rows · ${num(u.totalQty)} ${esc(u.unit)}${u.stockDate ? ` · as on ${esc(fmtIso(u.stockDate))}` : ''}</span><span class="small">${r.pending.length ? `Still to update today: ${r.pending.map(esc).join(', ')}` : 'All godowns updated for today ✓'}</span></div></div>
      <p class="small muted" style="margin-bottom:6px">Read ${r.sheetsUsed.length} sheet${r.sheetsUsed.length === 1 ? '' : 's'}${r.sheetsSkipped.length ? ` (skipped: ${r.sheetsSkipped.map(esc).join(', ')})` : ''} · columns found</p>
      <div class="chips">${cols.join('')}</div>${warn}
      <p class="small muted" style="margin:14px 0 4px">First rows</p>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Type</th><th>Size</th><th>Batch</th><th class="num">Boxes</th></tr></thead><tbody>${preview}</tbody></table></div>`;
    toast(`${u.godown} stock updated`);
    loadStatus();
  } catch (e) {
    out.innerHTML = `<div class="banner bad">${icon('x')}<div class="banner-text"><b>Stock NOT updated</b><span class="small">${esc(e.message)}</span><span class="small">The old stock list is still being used.</span></div></div>`;
  } finally {
    $('#file').value = '';
    pendingFile = null;
  }
}

// try the bot
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  const chat = $('#chat');
  if (chat.querySelector('.bubble.silent') && chat.children.length === 1) chat.innerHTML = '';
  chat.insertAdjacentHTML('beforeend', `<div class="bubble in">${esc(text).replace(/\n/g, '<br>')}</div>`);
  input.value = '';
  try {
    const r = await api('api/test', { method: 'POST', body: { text, group: $('#test-group').checked } });
    chat.insertAdjacentHTML('beforeend', r.relevant
      ? `<div class="bubble out">${waHtml(r.reply)}</div>`
      : `<div class="bubble silent">Bot stays silent – this does not look like a stock question.</div>`);
  } catch (ex) {
    chat.insertAdjacentHTML('beforeend', `<div class="bubble silent">${esc(ex.message)}</div>`);
  }
  chat.scrollTop = chat.scrollHeight;
});

// ---------- stock ----------
let stockTimer;
$('#stock-q').addEventListener('input', () => {
  clearTimeout(stockTimer);
  stockTimer = setTimeout(loadStock, 200);
});
$('#stock-godown').addEventListener('change', () => loadStock());

async function loadStock() {
  const q = $('#stock-q').value.trim();
  const sel = $('#stock-godown');
  const gsel = sel.value;
  const [data, uploads] = await Promise.all([api(`api/stock?q=${encodeURIComponent(q)}&godown=${encodeURIComponent(gsel)}`), api('api/uploads')]);
  const godowns = state.status?.godowns || [];
  sel.innerHTML = `<option value="">All godowns</option>${godowns.map((g) => `<option ${g.name === gsel ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}`;
  $('#stock-sub').textContent = godowns.length
    ? godowns.map((g) => `${g.name}: ${g.upload ? fmt.dateTime(g.upload.uploadedAt) : 'no list'}`).join(' · ')
    : 'No stock list uploaded yet';
  $('#stock-count').textContent = `${num(data.matches)} of ${num(data.count)} designs${data.matches > data.items.length ? ` · showing ${data.items.length}` : ''}`;
  $('#stock-body').innerHTML = data.items.length
    ? data.items.map((it) => {
      const variants = it.variants.map((v) => {
        const gl = v.godowns.length
          ? v.godowns.map((g) => `<div class="loc-list" style="margin-top:4px"><span><b>${esc(g.name)}</b> ${num(g.total)}</span>${g.batches.slice(0, 8).map((b) => `<span class="muted">${esc(b.batch || '—')} <b>${num(b.qty)}</b></span>`).join('')}${g.batches.length > 8 ? `<span class="muted">+${g.batches.length - 8} more</span>` : ''}</div>`).join('')
          : '<div class="loc-list" style="margin-top:4px"><span class="oos">Out of stock</span></div>';
        return `<div class="variant">${v.label ? `<span class="badge">${esc(v.label)}</span>` : ''}${gl}</div>`;
      }).join('');
      return `<tr><td class="code">${esc(it.code)}</td><td>${esc(it.name)}</td><td>${variants}</td><td class="num">${it.total > 0 ? `<b>${num(it.total)}</b>` : '<span class="oos">0</span>'}</td></tr>`;
    }).join('')
    : `<tr><td colspan="4" class="empty">${q ? 'No design matches your search.' : 'Upload a stock list on the Home page.'}</td></tr>`;
  $('#uploads-body').innerHTML = uploads.length
    ? uploads.map((x) => `<tr><td style="white-space:nowrap">${esc(fmt.dateTime(x.uploadedAt))}</td><td><b>${esc(x.godown)}</b></td><td class="small wrap">${esc(x.filename)}</td><td>${x.stockDate ? esc(fmtIso(x.stockDate)) : '—'}</td><td class="small">${esc(x.source === 'whatsapp' ? `WhatsApp ${x.uploadedBy || ''}` : 'Admin page')}</td><td class="num">${num(x.itemCount)}</td><td class="num">${num(x.totalQty)}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">No uploads yet.</td></tr>';
  renderGodownManage();
}

function renderGodownManage() {
  const godowns = state.status?.godowns || [];
  $('#godown-manage').innerHTML = godowns.length
    ? godowns.map((g) => `
      <div class="list-item" data-id="${g.id}">
        <div class="grow"><div class="title">${esc(g.name)}</div><div class="small muted">${g.upload ? `Last upload ${esc(fmt.dateTime(g.upload.uploadedAt))}` : 'No upload yet'}</div></div>
        <button class="btn sm js-rename" type="button">Rename</button>
        <button class="btn sm ghost icon-only js-delete" type="button" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('')
    : '<p class="empty">No godowns yet.</p>';
  $$('#godown-manage .list-item').forEach((row) => {
    const g = godowns.find((x) => String(x.id) === row.dataset.id);
    $('.js-rename', row).addEventListener('click', async () => {
      const name = prompt('New name for this godown', g.name);
      if (!name || name.trim() === g.name) return;
      try {
        await api(`api/godowns/${g.id}`, { method: 'PUT', body: { name } });
        await loadStatus();
        loadStock();
      } catch (e) { toast(e.message); }
    });
    $('.js-delete', row).addEventListener('click', async () => {
      if (!confirm(`Remove godown "${g.name}" and all its stock? The bot will stop showing it.`)) return;
      await api(`api/godowns/${g.id}`, { method: 'DELETE' });
      await loadStatus();
      loadStock();
    });
  });
}

$('#godown-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('api/godowns', { method: 'POST', body: { name: e.target.name.value } });
    e.target.reset();
    toast('Godown added – now upload its Excel');
    await loadStatus();
    loadStock();
  } catch (ex) { toast(ex.message); }
});

// ---------- whatsapp ----------
async function loadWhatsApp() {
  await renderWhatsApp();
  await renderGroups();
  waTimer = setInterval(async () => {
    const prev = state.wa?.status;
    await renderWhatsApp().catch(() => {});
    if (prev !== 'open' && state.wa?.status === 'open') {
      toast('WhatsApp linked');
      loadStatus();
      setTimeout(renderGroups, 3000);
    }
  }, 3000);
}

async function renderWhatsApp() {
  const wa = await api('api/whatsapp');
  const changed = JSON.stringify(wa) !== JSON.stringify(state.wa);
  state.wa = wa;
  if (!changed) return;
  const card = $('#wa-card');
  if (wa.status === 'disabled') {
    card.innerHTML = `<h2>WhatsApp is turned off</h2><p class="muted">Set <b>WHATSAPP_ENABLED=true</b> on the server to use the bot.</p>`;
  } else if (wa.status === 'open') {
    card.innerHTML = `
      <div class="connected">
        <div class="avatar">${icon('check')}</div>
        <div class="grow" style="flex:1">
          <h2>Connected</h2>
          <p class="muted">${esc(wa.me?.name || 'Shop number')} · ${esc(fmt.phone(wa.me?.phone))}</p>
        </div>
        <button class="btn danger sm" id="wa-logout" type="button">Unlink</button>
      </div>
      <p class="hint" style="margin-top:14px">Keep the shop phone switched on and open WhatsApp Business at least once every 2 weeks so the link stays active.</p>`;
    $('#wa-logout').addEventListener('click', async () => {
      if (!confirm('Unlink the bot from this WhatsApp number? It will stop replying until you scan again.')) return;
      await api('api/whatsapp/logout', { method: 'POST' });
      state.wa = null;
      renderWhatsApp();
      loadStatus();
    });
  } else if (wa.status === 'qr' && wa.qr) {
    card.innerHTML = `
      <div class="card-head"><div><h2>Link the shop's WhatsApp</h2><p class="muted small">Do this once. The phone keeps working normally.</p></div><span class="pill warn"><span class="dot"></span>Waiting for scan</span></div>
      <div class="qr-box">
        <img src="${wa.qr}" alt="WhatsApp QR code">
        <div class="stack">
          <ol class="steps">
            <li>Open <b>WhatsApp Business</b> on the shop phone</li>
            <li>Tap <b>⋮</b> (or <b>Settings</b> on iPhone) → <b>Linked devices</b></li>
            <li>Tap <b>Link a device</b> and scan this code</li>
          </ol>
          <details>
            <summary class="small" style="cursor:pointer;color:var(--accent)">Admin page open on the same phone? Link with a code instead</summary>
            <form class="stack" id="pair-form" style="margin-top:10px">
              <label class="field">Shop WhatsApp number<input type="tel" name="phone" placeholder="98765 43210" required></label>
              <div><button class="btn" type="submit">${icon('phone')}Get code</button></div>
              <div id="pair-out"></div>
            </form>
          </details>
        </div>
      </div>`;
    $('#pair-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const outEl = $('#pair-out');
      try {
        const r = await api('api/whatsapp/pair', { method: 'POST', body: { phone: e.target.phone.value } });
        outEl.innerHTML = `<div class="pair-code">${esc(r.code)}</div><p class="hint" style="margin-top:6px">In WhatsApp Business: Linked devices → Link a device → <b>Link with phone number instead</b> → enter this code.</p>`;
        clearInterval(waTimer); // keep the form on screen while the admin types the code
        waTimer = setInterval(async () => {
          const st = await api('api/whatsapp').catch(() => null);
          if (st?.status === 'open') { state.wa = null; loadWhatsApp(); loadStatus(); }
        }, 3000);
      } catch (ex) {
        outEl.innerHTML = `<p class="error">${esc(ex.message)}</p>`;
      }
    });
  } else {
    card.innerHTML = `<div class="row"><span class="spinner"></span><div><h2>Connecting to WhatsApp…</h2>${wa.lastError ? `<p class="muted small">${esc(wa.lastError)}</p>` : ''}</div></div>`;
  }
}

async function renderGroups() {
  const groups = await api('api/groups');
  const list = $('#groups-list');
  list.innerHTML = groups.length
    ? groups.map((g) => `
      <div class="list-item">
        <div class="grow"><div class="title">${esc(g.name || g.jid)}</div><div class="small muted">${g.participants ? `${g.participants} members` : 'Group'}</div></div>
        <label class="switch"><input type="checkbox" data-jid="${esc(g.jid)}" ${g.enabled ? 'checked' : ''}><span class="track"></span></label>
      </div>`).join('')
    : `<p class="empty">${state.wa?.status === 'open' ? 'No groups found. Tap Refresh.' : 'Link WhatsApp to see your groups.'}</p>`;
  $$('input[data-jid]', list).forEach((el) =>
    el.addEventListener('change', async () => {
      await api(`api/groups/${encodeURIComponent(el.dataset.jid)}`, { method: 'PUT', body: { enabled: el.checked } });
      toast(el.checked ? 'Bot will reply in this group' : 'Bot will stay silent in this group');
    }),
  );
}

$('#groups-refresh').addEventListener('click', async () => {
  try {
    await api('api/groups/refresh', { method: 'POST' });
    await renderGroups();
    toast('Groups updated');
  } catch (e) {
    toast(e.message);
  }
});

// ---------- people ----------
async function loadPeople() {
  const [settings, contacts] = await Promise.all([api('api/settings'), api('api/contacts')]);
  state.settings = settings;
  renderAccess();
  $('#contacts-count').textContent = `${contacts.length} people`;
  $('#contacts-body').innerHTML = contacts.length
    ? contacts.map((c) => `
      <tr data-phone="${esc(c.phone)}">
        <td>${esc(c.name || '—')}</td>
        <td class="mono">${esc(fmt.phone(c.phone))}</td>
        <td><select class="js-role" style="height:32px;width:auto">${['dealer', 'staff', 'admin'].map((r) => `<option value="${r}" ${c.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></td>
        <td><label class="switch"><input type="checkbox" class="js-active" ${c.active ? 'checked' : ''}><span class="track"></span></label></td>
        <td class="num"><button class="btn ghost sm icon-only js-del" type="button" aria-label="Remove">${icon('trash')}</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No one added yet. Add your dealers and staff above.</td></tr>';
  const byPhone = Object.fromEntries(contacts.map((c) => [c.phone, c]));
  $$('#contacts-body tr[data-phone]').forEach((tr) => {
    const c = byPhone[tr.dataset.phone];
    const save = (patch) => api('api/contacts', { method: 'POST', body: { ...c, ...patch } }).then((n) => Object.assign(c, n)).catch((e) => toast(e.message));
    $('.js-role', tr).addEventListener('change', (e) => save({ role: e.target.value }).then(() => toast('Role updated')));
    $('.js-active', tr).addEventListener('change', (e) => save({ active: e.target.checked }));
    $('.js-del', tr).addEventListener('click', async () => {
      if (!confirm(`Remove ${c.name || fmt.phone(c.phone)}?`)) return;
      await api(`api/contacts/${c.phone}`, { method: 'DELETE' });
      loadPeople();
    });
  });
}

function renderAccess() {
  const mode = state.settings.accessMode;
  $$('#access-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#access-hint').textContent = mode === 'everyone'
    ? 'Anyone who messages the shop number with a design code gets the stock reply.'
    : 'Only the people below get stock replies. Others are ignored (or get the message set in Settings).';
}

$$('#access-mode button').forEach((b) =>
  b.addEventListener('click', async () => {
    state.settings = await api('api/settings', { method: 'PUT', body: { accessMode: b.dataset.mode } });
    renderAccess();
    toast('Saved');
  }),
);

$('#contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('api/contacts', { method: 'POST', body: { name: f.name.value, phone: f.phone.value, role: f.role.value } });
    f.reset();
    toast('Added');
    loadPeople();
  } catch (ex) {
    toast(ex.message);
  }
});

$('#bulk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const r = await api('api/contacts/bulk', { method: 'POST', body: { text: f.text.value, role: f.role.value } });
  toast(`Added ${r.added}${r.skipped.length ? ` · ${r.skipped.length} lines skipped (no valid number)` : ''}`);
  if (!r.skipped.length) f.reset();
  else f.text.value = r.skipped.join('\n');
  loadPeople();
});

// ---------- reports ----------
const OUTCOME = {
  in_stock: ['good', 'In stock'],
  out_of_stock: ['warn', 'Out of stock'],
  unavailable: ['warn', 'Not in that polish/size'],
  not_found: ['bad', 'Not found'],
  ambiguous: ['info', 'Many matches'],
  blocked: ['', 'Not allowed'],
  no_stock_list: ['warn', 'No stock list'],
};

$$('#range button').forEach((b) =>
  b.addEventListener('click', () => {
    state.reportDays = Number(b.dataset.days);
    $$('#range button').forEach((x) => x.classList.toggle('active', x === b));
    $('#csv').href = `api/queries.csv?days=${state.reportDays}`;
    loadReports();
  }),
);

function rankList(items, labelFn) {
  if (!items.length) return '<p class="empty">Nothing yet.</p>';
  const max = Math.max(...items.map((i) => i.count));
  return `<div class="rank">${items.map((i) => `
    <div class="rank-item">
      <div class="rank-name">${labelFn(i)}</div><div class="rank-val">${num(i.count)}</div>
      <div class="rank-bar"><i style="width:${Math.max(3, (i.count / max) * 100)}%"></i></div>
    </div>`).join('')}</div>`;
}

async function loadReports() {
  const days = state.reportDays;
  const [r, queries] = await Promise.all([api(`api/reports?days=${days}`), api(`api/queries?days=${days}&limit=60`)]);
  const s = r.summary;
  $('#report-kpis').innerHTML = [
    stat('Questions', num(s.total), days === 1 ? 'today' : `last ${days} days`),
    stat('People asking', num(s.people), 'different numbers'),
    stat('Answered with stock', num(s.inStock), s.total ? `${Math.round((s.inStock / s.total) * 100)}% of questions` : ''),
    stat('Not found', num(s.notFound), `${num(s.outOfStock)} out of stock`),
  ].join('');
  drawDaily(r.daily, days);
  $('#top-codes').innerHTML = rankList(r.topCodes, (i) => `<span class="code">${esc(i.code)}</span> <span class="muted small">· ${i.people} people</span>`);
  $('#oos-codes').innerHTML = rankList(r.outOfStock, (i) => `<span class="code">${esc(i.code)}</span> <span class="muted small">· last ${esc(fmt.dateTime(i.last))}</span>`);
  $('#nf-codes').innerHTML = rankList(r.notFound, (i) => `<span class="code">${esc(i.code)}</span> <span class="muted small">· ${i.people} people</span>`);
  $('#top-people').innerHTML = rankList(r.topPeople, (i) => `${esc(i.name || fmt.phone(i.phone))} <span class="muted small">· ${esc(fmt.phone(i.phone))}</span>`);
  $('#queries-body').innerHTML = queries.length
    ? queries.map((q) => {
      const [cls, label] = OUTCOME[q.outcome] || ['', q.outcome];
      const from = `${esc(q.sender_name || fmt.phone(q.sender_phone) || '—')}${q.is_group ? `<div class="small muted">in ${esc(q.chat_name || 'group')}</div>` : `<div class="small muted mono">${esc(fmt.phone(q.sender_phone))}</div>`}`;
      return `<tr><td class="small" style="white-space:nowrap">${esc(fmt.dateTime(q.at))}</td><td>${from}</td><td style="max-width:320px">${esc(q.text.length > 140 ? `${q.text.slice(0, 140)}…` : q.text)}</td><td><span class="pill ${cls}"><span class="dot"></span>${label}</span></td></tr>`;
    }).join('')
    : '<tr><td colspan="4" class="empty">No questions yet.</td></tr>';
}

/** Single-series bar chart: questions per day (local days). */
function drawDaily(daily, days) {
  const el = $('#daily-chart');
  const counts = Object.fromEntries(daily.map((d) => [d.day, d.count]));
  const list = [];
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: state.tz }).format(new Date());
  const today = new Date(`${todayStr}T00:00:00Z`);
  const n = Math.max(days, 1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    list.push({ key, date: d, count: counts[key] || 0 });
  }
  const W = el.clientWidth || 600;
  const H = el.clientHeight || 180;
  const pad = { l: 30, r: 4, t: 8, b: 22 };
  const max = Math.max(4, ...list.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / list.length;
  const gap = Math.max(2, slot * 0.28);
  const bw = Math.max(2, Math.min(42, slot - gap));
  const y = (v) => pad.t + ih - (v / top) * ih;
  let svg = '';
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const labelEvery = Math.ceil(list.length / 8);
  list.forEach((d, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const h = (d.count / top) * ih;
    const r = Math.min(4, bw / 2, h);
    const y0 = pad.t + ih;
    if (d.count > 0) {
      svg += `<rect class="hit" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" data-i="${i}"/>`;
      svg += `<path class="bar" data-i="${i}" d="M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z"/>`;
    } else {
      svg += `<rect class="hit" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" data-i="${i}"/>`;
    }
    if (i % labelEvery === 0 || i === list.length - 1) {
      svg += `<text class="axis-label" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(fmt.day(d.date))}</text>`;
    }
  });
  const summary = list.map((d) => `${fmt.day(d.date)}: ${d.count}`).join(', ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Questions per day. ${esc(summary)}">${svg}</svg><div class="tooltip" hidden></div>`;
  const tip = $('.tooltip', el);
  $$('.hit', el).forEach((hit) => {
    hit.addEventListener('mouseenter', () => {
      const d = list[Number(hit.dataset.i)];
      const bar = $(`.bar[data-i="${hit.dataset.i}"]`, el);
      bar?.classList.add('hover');
      const x = pad.l + Number(hit.dataset.i) * slot + slot / 2;
      tip.textContent = `${fmt.day(d.date)}: ${d.count} question${d.count === 1 ? '' : 's'}`;
      tip.style.left = `${(x / W) * 100}%`;
      tip.style.top = `${(y(d.count) / H) * 100}%`;
      tip.hidden = false;
    });
    hit.addEventListener('mouseleave', () => {
      tip.hidden = true;
      $$('.bar.hover', el).forEach((b) => b.classList.remove('hover'));
    });
  });
}

// ---------- settings ----------
async function loadSettings() {
  const s = await api('api/settings');
  const f = $('#settings-form');
  for (const [k, v] of Object.entries(s)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v;
  }
  $('#settings-saved').textContent = '';
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    businessName: f.businessName.value,
    reminderEnabled: f.reminderEnabled.checked,
    reminderTime: f.reminderTime.value,
    reminderText: f.reminderText.value,
    unknownReplyEnabled: f.unknownReplyEnabled.checked,
    unknownReply: f.unknownReply.value,
    selfChatCommands: f.selfChatCommands.checked,
    showBatch: f.showBatch.checked,
    showRack: f.showRack.checked,
  };
  try {
    await api('api/settings', { method: 'PUT', body });
    $('#settings-saved').textContent = 'Saved ✓';
    toast('Settings saved');
    loadStatus();
  } catch (ex) {
    toast(ex.message);
  }
});

window.addEventListener('resize', () => {
  if (state.page === 'reports') loadReports().catch(() => {});
});

// ---------- boot ----------
api('api/session')
  .then((s) => (s.loggedIn ? startApp() : showLogin()))
  .catch(() => showLogin());
