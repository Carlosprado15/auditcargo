const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('./database');
const { calcularFrete } = require('./freteCalculator');
const { consultarTabelaContratual } = require('./tabelaContratual');

const VERSAO_MOTOR = '1.0';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// In-memory cache: chave -> { ts, resultado }
const _cache = new Map();

function buildCacheKey({ cepOrigem, cepDestino, peso, comprimento, altura, largura }) {
  return `${cepOrigem}|${cepDestino}|${peso}|${comprimento}|${altura}|${largura}`;
}

function chamarAPI(payload, opcoes) {
  return new Promise((resolve, reject) => {
    const client = opcoes.protocol === 'http:' ? http : https;
    const inicio = Date.now();

    const req = client.request(opcoes, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body, tempoMs: Date.now() - inicio }));
    });

    req.on('error', err => reject({ error: err, tempoMs: Date.now() - inicio }));
    req.setTimeout(10000, () => { req.destroy(); reject({ error: new Error('timeout'), tempoMs: Date.now() - inicio }); });

    req.write(payload);
    req.end();
  });
}

// Prioridade 1: tabela contratada do cliente
async function tentarTabelaCliente(params) {
  return consultarTabelaContratual({
    cepDestino: params.cepDestino,
    peso: params.peso,
    transportadora: params.transportadora
  });
}

// Prioridade 2: API Melhor Envio
async function tentarMelhorEnvio(params) {
  const token = process.env.MELHOR_ENVIO_TOKEN;
  if (!token) return null;

  const { cepOrigem, cepDestino, peso, comprimento, altura, largura } = params;

  const ausentes = ['cepOrigem', 'cepDestino', 'peso', 'comprimento', 'altura', 'largura']
    .filter(k => params[k] == null || params[k] === '');

  if (ausentes.length > 0) {
    console.log(`[MelhorEnvio] Dados ausentes: ${ausentes.join(', ')}. Usando fallback.`);
    return null;
  }

  const chave = buildCacheKey(params);

  // Cache em memória
  const cached = _cache.get(chave);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.resultado;
  }

  // Cache persistente no banco
  try {
    const dbCached = await db.get(
      `SELECT preco FROM melhor_envio_cache
       WHERE chave_cache = ? AND criado_em > datetime('now', '-24 hours')
       ORDER BY criado_em DESC LIMIT 1`,
      [chave]
    );
    if (dbCached && dbCached.preco != null) {
      const resultado = {
        fonte: 'melhor_envio',
        nivelConfianca: 'ALTA',
        freteReferencia: Number(dbCached.preco),
        versao: VERSAO_MOTOR,
        observacao: 'Resultado via cache (Melhor Envio)'
      };
      _cache.set(chave, { ts: Date.now(), resultado });
      return resultado;
    }
  } catch {}

  const baseUrl = process.env.MELHOR_ENVIO_BASE_URL || 'https://sandbox.melhorenvio.com.br';
  const url = new URL('/api/v2/me/shipment/calculate', baseUrl);
  const cepOrigemLimpo = String(cepOrigem).replace(/\D/g, '');
  const cepDestinoLimpo = String(cepDestino).replace(/\D/g, '');

  const payload = JSON.stringify({
    from: { postal_code: cepOrigemLimpo },
    to:   { postal_code: cepDestinoLimpo },
    package: { height: altura, width: largura, length: comprimento, weight: peso },
    options: { receipt: false, own_hand: false }
  });

  const opcoes = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'AuditCargo/1.0',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  let statusCode = null;
  let tempoMs = 0;
  const dataConsulta = new Date().toISOString();

  let resposta;
  try {
    resposta = await chamarAPI(payload, opcoes);
    statusCode = resposta.statusCode;
    tempoMs = resposta.tempoMs;
  } catch (err) {
    tempoMs = err.tempoMs || 0;
    console.log('[MelhorEnvio] API indisponível:', err.error?.message || err);
    try {
      await db.run(
        `INSERT INTO melhor_envio_cache
          (chave_cache, cep_origem, cep_destino, peso, comprimento, altura, largura, preco, status_http, tempo_resposta_ms, data_consulta_api, criado_em)
         VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,datetime('now'))`,
        [chave, cepOrigem, cepDestino, peso, comprimento, altura, largura, tempoMs, dataConsulta]
      );
    } catch {}
    return null;
  }

  if (statusCode < 200 || statusCode >= 300) {
    console.log(`[MelhorEnvio] Status HTTP ${statusCode}. Usando fallback.`);
    try {
      await db.run(
        `INSERT INTO melhor_envio_cache
          (chave_cache, cep_origem, cep_destino, peso, comprimento, altura, largura, preco, status_http, tempo_resposta_ms, data_consulta_api, criado_em)
         VALUES (?,?,?,?,?,?,?,NULL,?,?,?,datetime('now'))`,
        [chave, cepOrigem, cepDestino, peso, comprimento, altura, largura, statusCode, tempoMs, dataConsulta]
      );
    } catch {}
    return null;
  }

  let quotes;
  try {
    quotes = JSON.parse(resposta.body);
  } catch {
    console.log('[MelhorEnvio] Resposta JSON inválida. Usando fallback.');
    return null;
  }

  const validos = (Array.isArray(quotes) ? quotes : [])
    .filter(q => !q.error && q.price != null);

  if (!validos.length) {
    console.log('[MelhorEnvio] Nenhuma cotação válida. Usando fallback.');
    return null;
  }

  const precoMin = Math.min(...validos.map(q => parseFloat(q.price)));

  try {
    await db.run(
      `INSERT INTO melhor_envio_cache
        (chave_cache, cep_origem, cep_destino, peso, comprimento, altura, largura, preco, status_http, tempo_resposta_ms, data_consulta_api, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [chave, cepOrigem, cepDestino, peso, comprimento, altura, largura, precoMin, statusCode, tempoMs, dataConsulta]
    );
  } catch {}

  const resultado = {
    fonte: 'melhor_envio',
    nivelConfianca: 'ALTA',
    freteReferencia: precoMin,
    versao: VERSAO_MOTOR,
    observacao: `Cotação real via Melhor Envio (${validos.length} transportadoras)`
  };

  _cache.set(chave, { ts: Date.now(), resultado });
  return resultado;
}

// Prioridade 3: motor estimativo interno (fallback permanente)
function calcularFallback(params) {
  const freteReferencia = calcularFrete(params);
  return {
    fonte: 'fallback',
    nivelConfianca: 'BAIXA',
    freteReferencia,
    versao: VERSAO_MOTOR,
    observacao: 'Calculado pelo motor estimativo interno'
  };
}

// Retorna objeto padrão de referência seguindo a ordem de prioridade
async function calcularComReferencia(params) {
  const tabelaCliente = await tentarTabelaCliente(params);
  if (tabelaCliente) return tabelaCliente;

  const melhorEnvio = await tentarMelhorEnvio(params);
  if (melhorEnvio) return melhorEnvio;

  return calcularFallback(params);
}

module.exports = { calcularComReferencia };
