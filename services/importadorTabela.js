'use strict';

const XLSX = require('xlsx');
const { importarTabelaContratual } = require('./tabelaContratual');

// Formatos ativos. PDF reservado para implementação futura.
const FORMATOS_SUPORTADOS = ['xlsx', 'xls', 'csv'];

// Mapeamento flexível: campo canônico → nomes normalizados aceitos
// Normalização: lowercase, sem acentos, sem caracteres especiais
const MAPA_COLUNAS = {
  cep_inicial: [
    'cepinicial', 'cepi', 'ceporigem', 'cepdeorigem', 'cepde', 'decep',
    'faixainicial', 'cepmin', 'cepinicio', 'cepstart', 'cepfrom',
    'cepdesaida', 'ceppartida', 'origemcep', 'cepoi', 'cepori',
    'cepde', 'zipcodestart', 'zipfrom',
  ],
  cep_final: [
    'cepfinal', 'cepf', 'cepdestino', 'cepate', 'atecep',
    'faixafinal', 'cepmax', 'cepend', 'cepto', 'cepfim',
    'cepchegada', 'destinocep', 'cepentrega', 'cepdf', 'cepdest',
    'zipcodeend', 'zipto',
  ],
  peso_inicial: [
    'pesoinicial', 'pesoi', 'pesode', 'depeso',
    'pesomin', 'pesominimo', 'pmin', 'pesominkg',
    'weightfrom', 'weightstart', 'weightmin', 'pesoini',
  ],
  peso_final: [
    'pesofinal', 'pesof', 'pesoate', 'atepeso',
    'pesomax', 'pesomaximo', 'pmax', 'pesomaxkg',
    'weightto', 'weightend', 'weightmax', 'pesofim',
  ],
  valor_frete: [
    'valorfrete', 'vlrfrete', 'vlfrete', 'valor', 'frete',
    'preco', 'tarifa', 'tarifafrete', 'valorbase', 'valorkg',
    'freightvalue', 'shippingcost', 'shipping', 'vlr', 'vlfr',
  ],
  cubagem: ['cubagem', 'fator', 'fatorcubagem', 'cubage', 'fatordc', 'cubicfactor'],
  gris:     ['gris', 'advaloremgris', 'taxagris'],
  pedagio:  ['pedagio', 'taxapedagio', 'pedagiotaxa', 'txpedagio'],
  ad_valorem: ['advalorem', 'taxaadvalorem', 'adval'],
  icms:     ['icms', 'taxaicms'],
};

