'use strict';

const { Writable } = require('stream');
const { gerarRelatorioPDF, getVerifyUrl } = require('../../services/relatorioGenerator');
const { PREFIX } = require('../massaDeTestes');

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
    setTimeout(() => reject(new Error('PDF timeout após 20s')), 20000);
  });
}

const dadosBase = {
  clienteNome: 'Cliente Verificacao',
  clienteEmail: 'verificacao@teste.com.br',
  empresaNome: 'AUDITCARGO Verificacao',
  totalGasto: 50, totalReal: 40, economia: 10,
  porcentagem: '20.0', totalPedidos: 1,
  pedidos: [],
  motorInfo: { versao: '1.0', fonteContagem: { fallback: 1 } }
};

async function executarTestes(db) {
  const resultados = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'Verificacao', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'Verificacao', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-059: getVerifyUrl com APP_BASE_URL definida
  await tc('TC-059', 'getVerifyUrl com APP_BASE_URL definida → URL correta', async () => {
    const original = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://app.auditcargo.com.br';
    try {
      const url = getVerifyUrl('AUD-20260101-ABCD1234');
      const ok = url === 'https://app.auditcargo.com.br/verify/AUD-20260101-ABCD1234';
      return { aprovado: ok, esperado: 'https://app.auditcargo.com.br/verify/AUD-20260101-ABCD1234', obtido: url };
    } finally {
      process.env.APP_BASE_URL = original || '';
    }
  });

  // TC-060: getVerifyUrl sem APP_BASE_URL → fallback localhost
  await tc('TC-060', 'getVerifyUrl sem APP_BASE_URL → localhost com porta', async () => {
    const originalBase = process.env.APP_BASE_URL;
    const originalPort = process.env.PORT;
    process.env.APP_BASE_URL = '';
    process.env.PORT = '3000';
    try {
      const url = getVerifyUrl('AUD-TEST');
      const ok = url.startsWith('http://localhost') && url.includes('/verify/AUD-TEST');
      return { aprovado: ok, esperado: 'URL com localhost e /verify/AUD-TEST', obtido: url };
    } finally {
      process.env.APP_BASE_URL = originalBase || '';
      process.env.PORT = originalPort || '';
    }
  });

  // TC-061: DB — inserir relatorio com UUID de teste e recuperar
  await tc('TC-061', 'DB: inserir relatorio com UUID de teste e recuperar por audit_uuid', async () => {
    const uuid = `${PREFIX}VERIF_TC061`;
    await db.run('DELETE FROM relatorios WHERE audit_uuid = ?', [uuid]);
    await db.run(
      `INSERT INTO relatorios (audit_uuid, audit_hash, data_emissao_relatorio, total_pedidos, total_documentos, versao_motor, fontes_utilizadas, total_paginas)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuid, 'abc123hash', new Date().toISOString(), 5, 5, '1.0', '{"fallback":5}', 8]
    );
    const row = await db.get('SELECT * FROM relatorios WHERE audit_uuid = ?', [uuid]);
    await db.run('DELETE FROM relatorios WHERE audit_uuid = ?', [uuid]);
    const ok = row && row.audit_uuid === uuid && Number(row.total_paginas) === 8 && row.audit_hash === 'abc123hash';
    return {
      aprovado: ok,
      esperado: `uuid=${uuid}, total_paginas=8, hash=abc123hash`,
      obtido: row ? `uuid=${row.audit_uuid}, total_paginas=${row.total_paginas}, hash=${row.audit_hash}` : 'undefined'
    };
  });

  // TC-062: DB — UUID inexistente retorna undefined
  await tc('TC-062', 'DB: consultar audit_uuid inexistente → undefined', async () => {
    const row = await db.get('SELECT * FROM relatorios WHERE audit_uuid = ?', [`${PREFIX}UUID_INEXISTENTE_XYZ99`]);
    const ok = row === undefined;
    return { aprovado: ok, esperado: 'undefined', obtido: row === undefined ? 'undefined' : JSON.stringify(row) };
  });

  // TC-063: PDF com auditUuid definido → QR Code embarcado, bytes > 1000
  await tc('TC-063', 'PDF com auditUuid e QR Code → gerado sem exceção, bytes > 1000', async () => {
    const mockRes = criarMockRes();
    const originalBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'http://localhost:3000';
    try {
      gerarRelatorioPDF({ ...dadosBase, auditUuid: `${PREFIX}QR_TC063` }, mockRes);
      await aguardarPDF(mockRes);
      const bytes = mockRes.getBytesEscritos();
      const ok = bytes > 1000;
      return { aprovado: ok, esperado: 'bytes > 1000 (PDF com QR Code)', obtido: `${bytes} bytes` };
    } finally {
      process.env.APP_BASE_URL = originalBase || '';
    }
  });

  return resultados;
}

module.exports = executarTestes;
