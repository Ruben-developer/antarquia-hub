'use strict';

/* ---------- categorías y estados ---------- */
const CATS = {
  apoyo:     { name: 'Apoyo mutuo',  color: '#9be37a', icon: '🤝' },
  espacio:   { name: 'Espacios',     color: '#8fd6c2', icon: '🏠' },
  memoria:   { name: 'Memoria',      color: '#e0b45c', icon: '🕯️' },
  conflicto: { name: 'Conflictos',   color: '#ff6b6b', icon: '⚠️' },
  difusion:  { name: 'Difusión',     color: '#c9a0ff', icon: '📣' },
  cuidados:  { name: 'Cuidados',     color: '#7fb2ff', icon: '✚' }
};
const STATES = {
  pendiente: { name: 'Pendiente', color: '#f4f1e6' },
  encurso:   { name: 'En curso',  color: '#ffc800' },
  hecho:     { name: 'Resuelto',  color: '#9be37a' }
};
const TYPE_NAME = { point: 'Punto', line: 'Ruta', zone: 'Zona', radius: 'Radio' };
const TYPE_NEW = { point: 'Nuevo punto', line: 'Nueva ruta', zone: 'Nueva zona', radius: 'Nuevo radio' };
const STORAGE = 'mapa_cordillera_v1'; // datos de la versión local, para migrar
const BASE_STORAGE = 'mapa_cordillera_base';
const SAFE_STORAGE = 'mapa_cordillera_safe';

/* ---------- configuración del sitio ---------- */
const CONFIG = (() => {
  const b = document.body;
  const nums = (v, n) => {
    const arr = String(v || '').split(',').map(Number);
    return arr.length === n && arr.every(Number.isFinite) ? arr : null;
  };
  const site = b.dataset.site === 'cordillera' ? 'cordillera' : 'cartografia';
  return {
    site,
    gated: b.dataset.gated === '1',
    title: b.dataset.title || 'Mapa',
    boundsUrl: b.dataset.bounds || '',
    view: nums(b.dataset.view, 4),
    maxBounds: nums(b.dataset.maxbounds, 4),
    geoViewbox: b.dataset.geoviewbox || '-70.66,-33.48,-70.42,-33.66',
    apiRoot: '/api',
    apiQuery: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'site=' + site : ''
  };
})();

const TOKENS_KEY = 'antarquia_tokens_' + CONFIG.site;
const MIGRATED_KEY = 'antarquia_migrated_' + CONFIG.site;
const ADMIN_KEY = 'antarquia_admin_token';

/* Ejemplos: coordenadas aproximadas, solo para probar la herramienta. */
const EXAMPLES = [
  { id:'ex-plaza', type:'point', name:'Plaza de Puente Alto', cat:'espacio', estado:'hecho', note:'Punto de encuentro y conectividad. Elemento de ejemplo: edítalo o bórralo.', offers:'punto de encuentro', needs:'', schedule:'', contact:'', coords:[-33.6116,-70.5759], example:true },
  { id:'ex-metro', type:'point', name:'Metro La Florida', cat:'espacio', estado:'hecho', note:'Nodo de transporte y llegada. Ejemplo.', offers:'', needs:'', schedule:'', contact:'', coords:[-33.5226,-70.5983], example:true },
  { id:'ex-difusion', type:'point', name:'Punto de difusión Vicuña Mackenna', cat:'difusion', estado:'pendiente', note:'Ejemplo de punto de pegado y reparto de fanzines.', offers:'', needs:'carteles, engrudo', schedule:'', contact:'', coords:[-33.5240,-70.5980], example:true },
  { id:'ex-cerro', type:'point', name:'Ladera precordillera', cat:'conflicto', estado:'encurso', note:'Monitoreo socioambiental de bosque nativo. Ejemplo.', offers:'', needs:'registro fotográfico', schedule:'', contact:'', coords:[-33.5500,-70.5250], example:true },
  { id:'ex-acopio', type:'point', name:'Acopio de apoyo mutuo', cat:'apoyo', estado:'encurso', note:'Ejemplo de punto de acopio y entregas.', offers:'agua, legumbres', needs:'transporte, cajas', schedule:'sáb 10–13 h', contact:'', coords:[-33.5800,-70.5700], example:true },
  { id:'ex-memoria', type:'point', name:'Hito de memoria', cat:'memoria', estado:'hecho', note:'Ejemplo de memorial o hito histórico del barrio.', offers:'', needs:'', schedule:'', contact:'', coords:[-33.5550,-70.5900], example:true },
  { id:'ex-ruta', type:'line', name:'Ruta de difusión', cat:'difusion', estado:'pendiente', note:'Trayecto de ejemplo para afichaje y reparto.', offers:'', needs:'', schedule:'', contact:'', coords:[[-33.5240,-70.5980],[-33.5650,-70.5850],[-33.6107,-70.5759]], example:true },
  { id:'ex-zona', type:'zone', name:'Zona de cuidados', cat:'apoyo', estado:'encurso', note:'Polígono de ejemplo para delimitar un barrio o zona de trabajo.', offers:'', needs:'', schedule:'', contact:'', coords:[[-33.5720,-70.5900],[-33.5720,-70.5800],[-33.5780,-70.5780],[-33.5800,-70.5860],[-33.5770,-70.5920]], example:true },
  { id:'ex-radio', type:'radius', name:'Radio de cobertura', cat:'cuidados', estado:'encurso', note:'Ejemplo de alcance radial de un punto de cuidados.', offers:'', needs:'', schedule:'', contact:'', radius:600, coords:[-33.5800,-70.5700], example:true }
];

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const genId = () => 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const catOf = it => CATS[it.cat] ? it.cat : 'espacio';
const stateOf = it => STATES[it.estado] ? it.estado : 'pendiente';
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
const fmtArea = m2 => m2 >= 10000 ? (m2 / 10000).toFixed(2) + ' ha' : Math.round(m2) + ' m²';
const walkTime = m => Math.max(1, Math.round(m / 80)) + ' min';
const fmtCoord = (lat, lng) => lat.toFixed(5) + ', ' + lng.toFixed(5);

function areaM2(latlngs) {
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i], p2 = latlngs[(i + 1) % latlngs.length];
    total += (p2[1] - p1[1]) * Math.PI / 180 * (2 + Math.sin(p1[0] * Math.PI / 180) + Math.sin(p2[0] * Math.PI / 180));
  }
  return Math.abs(total * R * R / 2);
}

/* ---------- estado ---------- */
let items = [];
let activeTool = null;
let draft = [];
let pending = null;
let editingId = null;
let safeMode = false;
try { safeMode = localStorage.getItem(SAFE_STORAGE) === '1'; } catch (e) {}
let labelsOn = true;
let boundsOn = true;
let query = '';
const activeCats = new Set(Object.keys(CATS));
const activeStates = new Set(Object.keys(STATES));

/* ---------- mapa ---------- */
const startView = CONFIG.view || [-33.565, -70.570, -33.50, -70.50];
const map = L.map('map', {
  center: [(startView[0] + startView[2]) / 2, (startView[1] + startView[3]) / 2],
  zoom: 12,
  zoomControl: false,
  doubleClickZoom: false,
  preferCanvas: true,
  minZoom: 10,
  maxZoom: 19,
  maxBoundsViscosity: 0.7
});
map.attributionControl.setPrefix(false);
if (CONFIG.maxBounds) {
  map.setMaxBounds([[CONFIG.maxBounds[0], CONFIG.maxBounds[1]], [CONFIG.maxBounds[2], CONFIG.maxBounds[3]]]);
}
map.fitBounds([[startView[0], startView[1]], [startView[2], startView[3]]], { padding: [10, 10] });
L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

const BASES = {
  dark: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, maxNativeZoom: 16, className: 'basemap-dark',
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
  }),
  streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, maxNativeZoom: 17,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
  }),
  none: null
};
let currentBase = null;

