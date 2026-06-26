'use strict';

const XLSX = require('xlsx');
const { importarArquivo } = require('../../services/importadorTabela');
const { CSVS, METADADOS_CSV, PREFIX } = require('../massaDeTestes');

async function executarTestes(db) {
  const resultados = [];
  const tabelasInseridas = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'ImportadorTabela', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'ImportadorTabela', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  function bufferCSV(str) { return Buffer.from(str, 'utf-8'); }

  // TC-042: CSV válido padrão (vírgula) — 3 faixas
  await tc('TC-042', 'Importar CSV válido (vírgula, 3 faixas) → success=true, importados=3', async () => {
    const meta = { ...METADADOS_CSV.jadlog, nome: `${PREFIX}IMP_TC042` };
    const r = await importarArquivo(bufferCSV(CSVS.valido), 'tabela.csv', meta, 'homologacao');
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.importados === 3 && r.erros === 0;
    return { aprovado: ok, esperado: 'success=true, importados=3, erros=0', obtido: `success=${r.success}, importados=${r.importados}, erros=${r.erros}` };
  });

  // TC-043: CSV com ponto-e-vírgula
  await tc('TC-043', 'Importar CSV com separador ";" → auto-detectado, success=true', async () => {
    const meta = { ...METADADOS_CSV.correios, nome: `${PREFIX}IMP_TC043` };
    const r = await importarArquivo(bufferCSV(CSVS.validoPontoEVirgula), 'tabela_ptvirgula.csv', meta, 'homologacao');
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.importados >= 2;
    return { aprovado: ok, esperado: 'success=true, importados≥2', obtido: `success=${r.success}, importados=${r.importados}` };
  });

  // TC-044: CSV com aliases de coluna (cepi, cepf, pesode, pesoate, tarifa)
  await tc('TC-044', 'Importar CSV com aliases alternativos de coluna → mapeamento flexível funciona', async () => {
    const meta = { ...METADADOS_CSV.correios, nome: `${PREFIX}IMP_TC044` };
    const r = await importarArquivo(bufferCSV(CSVS.comAliases), 'tabela_aliases.csv', meta, 'homologacao');
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.importados >= 1;
    return { aprovado: ok, esperado: 'success=true, importados≥1', obtido: `success=${r.success}, importados=${r.importados}` };
  });

  // TC-045: CSV com linha vazia intercalada
  await tc('TC-045', 'Importar CSV com linha vazia intercalada → linha vazia ignorada, rest importado', async () => {
    const meta = { ...METADADOS_CSV.jadlog, nome: `${PREFIX}IMP_TC045` };
    const r = await importarArquivo(bufferCSV(CSVS.comLinhaVazia), 'tabela_linha_vazia.csv', meta, 'homologacao');
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.importados === 2;
    return { aprovado: ok, esperado: 'success=true, importados=2 (linha vazia ignorada)', obtido: `success=${r.success}, importados=${r.importados}` };
  });

  // TC-046: Extensão de arquivo não suportada (.pdf)
  await tc('TC-046', 'Importar arquivo .pdf → success=false, erro de formato não suportado', async () => {
    const r = await importarArquivo(Buffer.from('dummy'), 'tabela.pdf', METADADOS_CSV.jadlog, 'homologacao');
    const ok = r.success === false && r.detalheErros.some(e => e.erros.some(msg => msg.toLowerCase().includes('suportado')));
    return { aprovado: ok, esperado: 'success=false, erro "não suportado"', obtido: `success=${r.success}, erros=${JSON.stringify(r.detalheErros.map(e => e.erros).flat().slice(0, 1))}` };
  });

  // TC-047: CSV com CEP inválido (letras)
  await tc('TC-047', 'Importar CSV com CEP "ABCDEFGH" → linha rejeitada, success=false', async () => {
    const meta = { ...METADADOS_CSV.jadlog, nome: `${PREFIX}IMP_TC047` };
    const r = await importarArquivo(bufferCSV(CSVS.cepInvalido), 'cep_invalido.csv', meta, 'homologacao');
    // Todos os CEPs com letras normalizados pelo normalizarCep viram '00000000' que pode falhar a validação de faixa
    // A linha pode ser rejeitada por "CEP inicial inválido" OU pode ser aceita após normalização
    // Verificamos que a linha foi rejeitada (ignorados>0) OU que success=false
    const ok = r.success === false || r.ignorados >= 1;
    return { aprovado: ok, esperado: 'linha rejeitada (ignorados≥1 ou success=false)', obtido: `success=${r.success}, importados=${r.importados}, ignorados=${r.ignorados}` };
  });

  // TC-048: CSV com peso_inicial > peso_final
  await tc('TC-048', 'Importar CSV com peso_inicial(10) > peso_final(5) → linha rejeitada', async () => {
    const meta = { ...METADADOS_CSV.jadlog, nome: `${PREFIX}IMP_TC048` };
    const r = await importarArquivo(bufferCSV(CSVS.pesoInvalido), 'peso_invalido.csv', meta, 'homologacao');
    const ok = r.success === false || r.ignorados >= 1;
    const motivoEncontrado = r.detalheErros.some(e => e.erros.some(msg => msg.toLowerCase().includes('peso')));
    return {
      aprovado: ok && motivoEncontrado,
      esperado: 'ignorados≥1 e erro menciona "peso"',
      obtido: `success=${r.success}, ignorados=${r.ignorados}, motivo=${r.detalheErros.map(e => e.erros).flat().join('; ').slice(0, 80)}`
    };
  });

  // TC-049: CSV com valor_frete = 0
  await tc('TC-049', 'Importar CSV com valor_frete=0 → linha rejeitada (valor inválido)', async () => {
    const meta = { ...METADADOS_CSV.jadlog, nome: `${PREFIX}IMP_TC049` };
    const r = await importarArquivo(bufferCSV(CSVS.valorZero), 'valor_zero.csv', meta, 'homologacao');
    const ok = r.success === false || r.ignorados >= 1;
    const motivoEncontrado = r.detalheErros.some(e => e.erros.some(msg => msg.toLowerCase().includes('frete')));
    return {
      aprovado: ok && motivoEncontrado,
      esperado: 'ignorados≥1 e erro menciona "frete"',
      obtido: `success=${r.success}, ignorados=${r.ignorados}, motivo=${r.detalheErros.map(e => e.erros).flat().join('; ').slice(0, 80)}`
    };
  });

  // TC-050: XLSX simulado com dados válidos
  await tc('TC-050', 'Importar XLSX gerado programaticamente com 2 faixas válidas → success=true', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['cep_inicial', 'cep_final', 'peso_inicial', 'peso_final', 'valor_frete'],
      ['00000010',    '00000019',  0,              5,            28.00],
      ['00000010',    '00000019',  5,              10,           45.00]
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tabela');
    const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const meta = { ...METADADOS_CSV.xlsx, nome: `${PREFIX}IMP_TC050` };
    const r = await importarArquivo(buffer, 'tabela.xlsx', meta, 'homologacao');
    if (r.tabelaId) tabelasInseridas.push(r.tabelaId);
    const ok = r.success === true && r.importados === 2;
    return { aprovado: ok, esperado: 'success=true, importados=2', obtido: `success=${r.success}, importados=${r.importados}` };
  });

  // Cleanup das tabelas inseridas neste módulo
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
