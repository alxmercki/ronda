#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8371);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

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
  send(res, status, JSON.stringify(body), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
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

function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function summarizeText(text, maxChars = 12000) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n\n[texto truncado para caber no processamento]`;
}

async function readJsonBody(req, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('payload muito grande');
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function requireAccessToken(token) {
  if (!ACCESS_PASSWORD) return true;
  return String(token || '') === ACCESS_PASSWORD;
}

function getServerProviders() {
  const providers = [];
  if (OPENAI_API_KEY) providers.push('openai');
  if (ANTHROPIC_API_KEY) providers.push('anthropic');
  if (GEMINI_API_KEY) providers.push('gemini');
  return providers;
}

async function fetchPageText(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('url invalida');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocolo nao permitido');
  if (isPrivateHost(parsed.hostname)) throw new Error('host privado bloqueado');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(parsed.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Ronda/1.0 Safari/605.1.15',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await readResponseText(resp);
    const text = summarizeText(stripHtml(html));
    if (!text) throw new Error('nao foi possivel extrair texto da URL');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('imagem invalida');
  return { mediaType: match[1], data: match[2] };
}

function buildEditorialPrompt({ sourceUrl, sourceText, imageCount }) {
  const parts = [
    'Você é um revisor editorial rigoroso.',
    'Analise o material enviado e identifique incongruências editoriais, erros factuais aparentes, inconsistências entre texto e imagem, ambiguidades, trechos confusos e oportunidades de melhoria de clareza, precisão e estilo.',
    'Responda em português do Brasil.',
    'Priorize problemas concretos. Não invente fatos ausentes.',
    'Se algo não puder ser confirmado, diga claramente que é uma hipótese ou que depende de checagem humana.',
    '',
    'Estruture a resposta exatamente nestas seções:',
    '1. Resumo executivo',
    '2. Incongruências encontradas',
    '3. Melhorias sugeridas',
    '4. Versão sugerida',
    '',
    'Em "Incongruências encontradas", use bullets e informe gravidade (alta, média ou baixa).',
    'Em "Melhorias sugeridas", proponha ajustes práticos de edição.',
    'Em "Versão sugerida", entregue um texto reescrito apenas se houver texto-base suficiente; caso contrário, explique o que falta.',
  ];

  if (sourceUrl) parts.push('', `URL de referência: ${sourceUrl}`);
  if (imageCount > 0) parts.push(`Há ${imageCount} imagem(ns) anexada(s). Verifique texto visível, números, nomes, datas, legendas e coerência com o material textual.`);
  if (sourceText) parts.push('', 'Texto-base para análise:', sourceText);

  return parts.join('\n');
}

async function callOpenAI({ prompt, images }) {
  const content = [{ type: 'text', text: prompt }];
  for (const image of images) {
    content.push({
      type: 'image_url',
      image_url: { url: image, detail: 'high' },
    });
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${resp.status}`);
  return {
    provider: 'openai',
    model: json.model || DEFAULT_OPENAI_MODEL,
    text: json.choices?.[0]?.message?.content?.trim() || '',
  };
}

async function callAnthropic({ prompt, images }) {
  const content = [{ type: 'text', text: prompt }];
  for (const image of images) {
    const parsed = parseDataUrl(image);
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: parsed.mediaType,
        data: parsed.data,
      },
    });
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1800,
      temperature: 0.2,
      messages: [{ role: 'user', content }],
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${resp.status}`);
  const text = (json.content || [])
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
    .trim();
  return {
    provider: 'anthropic',
    model: json.model || DEFAULT_ANTHROPIC_MODEL,
    text,
  };
}

async function callGemini({ prompt, images }) {
  const parts = [{ text: prompt }];
  for (const image of images) {
    const parsed = parseDataUrl(image);
    parts.push({
      inlineData: {
        mimeType: parsed.mediaType,
        data: parsed.data,
      },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
      },
      contents: [{ role: 'user', parts }],
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message || `Gemini HTTP ${resp.status}`);
  const text = json.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n').trim() || '';
  return {
    provider: 'gemini',
    model: DEFAULT_GEMINI_MODEL,
    text,
  };
}

async function runEditorialAnalysis({ provider, sourceUrl, sourceText, images }) {
  const selectedProvider = provider || getServerProviders()[0];
  const prompt = buildEditorialPrompt({ sourceUrl, sourceText, imageCount: images.length });

  if (selectedProvider === 'openai' && OPENAI_API_KEY) return callOpenAI({ prompt, images });
  if (selectedProvider === 'anthropic' && ANTHROPIC_API_KEY) return callAnthropic({ prompt, images });
  if (selectedProvider === 'gemini' && GEMINI_API_KEY) return callGemini({ prompt, images });
  throw new Error('nenhum provedor de IA configurado para esta análise');
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

async function handleConfig(res) {
  return sendJson(res, 200, {
    serverProviders: getServerProviders(),
    requiresPassword: !!ACCESS_PASSWORD,
  });
}

async function handleGoogleClientId(res) {
  return sendJson(res, 200, { clientId: GOOGLE_CLIENT_ID });
}

async function handleEditorialCheck(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'payload invalido' });
  }

  if (!requireAccessToken(body.accessToken)) {
    return sendJson(res, 401, { error: 'senha de acesso invalida' });
  }

  const sourceUrl = String(body.url || '').trim();
  const manualText = String(body.text || '').trim();
  const images = Array.isArray(body.images)
    ? body.images.filter(value => typeof value === 'string' && value.startsWith('data:image/')).slice(0, 6)
    : [];

  if (!sourceUrl && !manualText && images.length === 0) {
    return sendJson(res, 400, { error: 'envie ao menos uma URL, um texto ou uma imagem' });
  }

  try {
    const fetchedText = sourceUrl ? await fetchPageText(sourceUrl) : '';
    const sourceText = summarizeText(
      [manualText, fetchedText].filter(Boolean).join('\n\n')
    );
    const result = await runEditorialAnalysis({
      provider: body.provider,
      sourceUrl,
      sourceText,
      images,
    });

    if (!result.text) throw new Error('a IA nao retornou analise');

    return sendJson(res, 200, {
      ok: true,
      provider: result.provider,
      model: result.model,
      analysis: result.text,
      sourceText,
      sourceUrl,
      imageCount: images.length,
    });
  } catch (err) {
    return sendJson(res, 502, { error: err.message || 'falha na analise editorial' });
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
  if (requestUrl.pathname === '/api/config' && req.method === 'GET') return handleConfig(res);
  if (requestUrl.pathname === '/api/google-client-id' && req.method === 'GET') return handleGoogleClientId(res);
  if (requestUrl.pathname === '/api/editorial-check' && req.method === 'POST') return handleEditorialCheck(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  return handleStatic(res, requestUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Ronda web app rodando em http://${HOST}:${PORT}`);
});