function setBase(name) {
  const next = name in BASES ? name : 'dark';
  if (currentBase && BASES[currentBase]) map.removeLayer(BASES[currentBase]);
  currentBase = next;
  const wrap = $('#mapwrap');
  if (next === 'none') {
    wrap.querySelector('.leaflet-container').classList.add('no-tiles');
  } else {
    wrap.querySelector('.leaflet-container').classList.remove('no-tiles');
    BASES[next].addTo(map);
  }
  $$('#basemaps button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === next)));
  try { localStorage.setItem(BASE_STORAGE, next); } catch (e) {}
  const names = { dark: 'Noche', streets: 'Calles', topo: 'Terreno', sat: 'Satélite', none: 'Sin fondo' };
  setStatus('Fondo: ' + names[next] + '.');
  updateZoomWarn();
}

/* capas */
const boundsLayer = L.layerGroup().addTo(map);
const itemsLayer = L.layerGroup().addTo(map);
const previewLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const locateLayer = L.layerGroup().addTo(map);
const searchLayer = L.layerGroup().addTo(map);

let boundsData = null;
let boundsZoomState = null;

async function loadBounds() {
  if (!CONFIG.boundsUrl) return;
  try {
    const res = await fetch(CONFIG.boundsUrl, { cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    boundsData = await res.json();
    drawBounds();
  } catch (e) {
    setStatus('No se pudieron cargar los límites comunales.', 'warn');
  }
}

function drawBounds() {
  boundsLayer.clearLayers();
  if (!boundsOn || !boundsData) return;
  const permanent = map.getZoom() >= 12;
  boundsZoomState = permanent;
  const layer = L.geoJSON(boundsData, {
    style: f => ({
      color: f.properties.color || '#ffc800',
      weight: 1.8,
      dashArray: '6,5',
      fillColor: f.properties.color || '#ffc800',
      fillOpacity: 0.05,
      opacity: 0.85
    }),
    onEachFeature: (f, l) => {
      const name = (f.properties && f.properties.name) || 'Comuna';
      const label = document.createElement('span');
      label.textContent = name;
      l.bindTooltip(label, {
        permanent,
        direction: 'center',
        className: 'comuna-label'
      });
      l.on('click', () => map.flyToBounds(l.getBounds(), { padding: [30, 30], maxZoom: 14 }));
      l.on('mouseover', () => { if (!permanent) l.openTooltip(); });
    }
  });
  layer.addTo(boundsLayer);
}

/* ---------- API colectiva ---------- */
let adminToken = '';
try { adminToken = sessionStorage.getItem(ADMIN_KEY) || ''; } catch (e) {}
let editTokens = {};
try { editTokens = JSON.parse(localStorage.getItem(TOKENS_KEY)) || {}; } catch (e) { editTokens = {}; }

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 0;
  }
}

function apiUrl(path) {
  if (!CONFIG.apiQuery) return CONFIG.apiRoot + path;
  return CONFIG.apiRoot + path + (path.includes('?') ? '&' : '?') + CONFIG.apiQuery;
}

async function api(path, opts = {}) {
  const { method = 'GET', body, headers = {}, quiet = false } = opts;
  const init = { method, credentials: 'same-origin', headers: Object.assign({}, headers) };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (e) {
    setNet(false, 'No se pudo conectar con el servidor.');
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && CONFIG.gated && !quiet) {
    showGate('La sesión caducó. Vuelve a escribir la frase.');
  }
  if (!res.ok) {
    const msg = (data && data.error) || ('Error ' + res.status);
    throw new ApiError(msg, res.status);
  }
  setNet(true);
  return data || {};
}

function authHeaders(it) {
  const h = {};
  if (adminToken) h['x-admin-token'] = adminToken;
  else if (it && editTokens[it.id]) h['x-edit-token'] = editTokens[it.id];
  return h;
}

function canEdit(it) {
  if (adminToken) return true;
  if (CONFIG.gated) return true;
  return !!(it && editTokens[it.id]);
}

function saveTokens() {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(editTokens)); } catch (e) {}
}

function validItem(it) {
  return it && typeof it === 'object' && typeof it.name === 'string'
    && ['point', 'line', 'zone', 'radius'].includes(it.type) && Array.isArray(it.coords);
}

function normalizeItem(it) {
  if (!it || typeof it !== 'object') return it;
  if (!it.updated && it.updatedAt) it.updated = it.updatedAt;
  if (!it.created && it.createdAt) it.created = it.createdAt;
  return it;
}

function setNet(ok, msg) {
  const bar = $('#netbar');
  const st = $('#net-status');
  if (st) {
    st.textContent = ok
      ? (CONFIG.gated ? 'Sesión activa. Mapa compartido.' : 'Conectado al mapa colectivo.')
      : (msg || 'Sin conexión con el servidor.');
  }
  if (bar) {
    bar.hidden = !!ok;
    const m = $('#netbar-msg');
    if (m) m.textContent = msg || 'Sin conexión con el servidor.';
  }
}

let refreshing = false;
async function refreshItems(opts = {}) {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api('/items', { quiet: !!opts.silent });
    items = (Array.isArray(data.items) ? data.items : []).filter(validItem).map(normalizeItem);
    renderAll();
    if (!opts.silent) {
      setStatus(items.length ? items.length + ' elementos en el mapa colectivo.' : 'El mapa está vacío. Marca el primer punto.');
    }
  } catch (e) {
    if (e.status !== 401) {
      setNet(false, e.message);
      setStatus(e.message, 'warn');
    }
  } finally {
    refreshing = false;
  }
}

/* ---------- migración de datos locales ---------- */
function legacyItems() {
  try {
    const raw = localStorage.getItem(STORAGE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(validItem) : [];
  } catch (e) {
    return [];
  }
}

function offerMigration() {
  let migrated = false;
  try { migrated = localStorage.getItem(MIGRATED_KEY) === '1'; } catch (e) {}
  if (migrated) return;
  const legacy = legacyItems();
  if (!legacy.length) return;
  const box = $('#migrate');
  if (!box) return;
  $('#migrate-count').textContent = legacy.length;
  box.hidden = false;
  $('#btn-migrate-skip').addEventListener('click', () => { box.hidden = true; });
  $('#btn-migrate').addEventListener('click', async () => {
    const btn = $('#btn-migrate');
    btn.disabled = true;
    btn.textContent = 'Subiendo…';
    try {
      const payload = legacy.map(it => ({
        type: it.type,
        name: it.name,
        cat: it.cat,
        estado: it.estado,
        offers: it.offers || '',
        needs: it.needs || '',
        schedule: it.schedule || '',
        contact: it.contact || '',
        note: it.note || '',
        approximate: !!it.approximate,
        coords: it.coords,
        radius: it.radius || undefined
      }));
      const res = await api('/import', { method: 'POST', body: { items: payload } });
      Object.assign(editTokens, res.editTokens || {});
      saveTokens();
      try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) {}
      box.hidden = true;
      toast('Subidos ' + ((res.items || []).length) + ' puntos al mapa colectivo.');
      await refreshItems();
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = 'Subir mis puntos';
    }
  });
}

function applyAdmin() {
  const actions = $('#admin-actions');
  if (actions) actions.hidden = !adminToken;
  const st = $('#admin-status');
  if (st) st.textContent = adminToken ? 'Modo administración activo.' : '';
  renderAll();
}

/* ---------- visibilidad y geometría ---------- */
function visible(it) {
  if (!activeCats.has(catOf(it)) || !activeStates.has(stateOf(it))) return false;
  if (!query) return true;
  const hay = [it.name, it.note, it.offers, it.needs, it.schedule, it.contact, CATS[catOf(it)].name, STATES[stateOf(it)].name]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(query);
}
function itemCenter(it) {
  if (it.type === 'point' || it.type === 'radius') return L.latLng(it.coords[0], it.coords[1]);
  return L.latLngBounds(it.coords).getCenter();
}
function itemLength(it) {
  let total = 0;
  for (let i = 1; i < it.coords.length; i++) total += map.distance(it.coords[i - 1], it.coords[i]);
  return total;
}

/* ---------- render ---------- */
function labelLayer(layer, text, opts, always) {
  if (!labelsOn) return;
  const content = document.createElement('span');
  content.textContent = text;
  if (always || map.getZoom() >= 14) {
    layer.bindTooltip(content, Object.assign({ permanent: true, className: 'item-label' }, opts));
  } else {
    layer.bindTooltip(content, { className: 'item-label', sticky: true });
  }
}

