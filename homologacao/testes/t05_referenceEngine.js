'use strict';

const { calcularComReferencia } = require('../../services/referenceEngine');
const { importarTabelaContratual } = require('../../services/tabelaContratual');
const { TABELAS_CONTRATUAIS, PARAMS_ENGINE, PREFIX } = require('../massaDeTestes');

async function executarTestes(db) {
  const resultados = [];
  const tabelasInseridas = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'ReferenceEngine', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'ReferenceEngine', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // Inserir tabela para testes de motor
  const tabelaEngine = await importarTabelaContratual(TABELAS_CONTRATUAIS.engineTest);
  if (tabelaEngine.tabelaId) tabelasInseridas.push(tabelaEngine.tabelaId);

  // TC-036: Motor com tabela ativa → retorna tabela_cliente
  await tc('TC-036', 'Motor com tabela contratual ativa → fonte=tabela_cliente, confiança=ALTA', async () => {
    const r = await calcularComReferencia(PARAMS_ENGINE.comTabela);
    const ok = r.fonte === 'tabela_cliente' && r.nivelConfianca === 'ALTA';
    return { aprovado: ok, esperado: 'fonte=tabela_cliente, ALTA', obtido: `fonte=${r.fonte}, ${r.nivelConfianca}` };
  });

  // TC-037: Sem tabela e sem token Melhor Envio → fallback
  await tc('TC-037', 'Sem tabela + sem token ME → fonte=fallback, confiança=BAIXA', async () => {
    const tokenOriginal = process.env.MELHOR_ENVIO_TOKEN;
    process.env.MELHOR_ENVIO_TOKEN = '';
    try {
      const r = await calcularComReferencia(PARAMS_ENGINE.semTabela);
      const ok = r.fonte === 'fallback' && r.nivelConfianca === 'BAIXA';
      return { aprovado: ok, esperado: 'fonte=fallback, BAIXA', obtido: `fonte=${r.fonte}, ${r.nivelConfianca}` };
    } finally {
      process.env.MELHOR_ENVIO_TOKEN = tokenOriginal || '';
    }
  });

  // TC-038: Token ME inválido + URL inacessível → API falha → retorna fallback
  await tc('TC-038', 'API Melhor Envio inacessível (localhost:19997) + sem tabela → fallback', async () => {
    const tokenOriginal = process.env.MELHOR_ENVIO_TOKEN;
    const urlOriginal = process.env.MELHOR_ENVIO_BASE_URL;
    process.env.MELHOR_ENVIO_TOKEN = 'TOKEN_INVALIDO_HOMOLOGACAO';
    process.env.MELHOR_ENVIO_BASE_URL = 'http://127.0.0.1:19997';
    try {
      const r = await calcularComReferencia(PARAMS_ENGINE.apiIndisponivel);
      const ok = r.fonte === 'fallback';
      return { aprovado: ok, esperado: 'fonte=fallback (API inacessível)', obtido: `fonte=${r.fonte}` };
    } finally {
      process.env.MELHOR_ENVIO_TOKEN = tokenOriginal || '';
      process.env.MELHOR_ENVIO_BASE_URL = urlOriginal || '';
    }
  });

  // TC-039: Nível de confiança ALTA com tabela contratual
  await tc('TC-039', 'Resultado com tabela contratual → nivel_confianca=ALTA e freteReferencia > 0', async () => {
    const r = await calcularComReferencia(PARAMS_ENGINE.comTabela);
    const ok = r.nivelConfianca === 'ALTA' && typeof r.freteReferencia === 'number' && r.freteReferencia > 0;
    return { aprovado: ok, esperado: 'ALTA, freteReferencia>0', obtido: `${r.nivelConfianca}, R$${r.freteReferencia}` };
  });

  // TC-040: Cache MelhorEnvio no banco → retornado sem chamar API
  await tc('TC-040', 'Cache ME válido no banco → retorna melhor_envio com observação de cache', async () => {
    const { cepOrigem, cepDestino, peso, comprimento, altura, largura } = PARAMS_ENGINE.cacheTest;
    const chave = `${cepOrigem}|${cepDestino}|${peso}|${comprimento}|${altura}|${largura}`;
    // Inserir cache válido no banco (< 24h)
    await db.run(
      `INSERT OR REPLACE INTO melhor_envio_cache
         (chave_cache, cep_origem, cep_destino, peso, comprimento, altura, largura, preco, status_http, tempo_resposta_ms, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [chave, cepOrigem, cepDestino, peso, comprimento, altura, largura, 54.80, 200, 320]
    );
    const tokenOriginal = process.env.MELHOR_ENVIO_TOKEN;
    process.env.MELHOR_ENVIO_TOKEN = 'TOKEN_PARA_ATIVAR_CAMINHO_ME';
    try {
      const r = await calcularComReferencia(PARAMS_ENGINE.cacheTest);
      const ok = r.fonte === 'melhor_envio' &&
                 (r.observacao || '').toLowerCase().includes('cache') &&
                 Math.abs(r.freteReferencia - 54.80) < 0.01;
      return {
        aprovado: ok,
        esperado: 'fonte=melhor_envio, observação contém "cache", valor=54.80',
        obtido: `fonte=${r.fonte}, valor=${r.freteReferencia}, obs=${r.observacao}`
      };
    } finally {
      process.env.MELHOR_ENVIO_TOKEN = tokenOriginal || '';
      await db.run("DELETE FROM melhor_envio_cache WHERE chave_cache = ?", [chave]);
    }
  });

  // TC-041: Cache expirado (>24h) → ignorado → fallback
  await tc('TC-041', 'Cache ME expirado (25h) → não reutilizado → fallback (API sem token)', async () => {
    const { cepOrigem, cepDestino, peso, comprimento, altura, largura } = PARAMS_ENGINE.cacheExpirado;
    const chave = `${cepOrigem}|${cepDestino}|${peso}|${comprimento}|${altura}|${largura}`;
    // Inserir cache EXPIRADO (25 horas atrás)
    await db.run(
      `INSERT OR REPLACE INTO melhor_envio_cache
         (chave_cache, cep_origem, cep_destino, peso, comprimento, altura, largura, preco, status_http, tempo_resposta_ms, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now', '-25 hours'))`,
      [chave, cepOrigem, cepDestino, peso, comprimento, altura, largura, 99.00, 200, 100]
    );
    const tokenOriginal = process.env.MELHOR_ENVIO_TOKEN;
    process.env.MELHOR_ENVIO_TOKEN = ''; // Sem token → ME retorna null imediatamente
    try {
      const r = await calcularComReferencia(PARAMS_ENGINE.cacheExpirado);
      // Cache expirado ignorado, sem token ME → fallback
      const ok = r.fonte === 'fallback';
      return {
        aprovado: ok,
        esperado: 'fonte=fallback (cache expirado ignorado)',
        obtido: `fonte=${r.fonte}, valor=${r.freteReferencia}`
      };
    } finally {
      process.env.MELHOR_ENVIO_TOKEN = tokenOriginal || '';
      await db.run("DELETE FROM melhor_envio_cache WHERE chave_cache = ?", [chave]);
    }
  });

  // Cleanup das tabelas do engine
  for (const id of tabelasInseridas) {
    try {
      await db.run('DELETE FROM faixas_tarifarias WHERE tabela_id = ?', [id]);
      await db.run('DELETE FROM logs_importacao WHERE tabela_id = ?', [id]);
      await db.run('DELETE FROM tabelas_frete WHERE id = ?', [id]);
    } catch {}
  }

  return resultados;
}

module.exports = executarTestes;
