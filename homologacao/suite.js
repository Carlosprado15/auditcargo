'use strict';

/**
 * Suite de Homologação Interna — AUDITCARGO
 *
 * Valida toda a arquitetura sem alterar dados reais.
 * Dados de teste usam prefixo HOMOLOG_TEST_ e são removidos ao final.
 *
 * Uso: npm run homologar
 */

const path = require('path');

// Carrega .env antes de qualquer módulo de serviço
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Força uso do SQLite local durante homologação (nunca usa Turso cloud)
const tursoOriginal = process.env.TURSO_URL;
const tursoTokenOriginal = process.env.TURSO_AUTH_TOKEN;
process.env.TURSO_URL = '';
process.env.TURSO_AUTH_TOKEN = '';

const db = require('../services/database');
const { gerarRelatorioTexto, salvarRelatorio } = require('./relatorio');
const { PREFIX } = require('./massaDeTestes');

const MODULOS = [
  { nome: 'FreteCalculator',      arquivo: './testes/t01_freteCalculator', precisaDb: false },
  { nome: 'AuditEvidence',        arquivo: './testes/t02_auditEvidence',   precisaDb: false },
  { nome: 'Database',             arquivo: './testes/t03_database',        precisaDb: true  },
  { nome: 'TabelaContratual',     arquivo: './testes/t04_tabelaContratual',precisaDb: true  },
  { nome: 'ReferenceEngine',      arquivo: './testes/t05_referenceEngine', precisaDb: true  },
  { nome: 'ImportadorTabela',     arquivo: './testes/t06_importador',      precisaDb: true  },
  { nome: 'RelatorioGenerator',   arquivo: './testes/t07_relatorio',       precisaDb: false },
  { nome: 'DocumentParser (OCR)', arquivo: './testes/t08_ocr',             precisaDb: false },
  { nome: 'Verificacao',          arquivo: './testes/t09_verificacao',     precisaDb: true  },
];

async function limparDadosTeste() {
  try {
    // Remove pedidos de teste
    await db.run(`DELETE FROM pedidos WHERE pedidoId LIKE '${PREFIX}%'`);

    // Remove tabelas de frete de teste (e suas faixas + logs)
    const tabelas = await db.all(`SELECT id FROM tabelas_frete WHERE nome LIKE '${PREFIX}%'`);
    for (const t of tabelas) {
      await db.run('DELETE FROM faixas_tarifarias WHERE tabela_id = ?', [t.id]);
      await db.run('DELETE FROM logs_importacao WHERE tabela_id = ?', [t.id]);
    }
    await db.run(`DELETE FROM tabelas_frete WHERE nome LIKE '${PREFIX}%'`);

    // Remove cache ME gerado pelos testes (CEPs fictícios começando com 000000)
    await db.run(`DELETE FROM melhor_envio_cache WHERE cep_origem LIKE '000000%'`);

    // Remove config de teste (se algum módulo criar)
    await db.run(`DELETE FROM config WHERE chave LIKE '${PREFIX}%'`);

    // Remove relatorios de teste (t09)
    await db.run(`DELETE FROM relatorios WHERE audit_uuid LIKE '${PREFIX}%'`);
  } catch (err) {
    console.warn('[Cleanup] Aviso durante limpeza:', err.message);
  }
}

function imprimir(texto) {
  process.stdout.write(texto + '\n');
}

async function main() {
  const inicioTotal = Date.now();

  imprimir('');
  imprimir('═'.repeat(70));
  imprimir('  AUDITCARGO — INICIANDO SUITE DE HOMOLOGAÇÃO INTERNA');
  imprimir('═'.repeat(70));
  imprimir(`  Data : ${new Date().toLocaleString('pt-BR')}`);
  imprimir(`  Banco : SQLite local (database/auditcargo.db)`);
  imprimir('');

  // Inicializa banco de dados
  imprimir('[DB] Inicializando banco de dados...');
  try {
    await db.initDB();
    imprimir('[DB] Banco inicializado com sucesso.');
  } catch (err) {
    imprimir(`[DB] ERRO CRÍTICO: Falha ao inicializar banco — ${err.message}`);
    process.exit(2);
  }

  const todosResultados = [];
  let modulosExecutados = 0;
  let modulosComFalha = 0;

  // Executa cada módulo de testes
  for (const modulo of MODULOS) {
    imprimir('');
    imprimir(`▶ Executando: ${modulo.nome}`);

    let resultadosModulo = [];
    try {
      const executar = require(modulo.arquivo);
      resultadosModulo = modulo.precisaDb
        ? await executar(db)
        : await executar();
    } catch (err) {
      // Erro catastrófico no módulo — registra como falha
      resultadosModulo = [{
        id: `${modulo.nome.toUpperCase().replace(/\s/g, '_')}_CRASH`,
        modulo: modulo.nome,
        cenario: `Carregamento/execução do módulo ${modulo.arquivo}`,
        status: 'REPROVADO',
        esperado: 'módulo executou sem crash',
        obtido: `CRASH: ${err.message}`,
        motivoFalha: err.stack || err.message,
        duracaoMs: 0
      }];
    }

    const aprov = resultadosModulo.filter(r => r.status === 'APROVADO').length;
    const reprov = resultadosModulo.length - aprov;

    for (const r of resultadosModulo) {
      const icone = r.status === 'APROVADO' ? '  ✓' : '  ✗';
      imprimir(`${icone} [${r.id}] ${r.cenario} (${r.duracaoMs}ms)`);
      if (r.status === 'REPROVADO') {
        imprimir(`       → ${r.motivoFalha || r.obtido}`);
      }
    }

    imprimir(`  ─ Resultado: ${aprov}/${resultadosModulo.length} aprovados`);

    todosResultados.push(...resultadosModulo);
    modulosExecutados++;
    if (reprov > 0) modulosComFalha++;
  }

  // Limpeza dos dados de teste
  imprimir('');
  imprimir('[Cleanup] Removendo dados de homologação...');
  await limparDadosTeste();
  imprimir('[Cleanup] Concluído.');

  // Restaura variáveis de ambiente
  process.env.TURSO_URL = tursoOriginal || '';
  process.env.TURSO_AUTH_TOKEN = tursoTokenOriginal || '';

  const duracaoTotal = Date.now() - inicioTotal;

  // Gera e salva relatório
  const relatorio = gerarRelatorioTexto(todosResultados, duracaoTotal);
  let arquivoSalvo = null;
  try {
    arquivoSalvo = salvarRelatorio(relatorio);
  } catch {}

  imprimir('');
  imprimir(relatorio);

  if (arquivoSalvo) {
    imprimir(`[Relatório] Salvo em: ${arquivoSalvo}`);
  }

  // Código de saída: 0 = todos aprovados, 1 = falhas encontradas
  const totalReprovados = todosResultados.filter(r => r.status === 'REPROVADO').length;
  process.exit(totalReprovados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[HOMOLOGAÇÃO] Erro fatal não tratado:', err);
  process.exit(2);
});