function renderItems() {
  itemsLayer.clearLayers();
  items.filter(visible).forEach(it => {
    const cat = CATS[catOf(it)], st = STATES[stateOf(it)];
    const stroke = st.color, fill = cat.color;
    let layer = null;

    if (it.type === 'point' || it.type === 'radius') {
      const ll = L.latLng(it.coords[0], it.coords[1]);
      if (it.type === 'radius') {
        layer = L.circle(ll, {
          radius: it.radius || 500, color: fill, weight: 2, fillColor: fill,
          fillOpacity: .14, dashArray: stateOf(it) === 'pendiente' ? '6,5' : null
        }).addTo(itemsLayer);
        L.circleMarker(ll, { radius: 4, color: stroke, weight: 2, fillColor: fill, fillOpacity: 1 })
          .addTo(itemsLayer)
          .on('click', e => { stop(e); openPopup(it, e.latlng); });
        if (labelsOn) labelLayer(layer, it.name, { direction: 'center' }, false);
      } else if (it.approximate) {
        layer = L.circle(ll, {
          radius: 140, color: fill, weight: 1.5, fillColor: fill,
          fillOpacity: .12, dashArray: '4,4'
        }).addTo(itemsLayer);
        L.circleMarker(ll, { radius: 3, color: fill, weight: 2, fillColor: fill, fillOpacity: 1 })
          .addTo(itemsLayer)
          .on('click', e => { stop(e); openPopup(it, e.latlng); });
        if (labelsOn) labelLayer(layer, it.name + ' ≈', { direction: 'center' }, false);
      } else {
        layer = L.circleMarker(ll, { radius: 7, color: stroke, weight: 2.5, fillColor: fill, fillOpacity: .95 });
        if (labelsOn) labelLayer(layer, it.name, { direction: 'top', offset: [0, -7] }, true);
      }
    } else if (it.type === 'line') {
      layer = L.polyline(it.coords, {
        color: fill, weight: 4, opacity: .95,
        dashArray: stateOf(it) === 'pendiente' ? '7,6' : null
      });
      if (labelsOn) labelLayer(layer, it.name, { direction: 'center' }, false);
    } else if (it.type === 'zone') {
      layer = L.polygon(it.coords, {
        color: fill, weight: 2, fillColor: fill,
        fillOpacity: stateOf(it) === 'hecho' ? .28 : .14,
        dashArray: stateOf(it) === 'pendiente' ? '6,5' : null
      });
      if (labelsOn) labelLayer(layer, it.name, { direction: 'center' }, false);
    }

    if (!layer) return;
    layer.on('click', e => { stop(e); openPopup(it, e.latlng || itemCenter(it)); });
    if (!layer._map) itemsLayer.addLayer(layer);
  });
}
function updateZoomWarn() {
  const w = $('#zoomwarn');
  if (w) w.hidden = !(currentBase === 'dark' && map.getZoom() > 16);
}
map.on('zoomend', () => {
  renderItems();
  updateZoomWarn();
  if (boundsData && (map.getZoom() >= 12) !== boundsZoomState) drawBounds();
});

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  const arr = items.filter(visible).slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!arr.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = items.length ? 'Sin elementos con estos filtros.' : 'Todavía no hay elementos. Usa una herramienta para marcar el primero.';
    list.append(p);
    return;
  }
  arr.forEach(it => {
    const cat = CATS[catOf(it)], st = STATES[stateOf(it)];
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.id = it.id;
    row.title = 'Centrar en el mapa';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', cat.color);
    const txt = document.createElement('span');
    txt.className = 'txt';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = it.name;
    const mt = document.createElement('span');
    mt.className = 'mt';
    mt.textContent = cat.name + ' · ' + st.name + (it.author ? ' · ' + it.author : '');
    txt.append(nm, mt);
    row.append(dot, txt, miniBtn('◎', 'Centrar', 'fly'));
    if (canEdit(it)) row.append(miniBtn('✎', 'Editar', 'edit'), miniBtn('✕', 'Borrar', 'del'));
    list.append(row);
  });
}

function miniBtn(text, label, act) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.dataset.act = act;
  return b;
}

function checkRow(kind, id, label, color, count, checked) {
  const l = document.createElement('label');
  l.className = 'check';
  const left = document.createElement('span');
  left.className = 'left';
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = checked;
  inp.dataset[kind] = id;
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = color;
  const sp = document.createElement('span');
  sp.textContent = label;
  left.append(inp, dot, sp);
  const b = document.createElement('b');
  b.textContent = count;
  l.append(left, b);
  return l;
}

function renderFilters() {
  const cats = $('#cats');
  cats.innerHTML = '';
  Object.entries(CATS).forEach(([id, c]) => {
    const n = items.filter(it => catOf(it) === id).length;
    cats.append(checkRow('cat', id, c.name, c.color, n, activeCats.has(id)));
  });
  const states = $('#states');
  states.innerHTML = '';
  Object.entries(STATES).forEach(([id, s]) => {
    const n = items.filter(it => stateOf(it) === id).length;
    states.append(checkRow('state', id, s.name, s.color, n, activeStates.has(id)));
  });
}

function renderStats() {
  const box = $('#stats');
  box.innerHTML = '';
  const total = items.length;
  const head = document.createElement('div');
  head.className = 'stat-top';
  const hl = document.createElement('span');
  hl.textContent = 'Elementos';
  const hr = document.createElement('b');
  hr.textContent = total;
  head.append(hl, hr);
  box.append(head);
  Object.entries(CATS).forEach(([id, c]) => {
    const n = items.filter(it => catOf(it) === id).length;
    if (!n) return;
    const top = document.createElement('div');
    top.className = 'stat-top';
    const l = document.createElement('span');
    l.textContent = c.name;
    const r = document.createElement('span');
    r.textContent = n;
    top.append(l, r);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.setProperty('--c', c.color);
    const fill = document.createElement('i');
    fill.style.width = total ? Math.round(n / total * 100) + '%' : '0%';
    bar.append(fill);
    box.append(top, bar);
  });
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = `Pendientes ${items.filter(it => stateOf(it) === 'pendiente').length} · En curso ${items.filter(it => stateOf(it) === 'encurso').length} · Resueltos ${items.filter(it => stateOf(it) === 'hecho').length}`;
  box.append(p);
}

function renderAll() {
  renderItems();
  renderList();
  renderFilters();
  renderStats();
}

function setStatus(msg, kind) {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2800);
}
function stop(e) {
  if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
}

/* ---------- dibujo ---------- */
function clearTransient(collapsePanel) {
  draft = [];
  pending = null;
  editingId = null;
  draftLayer.clearLayers();
  previewLayer.clearLayers();
  $('#itemform').hidden = true;
  $('#drawbar').hidden = true;
  $('#mapwrap').classList.remove('drawing');
  document.body.classList.remove('drawing-mode');
  activeTool = null;
  $$('.tool').forEach(b => b.classList.toggle('on', false));
  if (collapsePanel && useSheetUI()) setPanel(false);
}

function drawPreview() {
  previewLayer.clearLayers();
  if (!pending) return;
  const yellow = '#ffc800';
  if (pending.type === 'point') {
    L.circleMarker(pending.coords, { radius: 8, color: yellow, weight: 2, fillColor: yellow, fillOpacity: .4 }).addTo(previewLayer);
  } else if (pending.type === 'radius') {
    L.circle(pending.coords, { radius: pending.radius || 500, color: yellow, weight: 2, fillColor: yellow, fillOpacity: .1, dashArray: '6,5' }).addTo(previewLayer);
    L.circleMarker(pending.coords, { radius: 4, color: yellow, weight: 2, fillColor: yellow, fillOpacity: 1 }).addTo(previewLayer);
  } else if (pending.type === 'line') {
    L.polyline(pending.coords, { color: yellow, weight: 3, dashArray: '6,5' }).addTo(previewLayer);
    pending.coords.forEach(c => L.circleMarker(c, { radius: 4, color: yellow, weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 }).addTo(previewLayer));
  } else if (pending.type === 'zone') {
    L.polygon(pending.coords, { color: yellow, weight: 2, dashArray: '6,5', fillColor: yellow, fillOpacity: .12 }).addTo(previewLayer);
    pending.coords.forEach(c => L.circleMarker(c, { radius: 4, color: yellow, weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 }).addTo(previewLayer));
  }
}

function updateDraft() {
  draftLayer.clearLayers();
  if (!activeTool) return;
  const yellow = '#ffc800';
  if (activeTool === 'line' && draft.length >= 2) {
    L.polyline(draft, { color: yellow, weight: 3, dashArray: '6,5' }).addTo(draftLayer);
  }
  if (activeTool === 'zone' && draft.length >= 3) {
    L.polygon(draft, { color: yellow, weight: 2, dashArray: '6,5', fillColor: yellow, fillOpacity: .12 }).addTo(draftLayer);
  }
  if (activeTool === 'measure' && draft.length >= 2) {
    L.polyline(draft, { color: yellow, weight: 3, dashArray: '4,4' }).addTo(draftLayer);
    for (let i = 1; i < draft.length; i++) {
      const mid = L.latLng((draft[i - 1][0] + draft[i][0]) / 2, (draft[i - 1][1] + draft[i][1]) / 2);
      L.marker(mid, {
        icon: L.divIcon({ className: 'map-zone-label', html: fmtDist(map.distance(draft[i - 1], draft[i])), iconSize: [80, 14], iconAnchor: [40, 7] }),
        interactive: false
      }).addTo(draftLayer);
    }
  }
  draft.forEach(c => L.circleMarker(c, { radius: 4, color: yellow, weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 }).addTo(draftLayer));

  if (activeTool === 'measure') {
    if (draft.length >= 2) {
      const total = lineLength(draft);
      setStatus(`Medición: ${fmtDist(total)} · ~${walkTime(total)} a pie.`, 'warn');
    } else {
      setStatus('Haz clic para empezar a medir.', 'warn');
    }
  } else if (activeTool === 'line') {
    setStatus(`${draft.length} vértice(s). Enter o Guardar para terminar.`, 'warn');
  } else if (activeTool === 'zone') {
    setStatus(`${draft.length} vértice(s). Mínimo 3 para cerrar la zona.`, 'warn');
  }
}

function lineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += map.distance(coords[i - 1], coords[i]);
  return total;
}

function setTool(tool) {
  clearTransient();
  if (tool === 'locate') { if (useSheetUI()) setPanel(false); locate(); return; }
  if (!tool) { setStatus('Listo. Elige una herramienta o toca un elemento.'); return; }
  activeTool = tool;
  $$('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  $('#mapwrap').classList.add('drawing');
  document.body.classList.add('drawing-mode');
  $('#drawbar').hidden = false;
  const hints = useSheetUI() ? {
    point: 'Toca el mapa para ubicar el punto.',
    line: 'Toca el mapa para sumar vértices. Usa Guardar para terminar.',
    zone: 'Toca el mapa para delimitar la zona (mínimo 3 vértices).',
    radius: 'Toca el mapa para fijar el centro y ajusta el radio.',
    measure: 'Toca el mapa para medir un recorrido. Usa Terminar.'
  } : {
    point: 'Haz clic en el mapa para ubicar el punto.',
    line: 'Haz clic para sumar vértices. Enter o Guardar para terminar.',
    zone: 'Haz clic para delimitar la zona (mínimo 3 vértices).',
    radius: 'Haz clic en el centro y ajusta el radio.',
    measure: 'Haz clic para medir un recorrido. Enter para terminar.'
  };
  $('#drawhint').textContent = hints[tool] || '';
  $('#btn-finish').hidden = (tool === 'point' || tool === 'radius');
  $('#btn-undo').hidden = (tool === 'point' || tool === 'radius');
  $('#btn-finish').textContent = tool === 'measure' ? 'Terminar' : 'Guardar';
  setStatus(hints[tool] || '', 'warn');
  if (useSheetUI()) setPanel(false);
}

function metaFor(type, coords, radius) {
  if (type === 'line') {
    const m = lineLength(coords);
    return `Largo: ${fmtDist(m)} · ~${walkTime(m)} a pie.`;
  }
  if (type === 'zone') return `Área aproximada: ${fmtArea(areaM2(coords))}.`;
  if (type === 'radius') return `Radio: ${radius || 500} m · cobertura ~${fmtArea(Math.PI * Math.pow(radius || 500, 2))}.`;
  return 'Coordenadas: ' + fmtCoord(coords[0], coords[1]);
}

function fillForm(it) {
  $('#f-name').value = it ? it.name : '';
  $('#f-cat').value = it ? catOf(it) : Object.keys(CATS)[0];
  $('#f-est').value = it ? stateOf(it) : 'pendiente';
  $('#f-offers').value = it ? (it.offers || '') : '';
  $('#f-needs').value = it ? (it.needs || '') : '';
  $('#f-schedule').value = it ? (it.schedule || '') : '';
  $('#f-contact').value = it ? (it.contact || '') : '';
  $('#f-author').value = it ? (it.author || '') : '';
  $('#f-note').value = it ? (it.note || '') : '';
  $('#f-approx').checked = !!(it && it.approximate);
  const r = it && it.radius ? it.radius : 500;
  $('#f-radius').value = r;
  $('#f-radius-range').value = r;
}

function beginForm(type, coords, extra) {
  clearTransient();
  pending = { type: type, coords: coords, radius: extra && extra.radius ? extra.radius : 500 };
  editingId = null;
  fillForm(null);
  $('#formtitle').textContent = TYPE_NEW[type];
  $('#radiusfield').hidden = type !== 'radius';
  $('#f-save').textContent = CONFIG.gated ? 'Guardar' : 'Publicar';
  $('#formmeta').textContent = metaFor(type, coords, pending.radius);
  $('#itemform').hidden = false;
  drawPreview();
  if (useSheetUI()) {
    setPanel(true);
    setTimeout(() => $('#itemform').scrollIntoView({ block: 'start', behavior: 'smooth' }), 280);
  } else {
    $('#itemform').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  setTimeout(() => $('#f-name').focus({ preventScroll: true }), useSheetUI() ? 420 : 80);
  setStatus('Completa los datos y guarda.', 'warn');
}

function beginEdit(it) {
  if (!canEdit(it)) { toast('No tienes el token de edición de este elemento.'); return; }
  clearTransient();
  editingId = it.id;
  pending = { type: it.type, coords: it.coords, radius: it.radius || 500 };
  fillForm(it);
  $('#formtitle').textContent = 'Editar ' + TYPE_NAME[it.type].toLowerCase();
  $('#radiusfield').hidden = it.type !== 'radius';
  $('#f-save').textContent = 'Guardar cambios';
  $('#formmeta').textContent = metaFor(it.type, it.coords, it.radius || 500);
  $('#itemform').hidden = false;
  drawPreview();
  flyToItem(it);
  if (useSheetUI()) {
    setPanel(true);
    setTimeout(() => $('#itemform').scrollIntoView({ block: 'start', behavior: 'smooth' }), 280);
  }
  setTimeout(() => $('#f-name').focus({ preventScroll: true }), useSheetUI() ? 420 : 100);
  setStatus('Editando: ' + it.name, 'warn');
}

function syncRadius(v) {
  const n = clamp(parseInt(v, 10) || 500, 50, 5000);
  $('#f-radius').value = n;
  $('#f-radius-range').value = n;
  if (pending && pending.type === 'radius') {
    pending.radius = n;
    drawPreview();
    $('#formmeta').textContent = metaFor('radius', pending.coords, n);
  }
}

function finishDraw() {
  if (!activeTool) return;
  if (activeTool === 'line') {
    if (draft.length < 2) { toast('Necesitas al menos 2 puntos para una ruta.'); return; }
    beginForm('line', draft.slice());
  } else if (activeTool === 'zone') {
    if (draft.length < 3) { toast('Necesitas al menos 3 puntos para una zona.'); return; }
    beginForm('zone', draft.slice());
  } else if (activeTool === 'measure') {
    endMeasure();
  }
}

function endMeasure() {
  if (draft.length < 2) { setTool(null); return; }
  const total = lineLength(draft);
  activeTool = null;
  $$('.tool').forEach(b => b.classList.toggle('on', false));
  $('#mapwrap').classList.remove('drawing');
  document.body.classList.remove('drawing-mode');
  $('#drawbar').hidden = true;
  setStatus(`Medición: ${fmtDist(total)} · ~${walkTime(total)} a pie.`);
}

map.on('click', e => {
  updateCoords(e.latlng);
  if (!activeTool) return;
  const ll = [e.latlng.lat, e.latlng.lng];
  if (activeTool === 'point') { beginForm('point', ll); return; }
  if (activeTool === 'radius') { beginForm('radius', ll, { radius: 500 }); return; }
  draft.push(ll);
  updateDraft();
});

/* ---------- popups ---------- */
function openPopup(it, latlng) {
  const cat = CATS[catOf(it)], st = STATES[stateOf(it)];
  const el = document.createElement('div');
  el.className = 'pop';

  const head = document.createElement('div');
  head.className = 'pop-head';
  const c = document.createElement('span');
  c.className = 'pop-cat';
  c.style.setProperty('--c', cat.color);
  c.textContent = cat.name;
  const s = document.createElement('span');
  s.className = 'pop-state';
  s.style.setProperty('--s', st.color);
  s.textContent = st.name;
  head.append(c, s);

  const h = document.createElement('h3');
  h.textContent = it.name;
  el.append(head, h);

  if (it.note) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = safeMode ? 'Nota oculta (modo seguro).' : it.note;
    el.append(p);
  }

  const dl = document.createElement('dl');
  const add = (k, v) => {
    if (!v) return;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  };
  add('Ofrece', it.offers);
  add('Necesita', it.needs);
  add('Horario', it.schedule);
  add('Contacto', safeMode ? (it.contact ? 'oculto (modo seguro)' : '') : it.contact);
  if (it.type === 'line') add('Largo', fmtDist(itemLength(it)) + ' · ~' + walkTime(itemLength(it)) + ' a pie');
  if (it.type === 'zone') add('Área', fmtArea(areaM2(it.coords)));
  if (it.type === 'radius') add('Radio', (it.radius || 500) + ' m');
  if (it.approximate) add('Ubicación', 'aproximada (difuminada)');
  if (dl.children.length) el.append(dl);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const center = itemCenter(it);
  meta.textContent = TYPE_NAME[it.type] + ' · ' + (it.approximate ? '≈ ' : '') + fmtCoord(center.lat, center.lng)
    + (it.author ? ' · ' + it.author : '')
    + (it.updated ? ' · ' + new Date(it.updated).toLocaleDateString('es-CL') : '');
  el.append(meta);

  const actions = document.createElement('div');
  actions.className = 'pop-actions';
  const editable = canEdit(it);
  if (editable) {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Cambiar estado');
    Object.entries(STATES).forEach(([id, s2]) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = s2.name;
      if (id === stateOf(it)) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', async () => {
      const next = sel.value;
      sel.disabled = true;
      try {
        await api('/items/' + encodeURIComponent(it.id), {
          method: 'PATCH',
          body: { estado: next },
          headers: authHeaders(it)
        });
        it.estado = next;
        renderAll();
        map.closePopup();
        toast('Estado actualizado.');
      } catch (e) {
        sel.disabled = false;
        sel.value = stateOf(it);
        toast(e.message);
      }
    });
    actions.append(sel);
  }

  const bCenter = miniBtn('◎', 'Centrar', 'center');
  bCenter.addEventListener('click', () => { flyToItem(it); map.closePopup(); });
  actions.append(bCenter);
  if (editable) {
    const bEdit = miniBtn('✎', 'Editar', 'edit');
    bEdit.addEventListener('click', () => { map.closePopup(); beginEdit(it); });
    const bDel = miniBtn('✕', 'Borrar', 'del');
    bDel.classList.add('danger');
    bDel.addEventListener('click', () => { map.closePopup(); removeItem(it); });
    actions.append(bEdit, bDel);
  }
  el.append(actions);

  L.popup({ maxWidth: 300, className: 'map-pop', autoPanPadding: useSheetUI() ? [24, 104] : [24, 24] })
    .setLatLng(latlng).setContent(el).openOn(map);
}

