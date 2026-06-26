'use strict';

const { Writable } = require('stream');
const { gerarRelatorioPDF } = require('../../services/relatorioGenerator');
const { gerarAuditEvidence } = require('../../services/auditEvidence');
const { PEDIDOS } = require('../massaDeTestes');

function criarMockRes() {
  let bytesEscritos = 0;
  const stream = new Writable({
    write(chunk, encoding, callback) {
      bytesEscritos += chunk.length;
      callback();
    }
  });
  stream.setHeader = () => {};
  stream.getBytesEscritos = () => bytesEscritos;
  return stream;
}

function aguardarPDF(mockRes) {
  return new Promise((resolve, reject) => {
    mockRes.on('finish', resolve);
    mockRes.on('error', reject);
    setTimeout(() => reject(new Error('PDF timeout após 15s')), 15000);
  });
}

const dadosPedidos = Object.values(PEDIDOS);

const dadosRelatorio = {
  clienteNome: 'Cliente Homologação LTDA',
  clienteEmail: 'homologacao@teste.com.br',
  empresaNome: 'AUDITCARGO Homologação',
  totalGasto: dadosPedidos.reduce((s, p) => s + (p.freteCobrado || 0), 0),
  totalReal: dadosPedidos.reduce((s, p) => s + (p.freteCorreto || 0), 0),
  economia: dadosPedidos.reduce((s, p) => s + (p.economia || 0), 0),
  porcentagem: '12.5',
  totalPedidos: dadosPedidos.length,
  pedidos: dadosPedidos,
  motorInfo: { versao: '1.0', fonteContagem: { tabela_cliente: 2, melhor_envio: 1, fallback: 2 } }
};

async function executarTestes() {
  const resultados = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'RelatorioGenerator', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'RelatorioGenerator', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-051: Gerar PDF com pedidos válidos → stream recebe bytes
  await tc('TC-051', 'Gerar PDF com 5 pedidos fictícios → mais de 1000 bytes emitidos', async () => {
    const mockRes = criarMockRes();
    gerarRelatorioPDF(dadosRelatorio, mockRes);
    await aguardarPDF(mockRes);
    const bytes = mockRes.getBytesEscritos();
    const ok = bytes > 1000;
    return { aprovado: ok, esperado: 'bytes > 1000', obtido: `${bytes} bytes` };
  });

  // TC-052: Gerar PDF com lista vazia → ainda gera sem erro
  await tc('TC-052', 'Gerar PDF com lista vazia de pedidos → gera sem exceção', async () => {
    const mockRes = criarMockRes();
    const dadosVazios = { ...dadosRelatorio, pedidos: [], totalPedidos: 0, totalGasto: 0, totalReal: 0, economia: 0, porcentagem: '0.0' };
    gerarRelatorioPDF(dadosVazios, mockRes);
    await aguardarPDF(mockRes);
    const bytes = mockRes.getBytesEscritos();
    const ok = bytes > 500;
    return { aprovado: ok, esperado: 'PDF gerado sem exceção (bytes > 500)', obtido: `${bytes} bytes` };
  });

  // TC-053: AuditEvidence gerada para todos os pedidos do relatório
  await tc('TC-053', 'AuditEvidence: gerarAuditEvidence funciona para todos os 5 pedidos de teste', () => {
    const erros = [];
    for (const pedido of dadosPedidos) {
      try {
        const ev = gerarAuditEvidence(pedido);
        if (!ev.fundamentacao || !ev.rastreabilidade || !ev.resultadoEncontrado) {
          erros.push(`Pedido ${pedido.pedidoId}: campos obrigatórios ausentes`);
        }
      } catch (err) {
        erros.push(`Pedido ${pedido.pedidoId}: ${err.message}`);
      }
    }
    const ok = erros.length === 0;
    return {
      aprovado: ok,
      esperado: '0 erros de geração de evidence',
      obtido: erros.length === 0 ? '0 erros' : erros.join('; '),
      motivoFalha: erros.join('; ') || null
    };
  });

  return resultados;
}

module.exports = executarTestes;
