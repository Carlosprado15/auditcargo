const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { calcularFrete, determinarStatus } = require('../services/freteCalculator');
const { calcularComReferencia } = require('../services/referenceEngine');
const { gerarRelatorioPDF } = require('../services/relatorioGenerator');

function gerarHtmlVerificacao(relatorio, auditUuid) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const estilos = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:Arial,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh}',
    'header{background:#0f172a;border-bottom:1px solid rgba(255,255,255,0.08);padding:20px 32px}',
    '.brand{font-size:22px;font-weight:800;letter-spacing:-0.5px}',
    '.brand .audit{color:#2563eb}.brand .cargo{color:#f59e0b}',
    '.subtitle{color:#94a3b8;font-size:13px;margin-top:5px}',
    'main{max-width:660px;margin:36px auto;padding:0 16px}',
    '.card{background:#1e293b;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;margin-bottom:20px}',
    '.card-header{background:#0f172a;padding:12px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8}',
    '.field{display:flex;border-bottom:1px solid rgba(255,255,255,0.06)}',
    '.field:last-child{border-bottom:none}',
    '.field:nth-child(even){background:rgba(255,255,255,0.02)}',
    '.field-label{width:210px;padding:11px 16px;color:#64748b;font-size:12px;flex-shrink:0}',
    '.field-value{padding:11px 16px;color:#f8fafc;font-size:12px;font-weight:600;word-break:break-all;flex:1}',
    '.ok{color:#22c55e}.err{color:#f87171}',
    '.not-found{text-align:center;padding:64px 20px}',
    '.not-found h2{font-size:18px;font-weight:700;margin-bottom:10px;color:#f8fafc}',
    '.not-found p{color:#94a3b8;font-size:13px;line-height:1.7;margin-top:8px}',
    'footer{text-align:center;padding:24px;color:#475569;font-size:11px;border-top:1px solid rgba(255,255,255,0.06);margin-top:32px}'
  ].join('');

  const htmlShell = (conteudo) =>
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>AUDITCARGO — Verificação de Autenticidade</title>` +
    `<style>${estilos}</style></head><body>` +
    `<header><div class="brand"><span class="audit">AUDIT</span><span class="cargo">CARGO</span></div>` +
    `<div class="subtitle">Verificação de Autenticidade de Documento</div></header>` +
    `<main>${conteudo}</main>` +
    `<footer>AUDITCARGO — Sistema de Auditoria Automática de Fretes</footer>` +
    `</body></html>`;

  if (!relatorio) {
    return htmlShell(
      `<div class="card"><div class="not-found">` +
      `<h2>Documento não localizado.</h2>` +
      `<p>O identificador informado não corresponde a nenhum documento registrado no sistema.</p>` +
      `<p>Documentos emitidos antes da implementação do sistema de autenticação não podem ser verificados por este canal.</p>` +
      `</div></div>`
    );
  }

  const integro = !!(relatorio.audit_hash && relatorio.data_emissao_relatorio && relatorio.versao_motor);
  const statusIntegridade = integro
    ? `<span class="ok">&#x1F7E2; Documento íntegro</span>`
    : `<span class="err">&#x1F534; Documento inconsistente</span>`;

  let dataEmissao = '—';
  try { dataEmissao = esc(new Date(relatorio.data_emissao_relatorio).toLocaleString('pt-BR')); } catch {}

  let fontesStr = '—';
  try {
    const fontes = JSON.parse(relatorio.fontes_utilizadas || '{}');
    const labels = { tabela_cliente: 'Tabela Contratual', melhor_envio: 'API Melhor Envio', fallback: 'Estimativa Interna' };
    const entries = Object.entries(fontes);
    if (entries.length > 0) {
      fontesStr = esc(entries.map(([k, v]) => `${labels[k] || k}: ${v} pedido(s)`).join(' | '));
    }
  } catch {}

  const totalPaginas = relatorio.total_paginas && relatorio.total_paginas > 0
    ? esc(String(relatorio.total_paginas)) : '—';

  const blocoStatus =
    `<div class="card"><div class="card-header">Status do Documento</div>` +
    `<div class="field"><span class="field-label">Situação da Integridade</span><span class="field-value">${statusIntegridade}</span></div>` +
    `<div class="field"><span class="field-label">Documento</span><span class="field-value ok">&#x2713; Documento encontrado</span></div>` +
    `</div>`;

  const blocoInfo =
    `<div class="card"><div class="card-header">Informações do Documento</div>` +
    `<div class="field"><span class="field-label">ID da Auditoria</span><span class="field-value">${esc(relatorio.audit_uuid)}</span></div>` +
    `<div class="field"><span class="field-label">Data de Emissão</span><span class="field-value">${dataEmissao}</span></div>` +
    `<div class="field"><span class="field-label">Versão AUDITCARGO</span><span class="field-value">v1.0.1</span></div>` +
    `<div class="field"><span class="field-label">Versão do Motor</span><span class="field-value">v${esc(relatorio.versao_motor || '—')}</span></div>` +
    `<div class="field"><span class="field-label">Pedidos Auditados</span><span class="field-value">${esc(relatorio.total_pedidos != null ? String(relatorio.total_pedidos) : '—')}</span></div>` +
    `<div class="field"><span class="field-label">Páginas do Documento</span><span class="field-value">${totalPaginas}</span></div>` +
    `<div class="field"><span class="field-label">Fontes Utilizadas</span><span class="field-value">${fontesStr}</span></div>` +
    `</div>`;

  const blocoHash =
    `<div class="card"><div class="card-header">Integridade Criptográfica</div>` +
    `<div class="field"><span class="field-label">Hash SHA-256</span><span class="field-value" style="font-family:monospace;font-size:10px">${esc(relatorio.audit_hash || '—')}</span></div>` +
    `</div>`;

  return htmlShell(blocoStatus + blocoInfo + blocoHash);
}

