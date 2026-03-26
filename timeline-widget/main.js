// ╔══════════════════════════════════════════════════════╗
// ║  FIREBASE SETUP  (edit these two lines)              ║
// ║                                                      ║
// ║  1. firebase.google.com → new project                ║
// ║  2. Build → Realtime Database → Create (test mode)   ║
// ║  3. Copy the URL shown and paste below               ║
// ╚══════════════════════════════════════════════════════╝
const FIREBASE_DB_URL = 'https://timeline-data-6cdba-default-rtdb.firebaseio.com/';
//
// That's the only thing you need to change.
// Your data is encrypted before it ever leaves the browser,
// so this URL is safe to leave in public source code.

// ── Constants ──────────────────────────────────────────
const SIDEBAR_W    = 150;
const ROW_H        = 38;
const ITEM_H       = 28;
const ITEM_PAD_Y   = 5;
const HEADER_H     = 52;
const GAP_DAYS     = 0;
const PADDING_DAYS = 21;
const APP_SALT     = 'timeline-widget-v1';   // fixed — not secret

const PRESETS = [
  '#4a9eff','#7b68ee','#e74c3c','#e67e22','#2ecc71',
  '#1abc9c','#f39c12','#9b59b6','#e91e63','#00bcd4',
];

const CLOUD_MODE = !FIREBASE_DB_URL.includes('YOUR-PROJECT');

// ── Helpers needed before item init ───────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function dayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return fmtDate(d);
}

// ── State ──────────────────────────────────────────────
let items        = [];
let pixelsPerDay = 22;
let editingId    = null;
let editMode     = false;
let tableMode    = false;
let minDate, maxDate;

// Cloud storage state
let cryptoKey        = null;   // CryptoKey — AES-GCM
let storagePath      = null;   // hex string — Firebase path segment
let activePassphrase = null;   // kept so the copy-link button can encode it

// Drag-pan state
let isDragging     = false;
let dragStartX     = 0;
let dragScrollLeft = 0;

// Auto-save debounce
let saveTimer = null;

// ── DOM refs ───────────────────────────────────────────
const outer          = document.getElementById('timeline-outer');
const inner          = document.getElementById('timeline-inner');
const overlay        = document.getElementById('modal-overlay');
const popup          = document.getElementById('item-popup');
const fName          = document.getElementById('item-name');
const fStart         = document.getElementById('item-start');
const fEnd           = document.getElementById('item-end');
const fCat           = document.getElementById('item-category');
const fColor         = document.getElementById('item-color');
const fDesc          = document.getElementById('item-desc');
const btnDelete      = document.getElementById('modal-delete');
const editModeBtn    = document.getElementById('edit-mode-btn');
const tableModeBtn   = document.getElementById('table-mode-btn');
const zoomCtrl       = document.getElementById('zoom-controls');
const saveStatusEl   = document.getElementById('save-status');
const passphraseOver = document.getElementById('passphrase-overlay');
const passphraseInput= document.getElementById('passphrase-input');
const passphraseErr  = document.getElementById('passphrase-error');

// ── Drag-to-pan ────────────────────────────────────────
outer.addEventListener('mousedown', e => {
  if (tableMode || e.button !== 0) return;
  if (e.target.closest('.tl-item, .tl-label, .tl-header-corner')) return;
  isDragging     = true;
  dragStartX     = e.clientX;
  dragScrollLeft = outer.scrollLeft;
  outer.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!isDragging) return;
  outer.scrollLeft = dragScrollLeft - (e.clientX - dragStartX);
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  outer.classList.remove('dragging');
});

outer.addEventListener('touchstart', e => {
  if (tableMode || e.touches.length !== 1) return;
  if (e.target.closest('.tl-item, .tl-label')) return;
  isDragging     = true;
  dragStartX     = e.touches[0].clientX;
  dragScrollLeft = outer.scrollLeft;
}, { passive: true });

outer.addEventListener('touchmove', e => {
  if (!isDragging || e.touches.length !== 1) return;
  outer.scrollLeft = dragScrollLeft - (e.touches[0].clientX - dragStartX);
}, { passive: true });

outer.addEventListener('touchend', () => { isDragging = false; });

// ── Date utils ─────────────────────────────────────────
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86_400_000);
}

