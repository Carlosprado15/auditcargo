const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../services/database');
const { extractFreteData } = require('../services/documentParser');
const { determinarStatus } = require('../services/freteCalculator');
const { calcularComReferencia } = require('../services/referenceEngine');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG ou PNG.'));
  }
});

// POST /api/upload — fluxo: Documento → OCR → IA → JSON → Auditoria
router.post('/upload', upload.single('documento'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' });
  }

  let dados;
  try {
    dados = await extractFreteData(req.file.buffer, req.file.mimetype);
  } catch (e) {
    return res.status(422).json({ error: `Falha na extração: ${e.message}` });
  }

  const freteCobrado = Number(dados.valorCobrado);
  const cepO = dados.cepOrigem ? String(dados.cepOrigem).replace(/\D/g, '') : null;
  const cepD = dados.cepDestino ? String(dados.cepDestino).replace(/\D/g, '') : null;
  const peso = Number(dados.peso);

  const camposFaltando = [];
  if (!cepO || cepO.length !== 8) camposFaltando.push('CEP de origem');
  if (!cepD || cepD.length !== 8) camposFaltando.push('CEP de destino');
  if (!peso || peso <= 0) camposFaltando.push('peso');
  if (!freteCobrado || freteCobrado <= 0) camposFaltando.push('valor cobrado');

  if (camposFaltando.length) {
    return res.status(422).json({
      error: `IA não conseguiu extrair: ${camposFaltando.join(', ')}`,
      dadosExtraidos: dados
    });
  }

  const comprimento = Number(dados.comprimento || 20);
  const altura = Number(dados.altura || 15);
  const largura = Number(dados.largura || 15);

  const referencia = await calcularComReferencia({ cepOrigem: cepO, cepDestino: cepD, peso, comprimento, altura, largura });
  const freteCorreto = referencia.freteReferencia;
  const economia = Math.max(0, freteCobrado - freteCorreto);
  const status = determinarStatus(freteCobrado, freteCorreto);
  const pedidoId = `BOLETO-${Date.now()}`;
  const observacao = dados.transportadora ? `Transportadora: ${dados.transportadora}` : null;

  await db.run(
    `INSERT OR REPLACE INTO pedidos
      (pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status, observacao,
       fonte_referencia, nivel_confianca, versao_motor, observacao_auditoria)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [pedidoId, cepO, cepD, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status, observacao,
     referencia.fonte, referencia.nivelConfianca, referencia.versao, referencia.observacao]
  );

  res.json({
    success: true,
    pedidoId,
    dadosExtraidos: dados,
    freteCorreto: Number(freteCorreto.toFixed(2)),
    freteCobrado: Number(freteCobrado.toFixed(2)),
    economia: Number(economia.toFixed(2)),
    status
  });
});

module.exports = router;
