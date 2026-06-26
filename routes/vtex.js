const express = require('express');
const router = express.Router();
const db = require('../services/database');
const vtex = require('../services/vtexService');

// POST /api/vtex/validate-store
router.post('/validate-store', async (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ error: 'Nome da loja obrigatório' });
  const result = await vtex.validateStore(account.trim().toLowerCase());
  res.json(result);
});

// POST /api/vtex/connect — valida credenciais e inicia sync
router.post('/connect', async (req, res) => {
  const { account, appKey, appToken, originCep } = req.body;
  if (!account || !appKey || !appToken) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const validation = await vtex.validateCredentials(account, appKey, appToken);
  if (!validation.valid) {
    return res.status(401).json({ error: validation.error });
  }

  const cep = (originCep || '01310100').replace(/\D/g, '');

  const pairs = [
    ['vtex_account', account],
    ['vtex_appkey', appKey],
    ['vtex_apptoken', appToken],
    ['vtex_origin_cep', cep],
    ['vtex_connected', 'true'],
    ['vtex_synced_count', '0'],
    ['vtex_last_sync', new Date().toISOString()],
    ['vtex_order_count', String(validation.orderCount)],
  ];
  for (const [k, v] of pairs) {
    await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', [k, v]);
  }

  // Sync em background — não bloqueia o response
  vtex.syncOrders(account, appKey, appToken, cep, 100)
    .then(async ({ synced }) => {
      await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['vtex_synced_count', String(synced)]);
      await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['vtex_last_sync', new Date().toISOString()]);
    })
    .catch(() => {});

  res.json({
    success: true,
    message: 'Conectado! Sincronizando pedidos em segundo plano...',
    orderCount: validation.orderCount
  });
});

// GET /api/vtex/status
router.get('/status', async (req, res) => {
  const rows = await db.all("SELECT chave, valor FROM config WHERE chave LIKE 'vtex_%'");
  const cfg = {};
  rows.forEach(r => { cfg[r.chave] = r.valor; });

  res.json({
    connected: cfg.vtex_connected === 'true',
    account: cfg.vtex_account || null,
    lastSync: cfg.vtex_last_sync || null,
    syncedCount: parseInt(cfg.vtex_synced_count || '0'),
    orderCount: parseInt(cfg.vtex_order_count || '0'),
  });
});

// POST /api/vtex/sync — sync manual
router.post('/sync', async (req, res) => {
  const rows = await db.all("SELECT chave, valor FROM config WHERE chave LIKE 'vtex_%'");
  const cfg = {};
  rows.forEach(r => { cfg[r.chave] = r.valor; });

  if (cfg.vtex_connected !== 'true') {
    return res.status(400).json({ error: 'VTEX não conectada' });
  }

  try {
    const { synced } = await vtex.syncOrders(cfg.vtex_account, cfg.vtex_appkey, cfg.vtex_apptoken, cfg.vtex_origin_cep, 100);
    await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['vtex_synced_count', String(synced)]);
    await db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)', ['vtex_last_sync', new Date().toISOString()]);
    res.json({ success: true, synced });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/vtex/disconnect
router.delete('/disconnect', async (req, res) => {
  const keys = ['vtex_account', 'vtex_appkey', 'vtex_apptoken', 'vtex_connected', 'vtex_last_sync', 'vtex_synced_count', 'vtex_origin_cep', 'vtex_order_count'];
  for (const k of keys) {
    await db.run('DELETE FROM config WHERE chave = ?', [k]);
  }
  res.json({ success: true });
});

module.exports = router;