function dateToX(date) {
  return daysBetween(minDate, date) * pixelsPerDay;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Layout utils ───────────────────────────────────────
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function computeDateRange() {
  const today = new Date();

  if (items.length === 0) {
    minDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    maxDate = new Date(today.getFullYear(), today.getMonth() + 4, 1);
  } else {
    let mn = parseDate(items[0].start);
    let mx = parseDate(items[0].end);
    for (const item of items) {
      const s = parseDate(item.start);
      const e = parseDate(item.end);
      if (s < mn) mn = s;
      if (e > mx) mx = e;
    }
    minDate = new Date(mn); minDate.setDate(minDate.getDate() - PADDING_DAYS);
    maxDate = new Date(mx); maxDate.setDate(maxDate.getDate() + PADDING_DAYS);
  }

  // Extend to fill the viewport
  const viewDays = Math.ceil(outer.clientWidth / pixelsPerDay) + 60;
  while (daysBetween(minDate, maxDate) < viewDays) {
    minDate.setDate(minDate.getDate() - 30);
    maxDate.setDate(maxDate.getDate() + 30);
  }
}

function packIntoRows(categoryItems) {
  const sorted = [...categoryItems].sort((a, b) => parseDate(a.start) - parseDate(b.start));
  const rows = [];
  for (const item of sorted) {
    const iStart = parseDate(item.start);
    const iEnd   = parseDate(item.end);
    let placed = false;
    for (const row of rows) {
      if (iStart > row.endDate || daysBetween(row.endDate, iStart) > GAP_DAYS) {
        row.items.push(item);
        if (iEnd > row.endDate) row.endDate = iEnd;
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ endDate: iEnd, items: [item] });
  }
  return rows.map(r => r.items);
}

function groupByCategory() {
  const cats = {};
  const uncategorized = [];
  for (const item of items) {
    const cat = item.category?.trim() || '';
    if (cat) (cats[cat] = cats[cat] || []).push(item);
    else uncategorized.push(item);
  }
  const groups = Object.keys(cats).sort().map(name => ({ name, items: cats[name] }));
  if (uncategorized.length > 0) groups.push({ name: '', items: uncategorized });
  return groups;
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 140;
}

// ── Render ─────────────────────────────────────────────
function render() {
  hidePopup();
  if (tableMode) { renderTable(); return; }
  renderTimeline();
}

function renderTimeline() {
  computeDateRange();
  const totalDays  = daysBetween(minDate, maxDate);
  const totalWidth = totalDays * pixelsPerDay;
  const innerWidth = SIDEBAR_W + totalWidth;

  inner.style.display  = '';
  inner.style.minWidth = innerWidth + 'px';
  inner.innerHTML = '';

  renderHeader(inner, totalWidth, innerWidth);

  if (items.length === 0) {
    const e = el('div', 'empty-state');
    e.style.marginLeft = SIDEBAR_W + 'px';
    e.innerHTML = 'No items yet. Click <strong>+ Add Item</strong> to get started.';
    inner.appendChild(e);
    return;
  }

  for (const group of groupByCategory()) renderSection(inner, group, totalWidth);
}

function renderHeader(parent, totalWidth, innerWidth) {
  const header = el('div', 'tl-header');
  header.style.width    = innerWidth + 'px';
  header.style.minWidth = innerWidth + 'px';

  const corner = el('div', 'tl-header-corner');
  corner.style.width = SIDEBAR_W + 'px';
  header.appendChild(corner);

  const dates = el('div', 'tl-header-dates');
  dates.style.width  = totalWidth + 'px';
  dates.style.height = HEADER_H + 'px';

  let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    const x    = dateToX(cur);
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const w    = Math.min(dateToX(next), totalWidth) - Math.max(x, 0);

    if (x > 0) {
      const sep = el('div', 'tl-tick-line');
      Object.assign(sep.style, { left: x+'px', top: '0', height: HEADER_H+'px', background: '#3a3a3a' });
      dates.appendChild(sep);
    }
    if (w > 20) {
      const lbl = el('div', 'tl-month-label');
      lbl.style.left     = Math.max(x, 0) + 6 + 'px';
      lbl.style.maxWidth = (w - 8) + 'px';
      lbl.textContent    = cur.toLocaleString('default', { month: 'short', year: 'numeric' });
      dates.appendChild(lbl);
    }
    cur = next;
  }

  if (pixelsPerDay >= 28) {
    let day = new Date(minDate);
    while (day <= maxDate) {
      const x   = dateToX(day);
      const dow = day.getDay();
      if (dow === 1 || pixelsPerDay >= 45) {
        const t = el('div', 'tl-tick-line');
        Object.assign(t.style, { left: x+'px', top: '55%', height: '45%', background: dow===1 ? '#484848' : '#303030' });
        dates.appendChild(t);
      }
      if (pixelsPerDay >= 35 || (pixelsPerDay >= 28 && dow === 1)) {
        const lbl = el('div', 'tl-tick-label');
        lbl.style.left      = (x + pixelsPerDay/2) + 'px';
        lbl.style.transform = 'translateX(-50%)';
        lbl.textContent     = day.getDate();
        dates.appendChild(lbl);
      }
      day.setDate(day.getDate() + 1);
    }
  } else if (pixelsPerDay >= 7) {
    let day = new Date(minDate);
    while (day.getDay() !== 1) day.setDate(day.getDate() + 1);
    while (day <= maxDate) {
      const x = dateToX(day);
      const t = el('div', 'tl-tick-line');
      Object.assign(t.style, { left: x+'px', top: '55%', height: '45%', background: '#484848' });
      dates.appendChild(t);
      if (pixelsPerDay * 7 >= 28) {
        const lbl = el('div', 'tl-tick-label');
        lbl.style.left  = x + 2 + 'px';
        lbl.textContent = day.getDate() + '/' + (day.getMonth()+1);
        dates.appendChild(lbl);
      }
      day.setDate(day.getDate() + 7);
    }
  }

  const today = new Date();
  if (today >= minDate && today <= maxDate) {
    const dot = el('div', 'today-dot');
    dot.style.left = dateToX(today) + 'px';
    dot.style.top  = '78%';
    dates.appendChild(dot);
  }

  header.appendChild(dates);
  parent.appendChild(header);
}

