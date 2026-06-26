const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { calcularFrete, determinarStatus } = require('../services/freteCalculator');
const { gerarRelatorioPDF } = require('../services/relatorioGenerator');

// POST /webhook
router.post('/webhook', async (req, res) => {
  try {
    const { pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado } = req.body;

    if (!pedidoId || !cepOrigem || !cepDestino || peso == null || freteCobrado == null) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: pedidoId, cepOrigem, cepDestino, peso, freteCobrado' });
    }

    const freteCorreto = calcularFrete({
      cepOrigem, cepDestino,
      peso: Number(peso),
      comprimento: Number(comprimento || 20),
      altura: Number(altura || 15),
      largura: Number(largura || 15)
    });

    const economia = Math.max(0, Number(freteCobrado) - freteCorreto);
    const status = determinarStatus(Number(freteCobrado), freteCorreto);

    await db.run(
      `INSERT OR REPLACE INTO pedidos
        (pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [String(pedidoId), String(cepOrigem), String(cepDestino),
       Number(peso), Number(comprimento || 20), Number(altura || 15), Number(largura || 15),
       Number(freteCobrado), freteCorreto, economia, status]
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
  const pedidos = await db.all(`SELECT pedidoId, freteCobrado, freteCorreto, economia, status, dataHora FROM pedidos ORDER BY dataHora DESC`);
  const cfgRows = await db.all('SELECT chave, valor FROM config');
  const config = {};
  cfgRows.forEach(c => { config[c.chave] = c.valor; });

  const totalGasto = resumo.totalGasto || 0;
  const economia = resumo.economia || 0;

  return {
    totalGasto,
    totalReal: resumo.totalReal || 0,
    economia,
    porcentagem: totalGasto > 0 ? ((economia / totalGasto) * 100).toFixed(1) : '0.0',
    totalPedidos: resumo.totalPedidos || 0,
    pedidos,
    clienteNome: config.cliente_nome || 'Cliente',
    clienteEmail: config.cliente_email || '',
    empresaNome: config.empresa_nome || 'Empresa'
  };
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
    gerarRelatorioPDF(await buildDadosRelatorio(), res);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
