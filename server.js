#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8371);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8' });
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host);
}

async function readResponseText(resp) {
  const reader = resp.body?.getReader();
  if (!reader) return await resp.text();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) throw new Error('resposta muito grande');
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

async function handleFetch(req, res, requestUrl) {
  const target = requestUrl.searchParams.get('url');
  if (!target) return sendJson(res, 400, { error: 'url obrigatoria' });

  let parsed;
  try { parsed = new URL(target); } catch { return sendJson(res, 400, { error: 'url invalida' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return sendJson(res, 400, { error: 'protocolo nao permitido' });
  if (isPrivateHost(parsed.hostname)) return sendJson(res, 403, { error: 'host privado bloqueado' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const upstream = await fetch(parsed.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Ronda/1.0 Safari/605.1.15',
      },
    });
    const text = await readResponseText(upstream);
    send(res, upstream.ok ? 200 : upstream.status, text, {
      'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
  } catch (err) {
    sendJson(res, 502, { error: err.name === 'AbortError' ? 'timeout' : err.message });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleStatic(res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.resolve(ROOT, `.${cleanPath}`);
  if (!filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

  try {
    const data = await fs.readFile(filePath);
    send(res, 200, data, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': cleanPath === '/index.html' ? 'no-cache' : 'public, max-age=3600',
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      const data = await fs.readFile(path.join(ROOT, 'index.html'));
      send(res, 200, data, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      return;
    }
    send(res, 500, 'Internal Server Error');
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (requestUrl.pathname === '/api/fetch') return handleFetch(req, res, requestUrl);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  return handleStatic(res, requestUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Ronda web app rodando em http://${HOST}:${PORT}`);
});