function renderSection(parent, group, totalWidth) {
  const rows = packIntoRows(group.items);
  const secH = rows.length * ROW_H + 10;

  const section = el('div', 'tl-section');

  const label = el('div', 'tl-label' + (group.name ? '' : ' tl-label-uncat'));
  label.style.width     = SIDEBAR_W + 'px';
  label.style.minHeight = secH + 'px';
  const lt = el('span', 'tl-label-text');
  lt.textContent = group.name || 'Uncategorized';
  label.appendChild(lt);
  section.appendChild(label);

  const rowsArea = el('div', 'tl-rows-area');
  rowsArea.style.width  = totalWidth + 'px';
  rowsArea.style.height = secH + 'px';

  let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    const x = dateToX(cur);
    if (x > 0) {
      const line = el('div', 'tl-grid-line');
      line.style.left   = x + 'px';
      line.style.height = secH + 'px';
      rowsArea.appendChild(line);
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  const today = new Date();
  if (today >= minDate && today <= maxDate) {
    const tl = el('div', 'today-line');
    tl.style.left   = dateToX(today) + 'px';
    tl.style.height = secH + 'px';
    rowsArea.appendChild(tl);
  }

  rows.forEach((row, rowIdx) => {
    for (const item of row) {
      const s   = parseDate(item.start);
      const e   = parseDate(item.end);
      const x   = dateToX(s);
      const w   = Math.max(pixelsPerDay, (daysBetween(s, e) + 1) * pixelsPerDay);
      const y   = 5 + rowIdx * ROW_H + ITEM_PAD_Y;
      const bar = el('div', 'tl-item');
      bar.style.left       = x + 'px';
      bar.style.top        = y + 'px';
      bar.style.width      = w + 'px';
      bar.style.height     = ITEM_H + 'px';
      bar.style.background = item.color || '#4a9eff';
      bar.style.color      = isLight(item.color || '#4a9eff') ? '#111' : '#fff';

      const span = el('span');
      span.textContent = item.name;
      bar.appendChild(span);

      bar.addEventListener('click', ev => {
        ev.stopPropagation();
        if (editMode) openModal(item.id);
        else showPopup(item, ev);
      });

      rowsArea.appendChild(bar);
    }
  });

  section.appendChild(rowsArea);
  parent.appendChild(section);
}

// ── Table render ───────────────────────────────────────
function renderTable() {
  inner.innerHTML = '';
  inner.style.display  = 'block';
  inner.style.minWidth = '0';

  const wrapper = el('div', 'table-wrapper');
  const table   = el('table', 'data-table');

  const thead = el('thead');
  thead.innerHTML = `<tr>
    <th style="width:42px">Color</th>
    <th style="min-width:160px">Name</th>
    <th style="width:128px">Start</th>
    <th style="width:128px">End</th>
    <th style="min-width:110px">Category</th>
    <th>Description</th>
    <th style="width:36px"></th>
  </tr>`;
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const group of groupByCategory()) {
    const catRow  = el('tr', 'tbl-cat-row');
    const catCell = el('td');
    catCell.colSpan = 7;
    catCell.textContent = group.name || 'Uncategorized';
    catRow.appendChild(catCell);
    tbody.appendChild(catRow);

    for (const item of group.items) tbody.appendChild(makeTableRow(item));
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);

  const addBtn = el('button', 'btn table-add-btn');
  addBtn.textContent = '+ Add Row';
  addBtn.addEventListener('click', () => {
    const newItem = { id: uid(), name: '', start: fmtDate(new Date()), end: dayStr(7), category: '', color: '#4a9eff', description: '' };
    items.push(newItem);
    scheduleSave();
    render();
    setTimeout(() => {
      const row = inner.querySelector(`[data-id="${newItem.id}"] .tbl-name`);
      if (row) row.focus();
    }, 30);
  });
  wrapper.appendChild(addBtn);
  inner.appendChild(wrapper);
}

