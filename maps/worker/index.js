/**
 * Mapas Antarquía — Worker de Cloudflare
 *
 * Sirve dos mapas y una API colectiva sobre KV:
 *   cartografia.antarquia.cl  → Cartografía Anarquista (Gran Santiago, abierto)
 *   cordillera.antarquia.cl   → Mapeo Cordillera (passphrase)
 *
 * Secretos:
 *   CORDILLERA_PASSPHRASE  frase de acceso del mapa Cordillera
 *   SESSION_SECRET         clave HMAC para firmar sesiones
 *   ADMIN_TOKEN            token para moderar y borrar el mapa
 *
 * Bindings:
 *   MAPS    namespace KV
 *   ASSETS  assets estáticos de ../site
 */

const SITE_CARTO = 'cartografia';
const SITE_CORD = 'cordillera';
const SESSION_COOKIE = 'mc_session';
const SESSION_TTL = 12 * 60 * 60; // 12 h
const MAX_ITEMS = 2000;
const MAX_IMPORT = 200;
const AUDIT_MAX = 200;

const SITES = {
  [SITE_CARTO]: {
    name: 'Cartografía Anarquista',
    bbox: [-33.75, -70.85, -33.25, -70.35], // south, west, north, east
    gated: false,
  },
  [SITE_CORD]: {
    name: 'Mapeo Cordillera',
    bbox: [-33.68, -70.65, -33.47, -70.42],
    gated: true,
  },
};

const TYPES = new Set(['point', 'line', 'zone', 'radius']);
const CATS = new Set(['apoyo', 'espacio', 'memoria', 'conflicto', 'difusion', 'cuidados']);
const STATES = new Set(['pendiente', 'encurso', 'hecho']);
const LIMITS = { name: 90, offers: 120, needs: 120, schedule: 80, contact: 120, note: 400, author: 40 };

/* ---------- respuestas ---------- */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function jsonError(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

/* ---------- utilidades ---------- */
function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local');
}

function siteFromRequest(url) {
  const host = url.hostname.toLowerCase();
  // En desarrollo (http o puerto explícito) el host puede ser el custom domain
  // simulado por wrangler; el parámetro ?site= manda.
  const dev = url.protocol === 'http:' || url.port !== '';
  if (dev) {
    const q = url.searchParams.get('site');
    if (q === SITE_CORD) return SITE_CORD;
    if (q === SITE_CARTO) return SITE_CARTO;
  }
  if (host === 'cordillera.antarquia.cl') return SITE_CORD;
  if (host === 'cartografia.antarquia.cl') return SITE_CARTO;
  if (isLocalHost(host)) {
    return url.searchParams.get('site') === SITE_CORD ? SITE_CORD : SITE_CARTO;
  }
  // Dominio de preview de Workers o dominio desconocido: usa el parámetro si es válido.
  const q = url.searchParams.get('site');
  return q === SITE_CORD ? SITE_CORD : SITE_CARTO;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function finiteNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function insideBBox(lat, lng, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function cleanCoords(coords, type, bbox) {
  if (type === 'point' || type === 'radius') {
    if (!Array.isArray(coords) || coords.length !== 2) return null;
    const lat = finiteNumber(coords[0]);
    const lng = finiteNumber(coords[1]);
    if (lat === null || lng === null || !insideBBox(lat, lng, bbox)) return null;
    return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  }
  const min = type === 'zone' ? 3 : 2;
  if (!Array.isArray(coords) || coords.length < min || coords.length > 500) return null;
  const out = [];
  for (const pair of coords) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const lat = finiteNumber(pair[0]);
    const lng = finiteNumber(pair[1]);
    if (lat === null || lng === null || !insideBBox(lat, lng, bbox)) return null;
    out.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
  }
  return out;
}

function cleanItem(body, site) {
  if (!body || typeof body !== 'object') return { error: 'Datos inválidos.' };
  const type = TYPES.has(body.type) ? body.type : null;
  if (!type) return { error: 'Tipo de elemento inválido.' };
  const name = cleanText(body.name, LIMITS.name);
  if (!name) return { error: 'El nombre es obligatorio.' };
  const coords = cleanCoords(body.coords, type, SITES[site].bbox);
  if (!coords) return { error: 'Las coordenadas están fuera del área del mapa o tienen un formato inválido.' };
  const cat = CATS.has(body.cat) ? body.cat : 'espacio';
  const estado = STATES.has(body.estado) ? body.estado : 'pendiente';
  const item = {
    type,
    name,
    cat,
    estado,
    offers: cleanText(body.offers, LIMITS.offers),
    needs: cleanText(body.needs, LIMITS.needs),
    schedule: cleanText(body.schedule, LIMITS.schedule),
    contact: cleanText(body.contact, LIMITS.contact),
    note: cleanText(body.note, LIMITS.note),
    author: cleanText(body.author, LIMITS.author),
    approximate: body.approximate === true,
    coords,
    radius: null,
    hidden: false,
  };
  if (type === 'radius') {
    const r = finiteNumber(body.radius);
    item.radius = r === null ? 500 : Math.round(Math.min(5000, Math.max(50, r)));
  }
  return { item };
}

/* ---------- criptografía ---------- */
async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))));
}