function gerarAuditUuid() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `AUD-${datePart}-${randomPart}`;
}

function gerarAuditHash(dados) {
  const payload = JSON.stringify({
    dataEmissao: dados.dataEmissao,
    totalGasto: dados.totalGasto,
    totalReal: dados.totalReal,
    economia: dados.economia,
    totalPedidos: dados.totalPedidos,
    pedidos: dados.pedidos.map(p => ({
      pedidoId: p.pedidoId,
      freteCobrado: p.freteCobrado,
      freteCorreto: p.freteCorreto,
      economia: p.economia,
      status: p.status,
      fonte_referencia: p.fonte_referencia,
      dataHora: p.dataHora
    }))
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

// POST /webhook
router.post('/webhook', async (req, res) => {
  try {
    const { pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado } = req.body;

    if (!pedidoId || !cepOrigem || !cepDestino || peso == null || freteCobrado == null) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: pedidoId, cepOrigem, cepDestino, peso, freteCobrado' });
    }

    const referencia = await calcularComReferencia({
      cepOrigem, cepDestino,
      peso: Number(peso),
      comprimento: Number(comprimento || 20),
      altura: Number(altura || 15),
      largura: Number(largura || 15)
    });
    const freteCorreto = referencia.freteReferencia;

    const economia = Math.max(0, Number(freteCobrado) - freteCorreto);
    const status = determinarStatus(Number(freteCobrado), freteCorreto);

    await db.run(
      `INSERT OR REPLACE INTO pedidos
        (pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status,
         fonte_referencia, nivel_confianca, versao_motor, observacao_auditoria)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [String(pedidoId), String(cepOrigem), String(cepDestino),
       Number(peso), Number(comprimento || 20), Number(altura || 15), Number(largura || 15),
       Number(freteCobrado), freteCorreto, economia, status,
       referencia.fonte, referencia.nivelConfianca, referencia.versao, referencia.observacao]
    );

    return res.json({
      success: true,
      economia: economia.toFixed(2),
      freteCorreto: freteCorreto.toFixed(2),
      status,
      message: 'Auditoria realizada com sucesso'
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar pedido' });
  }
});

// GET /api/resumo
router.get('/resumo', async (req, res) => {
  try {
    const row = await db.get(`
      SELECT
        SUM(freteCobrado) AS totalGasto,
        SUM(freteCorreto) AS totalReal,
        SUM(economia) AS economia,
        COUNT(*) AS totalPedidos
      FROM pedidos
    `);

    const totalGasto = row.totalGasto || 0;
    const totalReal = row.totalReal || 0;
    const economia = row.economia || 0;
    const porcentagem = totalGasto > 0 ? ((economia / totalGasto) * 100).toFixed(1) : '0.0';

    res.json({ totalGasto, totalReal, economia, porcentagem, totalPedidos: row.totalPedidos || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/grafico
router.get('/grafico', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        DATE(dataHora) AS data,
        SUM(freteCobrado) AS freteCobrado,
        SUM(freteCorreto) AS freteCorreto
      FROM pedidos
      WHERE dataHora >= DATE('now', '-14 days')
      GROUP BY DATE(dataHora)
      ORDER BY data ASC
    `);

    const resultado = [];
    for (let i = 14; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = rows.find(r => r.data === dateStr);
      resultado.push({
        data: dateStr,
        freteCobrado: found ? Number(found.freteCobrado) : 0,
        freteCorreto: found ? Number(found.freteCorreto) : 0
      });
    }

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos
router.get('/pedidos', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT id, pedidoId, freteCobrado, freteCorreto, economia, status, dataHora, enviado
      FROM pedidos
      ORDER BY dataHora DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/:id
router.get('/pedidos/:id', async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pedidos/:id/enviado
router.patch('/pedidos/:id/enviado', async (req, res) => {
  try {
    await db.run('UPDATE pedidos SET enviado = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function buildDadosRelatorio() {
  const resumo = await db.get(`SELECT SUM(freteCobrado) AS totalGasto, SUM(freteCorreto) AS totalReal, SUM(economia) AS economia, COUNT(*) AS totalPedidos FROM pedidos`);
  const pedidos = await db.all(`SELECT id, pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status, dataHora, fonte_referencia, nivel_confianca, versao_motor, observacao_auditoria FROM pedidos ORDER BY dataHora DESC`);
  const cfgRows = await db.all('SELECT chave, valor FROM config');
  const config = {};
  cfgRows.forEach(c => { config[c.chave] = c.valor; });

  const totalGasto = resumo.totalGasto || 0;
  const economia = resumo.economia || 0;

  const fonteContagem = {};
  let versaoMotor = '1.0';
  pedidos.forEach(p => {
    const f = p.fonte_referencia || 'fallback';
    fonteContagem[f] = (fonteContagem[f] || 0) + 1;
    if (p.versao_motor) versaoMotor = p.versao_motor;
  });

  const auditUuid = gerarAuditUuid();
  const dataEmissao = new Date().toISOString();

  const resultado = {
    totalGasto,
    totalReal: resumo.totalReal || 0,
    economia,
    porcentagem: totalGasto > 0 ? ((economia / totalGasto) * 100).toFixed(1) : '0.0',
    totalPedidos: resumo.totalPedidos || 0,
    pedidos,
    clienteNome: config.cliente_nome || 'Cliente',
    clienteEmail: config.cliente_email || '',
    empresaNome: config.empresa_nome || 'Empresa',
    motorInfo: { versao: versaoMotor, fonteContagem },
    auditUuid,
    dataEmissao
  };

  resultado.auditHash = gerarAuditHash(resultado);
  return resultado;
}

// GET /api/relatorio
router.get('/relatorio', async (req, res) => {
  try {
    res.json(await buildDadosRelatorio());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/relatorio/pdf
router.get('/relatorio/pdf', async (req, res) => {
  try {
    const dados = await buildDadosRelatorio();
    await db.run(
      `INSERT OR IGNORE INTO relatorios
        (audit_uuid, audit_hash, data_emissao_relatorio, total_pedidos, total_documentos, versao_motor, fontes_utilizadas, total_paginas)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        dados.auditUuid,
        dados.auditHash,
        dados.dataEmissao,
        dados.totalPedidos,
        dados.pedidos.length,
        dados.motorInfo.versao,
        JSON.stringify(dados.motorInfo.fonteContagem),
        0
      ]
    );
    const totalPaginas = await gerarRelatorioPDF(dados, res);
    try {
      if (totalPaginas > 0) {
        await db.run(
          'UPDATE relatorios SET total_paginas = ? WHERE audit_uuid = ?',
          [totalPaginas, dados.auditUuid]
        );
      }
    } catch (dbErr) {
      console.error('Aviso: falha ao atualizar total_paginas:', dbErr.message);
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /verify/:audit_uuid
router.get('/verify/:audit_uuid', async (req, res) => {
  try {
    const { audit_uuid } = req.params;
    if (!audit_uuid || !/^[A-Za-z0-9_\-]+$/.test(audit_uuid)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(gerarHtmlVerificacao(null, audit_uuid));
    }
    const relatorio = await db.get(
      'SELECT * FROM relatorios WHERE audit_uuid = ?',
      [audit_uuid]
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(gerarHtmlVerificacao(relatorio || null, audit_uuid));
  } catch (err) {
    console.error('Verify route error:', err.message);
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(gerarHtmlVerificacao(null, req.params.audit_uuid));
  }
});

// GET /api/config
router.get('/config', async (req, res) => {
  try {
    const rows = await db.all('SELECT chave, valor FROM config');
    const config = {};
    rows.forEach(r => { config[r.chave] = r.valor; });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config
router.post('/config', async (req, res) => {
  try {
    const { cliente_nome, cliente_email, empresa_nome } = req.body;
    if (cliente_nome !== undefined) await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['cliente_nome', cliente_nome]);
    if (cliente_email !== undefined) await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['cliente_email', cliente_email]);
    if (empresa_nome !== undefined) await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['empresa_nome', empresa_nome]);
    res.json({ success: true, message: 'Configurações salvas' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seed
router.post('/seed', async (req, res) => {
  try {
    const exemplos = [
      { pedidoId: 'PED-001', cepOrigem: '01310100', cepDestino: '20040020', peso: 2.5, comprimento: 30, altura: 20, largura: 20, freteCobrado: 45.90 },
      { pedidoId: 'PED-002', cepOrigem: '01310100', cepDestino: '30130010', peso: 0.8, comprimento: 20, altura: 10, largura: 10, freteCobrado: 28.50 },
      { pedidoId: 'PED-003', cepOrigem: '01310100', cepDestino: '40020010', peso: 5.0, comprimento: 40, altura: 30, largura: 25, freteCobrado: 89.00 },
      { pedidoId: 'PED-004', cepOrigem: '01310100', cepDestino: '60175050', peso: 1.2, comprimento: 25, altura: 15, largura: 15, freteCobrado: 52.30 },
      { pedidoId: 'PED-005', cepOrigem: '01310100', cepDestino: '70040010', peso: 3.0, comprimento: 35, altura: 25, largura: 20, freteCobrado: 67.80 },
      { pedidoId: 'PED-006', cepOrigem: '01310100', cepDestino: '80010010', peso: 0.5, comprimento: 15, altura: 10, largura: 10, freteCobrado: 22.40 },
      { pedidoId: 'PED-007', cepOrigem: '01310100', cepDestino: '90010020', peso: 4.5, comprimento: 40, altura: 30, largura: 30, freteCobrado: 95.60 },
      { pedidoId: 'PED-008', cepOrigem: '01310100', cepDestino: '20040020', peso: 1.8, comprimento: 28, altura: 18, largura: 18, freteCobrado: 38.20 },
      { pedidoId: 'PED-009', cepOrigem: '01310100', cepDestino: '30130010', peso: 6.0, comprimento: 45, altura: 35, largura: 30, freteCobrado: 112.00 },
      { pedidoId: 'PED-010', cepOrigem: '01310100', cepDestino: '40020010', peso: 0.3, comprimento: 15, altura: 10, largura: 8, freteCobrado: 18.90 },
    ];

    let inseridos = 0;
    for (const ex of exemplos) {
      const freteCorreto = calcularFrete(ex);
      const economia = Math.max(0, ex.freteCobrado - freteCorreto);
      const status = determinarStatus(ex.freteCobrado, freteCorreto);
      const diasAtras = Math.floor(Math.random() * 14);
      const horasAtras = Math.floor(Math.random() * 23);
      const dataHora = new Date(Date.now() - diasAtras * 86400000 - horasAtras * 3600000).toISOString().replace('T', ' ').split('.')[0];

      try {
        await db.run(
          `INSERT OR IGNORE INTO pedidos
            (pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status, dataHora)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ex.pedidoId, ex.cepOrigem, ex.cepDestino, ex.peso, ex.comprimento, ex.altura, ex.largura,
           ex.freteCobrado, freteCorreto, economia, status, dataHora]
        );
        inseridos++;
      } catch {}
    }

    res.json({ success: true, message: `${inseridos} pedidos de exemplo inseridos` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