function makeTableRow(item) {
  const tr = el('tr', 'tbl-row');
  tr.dataset.id = item.id;

  const tdColor    = el('td', 'tbl-color-cell');
  const swatch     = el('div', 'tbl-swatch');
  swatch.style.background = item.color || '#4a9eff';
  const colorInput = document.createElement('input');
  colorInput.type  = 'color';
  colorInput.value = item.color || '#4a9eff';
  colorInput.className = 'tbl-color-input';
  colorInput.addEventListener('input', e => {
    item.color = e.target.value;
    swatch.style.background = e.target.value;
    scheduleSave();
  });
  swatch.addEventListener('click', () => colorInput.click());
  tdColor.appendChild(swatch);
  tdColor.appendChild(colorInput);
  tr.appendChild(tdColor);

  tr.appendChild(makeTblCell(item, 'name',        'text', 'tbl-input tbl-name',      'Item name'));
  tr.appendChild(makeTblCell(item, 'start',       'date', 'tbl-input tbl-date'));
  tr.appendChild(makeTblCell(item, 'end',         'date', 'tbl-input tbl-date'));
  const catTd = makeTblCell(item, 'category',     'text', 'tbl-input tbl-cat-input', 'Category');
  catTd.querySelector('input').setAttribute('list', 'categories-list');
  tr.appendChild(catTd);
  tr.appendChild(makeTblCell(item, 'description', 'text', 'tbl-input tbl-desc-input','Description'));

  const tdDel  = el('td', 'tbl-del-cell');
  const delBtn = el('button', 'btn btn-danger tbl-del-btn');
  delBtn.textContent = '×';
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', () => {
    items = items.filter(i => i.id !== item.id);
    scheduleSave();
    render();
  });
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  return tr;
}

function makeTblCell(item, field, type, className, placeholder) {
  const td    = el('td', 'tbl-cell');
  const input = document.createElement('input');
  input.type  = type;
  input.value = item[field] || '';
  input.className = className;
  if (placeholder) input.placeholder = placeholder;
  const evt = type === 'date' ? 'change' : 'input';
  input.addEventListener(evt, e => {
    item[field] = e.target.value;
    scheduleSave();
  });
  td.appendChild(input);
  return td;
}

// ── Popup (view mode) ──────────────────────────────────
let popupCloseHandler = null;

