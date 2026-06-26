'use strict';

const fs = require('fs');
const path = require('path');

function gerarRelatorioTexto(resultados, duracaoTotalMs) {
  const total = resultados.length;
  const aprovados = resultados.filter(r => r.status === 'APROVADO').length;
  const reprovados = total - aprovados;
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const duracaoSeg = (duracaoTotalMs / 1000).toFixed(2);
  const taxaAprovacao = total > 0 ? ((aprovados / total) * 100).toFixed(1) : '0.0';

  const linhas = [];

  linhas.push('═'.repeat(70));
  linhas.push('  AUDITCARGO — RELATÓRIO DE HOMOLOGAÇÃO INTERNA');
  linhas.push('═'.repeat(70));
  linhas.push('');
  linhas.push('RESUMO EXECUTIVO');
  linhas.push('─'.repeat(70));
  linhas.push(`  Data / Hora       : ${dataHora}`);
  linhas.push(`  Versão do Motor   : 1.0`);
  linhas.push(`  Total de Testes   : ${total}`);
  linhas.push(`  Aprovados         : ${aprovados}`);
  linhas.push(`  Reprovados        : ${reprovados}`);
  linhas.push(`  Taxa de Aprovação : ${taxaAprovacao}%`);
  linhas.push(`  Tempo Total       : ${duracaoSeg}s`);
  linhas.push('');

  // Resultados por módulo
  const modulos = [...new Set(resultados.map(r => r.modulo))];
  linhas.push('RESULTADOS POR MÓDULO');
  linhas.push('─'.repeat(70));
  for (const modulo of modulos) {
    const testes = resultados.filter(r => r.modulo === modulo);
    const aprov = testes.filter(r => r.status === 'APROVADO').length;
    const reprov = testes.length - aprov;
    const icone = reprov === 0 ? '✓' : '✗';
    linhas.push(`  ${icone} ${modulo.padEnd(30)} ${aprov}/${testes.length} aprovados`);
  }
  linhas.push('');

  // Detalhe de cada teste
  linhas.push('DETALHE DOS TESTES');
  linhas.push('─'.repeat(70));
  for (const r of resultados) {
    const icone = r.status === 'APROVADO' ? '✓' : '✗';
    linhas.push(`  ${icone} [${r.id}] ${r.cenario}`);
    if (r.status === 'REPROVADO') {
      linhas.push(`      MÓDULO   : ${r.modulo}`);
      linhas.push(`      ESPERADO : ${r.esperado}`);
      linhas.push(`      OBTIDO   : ${r.obtido}`);
      if (r.motivoFalha) linhas.push(`      MOTIVO   : ${r.motivoFalha}`);
    }
    linhas.push(`      Duração  : ${r.duracaoMs}ms`);
  }
  linhas.push('');

  // Falhas (se houver)
  const falhas = resultados.filter(r => r.status === 'REPROVADO');
  if (falhas.length > 0) {
    linhas.push('ITENS QUE FALHARAM');
    linhas.push('─'.repeat(70));
    for (const f of falhas) {
      linhas.push(`  ✗ [${f.id}] — Módulo: ${f.modulo}`);
      linhas.push(`     Cenário : ${f.cenario}`);
      linhas.push(`     Esperado: ${f.esperado}`);
      linhas.push(`     Obtido  : ${f.obtido}`);
      linhas.push(`     Motivo  : ${f.motivoFalha || 'Não especificado'}`);
      linhas.push('');
    }
  }

  linhas.push('═'.repeat(70));
  const veredicto = reprovados === 0
    ? '  HOMOLOGAÇÃO INTERNA CONCLUÍDA'
    : `  HOMOLOGAÇÃO INTERNA CONCLUÍDA COM FALHAS IDENTIFICADAS (${reprovados} falha(s))`;
  linhas.push(veredicto);
  linhas.push('═'.repeat(70));
  linhas.push('');

  return linhas.join('\n');
}

function salvarRelatorio(texto) {
  const dir = path.join(__dirname, '..', 'homologacao', 'resultados');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const nome = `homologacao_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const arquivo = path.join(dir, nome);
  fs.writeFileSync(arquivo, texto, 'utf-8');
  return arquivo;
}

module.exports = { gerarRelatorioTexto, salvarRelatorio };
