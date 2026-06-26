const db = require('./database');

const VERSAO_MOTOR = '1.0';

// Normaliza CEP para 8 dígitos sem traço
function normalizarCep(cep) {
  return String(cep).replace(/\D/g, '').padStart(8, '0');
}

/**
 * Consulta tabelas contratuais ativas para os parâmetros fornecidos.
 *
 * Ordem de prioridade quando houver mais de uma tabela compatível:
 *   1. Tabela com transportadora correspondente ao parâmetro (se fornecido)
 *   2. Data de início mais recente (tabela mais atual vence)
 *
 * @param {object} params
 * @param {string} params.cepDestino   - CEP de destino (8 dígitos)
 * @param {number} params.peso         - Peso em kg
 * @param {string} [params.transportadora] - Filtra por transportadora específica (opcional)
 * @returns {object|null} Resultado no formato padrão do referenceEngine, ou null
 */
async function consultarTabelaContratual({ cepDestino, peso, transportadora } = {}) {
  if (!cepDestino || peso == null) return null;

  const cepLimpo = normalizarCep(cepDestino);
  const pesoNum = Number(peso);

  try {
    // Monta query filtrando por status ativa e vigência atual
    let sql = `
      SELECT
        ft.id AS faixaId,
        ft.valor_frete,
        ft.cubagem,
        ft.gris,
        ft.pedagio,
        ft.ad_valorem,
        ft.icms,
        ft.taxas_adicionais,
        tf.id AS tabelaId,
        tf.nome AS tabelaNome,
        tf.transportadora,
        tf.data_inicio,
        tf.observacoes
      FROM faixas_tarifarias ft
      JOIN tabelas_frete tf ON tf.id = ft.tabela_id
      WHERE tf.status = 'ativa'
        AND tf.data_inicio <= DATE('now')
        AND (tf.data_fim IS NULL OR tf.data_fim >= DATE('now'))
        AND ft.cep_inicial <= ?
        AND ft.cep_final   >= ?
        AND ft.peso_inicial <= ?
        AND ft.peso_final   >= ?
    `;
    const args = [cepLimpo, cepLimpo, pesoNum, pesoNum];

    if (transportadora) {
      sql += ` AND LOWER(tf.transportadora) = LOWER(?)`;
      args.push(transportadora);
    }

    sql += ` ORDER BY tf.data_inicio DESC LIMIT 1`;

    const faixa = await db.get(sql, args);
    if (!faixa) return null;

    let valorFinal = Number(faixa.valor_frete);

    // Aplica encargos opcionais quando presentes
    if (faixa.gris)       valorFinal += Number(faixa.gris);
    if (faixa.pedagio)    valorFinal += Number(faixa.pedagio);
    if (faixa.ad_valorem) valorFinal += Number(faixa.ad_valorem);
    if (faixa.icms)       valorFinal += Number(faixa.icms);

    // Taxas adicionais em JSON: [{ descricao, valor }]
    if (faixa.taxas_adicionais) {
      try {
        const extras = JSON.parse(faixa.taxas_adicionais);
        if (Array.isArray(extras)) {
          extras.forEach(t => { if (t.valor) valorFinal += Number(t.valor); });
        }
      } catch {}
    }

    return {
      fonte: 'tabela_cliente',
      nivelConfianca: 'ALTA',
      freteReferencia: valorFinal,
      versao: VERSAO_MOTOR,
      observacao: `Tabela contratual: ${faixa.tabelaNome} (${faixa.transportadora})`
    };
  } catch (err) {
    console.error('[TabelaContratual] Erro na consulta:', err.message);
    return null;
  }
}

/**
 * Importa uma tabela contratual a partir de uma fonte externa.
 *
 * ESTRUTURA ESPERADA DO OBJETO `dadosTabela`:
 * {
 *   nome: string,               // nome da tabela (ex: "Jadlog Contrato 2025")
 *   transportadora: string,     // nome da transportadora
 *   data_inicio: string,        // "YYYY-MM-DD"
 *   data_fim: string|null,      // "YYYY-MM-DD" ou null
 *   status: "ativa"|"inativa",
 *   observacoes: string|null,
 *   faixas: [
 *     {
 *       cep_inicial: string,    // 8 dígitos
 *       cep_final: string,      // 8 dígitos
 *       peso_inicial: number,   // kg
 *       peso_final: number,     // kg
 *       valor_frete: number,    // R$
 *       // Campos opcionais de expansão:
 *       cubagem: number|null,
 *       gris: number|null,
 *       pedagio: number|null,
 *       ad_valorem: number|null,
 *       icms: number|null,
 *       taxas_adicionais: Array<{ descricao: string, valor: number }>|null
 *     }
 *   ]
 * }
 *
 * RETORNO:
 * { success: boolean, tabelaId: number|null, faixasInseridas: number, erros: string[] }
 *
 * IMPLEMENTAÇÃO: pendente (Missão 04)
 */
