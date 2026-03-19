const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000);
const INDEX_FILE = path.join(ROOT, 'index.html');
const REQUIRED_ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function loadEnv(filePath) {
  try {
    const dotenv = require('dotenv');
    dotenv.config({ path: filePath });
  } catch {}

  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    let key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    value = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
    if (key) process.env[key] = value;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function escapeTelegram(text = '') {
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function validateLead(body = {}) {
  const data = {
    fname: String(body.fname || '').trim(),
    lname: String(body.lname || '').trim(),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    model: String(body.model || '').trim(),
    timeframe: String(body.timeframe || '').trim(),
    downPayment: String(body.downPayment || '').trim(),
    tradeIn: String(body.tradeIn || '').trim(),
    contactPreference: String(body.contactPreference || '').trim(),
    language: String(body.language || '').trim(),
    message: String(body.message || '').trim(),
    pageUrl: String(body.pageUrl || '').trim(),
    userAgent: String(body.userAgent || '').trim(),
    submittedAt: new Date().toISOString(),
  };

  if (!data.fname) return { error: 'El nombre es obligatorio.' };
  if (!data.phone || data.phone.replace(/\D/g, '').length < 10) return { error: 'Telefono invalido.' };
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { error: 'Email invalido.' };
  if (!data.model) return { error: 'Modelo invalido.' };

  return { data };
}

function buildTelegramMessage(lead) {
  const fullName = [lead.fname, lead.lname].filter(Boolean).join(' ');
  const dateText = new Date(lead.submittedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return [
    '🚗 *NUEVO LEAD — HYUNDAI MIAMI*',
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 *Nombre:* ${escapeTelegram(fullName)}`,
    `📞 *Telefono:* ${escapeTelegram(lead.phone)}`,
    lead.email ? `📧 *Email:* ${escapeTelegram(lead.email)}` : null,
    `🚘 *Modelo:* ${escapeTelegram(lead.model)}`,
    `📅 *Quiere hacer negocio:* ${escapeTelegram(lead.timeframe || 'No indicado')}`,
    `💵 *Inicial disponible:* ${escapeTelegram(lead.downPayment || 'No indicado')}`,
    `🔁 *Trade\-in:* ${escapeTelegram(lead.tradeIn || 'No indicado')}`,
    `📲 *Contacto preferido:* ${escapeTelegram(lead.contactPreference || 'No indicado')}`,
    `🗣️ *Idioma:* ${escapeTelegram(lead.language || 'No indicado')}`,
    lead.message ? `💬 *Mensaje:* ${escapeTelegram(lead.message)}` : null,
    `🕒 *Fecha:* ${escapeTelegram(dateText)}`,
    lead.pageUrl ? `🌐 *Pagina:* ${escapeTelegram(lead.pageUrl)}` : null,
    '📍 *Fuente:* Landing QR / Web',
    '━━━━━━━━━━━━━━━━━━━━',
    '⚡ *Dar seguimiento rapido*',
  ].filter(Boolean).join('\n');
}

async function handleLead(req, res) {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return sendJson(res, 500, {
      ok: false,
      error: `Faltan variables de entorno: ${missing.join(', ')}`,
    });
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 100000) req.destroy();
  });

  req.on('end', async () => {
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJson(res, 400, { ok: false, error: 'JSON invalido.' });
    }

    const { data, error } = validateLead(body);
    if (error) return sendJson(res, 400, { ok: false, error });

    try {
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: buildTelegramMessage(data).replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1'),
            disable_web_page_preview: true,
          }),
        }
      );

      const telegramJson = await telegramResponse.json();
      if (!telegramResponse.ok || !telegramJson.ok) {
        console.error('Telegram API error:', telegramJson);
        const description = telegramJson && telegramJson.description ? ` ${telegramJson.description}` : '';
        return sendJson(res, 502, {
          ok: false,
          error: `Telegram rechazo el envio.${description}`.trim(),
        });
      }

      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error('Lead delivery error:', err);
      return sendJson(res, 500, {
        ok: false,
        error: 'No se pudo enviar el lead al backend.',
      });
    }
  });
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, '');
  return path.join(ROOT, normalized === '/' ? 'index.html' : normalized);
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(INDEX_FILE, (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('No se pudo cargar index.html');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    return sendJson(res, 200, { ok: missing.length === 0, missing });
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/lead') {
    return handleLead(req, res);
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    return sendJson(res, 405, { ok: false, error: 'Metodo no permitido.' });
  }

  const filePath = safePath(reqUrl.pathname);
  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`Hyundai landing lista en http://localhost:${PORT}`);
});