function showPopup(item, event) {
  hidePopup();
  const color = item.color || '#4a9eff';
  const tc    = isLight(color) ? '#111' : '#fff';
  popup.innerHTML = `
    <div class="popup-header" style="background:${color};color:${tc}">
      <div class="popup-name">${escHtml(item.name)}</div>
      <div class="popup-dates">${item.start} → ${item.end}</div>
    </div>
    <div class="popup-body">
      ${item.category ? `<div class="popup-cat">${escHtml(item.category)}</div>` : ''}
      ${item.description
        ? `<div class="popup-desc">${escHtml(item.description)}</div>`
        : '<div class="popup-nodesc">No description</div>'}
    </div>`;

  popup.style.left = (event.clientX + 14) + 'px';
  popup.style.top  = (event.clientY + 14) + 'px';
  popup.classList.remove('hidden');

  requestAnimationFrame(() => {
    const r = popup.getBoundingClientRect();
    if (r.right  > window.innerWidth  - 8) popup.style.left = (event.clientX - r.width  - 14) + 'px';
    if (r.bottom > window.innerHeight - 8) popup.style.top  = (event.clientY - r.height - 14) + 'px';
  });

  setTimeout(() => {
    popupCloseHandler = e => { if (!popup.contains(e.target)) hidePopup(); };
    document.addEventListener('click', popupCloseHandler);
  }, 0);
}

function hidePopup() {
  popup.classList.add('hidden');
  if (popupCloseHandler) {
    document.removeEventListener('click', popupCloseHandler);
    popupCloseHandler = null;
  }
}

// ── Modal ──────────────────────────────────────────────
function buildColorPresets() {
  const container = document.getElementById('color-presets');
  container.innerHTML = '';
  for (const c of PRESETS) {
    const sw = el('div', 'color-swatch');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      fColor.value = c;
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    container.appendChild(sw);
  }
}

function syncPresetHighlight() {
  const cur = fColor.value.toLowerCase();
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.title.toLowerCase() === cur);
  });
}

function updateCatList() {
  const dl   = document.getElementById('categories-list');
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  dl.innerHTML = cats.map(c => `<option value="${escHtml(c)}">`).join('');
}

function openModal(id) {
  editingId = id || null;
  const item = id ? items.find(i => i.id === id) : null;

  document.getElementById('modal-title').textContent = item ? 'Edit Item' : 'Add Item';
  fName.value  = item?.name        || '';
  fStart.value = item?.start       || fmtDate(new Date());
  fEnd.value   = item?.end         || dayStr(7);
  fCat.value   = item?.category    || '';
  fColor.value = item?.color       || '#4a9eff';
  fDesc.value  = item?.description || '';
  btnDelete.classList.toggle('hidden', !item);

  updateCatList();
  buildColorPresets();
  fColor.removeEventListener('input', syncPresetHighlight);
  fColor.addEventListener('input', syncPresetHighlight);
  syncPresetHighlight();

  overlay.classList.remove('hidden');
  setTimeout(() => fName.focus(), 50);
}

function closeModal() {
  overlay.classList.add('hidden');
  editingId = null;
}

function saveModal() {
  const name  = fName.value.trim();
  const start = fStart.value;
  const end   = fEnd.value;
  const cat   = fCat.value.trim();
  const color = fColor.value;
  const desc  = fDesc.value.trim();

  if (!name)        { fName.focus(); return; }
  if (!start||!end) { return; }
  if (start > end)  { fEnd.focus(); return; }

  if (editingId) {
    const idx = items.findIndex(i => i.id === editingId);
    if (idx !== -1) items[idx] = { ...items[idx], name, start, end, category: cat, color, description: desc };
  } else {
    items.push({ id: uid(), name, start, end, category: cat, color, description: desc });
  }

  closeModal();
  scheduleSave();
  render();
  if (!tableMode) scrollToToday(false);
}

function deleteItem() {
  if (!editingId) return;
  items = items.filter(i => i.id !== editingId);
  closeModal();
  scheduleSave();
  render();
}

// ── Zoom & scroll ──────────────────────────────────────
function zoom(factor) {
  const cx  = outer.scrollLeft + outer.clientWidth / 2 - SIDEBAR_W;
  const day = cx / pixelsPerDay;
  pixelsPerDay = Math.max(2, Math.min(120, pixelsPerDay * factor));
  render();
  outer.scrollLeft = day * pixelsPerDay - outer.clientWidth / 2 + SIDEBAR_W;
}