async function importarTabelaContratual(dadosTabela) {
  const erros = [];

  // 1. Validar campos obrigatórios do cabeçalho
  if (!dadosTabela || typeof dadosTabela !== 'object') {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: ['dadosTabela inválido'] };
  }
  if (!dadosTabela.nome || !String(dadosTabela.nome).trim()) {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: ['Campo obrigatório ausente: nome'] };
  }
  if (!dadosTabela.transportadora || !String(dadosTabela.transportadora).trim()) {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: ['Campo obrigatório ausente: transportadora'] };
  }
  if (!dadosTabela.data_inicio) {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: ['Campo obrigatório ausente: data_inicio'] };
  }
  if (!Array.isArray(dadosTabela.faixas) || dadosTabela.faixas.length === 0) {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: ['Nenhuma faixa tarifária fornecida'] };
  }

  // 2. Inserir cabeçalho em tabelas_frete
  let tabelaId;
  try {
    tabelaId = await db.runInsert(
      `INSERT INTO tabelas_frete
         (nome, transportadora, data_inicio, data_fim, status, observacoes, arquivo_origem, usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(dadosTabela.nome).trim(),
        String(dadosTabela.transportadora).trim(),
        dadosTabela.data_inicio,
        dadosTabela.data_fim || null,
        dadosTabela.status || 'ativa',
        dadosTabela.observacoes || null,
        dadosTabela.arquivo_origem || null,
        dadosTabela.usuario || null,
      ]
    );
  } catch (err) {
    return { success: false, tabelaId: null, faixasInseridas: 0, erros: [`Erro ao criar tabela: ${err.message}`] };
  }

  // 3. Inserir faixas tarifárias
  let faixasInseridas = 0;
  for (let i = 0; i < dadosTabela.faixas.length; i++) {
    const f = dadosTabela.faixas[i];
    try {
      const taxasJson = Array.isArray(f.taxas_adicionais) && f.taxas_adicionais.length
        ? JSON.stringify(f.taxas_adicionais)
        : null;

      await db.run(
        `INSERT INTO faixas_tarifarias
           (tabela_id, cep_inicial, cep_final, peso_inicial, peso_final,
            valor_frete, cubagem, gris, pedagio, ad_valorem, icms, taxas_adicionais)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tabelaId,
          normalizarCep(f.cep_inicial),
          normalizarCep(f.cep_final),
          Number(f.peso_inicial),
          Number(f.peso_final),
          Number(f.valor_frete),
          f.cubagem != null ? Number(f.cubagem) : null,
          f.gris != null ? Number(f.gris) : null,
          f.pedagio != null ? Number(f.pedagio) : null,
          f.ad_valorem != null ? Number(f.ad_valorem) : null,
          f.icms != null ? Number(f.icms) : null,
          taxasJson,
        ]
      );
      faixasInseridas++;
    } catch (err) {
      erros.push(`Faixa ${i + 1}: ${err.message}`);
    }
  }

  // Se nenhuma faixa foi inserida, remove o registro órfão de tabelas_frete
  if (faixasInseridas === 0) {
    try { await db.run('DELETE FROM tabelas_frete WHERE id = ?', [tabelaId]); } catch {}
    return { success: false, tabelaId: null, faixasInseridas: 0, erros };
  }

  // 4. Registrar log da importação
  try {
    await db.run(
      `INSERT INTO logs_importacao
         (tabela_id, arquivo_origem, total_registros, importados, ignorados, erros, usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tabelaId,
        dadosTabela.arquivo_origem || null,
        dadosTabela.faixas.length,
        faixasInseridas,
        dadosTabela.faixas.length - faixasInseridas,
        erros.length,
        dadosTabela.usuario || null,
      ]
    );
  } catch {}

  return { success: true, tabelaId, faixasInseridas, erros };
}

module.exports = { consultarTabelaContratual, importarTabelaContratual };
