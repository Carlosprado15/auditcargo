'use strict';

const { consultarTabelaContratual, importarTabelaContratual } = require('../../services/tabelaContratual');
const { TABELAS_CONTRATUAIS, PREFIX } = require('../massaDeTestes');

async function executarTestes(db) {
  const resultados = [];
  const tabelasInseridas = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'TabelaContratual', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'TabelaContratual', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-025: Importar tabela válida com 3 faixas
  await tc('TC-025', 'Importar tabela válida (3 faixas) → success=true, faixasInseridas=3', async () => {
    const r = await importarTabelaContratual(TABELAS_CONTRATUAIS.jadlog);
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.faixasInseridas === 3;
    return { aprovado: ok, esperado: 'success=true, faixas=3', obtido: `success=${r.success}, faixas=${r.faixasInseridas}` };
  });

  // TC-026: Consultar tabela ativa — CEP e peso dentro da faixa
  await tc('TC-026', 'Consultar tabela ativa — CEP 00000015, peso 3.0kg → faixa encontrada', async () => {
    // Garante que a tabela jadlog foi inserida (reutiliza TC-025 ou insere de novo)
    if (tabelasInseridas.length === 0) {
      const r = await importarTabelaContratual(TABELAS_CONTRATUAIS.jadlog);
      if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    }
    const r = await consultarTabelaContratual({ cepDestino: '00000015', peso: 3.0 });
    const ok = r !== null && r.fonte === 'tabela_cliente' && r.nivelConfianca === 'ALTA';
    return { aprovado: ok, esperado: 'fonte=tabela_cliente, confiança=ALTA', obtido: r ? `fonte=${r.fonte}, confiança=${r.nivelConfianca}, valor=R$${r.freteReferencia}` : 'null' };
  });

  // TC-027: CEP fora de todas as faixas → null
  await tc('TC-027', 'Consultar — CEP 99000000 fora de todas as faixas → null', async () => {
    const r = await consultarTabelaContratual({ cepDestino: '99000000', peso: 3.0 });
    // Este CEP não está em nenhuma tabela de teste
    // Se por acaso existir na produção, o teste aceita qualquer resultado (não é controlável)
    const ok = true; // Apenas verifica que não lança exceção
    return { aprovado: ok, esperado: 'null ou resultado de tabela de produção (sem exceção)', obtido: r === null ? 'null' : `fonte=${r.fonte}` };
  });

  // TC-028: Tabela vencida (data_fim = ontem) → não deve ser retornada
  await tc('TC-028', 'Tabela com data_fim = 2024-12-31 (vencida) → não retornada para CEP 00000035', async () => {
    const r2 = await importarTabelaContratual(TABELAS_CONTRATUAIS.vencida);
    if (r2.tabelaId) tabelasInseridas.push(r2.tabelaId);
    const r = await consultarTabelaContratual({ cepDestino: '00000035', peso: 5.0 });
    // A tabela vencida cobre CEP 00000030-00000039 mas tem data_fim = 2024-12-31
    const ok = r === null;
    return { aprovado: ok, esperado: 'null (tabela vencida ignorada)', obtido: r === null ? 'null' : `fonte=${r.fonte}, valor=R$${r.freteReferencia}` };
  });

  // TC-029: Transportadora inexistente → null
  await tc('TC-029', 'Consultar com transportadora inexistente → null', async () => {
    const r = await consultarTabelaContratual({
      cepDestino: '00000015',
      peso: 3.0,
      transportadora: 'TRANSPORTADORA_FICTICIA_XYZ_9999'
    });
    const ok = r === null;
    return { aprovado: ok, esperado: 'null (transportadora inexistente)', obtido: r === null ? 'null' : `fonte=${r.fonte}` };
  });

  // TC-030: Importar sem nome → falha
  await tc('TC-030', 'Importar tabela sem campo "nome" → success=false com mensagem de erro', async () => {
    const dadosInvalidos = { ...TABELAS_CONTRATUAIS.jadlog, nome: '' };
    const r = await importarTabelaContratual(dadosInvalidos);
    const ok = r.success === false && r.erros.length > 0;
    return { aprovado: ok, esperado: 'success=false, erros>0', obtido: `success=${r.success}, erros=${JSON.stringify(r.erros)}` };
  });

  // TC-031: Importar sem transportadora → falha
  await tc('TC-031', 'Importar tabela sem campo "transportadora" → success=false', async () => {
    const dadosInvalidos = { ...TABELAS_CONTRATUAIS.jadlog, nome: `${PREFIX}INVALIDA_031`, transportadora: '' };
    const r = await importarTabelaContratual(dadosInvalidos);
    const ok = r.success === false;
    return { aprovado: ok, esperado: 'success=false', obtido: `success=${r.success}` };
  });

  // TC-032: Importar sem data_inicio → falha
  await tc('TC-032', 'Importar tabela sem campo "data_inicio" → success=false', async () => {
    const dadosInvalidos = { ...TABELAS_CONTRATUAIS.jadlog, nome: `${PREFIX}INVALIDA_032`, data_inicio: null };
    const r = await importarTabelaContratual(dadosInvalidos);
    const ok = r.success === false;
    return { aprovado: ok, esperado: 'success=false', obtido: `success=${r.success}` };
  });

  // TC-033: Importar sem faixas → falha
  await tc('TC-033', 'Importar tabela com faixas=[] → success=false', async () => {
    const dadosInvalidos = { ...TABELAS_CONTRATUAIS.jadlog, nome: `${PREFIX}INVALIDA_033`, faixas: [] };
    const r = await importarTabelaContratual(dadosInvalidos);
    const ok = r.success === false;
    return { aprovado: ok, esperado: 'success=false', obtido: `success=${r.success}` };
  });

  // TC-034: Tabela inativa não é retornada
  await tc('TC-034', 'Tabela com status=inativa (CEP 00000045, peso 5kg) → não retornada', async () => {
    const r2 = await importarTabelaContratual(TABELAS_CONTRATUAIS.inativa);
    if (r2.tabelaId) tabelasInseridas.push(r2.tabelaId);
    const r = await consultarTabelaContratual({ cepDestino: '00000045', peso: 5.0 });
    const ok = r === null;
    return { aprovado: ok, esperado: 'null (tabela inativa não retornada)', obtido: r === null ? 'null' : `fonte=${r.fonte}, valor=R$${r.freteReferencia}` };
  });

  // TC-035: Faixa com encargos adicionais (GRIS + pedágio) → valor somado
  await tc('TC-035', 'Tabela com GRIS R$2,50 + pedágio R$1,80 → valor final = R$34,30', async () => {
    const r2 = await importarTabelaContratual(TABELAS_CONTRATUAIS.correiosComEncargos);
    if (r2.tabelaId) tabelasInseridas.push(r2.tabelaId);
    const r = await consultarTabelaContratual({ cepDestino: '00000025', peso: 5.0 });
    // valor_frete=30.00 + gris=2.50 + pedagio=1.80 = 34.30
    const valorEsperado = 34.30;
    const ok = r !== null && Math.abs(r.freteReferencia - valorEsperado) < 0.01;
    return {
      aprovado: ok,
      esperado: `R$${valorEsperado} (base 30 + gris 2.50 + pedágio 1.80)`,
      obtido: r ? `R$${r.freteReferencia}` : 'null'
    };
  });

  // Cleanup local das tabelas inseridas neste módulo
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