function scrollToToday(smooth = true) {
  if (!minDate) return;
  const tx = SIDEBAR_W + dateToX(new Date()) - outer.clientWidth / 2;
  outer.scrollTo({ left: Math.max(0, tx), behavior: smooth ? 'smooth' : 'instant' });
}

// ── Import / Export ────────────────────────────────────
function csvEsc(v) {
  const s = String(v == null ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCSV() {
  const header = 'name,start,end,category,color,description';
  const rows   = items.map(i =>
    [i.name, i.start, i.end, i.category||'', i.color||'', i.description||'']
      .map(csvEsc).join(',')
  );
  const csv = [header, ...rows].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: 'timeline.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = ev.target.result;
      let rows;
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
        rows = parsed;
      } else {
        rows = parseCSV(text);
      }
      const newItems = rows
        .filter(d => d.name || d.start)
        .map(d => ({
          id:          uid(),
          name:        String(d.name        || ''),
          start:       String(d.start       || fmtDate(new Date())),
          end:         String(d.end         || dayStr(7)),
          category:    String(d.category    || ''),
          color:       /^#[0-9a-f]{6}$/i.test(d.color||'') ? d.color : '#4a9eff',
          description: String(d.description || ''),
        }));
      if (!newItems.length) { alert('No valid rows found.'); return; }
      const msg = items.length
        ? `Replace ${items.length} existing item(s) with ${newItems.length} imported item(s)?`
        : null;
      if (!msg || confirm(msg)) {
        items = newItems;
        scheduleSave();
        render();
        if (!tableMode) setTimeout(() => scrollToToday(false), 30);
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function parseCSV(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseCSVRow(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

function parseCSVRow(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else { cur += c; }
  }
  result.push(cur);
  return result;
}

// ── Crypto (Web Crypto API — no library needed) ────────
async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(APP_SALT), iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function hashPassphrase(passphrase) {
  const enc  = new TextEncoder();
  const buf  = await crypto.subtle.digest('SHA-256', enc.encode(passphrase + APP_SALT));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 40);
}

async function encryptItems(key) {
  const enc = new TextEncoder();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(items))
  );
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptPayload(b64, key) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv  = combined.slice(0, 12);
  const ct  = combined.slice(12);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(buf));
}