function flyToItem(it) {
  if (it.type === 'point' || it.type === 'radius') {
    map.flyTo([it.coords[0], it.coords[1]], Math.max(map.getZoom(), 15));
  } else {
    map.flyToBounds(L.latLngBounds(it.coords), { padding: [50, 50], maxZoom: 16 });
  }
}

async function removeItem(it) {
  if (!canEdit(it)) { toast('Solo quien lo creó puede borrarlo. Pide moderación si es necesario.'); return; }
  if (!confirm('¿Borrar "' + it.name + '"? Esta acción no se puede deshacer.')) return;
  try {
    await api('/items/' + encodeURIComponent(it.id), { method: 'DELETE', headers: authHeaders(it) });
    items = items.filter(x => x.id !== it.id);
    delete editTokens[it.id];
    saveTokens();
    renderAll();
    toast('Elemento borrado.');
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- interacción del panel ---------- */
$('#tools').addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (!b) return;
  const t = b.dataset.tool;
  if (t === 'locate') { setTool('locate'); return; }
  setTool(activeTool === t ? null : t);
});
$('#btn-finish').addEventListener('click', finishDraw);
$('#btn-undo').addEventListener('click', () => {
  if (!draft.length) return;
  draft.pop();
  updateDraft();
});
$('#btn-cancel').addEventListener('click', () => { clearTransient(true); setStatus('Cancelado.'); });
$('#f-cancel').addEventListener('click', () => { clearTransient(true); setStatus('Cancelado.'); });
$('#f-radius-range').addEventListener('input', e => syncRadius(e.target.value));
$('#f-radius').addEventListener('input', e => syncRadius(e.target.value));

$('#itemform').addEventListener('submit', async e => {
  e.preventDefault();
  if (!pending) return;
  const name = $('#f-name').value.trim();
  if (!name) { $('#f-name').focus(); return; }
  const wasEdit = !!editingId;
  const body = {
    type: pending.type,
    name: name,
    cat: $('#f-cat').value,
    estado: $('#f-est').value,
    offers: $('#f-offers').value.trim(),
    needs: $('#f-needs').value.trim(),
    schedule: $('#f-schedule').value.trim(),
    contact: $('#f-contact').value.trim(),
    author: $('#f-author').value.trim(),
    note: $('#f-note').value.trim(),
    approximate: $('#f-approx').checked,
    coords: pending.coords
  };
  if (pending.type === 'radius') body.radius = clamp(parseInt($('#f-radius').value, 10) || 500, 50, 5000);
  const save = $('#f-save');
  const label = wasEdit ? 'Guardar cambios' : (CONFIG.gated ? 'Guardar' : 'Publicar');
  save.disabled = true;
  save.textContent = 'Guardando…';
  try {
    if (editingId) {
      const current = items.find(x => x.id === editingId) || { id: editingId };
      await api('/items/' + encodeURIComponent(editingId), {
        method: 'PATCH',
        body: body,
        headers: authHeaders(current)
      });
      toast('Elemento actualizado.');
    } else {
      const res = await api('/items', { method: 'POST', body: body });
      if (res.editToken && res.item) {
        editTokens[res.item.id] = res.editToken;
        saveTokens();
      }
      toast(CONFIG.gated ? 'Elemento guardado.' : 'Elemento publicado. Guardamos tu token de edición en este navegador.');
    }
    clearTransient(true);
    await refreshItems();
  } catch (err) {
    toast(err.message);
  } finally {
    save.disabled = false;
    save.textContent = label;
  }
});

$('#list').addEventListener('click', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  const it = items.find(x => x.id === row.dataset.id);
  if (!it) return;
  const btn = e.target.closest('button[data-act]');
  if (!btn) { flyToItem(it); return; }
  e.stopPropagation();
  if (btn.dataset.act === 'fly') flyToItem(it);
  if (btn.dataset.act === 'edit') beginEdit(it);
  if (btn.dataset.act === 'del') removeItem(it);
});