async function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const [ha, hb] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signSession(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64url(new Uint8Array(sig));
}

async function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.scope !== SITE_CORD || !payload.exp || payload.exp < now) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}

async function sessionFromRequest(request, env) {
  if (!env.SESSION_SECRET) return null;
  return verifySession(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

async function requireSession(request, env, site) {
  if (site !== SITE_CORD) return { ok: true };
  if (!env.CORDILLERA_PASSPHRASE || !env.SESSION_SECRET) {
    return { ok: false, response: jsonError('El acceso no está configurado.', 503) };
  }
  const session = await sessionFromRequest(request, env);
  if (!session) return { ok: false, response: jsonError('Sesión requerida.', 401) };
  return { ok: true, session };
}

async function isAdmin(request, env) {
  const token = request.headers.get('x-admin-token');
  if (!token || !env.ADMIN_TOKEN) return false;
  return safeEqual(token, env.ADMIN_TOKEN);
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch (e) {
    return false;
  }
}

async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return b64url(await sha256Bytes(ip + '|' + (env.SESSION_SECRET || 'mapas')));
}

/* ---------- límites de tasa ---------- */
async function rateLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rate:${key}:${bucket}`;
  const current = parseInt((await env.MAPS.get(k)) || '0', 10);
  if (current >= limit) return false;
  await env.MAPS.put(k, String(current + 1), { expirationTtl: windowSec + 60 });
  return true;
}

async function checkWriteLimit(request, env, site, bucket, limit, windowSec) {
  const h = await ipHash(request, env);
  return rateLimit(env, `${site}:${bucket}:${h}`, limit, windowSec);
}

/* ---------- almacenamiento ---------- */
const dataKey = (site) => `data:${site}`;
const auditKey = (site) => `audit:${site}`;

async function readAll(env, site) {
  const raw = await env.MAPS.get(dataKey(site));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function writeAll(env, site, items) {
  await env.MAPS.put(dataKey(site), JSON.stringify(items));
}

async function getItem(env, site, id) {
  const all = await readAll(env, site);
  return all.find((x) => x && x.id === id) || null;
}

async function putItem(env, site, item) {
  const all = await readAll(env, site);
  const i = all.findIndex((x) => x && x.id === item.id);
  if (i >= 0) all[i] = item;
  else all.push(item);
  await writeAll(env, site, all);
}

async function deleteItem(env, site, id) {
  const all = await readAll(env, site);
  const next = all.filter((x) => x && x.id !== id);
  await writeAll(env, site, next);
  return all.length - next.length;
}

function publicItem(item) {
  const { editTokenHash, ...safe } = item;
  return safe;
}

async function listItems(env, site, includeHidden) {
  const all = await readAll(env, site);
  return all
    .filter((item) => item && (includeHidden || !item.hidden))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function addAudit(env, site, request, action, item, extra = {}) {
  const raw = (await env.MAPS.get(auditKey(site))) || '[]';
  let list;
  try {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch (e) {
    list = [];
  }
  const entry = {
    ts: new Date().toISOString(),
    action,
    id: item ? item.id : null,
    name: item ? item.name : '',
    type: item ? item.type : '',
    ipHash: await ipHash(request, env),
    ...extra,
  };
  list.unshift(entry);
  await env.MAPS.put(auditKey(site), JSON.stringify(list.slice(0, AUDIT_MAX)));
}

/* ---------- API ---------- */
async function handleApi(request, env, site, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-edit-token, x-admin-token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, site, time: new Date().toISOString() });
  }

  /* sesión */
  if (method === 'GET' && path === '/session') {
    if (site !== SITE_CORD) return json({ ok: false, error: 'Este mapa no usa sesión.' }, 404);
    const session = await sessionFromRequest(request, env);
    if (!session) return jsonError('Sesión requerida.', 401);
    return json({ ok: true, exp: session.exp });
  }

  if (method === 'POST' && path === '/auth') {
    if (site !== SITE_CORD) return jsonError('Este mapa no usa passphrase.', 404);
    if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
    if (!env.CORDILLERA_PASSPHRASE || !env.SESSION_SECRET) {
      return jsonError('El acceso no está configurado.', 503);
    }
    const h = await ipHash(request, env);
    if (!(await rateLimit(env, `auth10m:${h}`, 5, 600))) {
      return jsonError('Demasiados intentos. Espera 10 minutos.', 429, { retryAfter: 600 });
    }
    if (!(await rateLimit(env, `auth1h:${h}`, 20, 3600))) {
      return jsonError('Demasiados intentos. Espera una hora.', 429, { retryAfter: 3600 });
    }
    const body = await request.json().catch(() => ({}));
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase.slice(0, 200) : '';
    if (!passphrase || !(await safeEqual(passphrase, env.CORDILLERA_PASSPHRASE))) {
      return jsonError('Frase incorrecta.', 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession({ v: 1, scope: SITE_CORD, iat: now, exp: now + SESSION_TTL }, env.SESSION_SECRET);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return json(
      { ok: true, exp: now + SESSION_TTL },
      200,
      { 'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}` }
    );
  }

  if (method === 'POST' && path === '/logout') {
    if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
    return json(
      { ok: true },
      200,
      { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }
    );
  }

  /* lectura */
  if (method === 'GET' && path === '/items') {
    const auth = await requireSession(request, env, site);
    if (!auth.ok) return auth.response;
    const admin = await isAdmin(request, env);
    const includeHidden = admin;
    const items = await listItems(env, site, includeHidden);
    return json({ items: items.map(publicItem) });
  }

  /* creación */
  if (method === 'POST' && path === '/items') {
    if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
    const auth = await requireSession(request, env, site);
    if (!auth.ok) return auth.response;
    if (!(await checkWriteLimit(request, env, site, 'create', site === SITE_CORD ? 120 : 20, 3600))) {
      return jsonError('Has creado demasiados elementos. Espera un rato.', 429, { retryAfter: 3600 });
    }
    const all = await readAll(env, site);
    if (all.length >= MAX_ITEMS) return jsonError('El mapa está lleno. Avisa al colectivo.', 507);
    const body = await request.json().catch(() => null);
    const cleaned = cleanItem(body, site);
    if (cleaned.error) return jsonError(cleaned.error, 422);
    const now = new Date().toISOString();
    const item = {
      ...cleaned.item,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    let editToken = '';
    if (site === SITE_CARTO) {
      editToken = b64url(crypto.getRandomValues(new Uint8Array(24)));
      item.editTokenHash = b64url(await sha256Bytes(editToken));
    }
    all.push(item);
    await writeAll(env, site, all);
    await addAudit(env, site, request, 'crear', item);
    return json({ item: publicItem(item), editToken: editToken || undefined }, 201);
  }

  /* importación */
  if (method === 'POST' && path === '/import') {
    if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
    const auth = await requireSession(request, env, site);
    if (!auth.ok) return auth.response;
    if (!(await checkWriteLimit(request, env, site, 'import', 3, 3600))) {
      return jsonError('Demasiadas importaciones. Espera un rato.', 429, { retryAfter: 3600 });
    }
    const body = await request.json().catch(() => null);
    const incoming = body && Array.isArray(body.items) ? body.items : null;
    if (!incoming || !incoming.length) return jsonError('No hay elementos para importar.', 422);
    if (incoming.length > MAX_IMPORT) return jsonError(`Máximo ${MAX_IMPORT} elementos por importación.`, 422);
    const all = await readAll(env, site);
    if (all.length + incoming.length > MAX_ITEMS) return jsonError('El mapa está lleno. Avisa al colectivo.', 507);
    const created = [];
    const editTokens = {};
    for (const raw of incoming) {
      const cleaned = cleanItem(raw, site);
      if (cleaned.error) continue;
      const now = new Date().toISOString();
      const item = { ...cleaned.item, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      if (site === SITE_CARTO) {
        const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
        item.editTokenHash = b64url(await sha256Bytes(token));
        editTokens[item.id] = token;
      }
      all.push(item);
      created.push(publicItem(item));
    }
    await writeAll(env, site, all);
    if (created.length) await addAudit(env, site, request, 'importar', null, { count: created.length });
    return json({ items: created, editTokens }, 201);
  }

  /* detalle, edición y borrado */
  const match = path.match(/^\/items\/([A-Za-z0-9-]+)$/);
  if (match) {
    const id = match[1];
    const item = await getItem(env, site, id);
    if (!item) return jsonError('Elemento no encontrado.', 404);

    if (method === 'PATCH') {
      if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
      const auth = await requireSession(request, env, site);
      if (!auth.ok) return auth.response;
      const admin = await isAdmin(request, env);
      if (site === SITE_CARTO && !admin) {
        const token = request.headers.get('x-edit-token') || '';
        const ok = token && item.editTokenHash && (await safeEqual(b64url(await sha256Bytes(token)), item.editTokenHash));
        if (!ok) return jsonError('No autorizado para editar este elemento.', 403);
      }
      if (!(await checkWriteLimit(request, env, site, 'update', site === SITE_CORD ? 240 : 60, 3600))) {
        return jsonError('Demasiadas ediciones. Espera un rato.', 429, { retryAfter: 3600 });
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return jsonError('Datos inválidos.', 422);

      const patch = { ...item };
      const fields = ['name', 'offers', 'needs', 'schedule', 'contact', 'note', 'author'];
      for (const field of fields) {
        if (typeof body[field] === 'string') patch[field] = cleanText(body[field], LIMITS[field]);
      }
      if (body.cat !== undefined) patch.cat = CATS.has(body.cat) ? body.cat : patch.cat;
      if (body.estado !== undefined) patch.estado = STATES.has(body.estado) ? body.estado : patch.estado;
      if (body.approximate !== undefined) patch.approximate = body.approximate === true;
      if (body.radius !== undefined && patch.type === 'radius') {
        const r = finiteNumber(body.radius);
        if (r !== null) patch.radius = Math.round(Math.min(5000, Math.max(50, r)));
      }
      if (body.coords !== undefined) {
        const coords = cleanCoords(body.coords, patch.type, SITES[site].bbox);
        if (!coords) return jsonError('Coordenadas inválidas o fuera del área.', 422);
        patch.coords = coords;
      }
      if (body.hidden !== undefined) {
        if (!admin) return jsonError('Solo administración puede ocultar elementos.', 403);
        patch.hidden = body.hidden === true;
      }
      if (!patch.name) return jsonError('El nombre es obligatorio.', 422);
      patch.updatedAt = new Date().toISOString();
      await putItem(env, site, patch);
      await addAudit(env, site, request, patch.hidden ? 'ocultar' : 'editar', patch);
      return json({ item: publicItem(patch) });
    }

    if (method === 'DELETE') {
      if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
      const auth = await requireSession(request, env, site);
      if (!auth.ok) return auth.response;
      const admin = await isAdmin(request, env);
      if (site === SITE_CARTO && !admin) {
        const token = request.headers.get('x-edit-token') || '';
        const ok = token && item.editTokenHash && (await safeEqual(b64url(await sha256Bytes(token)), item.editTokenHash));
        if (!ok) return jsonError('No autorizado para borrar este elemento.', 403);
      }
      if (!(await checkWriteLimit(request, env, site, 'delete', site === SITE_CORD ? 120 : 60, 3600))) {
        return jsonError('Demasiados borrados. Espera un rato.', 429, { retryAfter: 3600 });
      }
      await deleteItem(env, site, id);
      await addAudit(env, site, request, 'borrar', item);
      return json({ ok: true });
    }

    return jsonError('Método no permitido.', 405);
  }

  /* auditoría */
  if (method === 'GET' && path === '/audit') {
    const auth = await requireSession(request, env, site);
    if (!auth.ok) return auth.response;
    if (!(await isAdmin(request, env))) return jsonError('Solo administración.', 403);
    const raw = (await env.MAPS.get(auditKey(site))) || '[]';
    let audit;
    try {
      audit = JSON.parse(raw);
      if (!Array.isArray(audit)) audit = [];
    } catch (e) {
      audit = [];
    }
    return json({ audit });
  }

  /* borrado total (administración) */
  if (method === 'POST' && path === '/purge') {
    if (!sameOrigin(request)) return jsonError('Origen no permitido.', 403);
    if (!(await isAdmin(request, env))) return jsonError('Solo administración.', 403);
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== 'BORRAR') return jsonError('Falta la confirmación.', 422);
    const all = await readAll(env, site);
    await env.MAPS.delete(dataKey(site));
    await addAudit(env, site, request, 'purgar', null, { count: all.length });
    return json({ ok: true, deleted: all.length });
  }

  return jsonError('Ruta no encontrada.', 404);
}

/* ---------- estáticos ---------- */
function securityHeaders(site) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://server.arcgisonline.com https://*.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.tile.opentopomap.org https://*.basemaps.cartocdn.com",
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    ...(site === SITE_CORD ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
  };
}