const CAMPOS_OBRIGATORIOS = ['cep_inicial', 'cep_final', 'peso_inicial', 'peso_final', 'valor_frete'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizarNomeColuna(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizarCep(val) {
  return String(val).replace(/\D/g, '').padStart(8, '0');
}

function toNumero(val) {
  if (val == null || val === '') return null;
  const n = Number(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function isLinhaVazia(linha) {
  return !linha || linha.every(c => c == null || c === '');
}

// ─── Mapeamento de colunas ────────────────────────────────────────────────────

function mapearColunas(headerRow) {
  const mapeamento = {};
  headerRow.forEach((celula, idx) => {
    if (celula == null || celula === '') return;
    const norm = normalizarNomeColuna(String(celula));
    for (const [campo, aliases] of Object.entries(MAPA_COLUNAS)) {
      if (mapeamento[campo] !== undefined) continue;
      if (aliases.includes(norm)) {
        mapeamento[campo] = idx;
        break;
      }
    }
  });
  return mapeamento;
}

// Varre as primeiras linhas e usa a que mapeia mais campos obrigatórios
function detectarHeaderRow(rows) {
  let melhorIdx = 0;
  let melhorScore = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row || !row.some(c => c != null && c !== '')) continue;
    const mapa = mapearColunas(row);
    const score = CAMPOS_OBRIGATORIOS.filter(c => mapa[c] !== undefined).length;
    if (score > melhorScore) {
      melhorScore = score;
      melhorIdx = i;
    }
  }
  return melhorIdx;
}

// ─── Validação de linha ───────────────────────────────────────────────────────

function validarLinha(linha, mapeamento) {
  const erros = [];
  const get = campo => {
    const idx = mapeamento[campo];
    return idx !== undefined ? linha[idx] : undefined;
  };

  const cepIni  = get('cep_inicial');
  const cepFim  = get('cep_final');
  const pesoIni = get('peso_inicial');
  const pesoFim = get('peso_final');
  const valor   = get('valor_frete');

  // CEP inicial
  if (cepIni == null || cepIni === '') {
    erros.push('CEP inicial ausente');
  } else if (!/^\d+$/.test(String(cepIni).replace(/[\s-]/g, '')) || !/^\d{8}$/.test(normalizarCep(cepIni))) {
    erros.push(`CEP inicial inválido: "${cepIni}"`);
  }

  // CEP final
  if (cepFim == null || cepFim === '') {
    erros.push('CEP final ausente');
  } else if (!/^\d+$/.test(String(cepFim).replace(/[\s-]/g, '')) || !/^\d{8}$/.test(normalizarCep(cepFim))) {
    erros.push(`CEP final inválido: "${cepFim}"`);
  }

  // Faixa de CEP coerente
  if (cepIni && cepFim && erros.length === 0) {
    if (normalizarCep(cepIni) > normalizarCep(cepFim)) {
      erros.push('CEP inicial maior que CEP final');
    }
  }

  // Peso inicial
  const pesoIniNum = toNumero(pesoIni);
  if (pesoIni == null || pesoIni === '') {
    erros.push('Peso inicial ausente');
  } else if (pesoIniNum === null || pesoIniNum < 0) {
    erros.push(`Peso inicial inválido: "${pesoIni}"`);
  }

  // Peso final
  const pesoFimNum = toNumero(pesoFim);
  if (pesoFim == null || pesoFim === '') {
    erros.push('Peso final ausente');
  } else if (pesoFimNum === null || pesoFimNum < 0) {
    erros.push(`Peso final inválido: "${pesoFim}"`);
  }

  // Faixa de peso coerente
  if (pesoIniNum !== null && pesoFimNum !== null && pesoIniNum > pesoFimNum) {
    erros.push('Peso inicial maior que peso final');
  }

  // Valor frete
  const valorNum = toNumero(valor);
  if (valor == null || valor === '') {
    erros.push('Valor do frete ausente');
  } else if (valorNum === null || valorNum <= 0) {
    erros.push(`Valor do frete inválido: "${valor}"`);
  }

  return erros;
}

function construirFaixa(linha, mapeamento) {
  const get = campo => {
    const idx = mapeamento[campo];
    return idx !== undefined ? linha[idx] : null;
  };
  return {
    cep_inicial:  normalizarCep(get('cep_inicial')),
    cep_final:    normalizarCep(get('cep_final')),
    peso_inicial: toNumero(get('peso_inicial')),
    peso_final:   toNumero(get('peso_final')),
    valor_frete:  toNumero(get('valor_frete')),
    cubagem:      toNumero(get('cubagem')),
    gris:         toNumero(get('gris')),
    pedagio:      toNumero(get('pedagio')),
    ad_valorem:   toNumero(get('ad_valorem')),
    icms:         toNumero(get('icms')),
    taxas_adicionais: null,
  };
}

// ─── Parsers de arquivo ───────────────────────────────────────────────────────

function parseCSV(buffer) {
  const text = buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const linhas = text.split('\n');

  // Detecta delimitador pela primeira linha não vazia
  const primeiraLinha = linhas.find(l => l.trim()) || '';
  const delimitador = primeiraLinha.split(';').length > primeiraLinha.split(',').length ? ';' : ',';

  return linhas.map(linha => {
    if (!linha.trim()) return null;
    const row = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (ch === '"') {
        if (inQuote && linha[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === delimitador && !inQuote) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    return row;
  }).filter(r => r !== null);
}

function parseArquivo(buffer, extensao) {
  const ext = extensao.toLowerCase();

  if (ext === 'csv') {
    return parseCSV(buffer);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
    if (!wb.SheetNames.length) throw new Error('Arquivo sem planilhas');
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  }

  // PDF: reservado para implementação futura
  throw new Error(`Formato .${ext} não suportado. Use XLSX, XLS ou CSV.`);
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Importa tabela contratual a partir de arquivo XLSX, XLS ou CSV.
 *
 * @param {Buffer} buffer        - Conteúdo binário do arquivo
 * @param {string} nomeArquivo   - Nome original (usado para detectar extensão e logar)
 * @param {object} metadados     - { nome, transportadora, data_inicio, data_fim, status, observacoes }
 * @param {string|null} usuario  - Preparado para autenticação futura
 * @returns {object}             - Relatório completo de importação
 */
async function importarArquivo(buffer, nomeArquivo, metadados = {}, usuario = null) {
  const partes = String(nomeArquivo).split('.');
  const ext = partes.length > 1 ? partes.pop().toLowerCase() : '';

  const erroFormato = {
    success: false, importados: 0, ignorados: 0, erros: 1,
    detalheErros: [{ linha: null, erros: [`Formato não suportado: .${ext}. Aceitos: ${FORMATOS_SUPORTADOS.join(', ')}.`] }],
    relatorio: null,
  };

  if (!FORMATOS_SUPORTADOS.includes(ext)) return erroFormato;

  // Parse
  let rows;
  try {
    rows = parseArquivo(buffer, ext);
  } catch (err) {
    return {
      success: false, importados: 0, ignorados: 0, erros: 1,
      detalheErros: [{ linha: null, erros: [`Erro ao processar arquivo: ${err.message}`] }],
      relatorio: null,
    };
  }

  // Localizar linha de cabeçalho
  const headerIdx = detectarHeaderRow(rows);
  const headerRow = rows[headerIdx] || [];
  const mapeamento = mapearColunas(headerRow);

  // Verificar campos obrigatórios
  const faltando = CAMPOS_OBRIGATORIOS.filter(c => mapeamento[c] === undefined);
  if (faltando.length > 0) {
    const colsDetectadas = headerRow.filter(Boolean).join(', ') || '(nenhuma)';
    return {
      success: false, importados: 0, ignorados: 0, erros: 1,
      detalheErros: [{
        linha: headerIdx + 1,
        erros: [`Colunas obrigatórias não mapeadas: ${faltando.join(', ')}. Colunas no arquivo: ${colsDetectadas}`],
      }],
      relatorio: null,
    };
  }

  // Processar linhas de dados
  const faixasValidas = [];
  const detalheErros  = [];
  let ignorados = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const linha = rows[i];
    if (isLinhaVazia(linha)) continue;

    const numLinha = i + 1;
    const errosLinha = validarLinha(linha, mapeamento);

    if (errosLinha.length > 0) {
      detalheErros.push({ linha: numLinha, erros: errosLinha });
      ignorados++;
    } else {
      faixasValidas.push(construirFaixa(linha, mapeamento));
    }
  }

  const totalLinhas = rows.length - headerIdx - 1;
  const colunasDetectadas = Object.fromEntries(
    Object.entries(mapeamento).map(([campo, idx]) => [campo, headerRow[idx] || `col_${idx}`])
  );

  // Nenhuma linha válida: retorna relatório sem importar
  if (faixasValidas.length === 0) {
    return {
      success: false, importados: 0, ignorados, erros: detalheErros.length,
      detalheErros,
      relatorio: {
        arquivo: nomeArquivo,
        importadoEm: new Date().toISOString(),
        usuario,
        tabelaId: null,
        totalLinhas,
        importados: 0,
        ignorados,
        erros: detalheErros.length,
        colunasDetectadas,
      },
    };
  }

  // Montar objeto para importarTabelaContratual
  const dadosTabela = {
    nome: String(metadados.nome || nomeArquivo).trim(),
    transportadora: String(metadados.transportadora || 'Não informada').trim(),
    data_inicio: metadados.data_inicio || new Date().toISOString().split('T')[0],
    data_fim: metadados.data_fim || null,
    status: metadados.status || 'ativa',
    observacoes: metadados.observacoes || null,
    arquivo_origem: nomeArquivo,
    usuario,
    faixas: faixasValidas,
  };

  const resultado = await importarTabelaContratual(dadosTabela);

  const errosInsercao = resultado.erros.map(e => ({ linha: null, erros: [e] }));
  const totalErros = detalheErros.length + errosInsercao.length;

  return {
    success: resultado.success,
    tabelaId: resultado.tabelaId,
    importados: resultado.faixasInseridas,
    ignorados,
    erros: totalErros,
    detalheErros: [...detalheErros, ...errosInsercao],
    relatorio: {
      arquivo: nomeArquivo,
      importadoEm: new Date().toISOString(),
      usuario,
      tabelaId: resultado.tabelaId,
      totalLinhas,
      importados: resultado.faixasInseridas,
      ignorados,
      erros: totalErros,
      colunasDetectadas,
    },
  };
}

module.exports = { importarArquivo, FORMATOS_SUPORTADOS, MAPA_COLUNAS };