$('#cats').addEventListener('change', e => {
  const id = e.target.dataset.cat;
  if (!id) return;
  if (e.target.checked) activeCats.add(id); else activeCats.delete(id);
  renderItems();
  renderList();
});
$('#states').addEventListener('change', e => {
  const id = e.target.dataset.state;
  if (!id) return;
  if (e.target.checked) activeStates.add(id); else activeStates.delete(id);
  renderItems();
  renderList();
});
$('#toggle-labels').addEventListener('change', e => { labelsOn = e.target.checked; renderItems(); });
$('#toggle-bounds').addEventListener('change', e => { boundsOn = e.target.checked; drawBounds(); });
$('#search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderItems(); renderList(); });
$('#basemaps').addEventListener('click', e => {
  const b = e.target.closest('button[data-base]');
  if (b) setBase(b.dataset.base);
});

$('#btn-zoomin').addEventListener('click', () => map.zoomIn());
$('#btn-zoomout').addEventListener('click', () => map.zoomOut());

function locate() {
  if (!navigator.geolocation) { toast('Geolocalización no disponible.'); return; }
  setStatus('Buscando tu ubicación…', 'warn');
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    locateLayer.clearLayers();
    L.circle(ll, { radius: pos.coords.accuracy, color: '#ffc800', weight: 1, fillColor: '#ffc800', fillOpacity: .08, dashArray: '4,4' }).addTo(locateLayer);
    L.circleMarker(ll, { radius: 7, color: '#ffc800', weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 })
      .addTo(locateLayer).bindTooltip('Tu ubicación', { direction: 'top', offset: [0, -7] });
    map.flyTo(ll, 16);
    setStatus('Ubicación aproximada · precisión ' + Math.round(pos.coords.accuracy) + ' m.', 'warn');
  }, () => {
    setStatus('No se pudo obtener la ubicación.', 'err');
    toast('Permiso denegado o ubicación no disponible.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
$('#btn-locate').addEventListener('click', locate);

/* ---------- buscador de calles, direcciones y coordenadas ---------- */
const GEO_VIEWBOX = CONFIG.geoViewbox; // left,top,right,bottom (Nominatim)
const GEO_CACHE = new Map();
let lastGeoRequest = 0;
const ROAD_TYPES = new Set(['trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street','pedestrian','service','track','footway','cycleway','path','steps']);

function validCoords(a, b) {
  const lat = parseFloat(a), lng = parseFloat(b);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function parseCoords(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  let m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) return validCoords(m[1], m[2]);
  m = s.match(/^(-?\d{1,3}\.\d+)\s+(-?\d{1,3}\.\d+)$/);
  if (m) return validCoords(m[1], m[2]);
  return null;
}

function comunaOf(text) {
  const t = text || '';
  if (/la florida/i.test(t)) return 'La Florida';
  if (/puente alto/i.test(t)) return 'Puente Alto';
  return '';
}

function geoLabel(r) {
  if (r.name) return r.name;
  const parts = (r.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || 'Resultado';
}

function geoTypeLabel(r) {
  if (r.category === 'coords') return 'coordenadas';
  if (r.category === 'highway') return 'calle';
  if (r.category === 'place' && (r.type === 'house' || r.type === 'apartments')) return 'dirección';
  const map = { railway: 'estación', amenity: 'lugar', shop: 'comercio', leisure: 'espacio', tourism: 'lugar', building: 'edificio', place: 'lugar', boundary: 'límite', natural: 'lugar', waterway: 'curso de agua' };
  return map[r.category] || r.type || 'lugar';
}

function geoIcon(r) {
  if (r.category === 'highway') return '🛣️';
  if (r.category === 'place' && (r.type === 'house' || r.type === 'apartments')) return '🏠';
  if (r.category === 'railway') return '🚉';
  if (r.category === 'leisure' || r.category === 'natural') return '🌳';
  if (r.category === 'amenity' || r.category === 'shop') return '📍';
  return '📍';
}

function isRoad(r) {
  return !!r && r.category === 'highway' && ROAD_TYPES.has(r.type);
}

async function fetchJSON(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geoThrottle() {
  const wait = 1100 - (Date.now() - lastGeoRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeoRequest = Date.now();
}

async function geocode(q) {
  const key = 'q:' + q.toLowerCase();
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  await geoThrottle();
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&polygon_geojson=1&countrycodes=cl&accept-language=es&viewbox='
    + encodeURIComponent(GEO_VIEWBOX) + '&q=' + encodeURIComponent(q);
  const data = await fetchJSON(url, { headers: { Accept: 'application/json' } }, 12000);
  GEO_CACHE.set(key, data);
  return data;
}

async function fetchStreet(name) {
  const key = 'street:' + name.toLowerCase();
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  await geoThrottle();
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=50&polygon_geojson=1&countrycodes=cl&accept-language=es&bounded=1&viewbox='
    + encodeURIComponent(GEO_VIEWBOX) + '&q=' + encodeURIComponent(name);
  const data = await fetchJSON(url, { headers: { Accept: 'application/json' } }, 15000);
  const want = name.trim().toLowerCase();
  const lines = [];
  data.forEach(r => {
    if ((r.name || '').trim().toLowerCase() !== want) return;
    const g = r.geojson;
    if (!g) return;
    if (g.type === 'LineString') lines.push(g.coordinates.map(c => [c[1], c[0]]));
    else if (g.type === 'MultiLineString') g.coordinates.forEach(l => lines.push(l.map(c => [c[1], c[0]])));
  });
  GEO_CACHE.set(key, lines);
  return lines;
}

function geoPopup(r, ll, isStreet) {
  const el = document.createElement('div');
  el.className = 'pop';
  const head = document.createElement('div');
  head.className = 'pop-head';
  const cat = document.createElement('span');
  cat.className = 'pop-cat';
  cat.style.setProperty('--c', '#ffc800');
  cat.textContent = isStreet ? 'Calle completa' : geoTypeLabel(r);
  head.append(cat);
  const h = document.createElement('h3');
  h.textContent = geoLabel(r);
  el.append(head, h);
  if (r.display_name) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = r.display_name;
    el.append(p);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = 'Búsqueda · ' + fmtCoord(ll.lat, ll.lng);
  el.append(meta);
  const actions = document.createElement('div');
  actions.className = 'pop-actions';
  const bMark = document.createElement('button');
  bMark.type = 'button';
  bMark.className = 'primary';
  bMark.textContent = isStreet ? 'Marcar el centro' : 'Marcar punto aquí';
  bMark.addEventListener('click', () => {
    const name = geoLabel(r);
    searchLayer.clearLayers();
    map.closePopup();
    beginForm('point', [ll.lat, ll.lng]);
    $('#f-name').value = name;
    $('#f-name').focus();
  });
  const bCopy = document.createElement('button');
  bCopy.type = 'button';
  bCopy.textContent = 'Copiar coordenadas';
  bCopy.addEventListener('click', () => copyText(fmtCoord(ll.lat, ll.lng)));
  actions.append(bMark, bCopy);
  el.append(actions);
  return el;
}

function drawStreet(name, lines) {
  searchLayer.clearLayers();
  const all = [];
  lines.forEach(line => {
    L.polyline(line, { color: '#0a0a0a', weight: 8, opacity: .5 }).addTo(searchLayer);
    L.polyline(line, { color: '#ffc800', weight: 4, opacity: .95 }).addTo(searchLayer);
    all.push(...line);
  });
  const bounds = L.latLngBounds(all);
  map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 16, duration: .8 });
  const center = bounds.getCenter();
  L.circleMarker(center, { radius: 9, color: '#ffc800', weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 })
    .addTo(searchLayer)
    .bindPopup(geoPopup({ name: name, display_name: name, category: 'highway', type: 'street' }, center, true))
    .openPopup();
  setStatus('Calle completa: ' + name + ' · ' + lines.length + ' tramo(s).', 'warn');
}

function showGeoPoint(r, ll) {
  searchLayer.clearLayers();
  L.circleMarker(ll, { radius: 10, color: '#ffc800', weight: 2, fillColor: '#ffc800', fillOpacity: .25 }).addTo(searchLayer);
  L.circleMarker(ll, { radius: 4, color: '#0a0a0a', weight: 2, fillColor: '#ffc800', fillOpacity: 1 }).addTo(searchLayer);
  const g = r.geojson;
  if (g && g.type === 'LineString') {
    const line = g.coordinates.map(c => [c[1], c[0]]);
    L.polyline(line, { color: '#0a0a0a', weight: 7, opacity: .5 }).addTo(searchLayer);
    L.polyline(line, { color: '#ffc800', weight: 3.5, opacity: .95 }).addTo(searchLayer);
    map.flyToBounds(L.latLngBounds(line), { padding: [60, 60], maxZoom: 17 });
  } else if (g && g.type === 'Polygon') {
    const ring = g.coordinates[0].map(c => [c[1], c[0]]);
    L.polygon(ring, { color: '#ffc800', weight: 2.5, fillColor: '#ffc800', fillOpacity: .12 }).addTo(searchLayer);
    map.flyToBounds(L.latLngBounds(ring), { padding: [60, 60], maxZoom: 17 });
  } else {
    map.flyTo(ll, 17);
  }
  L.popup({ maxWidth: 300 }).setLatLng(ll).setContent(geoPopup(r, L.latLng(ll[0], ll[1]), false)).openOn(map);
  setStatus('Resultado: ' + geoLabel(r) + '.');
}

async function selectGeoResult(r, fullStreet) {
  const ll = [parseFloat(r.lat), parseFloat(r.lon)];
  if (fullStreet && r.name) {
    setStatus('Buscando la calle completa: ' + r.name + '…', 'warn');
    try {
      const lines = await fetchStreet(r.name);
      if (lines.length) { drawStreet(r.name, lines); return; }
      toast('No se encontró la calle completa; muestro el tramo principal.');
    } catch (e) {
      toast('No se pudo cargar la calle completa; muestro el tramo principal.');
    }
  }
  showGeoPoint(r, ll);
}

function renderGeoResults(results, query) {
  const box = $('#georesults');
  box.innerHTML = '';
  searchLayer.clearLayers();
  if (!results || !results.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Sin resultados. Prueba con “calle, comuna”.';
    box.append(p);
    setStatus('Sin resultados para “' + query + '”.', 'err');
    return;
  }
  const hasDigits = /\d/.test(query);
  const arr = results.slice();
  if (hasDigits) {
    const num = (query.match(/\d+/) || [''])[0];
    arr.sort((a, b) => {
      const sa = (a.display_name || '').includes(num) ? 1 : 0;
      const sb = (b.display_name || '').includes(num) ? 1 : 0;
      return sb - sa;
    });
  }
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    if (isRoad(r)) {
      const k = 'r:' + (r.name || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(r);
    if (out.length >= 6) break;
  }
  out.forEach(r => {
    const fullStreet = !hasDigits && isRoad(r) && !!r.name;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'geo-item';
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = fullStreet ? '🛣️' : geoIcon(r);
    const txt = document.createElement('span');
    txt.className = 'txt';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = geoLabel(r);
    const mt = document.createElement('span');
    mt.className = 'mt';
    const comuna = comunaOf(r.display_name);
    mt.textContent = (fullStreet ? 'calle completa' : geoTypeLabel(r)) + (comuna ? ' · ' + comuna : '');
    txt.append(nm, mt);
    const go = document.createElement('span');
    go.className = 'go';
    go.textContent = fullStreet ? 'trazar' : 'ir';
    b.append(ico, txt, go);
    b.addEventListener('click', () => selectGeoResult(r, fullStreet));
    box.append(b);
  });
  setStatus(out.length + ' resultado(s). Elige uno.', 'warn');
}

async function runGeoSearch() {
  const raw = $('#geosearch').value.trim();
  if (!raw) { $('#geosearch').focus(); return; }
  const coords = parseCoords(raw);
  if (coords) {
    const ll = [coords[0], coords[1]];
    searchLayer.clearLayers();
    L.circleMarker(ll, { radius: 10, color: '#ffc800', weight: 2, fillColor: '#ffc800', fillOpacity: .25 }).addTo(searchLayer);
    L.circleMarker(ll, { radius: 4, color: '#0a0a0a', weight: 2, fillColor: '#ffc800', fillOpacity: 1 }).addTo(searchLayer);
    map.flyTo(ll, 17);
    L.popup({ maxWidth: 300 }).setLatLng(ll)
      .setContent(geoPopup({ name: 'Coordenadas', display_name: fmtCoord(coords[0], coords[1]), category: 'coords' }, L.latLng(ll[0], ll[1]), false))
      .openOn(map);
    setStatus('Coordenadas ' + fmtCoord(coords[0], coords[1]) + '.');
    return;
  }
  const btn = $('#btn-geosearch');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  setStatus('Buscando “' + raw + '” en OpenStreetMap…', 'warn');
  try {
    const data = await geocode(raw);
    renderGeoResults(data, raw);
  } catch (e) {
    setStatus('No se pudo buscar. Revisa la conexión.', 'err');
    toast('La búsqueda en OpenStreetMap falló.');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

$('#btn-geosearch').addEventListener('click', runGeoSearch);
$('#geosearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runGeoSearch(); } });

function updateCoords(ll) { $('#coords').textContent = fmtCoord(ll.lat, ll.lng); }
map.on('mousemove', e => updateCoords(e.latlng));
$('#btn-copycoords').addEventListener('click', () => copyText($('#coords').textContent));

function toggleFocus() {
  const on = !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(() => map.invalidateSize(), 260);
}
$('#btn-focus').addEventListener('click', toggleFocus);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('focus-mode')) {
    document.body.classList.remove('focus-mode');
    setTimeout(() => map.invalidateSize(), 260);
  }
});

/* ---------- hoja inferior en móvil ---------- */
const mqMobile = window.matchMedia('(max-width:900px)');
function useSheetUI() { return mqMobile.matches && CONFIG.site === 'cordillera'; }

function setPanel(open) {
  const panel = $('#panel');
  const btn = $('#panel-toggle');
  panel.classList.toggle('collapsed', !open);
  document.body.classList.toggle('sheet-open', open && useSheetUI());
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? '▾' : '▴';
  btn.title = open ? 'Plegar panel' : 'Abrir panel';
  setTimeout(() => map.invalidateSize(), 280);
}

const drawbarEl = $('#drawbar');
const drawbarHome = drawbarEl.parentNode;
const drawbarAnchor = drawbarEl.nextElementSibling;

function placeDrawbar() {
  if (useSheetUI()) {
    if (drawbarEl.parentNode !== $('#mapwrap')) $('#mapwrap').append(drawbarEl);
  } else if (drawbarEl.parentNode !== drawbarHome) {
    drawbarHome.insertBefore(drawbarEl, drawbarAnchor);
  }
}

$('#panel-toggle').addEventListener('click', () => {
  setPanel($('#panel').classList.contains('collapsed'));
});

$('.panel-head').addEventListener('click', e => {
  if (!useSheetUI() || e.target.closest('button')) return;
  setPanel($('#panel').classList.contains('collapsed'));
});

mqMobile.addEventListener('change', () => {
  placeDrawbar();
  setPanel(!useSheetUI());
  setTimeout(() => map.invalidateSize(), 320);
});

function applySafe() {
  $('#safe-banner').hidden = !safeMode;
  $('#safe-mode').checked = safeMode;
  try { localStorage.setItem(SAFE_STORAGE, safeMode ? '1' : '0'); } catch (e) {}
  map.closePopup();
  renderList();
}
$('#safe-mode').addEventListener('change', e => { safeMode = e.target.checked; applySafe(); });

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { clearTransient(true); setStatus('Cancelado.'); return; }
  if (k === 'enter' && activeTool) { e.preventDefault(); finishDraw(); return; }
  const mapKeys = { p: 'point', r: 'line', z: 'zone', c: 'radius', m: 'measure' };
  if (mapKeys[k]) { e.preventDefault(); setTool(activeTool === mapKeys[k] ? null : mapKeys[k]); }
  if (k === 'l') locate();
  if (k === 'f') toggleFocus();
});

/* ---------- datos ---------- */
function populateSelects() {
  const cat = $('#f-cat');
  cat.innerHTML = '';
  Object.entries(CATS).forEach(([id, c]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = c.name;
    cat.append(o);
  });
  const est = $('#f-est');
  est.innerHTML = '';
  Object.entries(STATES).forEach(([id, s]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = s.name;
    est.append(o);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles.');
    return;
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('Copiado al portapapeles.');
  } catch (e) {
    toast('No se pudo copiar.');
  }
  ta.remove();
}

function download(text, name, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function dateTag() { return new Date().toISOString().slice(0, 10); }

function toGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: items.map(it => {
      let geometry = null;
      if (it.type === 'point' || it.type === 'radius') {
        geometry = { type: 'Point', coordinates: [it.coords[1], it.coords[0]] };
      } else if (it.type === 'line') {
        geometry = { type: 'LineString', coordinates: it.coords.map(c => [c[1], c[0]]) };
      } else if (it.type === 'zone') {
        const ring = it.coords.map(c => [c[1], c[0]]);
        if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
        geometry = { type: 'Polygon', coordinates: [ring] };
      }
      return {
        type: 'Feature',
        properties: {
          id: it.id, name: it.name, cat: catOf(it), estado: stateOf(it),
          note: it.note || '', offers: it.offers || '', needs: it.needs || '',
          schedule: it.schedule || '', contact: it.contact || '', author: it.author || '',
          type: it.type, radius: it.radius || null, approximate: !!it.approximate,
          example: !!it.example, created: it.created || null, updated: it.updated || null
        },
        geometry: geometry
      };
    })
  };
}

function toCSV() {
  const cols = ['id','type','name','cat','estado','lat','lng','radius','note','offers','needs','schedule','contact','author','approximate','example'];
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [cols.join(',')];
  items.forEach(it => {
    const c = itemCenter(it);
    rows.push([
      it.id, it.type, it.name, catOf(it), stateOf(it),
      c.lat.toFixed(6), c.lng.toFixed(6), it.radius || '',
      it.note || '', it.offers || '', it.needs || '', it.schedule || '', it.contact || '',
      it.author || '', it.approximate ? '1' : '0', it.example ? '1' : '0'
    ].map(esc).join(','));
  });
  return rows.join('\r\n');
}

$('#btn-geo').addEventListener('click', () => {
  if (!items.length) { toast('No hay datos para exportar.'); return; }
  download(JSON.stringify(toGeoJSON(), null, 2), 'mapa-cordillera-' + dateTag() + '.geojson', 'application/geo+json');
  toast('GeoJSON descargado.');
});
$('#btn-backup').addEventListener('click', () => {
  download(JSON.stringify({ app: 'mapa-cordillera', version: 1, exported: new Date().toISOString(), items: items }, null, 2),
    'mapa-cordillera-respaldo-' + dateTag() + '.json', 'application/json');
  toast('Respaldo descargado.');
});
$('#btn-csv').addEventListener('click', () => {
  if (!items.length) { toast('No hay datos para exportar.'); return; }
  download(toCSV(), 'mapa-cordillera-' + dateTag() + '.csv', 'text/csv;charset=utf-8');
  toast('CSV descargado.');
});

$('#btn-import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const incoming = [];
      if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        data.features.forEach(f => {
          const g = f.geometry, p = f.properties || {};
          if (!g) return;
          let type = p.type, coords = null;
          if (g.type === 'Point') {
            coords = [g.coordinates[1], g.coordinates[0]];
            if (!type) type = p.radius ? 'radius' : 'point';
          } else if (g.type === 'LineString') {
            coords = g.coordinates.map(c => [c[1], c[0]]);
            type = 'line';
          } else if (g.type === 'Polygon') {
            coords = g.coordinates[0].map(c => [c[1], c[0]]);
            if (coords.length > 1 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]) coords.pop();
            type = 'zone';
          }
          if (!coords || !['point','line','zone','radius'].includes(type)) return;
          incoming.push({
            id: genId(), type: type, name: p.name || 'Elemento importado',
            cat: CATS[p.cat] ? p.cat : 'espacio', estado: STATES[p.estado] ? p.estado : 'pendiente',
            note: p.note || '', offers: p.offers || '', needs: p.needs || '',
            schedule: p.schedule || '', contact: p.contact || '', author: p.author || '',
            radius: p.radius || 500, approximate: !!p.approximate, coords: coords,
            example: false, updated: new Date().toISOString()
          });
        });
      } else if (data && Array.isArray(data.items)) {
        data.items.filter(validItem).forEach(it => {
          incoming.push(Object.assign({}, it, { id: genId(), example: false, updated: new Date().toISOString() }));
        });
      } else if (Array.isArray(data)) {
        data.filter(validItem).forEach(it => {
          incoming.push(Object.assign({}, it, { id: genId(), example: false, updated: new Date().toISOString() }));
        });
      } else {
        toast('Formato no reconocido. Usa GeoJSON o un respaldo.');
        return;
      }
      if (!incoming.length) { toast('No se encontraron elementos válidos.'); return; }
      const res = await api('/import', { method: 'POST', body: { items: incoming } });
      Object.assign(editTokens, res.editTokens || {});
      saveTokens();
      toast('Importados ' + ((res.items || []).length) + ' elementos al mapa colectivo.');
      await refreshItems();
    } catch (err) {
      toast(err.message || 'No se pudo leer el archivo.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

$('#btn-print').addEventListener('click', () => {
  const area = $('#print-area');
  area.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = CONFIG.title + (CONFIG.gated ? ' · La Florida / Puente Alto' : ' · Gran Santiago');
  area.append(h);
  const meta = document.createElement('p');
  meta.className = 'pmeta';
  meta.textContent = 'Ficha territorial · ' + new Date().toLocaleString('es-CL') + ' · ' + items.length + ' elementos' + (safeMode ? ' · modo seguro' : '');
  area.append(meta);
  if (safeMode) {
    const w = document.createElement('p');
    w.className = 'pmeta';
    w.textContent = 'Modo seguro: notas y contactos ocultos.';
    area.append(w);
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['Nombre','Categoría','Estado','Tipo','Nota','Necesita','Horario','Coordenadas'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    htr.append(th);
  });
  thead.append(htr);
  table.append(thead);
  const tbody = document.createElement('tbody');
  items.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach(it => {
    const tr = document.createElement('tr');
    const c = itemCenter(it);
    [it.name, CATS[catOf(it)].name, STATES[stateOf(it)].name, TYPE_NAME[it.type],
      safeMode ? '—' : (it.note || ''), safeMode ? '—' : (it.needs || ''),
      it.schedule || '', fmtCoord(c.lat, c.lng)].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  area.append(table);
  const foot = document.createElement('p');
  foot.className = 'pfoot';
  foot.textContent = 'Mapa colectivo: los datos viven en el servidor de Antarquía. Límites comunales: OpenStreetMap. Mapa base: Esri / OpenStreetMap.';
  area.append(foot);
  area.hidden = false;
  const cleanup = () => {
    area.hidden = true;
    area.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1500);
});

$('#btn-copy').addEventListener('click', () => {
  const lines = [
    CONFIG.title + ' — ' + items.length + ' elementos',
    'Pendientes ' + items.filter(it => stateOf(it) === 'pendiente').length
      + ' · En curso ' + items.filter(it => stateOf(it) === 'encurso').length
      + ' · Resueltos ' + items.filter(it => stateOf(it) === 'hecho').length,
    ''
  ];
  items.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach(it => {
    lines.push('- [' + CATS[catOf(it)].name + ' / ' + STATES[stateOf(it)].name + '] ' + it.name
      + (it.needs ? ' · necesita: ' + it.needs : '')
      + (it.schedule ? ' · ' + it.schedule : ''));
  });
  copyText(lines.join('\n'));
});

$('#btn-clear').addEventListener('click', async () => {
  if (!adminToken) { toast('Necesitas el token de administración.'); return; }
  if (!items.length) { toast('El mapa ya está vacío.'); return; }
  if (!confirm('¿Borrar TODOS los elementos del mapa colectivo? Esta acción no se puede deshacer.')) return;
  const typed = prompt('Escribe BORRAR para confirmar el borrado total.');
  if (typed !== 'BORRAR') { toast('Cancelado.'); return; }
  try {
    const res = await api('/purge', { method: 'POST', body: { confirm: 'BORRAR' }, headers: { 'x-admin-token': adminToken } });
    toast('Borrados ' + res.deleted + ' elementos.');
    await refreshItems();
  } catch (e) {
    toast(e.message);
  }
});

$('#btn-examples').addEventListener('click', async () => {
  const payload = EXAMPLES.map(it => ({
    type: it.type, name: it.name, cat: it.cat, estado: it.estado,
    note: it.note, offers: it.offers, needs: it.needs,
    schedule: it.schedule, contact: it.contact, coords: it.coords, radius: it.radius
  }));
  try {
    const res = await api('/import', { method: 'POST', body: { items: payload } });
    Object.assign(editTokens, res.editTokens || {});
    saveTokens();
    toast('Ejemplos publicados: ' + ((res.items || []).length) + '.');
    await refreshItems();
  } catch (e) {
    toast(e.message);
  }
});
$('#btn-noexamples').addEventListener('click', () => {
  toast('Los elementos publicados se borran uno por uno o con moderación.');
});

/* ---------- sesión, moderación y red ---------- */
function showGate(msg) {
  const g = $('#gate');
  if (!g) return;
  g.hidden = false;
  const err = $('#gate-error');
  if (err) err.textContent = msg || '';
  setTimeout(() => { const p = $('#gate-pass'); if (p) p.focus(); }, 60);
}

function hideGate() {
  const g = $('#gate');
  if (g) g.hidden = true;
}

async function checkSession() {
  try {
    await api('/session', { quiet: true });
    hideGate();
    return true;
  } catch (e) {
    if (e.status === 401 || e.status === 503) {
      showGate(e.status === 503 ? e.message : '');
      return false;
    }
    hideGate();
    return true;
  }
}

const gateForm = $('#gate-form');
if (gateForm) {
  gateForm.addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#gate-pass');
    const btn = $('#gate-submit');
    const err = $('#gate-error');
    if (err) err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Comprobando…';
    try {
      await api('/auth', { method: 'POST', body: { passphrase: input.value }, quiet: true });
      input.value = '';
      hideGate();
      await refreshItems();
      offerMigration();
      toast('Sesión iniciada.');
    } catch (ex) {
      if (err) err.textContent = ex.message;
      input.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

const logoutBtn = $('#btn-logout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST', quiet: true }); } catch (e) {}
    items = [];
    renderAll();
    showGate('Sesión cerrada.');
    setStatus('Sesión cerrada.');
  });
}

$('#btn-admin').addEventListener('click', async () => {
  const input = $('#admin-token');
  const value = input.value.trim();
  if (!value) {
    adminToken = '';
    try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
    applyAdmin();
    toast('Modo administración desactivado.');
    return;
  }
  try {
    await api('/audit', { headers: { 'x-admin-token': value } });
    adminToken = value;
    try { sessionStorage.setItem(ADMIN_KEY, value); } catch (e) {}
    input.value = '';
    applyAdmin();
    toast('Token válido. Modo administración activo en esta pestaña.');
    refreshItems({ silent: true });
  } catch (e) {
    toast('Token inválido: ' + e.message);
  }
});

$('#btn-audit').addEventListener('click', async () => {
  try {
    const data = await api('/audit', { headers: { 'x-admin-token': adminToken } });
    const list = Array.isArray(data.audit) ? data.audit : [];
    const modal = document.createElement('div');
    modal.className = 'audit-modal';
    const card = document.createElement('div');
    card.className = 'audit-card';
    const h = document.createElement('h2');
    h.textContent = 'Auditoría · últimas acciones';
    card.append(h);
    const ul = document.createElement('ul');
    if (!list.length) {
      const li = document.createElement('li');
      li.textContent = 'Sin registros.';
      ul.append(li);
    }
    list.slice(0, 60).forEach(a => {
      const li = document.createElement('li');
      li.textContent = new Date(a.ts).toLocaleString('es-CL') + ' · ' + a.action
        + (a.name ? ' · ' + a.name : '') + (a.count ? ' · ' + a.count + ' elementos' : '')
        + (a.ipHash ? ' · ' + a.ipHash.slice(0, 8) : '');
      ul.append(li);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => modal.remove());
    card.append(ul, close);
    modal.append(card);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.append(modal);
  } catch (e) {
    toast(e.message);
  }
});

$('#btn-retry').addEventListener('click', () => refreshItems());

/* ---------- arranque ---------- */
let tileWarned = false;
map.on('tileerror', () => {
  if (tileWarned) return;
  tileWarned = true;
  toast('No se pudieron cargar algunas teselas. Prueba el fondo "Sin fondo".');
});

async function init() {
  populateSelects();
  if (useSheetUI()) {
    placeDrawbar();
    setPanel(false);
    L.Popup.prototype.options.autoPanPadding = L.point(20, 96);
  }
  $('#safe-mode').checked = safeMode;
  applySafe();
  applyAdmin();
  renderAll();
  let savedBase = 'dark';
  try { savedBase = localStorage.getItem(BASE_STORAGE) || 'dark'; } catch (e) {}
  setBase(savedBase in BASES ? savedBase : 'dark');
  await loadBounds();
  if (CONFIG.gated) {
    const ok = await checkSession();
    if (ok) {
      await refreshItems();
      offerMigration();
    }
  } else {
    await refreshItems();
    offerMigration();
  }
  setStatus('Listo. Elige una herramienta o toca un elemento.');
  setTimeout(() => map.invalidateSize(), 150);
  setTimeout(() => map.invalidateSize(), 700);

  setInterval(() => {
    if (document.hidden) return;
    if (!$('#itemform').hidden) return;
    const gate = $('#gate');
    if (gate && !gate.hidden) return;
    refreshItems({ silent: true });
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const gate = $('#gate');
    if (gate && !gate.hidden) return;
    refreshItems({ silent: true });
  });
}
init();