function cacheFor(path) {
  if (path.startsWith('/assets/leaflet/')) return 'public, max-age=31536000, immutable';
  if (path.endsWith('.json')) return 'public, max-age=3600';
  if (path.endsWith('.js') || path.endsWith('.css')) return 'public, max-age=300';
  if (path.endsWith('.html') || path === '/') return 'no-cache';
  return 'public, max-age=86400';
}

async function serveStatic(request, env, url, site) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  let path = url.pathname;
  if (path === '/' || path === '') {
    path = `/${site}/index.html`;
  } else if (path === '/cartografia' || path === '/cartografia/') {
    path = '/cartografia/index.html';
  } else if (path === '/cordillera' || path === '/cordillera/') {
    path = '/cordillera/index.html';
  }
  const assetUrl = new URL(path, url.origin);
  const assetReq = new Request(assetUrl.toString(), {
    method: request.method,
    headers: request.headers
  });
  const res = await env.ASSETS.fetch(assetReq);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(securityHeaders(site))) headers.set(k, v);
  headers.set('Cache-Control', cacheFor(path));
  return new Response(res.body, { status: res.status, headers });
}

/* ---------- entrada ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = siteFromRequest(url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, site, url);
      } catch (e) {
        console.error('API error', e && e.stack ? e.stack : e);
        return jsonError('Error interno. Inténtalo de nuevo.', 500);
      }
    }
    return serveStatic(request, env, url, site);
  },
};
