'use strict';

const { PREFIX } = require('../massaDeTestes');

async function executarTestes(db) {
  const resultados = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'Database', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'Database', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-019: Inserir pedido e recuperar por pedidoId
  await tc('TC-019', 'Inserir pedido com runInsert e recuperar com get por pedidoId', async () => {
    const pid = `${PREFIX}DB_TC019`;
    await db.run("DELETE FROM pedidos WHERE pedidoId = ?", [pid]);
    await db.runInsert(
      `INSERT INTO pedidos (pedidoId, cepOrigem, cepDestino, peso, freteCobrado, freteCorreto, economia, status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [pid, '01001000', '09001000', 2.0, 35.00, 30.00, 5.00, 'cobrado_a_mais']
    );
    const row = await db.get('SELECT * FROM pedidos WHERE pedidoId = ?', [pid]);
    const ok = row && row.pedidoId === pid && Number(row.freteCobrado) === 35.00;
    return { aprovado: ok, esperado: `pedidoId=${pid}, freteCobrado=35`, obtido: row ? `pedidoId=${row.pedidoId}, freteCobrado=${row.freteCobrado}` : 'undefined' };
  });

  // TC-020: Buscar pedido inexistente retorna undefined
  await tc('TC-020', 'Buscar pedidoId inexistente → retorna undefined', async () => {
    const row = await db.get('SELECT * FROM pedidos WHERE pedidoId = ?', [`${PREFIX}INEXISTENTE_XYZ_9999`]);
    const ok = row === undefined;
    return { aprovado: ok, esperado: 'undefined', obtido: row === undefined ? 'undefined' : JSON.stringify(row) };
  });

  // TC-021: Inserir múltiplos e recuperar com all
  await tc('TC-021', 'Inserir 3 pedidos de teste e recuperar com all → retorna ao menos 3', async () => {
    const ids = [`${PREFIX}DB_TC021_A`, `${PREFIX}DB_TC021_B`, `${PREFIX}DB_TC021_C`];
    for (const id of ids) {
      await db.run("DELETE FROM pedidos WHERE pedidoId = ?", [id]);
      await db.runInsert(
        `INSERT INTO pedidos (pedidoId, cepOrigem, cepDestino, peso, freteCobrado, freteCorreto, economia, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, '01001000', '09001000', 1.0, 20.00, 18.00, 2.00, 'cobrado_a_mais']
      );
    }
    const rows = await db.all(`SELECT pedidoId FROM pedidos WHERE pedidoId LIKE '${PREFIX}DB_TC021_%'`);
    const ok = rows.length >= 3;
    return { aprovado: ok, esperado: '≥3 registros', obtido: `${rows.length} registros` };
  });

  // TC-022: Inserir config e recuperar valor
  await tc('TC-022', 'Inserir chave de config e recuperar valor com get', async () => {
    const chave = `${PREFIX}config_test`;
    await db.run("DELETE FROM config WHERE chave = ?", [chave]);
    await db.run("INSERT INTO config (chave, valor) VALUES (?,?)", [chave, 'valor_teste_homologacao']);
    const row = await db.get("SELECT valor FROM config WHERE chave = ?", [chave]);
    const ok = row && row.valor === 'valor_teste_homologacao';
    await db.run("DELETE FROM config WHERE chave = ?", [chave]);
    return { aprovado: ok, esperado: 'valor_teste_homologacao', obtido: row ? row.valor : 'undefined' };
  });

  // TC-023: Inserir e recuperar cache MelhorEnvio
  await tc('TC-023', 'Inserir registro em melhor_envio_cache e recuperar dentro de 24h', async () => {
    const chave = `${PREFIX}CACHE_TC023`;
    await db.run("DELETE FROM melhor_envio_cache WHERE chave_cache = ?", [chave]);
    await db.run(
      `INSERT INTO melhor_envio_cache
         (chave_cache, cep_origem, cep_destino, peso, preco, status_http, tempo_resposta_ms)
       VALUES (?,?,?,?,?,?,?)`,
      [chave, '00000001', '00000099', 2.0, 47.50, 200, 350]
    );
    const row = await db.get(
      `SELECT preco FROM melhor_envio_cache
       WHERE chave_cache = ? AND criado_em > datetime('now', '-24 hours')`,
      [chave]
    );
    const ok = row && Number(row.preco) === 47.50;
    await db.run("DELETE FROM melhor_envio_cache WHERE chave_cache = ?", [chave]);
    return { aprovado: ok, esperado: 'preco=47.50', obtido: row ? `preco=${row.preco}` : 'undefined' };
  });

  // TC-024: Violação de UNIQUE em pedidoId
  await tc('TC-024', 'Inserir pedidoId duplicado → banco lança erro de UNIQUE constraint', async () => {
    const pid = `${PREFIX}DB_TC024_UNIQUE`;
    await db.run("DELETE FROM pedidos WHERE pedidoId = ?", [pid]);
    await db.runInsert(
      `INSERT INTO pedidos (pedidoId, freteCobrado, freteCorreto, economia, status)
       VALUES (?,?,?,?,?)`,
      [pid, 10.00, 10.00, 0, 'correto']
    );
    let erroLancado = false;
    try {
      await db.runInsert(
        `INSERT INTO pedidos (pedidoId, freteCobrado, freteCorreto, economia, status)
         VALUES (?,?,?,?,?)`,
        [pid, 20.00, 20.00, 0, 'correto']
      );
    } catch {
      erroLancado = true;
    }
    return { aprovado: erroLancado, esperado: 'UNIQUE constraint error', obtido: erroLancado ? 'erro lançado' : 'nenhum erro' };
  });

  return resultados;
}

module.exports = executarTestes;