// ── Firebase (REST API — no SDK) ───────────────────────
async function fbGet(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/tl/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET failed: ${res.status}`);
  return res.json();
}

async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE_DB_URL}/tl/${path}.json`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT failed: ${res.status}`);
}

// ── Auto-save ──────────────────────────────────────────
function setSaveStatus(state, text) {
  saveStatusEl.className = 'save-status ' + (state || '');
  saveStatusEl.textContent = text || '';
}

function scheduleSave() {
  if (!CLOUD_MODE) {
    // localStorage fallback
    localStorage.setItem('tl_items', JSON.stringify(items));
    return;
  }
  if (!cryptoKey || !storagePath) return;
  clearTimeout(saveTimer);
  setSaveStatus('saving', 'Saving…');
  saveTimer = setTimeout(doSave, 1500);
}

async function doSave() {
  try {
    const payload = await encryptItems(cryptoKey);
    await fbPut(storagePath, { payload, ts: Date.now() });
    setSaveStatus('saved', 'Saved ✓');
    setTimeout(() => setSaveStatus('', ''), 3000);
  } catch (err) {
    setSaveStatus('error', 'Save failed');
    console.error('Save error:', err);
  }
}

// ── Passphrase modal ───────────────────────────────────
function showPassphraseModal(message) {
  passphraseOver.classList.remove('hidden');
  passphraseErr.classList.toggle('hidden', !message);
  passphraseErr.textContent = message || '';
  passphraseInput.value = '';
  setTimeout(() => passphraseInput.focus(), 80);
}

function hidePassphraseModal() {
  passphraseOver.classList.add('hidden');
}

async function submitPassphrase() {
  const pass = passphraseInput.value.trim();
  if (!pass) { passphraseInput.focus(); return; }

  document.getElementById('passphrase-submit').textContent = 'Unlocking…';
  document.getElementById('passphrase-submit').disabled = true;

  try {
    const key  = await deriveKey(pass);
    const hash = await hashPassphrase(pass);

    if (CLOUD_MODE) {
      const record = await fbGet(hash);
      if (record?.payload) {
        try {
          items = await decryptPayload(record.payload, key);
        } catch {
          // Key derivation succeeded but decryption failed → wrong passphrase
          document.getElementById('passphrase-submit').textContent = 'Unlock';
          document.getElementById('passphrase-submit').disabled = false;
          showPassphraseModal('Wrong key — could not decrypt data.');
          return;
        }
      }
      // else: new passphrase, start empty
    } else {
      // localStorage mode
      const stored = localStorage.getItem('tl_items');
      if (stored) {
        try { items = JSON.parse(stored); } catch { items = []; }
      }
    }

    cryptoKey        = key;
    storagePath      = hash;
    activePassphrase = pass;

    // Reflect the key in the URL so reloads and Notion embeds stay logged in
    const encoded = encodeURIComponent(pass);
    history.replaceState(null, '', `${location.pathname}?pass=${encoded}`);

    if (document.getElementById('remember-key').checked) {
      localStorage.setItem('tl_passphrase', pass);
    } else {
      localStorage.removeItem('tl_passphrase');
    }

    hidePassphraseModal();
    render();
    setTimeout(() => scrollToToday(false), 30);

  } catch (err) {
    document.getElementById('passphrase-submit').textContent = 'Unlock';
    document.getElementById('passphrase-submit').disabled = false;
    showPassphraseModal('Error: ' + err.message);
  }
}

document.getElementById('passphrase-submit').addEventListener('click', submitPassphrase);
passphraseInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitPassphrase(); });

// ── Mode toggles ───────────────────────────────────────
editModeBtn.addEventListener('click', () => {
  editMode = !editMode;
  editModeBtn.classList.toggle('active', editMode);
  document.body.classList.toggle('edit-mode',  editMode);
  document.body.classList.toggle('view-mode', !editMode);
  hidePopup();
});

tableModeBtn.addEventListener('click', () => {
  tableMode = !tableMode;
  tableModeBtn.classList.toggle('active', tableMode);
  zoomCtrl.classList.toggle('hidden', tableMode);
  render();
  if (!tableMode) setTimeout(() => scrollToToday(false), 30);
});

// ── Wire up controls ───────────────────────────────────
document.getElementById('export-btn').addEventListener('click', exportCSV);
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('zoom-in').addEventListener('click',  () => zoom(1.5));
document.getElementById('zoom-out').addEventListener('click', () => zoom(1/1.5));
document.getElementById('today-btn').addEventListener('click', () => scrollToToday(true));
document.getElementById('add-btn').addEventListener('click', () => openModal(null));
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveModal);
document.getElementById('modal-delete').addEventListener('click', deleteItem);
document.getElementById('copy-link-btn').addEventListener('click', () => {
  if (!activePassphrase) return;
  const url = `${location.origin}${location.pathname}?pass=${encodeURIComponent(activePassphrase)}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copy-link-btn');
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '🔗'; }, 2000);
  });
});

document.getElementById('lock-btn').addEventListener('click', () => {
  localStorage.removeItem('tl_passphrase');
  activePassphrase = null;
  showPassphraseModal(null);
});

overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.addEventListener('keydown', e => {
  if (!overlay.classList.contains('hidden')) {
    if (e.key === 'Enter' && document.activeElement !== fCat && document.activeElement !== fDesc) saveModal();
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (e.key === 'Escape') hidePopup();
});

// ── Init ───────────────────────────────────────────────
document.body.classList.add('view-mode');

// Show a blank timeline immediately so the page isn't empty
render();

// Then unlock — priority: ?pass= URL param → localStorage → prompt
(async () => {
  // Use a raw regex + decodeURIComponent instead of URLSearchParams so that
  // Base64 characters like +, =, and / survive the round-trip correctly.
  const m       = window.location.search.match(/[?&]pass=([^&#]*)/);
  const urlPass = m ? decodeURIComponent(m[1]) : null;
  const saved   = localStorage.getItem('tl_passphrase');
  const pass    = urlPass || saved;

  if (pass) {
    passphraseInput.value = pass;
    // Only persist to localStorage if it came from there, not from the URL
    document.getElementById('remember-key').checked = !urlPass && !!saved;
    await submitPassphrase();
  } else {
    showPassphraseModal(null);
  }
})();
