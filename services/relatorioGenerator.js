const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { gerarAuditEvidence } = require('./auditEvidence');

const FOOTER_LINE_Y = 807;
const FOOTER_TEXT_Y = 813;
const QR_X = 505;
const QR_Y = 768;
const QR_SIZE = 35;

function getVerifyUrl(auditUuid) {
  const base = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  return `${base}/verify/${auditUuid}`;
}

// ── Rodapé permanente (todas as páginas) ──────────────────────────────────────
function adicionarRodape(doc, { auditUuid, versaoMotor, dataEmissaoStr, pageNum, totalPages, qrImageBuffer }) {
  doc.moveTo(50, FOOTER_LINE_Y).lineTo(545, FOOTER_LINE_Y)
    .strokeColor('#cbd5e1').lineWidth(0.3).stroke();
  doc.fontSize(6).fillColor('#94a3b8').font('Helvetica');
  doc.text(
    `AUDITCARGO  |  Motor v${versaoMotor}  |  ${auditUuid}  |  Emitido em: ${dataEmissaoStr}`,
    50, FOOTER_TEXT_Y, { width: 370, lineBreak: false }
  );
  doc.fontSize(6).fillColor('#94a3b8').font('Helvetica');
  doc.text(
    `Página ${pageNum} de ${totalPages}`,
    420, FOOTER_TEXT_Y, { width: 125, align: 'right', lineBreak: false }
  );
  if (qrImageBuffer) {
    doc.image(qrImageBuffer, QR_X, QR_Y, { width: QR_SIZE });
  }
}

// ── Geração principal do PDF ──────────────────────────────────────────────────
async function gerarRelatorioPDF(dados, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

  const auditUuid = dados.auditUuid || 'AUD-DESCONHECIDO';
  const versaoMotor = (dados.motorInfo || {}).versao || '1.0';
  const dataEmissaoStr = dados.dataEmissao
    ? new Date(dados.dataEmissao).toLocaleString('pt-BR')
    : new Date().toLocaleString('pt-BR');
  const auditHash = dados.auditHash || '—';

  let qrImageBuffer = null;
  try {
    qrImageBuffer = await QRCode.toBuffer(getVerifyUrl(auditUuid), { width: 140, margin: 1 });
  } catch {}

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-glosa-${Date.now()}.pdf"`);
  doc.pipe(res);

  // ── Cabeçalho da primeira página ─────────────────────────────────────────
  doc.rect(0, 0, 595, 120).fill('#0f172a');

  doc.fontSize(28).fillColor('#2563eb').font('Helvetica-Bold');
  doc.text('AUDIT', 50, 40, { continued: true });
  doc.fillColor('#f59e0b').text('CARGO');

  doc.fontSize(11).fillColor('#94a3b8').font('Helvetica');
  doc.text('Auditor Automático de Fretes', 50, 75);

  doc.fontSize(13).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('RELATÓRIO DE GLOSA', 350, 38);
  doc.fontSize(9).fillColor('#94a3b8').font('Helvetica');
  doc.text(`Gerado em: ${dataEmissaoStr}`, 350, 57);
  doc.text(`Cliente: ${dados.clienteNome}`, 350, 71);
  doc.text(`Empresa: ${dados.empresaNome}`, 350, 85);
  doc.fontSize(7.5).fillColor('#f59e0b').font('Helvetica-Bold');
  doc.text(`ID da Auditoria: ${auditUuid}`, 350, 101);

  doc.fillColor('#0f172a');
  doc.moveTo(50, 135).lineTo(545, 135).strokeColor('#e2e8f0').stroke();

  // ── Resumo executivo ──────────────────────────────────────────────────────
  doc.y = 150;
  doc.fontSize(14).fillColor('#1e293b').font('Helvetica-Bold').text('Resumo Executivo', 50);
  doc.moveDown(0.5);

  const resumoExecY = doc.y;
  const cardW = 155;
  const cardH = 65;
  const gap = 8;

  desenharCard(doc, 50, resumoExecY, cardW, cardH, '#fff7ed', '#f59e0b', 'TOTAL COBRADO', `R$ ${formatarMoeda(dados.totalGasto)}`);
  desenharCard(doc, 50 + cardW + gap, resumoExecY, cardW, cardH, '#f0fdf4', '#16a34a', 'VALOR CORRETO', `R$ ${formatarMoeda(dados.totalReal)}`);
  desenharCard(doc, 50 + (cardW + gap) * 2, resumoExecY, cardW, cardH, '#eff6ff', '#2563eb', 'ECONOMIA TOTAL', `R$ ${formatarMoeda(dados.economia)}`);

  doc.y = resumoExecY + cardH + 20;

  doc.fontSize(10).fillColor('#64748b').font('Helvetica');
  doc.text(
    `Percentual de economia: ${dados.porcentagem}%  |  Total de pedidos auditados: ${dados.totalPedidos}`,
    50, doc.y, { align: 'center', width: 495 }
  );

  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  // ── Motor de Referência ───────────────────────────────────────────────────
  doc.fontSize(11).fillColor('#1e293b').font('Helvetica-Bold').text('Motor de Referência', 50);
  doc.moveDown(0.4);

  const motorInfo = dados.motorInfo || { versao: '1.0', fonteContagem: {} };
  const fonteLabels = { tabela_cliente: 'Tabela Contratada', melhor_envio: 'API Melhor Envio', fallback: 'Estimativa Interna' };
  const fonteEntradas = Object.entries(motorInfo.fonteContagem);
  const fonteTexto = fonteEntradas.length
    ? fonteEntradas.map(([k, v]) => `${fonteLabels[k] || k}: ${v} pedido(s)`).join('  |  ')
    : 'Nenhum pedido auditado';
  doc.fontSize(9).fillColor('#64748b').font('Helvetica');
  doc.text(`Versão: ${motorInfo.versao}  |  Fontes utilizadas: ${fonteTexto}`, 50, doc.y, { width: 495 });
  doc.moveDown(1.5);

  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  // ── Detalhamento dos Pedidos ──────────────────────────────────────────────
  doc.fontSize(14).fillColor('#1e293b').font('Helvetica-Bold').text('Detalhamento dos Pedidos', 50);
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const cols = [50, 140, 255, 360, 455];
  const colWidths = [85, 110, 100, 90, 90];
  const headers = ['Pedido ID', 'Frete Cobrado', 'Frete Correto', 'Economia', 'Status'];

  doc.rect(50, tableTop, 495, 22).fill('#1e293b');
  doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, cols[i] + 4, tableTop + 7, { width: colWidths[i] - 8 });
  });

  let rowY = tableTop + 22;
  dados.pedidos.forEach((p, idx) => {
    if (rowY > 700) {
      doc.addPage();
      rowY = 50;
    }

    const bgColor = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
    doc.rect(50, rowY, 495, 20).fill(bgColor);

    doc.fontSize(8).fillColor('#334155').font('Helvetica');
    doc.text(String(p.pedidoId).substring(0, 14), cols[0] + 4, rowY + 6, { width: colWidths[0] - 8 });
    doc.text(`R$ ${formatarMoeda(p.freteCobrado)}`, cols[1] + 4, rowY + 6, { width: colWidths[1] - 8 });
    doc.text(`R$ ${formatarMoeda(p.freteCorreto)}`, cols[2] + 4, rowY + 6, { width: colWidths[2] - 8 });

    doc.fillColor(p.economia > 0 ? '#16a34a' : '#64748b').font('Helvetica-Bold');
    doc.text(`R$ ${formatarMoeda(p.economia)}`, cols[3] + 4, rowY + 6, { width: colWidths[3] - 8 });

    doc.fillColor('#334155').font('Helvetica');
    const statusText = p.status === 'correto' ? 'Correto' : p.status === 'cobrado_a_mais' ? 'Cobrado a mais' : 'Economia';
    doc.text(statusText, cols[4] + 4, rowY + 6, { width: colWidths[4] - 8 });

    doc.moveTo(50, rowY + 20).lineTo(545, rowY + 20).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    rowY += 20;
  });

  rowY += 10;
  doc.rect(50, rowY, 495, 28).fill('#0f172a');
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('TOTAL A GLOSAR:', cols[0] + 4, rowY + 8, { width: 350 });
  doc.fillColor('#f59e0b');
  doc.text(`R$ ${formatarMoeda(dados.economia)}`, cols[3] + 4, rowY + 8, { width: 185 });

  const footerY = Math.max(rowY + 60, 720);
  doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.fontSize(9).fillColor('#64748b').font('Helvetica');
  doc.text(
    'Envie este relatório para sua transportadora solicitando reembolso ou abatimento na próxima fatura.',
    50, footerY + 8, { align: 'center', width: 495 }
  );
  doc.text(
    'AUDITCARGO — Auditoria Inteligente de Fretes',
    50, footerY + 22, { align: 'center', width: 495 }
  );

  // ── Dossiê Técnico ────────────────────────────────────────────────────────
  if (dados.pedidos && dados.pedidos.length > 0) {
    renderizarDossies(doc, dados.pedidos);
  }

  // ── Resumo Técnico de Integridade ─────────────────────────────────────────
  doc.addPage();
  const resumoPageIdx = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
  const paginasPlaceholder = renderizarResumoIntegridade(doc, dados, auditHash, dataEmissaoStr, versaoMotor);

  // ── Natureza Técnica do Relatório ─────────────────────────────────────────
  doc.addPage();
  renderizarNaturezaTecnica(doc);

  // ── Rodapés: calcular total e aplicar em todas as páginas ─────────────────
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  // Substituir placeholder de quantidade de páginas no Resumo de Integridade
  doc.switchToPage(resumoPageIdx);
  doc.rect(paginasPlaceholder.x, paginasPlaceholder.y, 200, 12).fill('#f8fafc');
  doc.fontSize(7.5).fillColor('#1e293b').font('Helvetica-Bold');
  doc.text(String(totalPages), paginasPlaceholder.x, paginasPlaceholder.y + 1, { width: 200, lineBreak: false });

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    adicionarRodape(doc, { auditUuid, versaoMotor, dataEmissaoStr, pageNum: i + 1, totalPages, qrImageBuffer });
  }

  doc.flushPages();
  doc.end();
  return totalPages;
}

// ── Resumo Técnico de Integridade ─────────────────────────────────────────────
function renderizarResumoIntegridade(doc, dados, auditHash, dataEmissaoStr, versaoMotor) {
  const x = 50;
  const w = 495;

  doc.rect(0, 0, 595, 90).fill('#0f172a');
  doc.fontSize(20).fillColor('#2563eb').font('Helvetica-Bold');
  doc.text('AUDIT', 50, 28, { continued: true });
  doc.fillColor('#f59e0b').text('CARGO');
  doc.fontSize(10).fillColor('#94a3b8').font('Helvetica');
  doc.text('Resumo Técnico de Integridade', 50, 55);
  doc.fillColor('#0f172a');
  doc.y = 108;

  const titleY = doc.y;
  doc.rect(x, titleY, w, 22).fill('#1e293b');
  doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('RESUMO TÉCNICO DE INTEGRIDADE', x + 8, titleY + 7, { width: w - 16 });
  doc.y = titleY + 30;

  const motorInfo = dados.motorInfo || { versao: versaoMotor, fonteContagem: {} };
  const fonteLabels = {
    tabela_cliente: 'Tabela Contratual',
    melhor_envio: 'API Melhor Envio',
    fallback: 'Estimativa Interna (Fallback)'
  };
  const fonteEntradas = Object.entries(motorInfo.fonteContagem);
  const fontesTexto = fonteEntradas.length
    ? fonteEntradas.map(([k, v]) => `${fonteLabels[k] || k}: ${v}`).join('  |  ')
    : 'Nenhum';

  const labelX = x + 8;
  const valorX = x + 222;
  let paginasPlaceholder = { x: valorX, y: 0 };

  const campos = [
    { label: 'Versão do Motor de Auditoria', valor: `v${versaoMotor}` },
    { label: 'Data/Hora de Emissão', valor: dataEmissaoStr },
    { label: 'Quantidade de Páginas', valor: null },
    { label: 'Documentos Analisados', valor: String(dados.pedidos.length) },
    { label: 'Pedidos Auditados', valor: String(dados.totalPedidos) },
    { label: 'Fontes Utilizadas', valor: fontesTexto },
  ];

  campos.forEach((campo, idx) => {
    const rowY = doc.y;
    doc.rect(x, rowY, w, 18).fill(idx % 2 === 0 ? '#f8fafc' : '#ffffff');
    doc.fontSize(7.5).fillColor('#64748b').font('Helvetica');
    doc.text(campo.label + ':', labelX, rowY + 5, { width: 200, lineBreak: false });
    if (campo.valor === null) {
      paginasPlaceholder = { x: valorX, y: rowY + 5 };
      doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica');
      doc.text('—', valorX, rowY + 5, { width: w - valorX + x - 8, lineBreak: false });
    } else {
      doc.fontSize(7.5).fillColor('#1e293b').font('Helvetica-Bold');
      doc.text(campo.valor, valorX, rowY + 5, { width: w - valorX + x - 8, lineBreak: false });
    }
    doc.y = rowY + 18;
  });

  doc.moveDown(1);
  const hashBoxY = doc.y;
  doc.rect(x, hashBoxY, w, 50).fill('#0f172a');
  doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica');
  doc.text('HASH SHA-256 DO CONTEÚDO DA AUDITORIA:', x + 8, hashBoxY + 7, { width: w - 16, lineBreak: false });
  doc.fontSize(7).fillColor('#f59e0b').font('Helvetica-Bold');
  doc.text(auditHash, x + 8, hashBoxY + 20, { width: w - 16, lineBreak: false });
  doc.fontSize(6.5).fillColor('#64748b').font('Helvetica');
  doc.text('calculado sobre os dados antes da geração do PDF', x + 8, hashBoxY + 35, { width: w - 16, lineBreak: false });
  doc.y = hashBoxY + 56;

  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.moveDown(0.8);

  doc.fontSize(7).fillColor('#64748b').font('Helvetica');
  doc.text(
    'O hash SHA-256 acima foi calculado sobre os dados desta auditoria antes da geração final do PDF. ' +
    'Ele permite verificar futuramente se as informações registradas permaneceram íntegras após a emissão. ' +
    'O identificador único desta auditoria e o hash foram armazenados no banco de dados do sistema.',
    x, doc.y, { width: w, lineGap: 1.5 }
  );

  return paginasPlaceholder;
}

// ── Natureza Técnica do Relatório ─────────────────────────────────────────────
function renderizarNaturezaTecnica(doc) {
  const x = 50;
  const w = 495;

  doc.rect(0, 0, 595, 90).fill('#0f172a');
  doc.fontSize(20).fillColor('#2563eb').font('Helvetica-Bold');
  doc.text('AUDIT', 50, 28, { continued: true });
  doc.fillColor('#f59e0b').text('CARGO');
  doc.fontSize(10).fillColor('#94a3b8').font('Helvetica');
  doc.text('Natureza Técnica do Relatório', 50, 55);
  doc.fillColor('#0f172a');
  doc.y = 108;

  const titleY = doc.y;
  doc.rect(x, titleY, w, 22).fill('#1e293b');
  doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('NATUREZA TÉCNICA DO RELATÓRIO', x + 8, titleY + 7, { width: w - 16 });
  doc.y = titleY + 32;

  doc.fontSize(8.5).fillColor('#334155').font('Helvetica');

  doc.text(
    'Este relatório foi gerado automaticamente pelo AUDITCARGO com base nos documentos, informações ' +
    'e referências disponíveis no momento da auditoria.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(0.7);

  doc.text(
    'Sua finalidade é apoiar tecnicamente a conferência de cobranças de frete, registrando de forma ' +
    'rastreável os critérios utilizados na análise e as divergências eventualmente identificadas.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(0.7);

  doc.text(
    'As conclusões apresentadas dependem da integridade dos documentos analisados, da vigência das ' +
    'tabelas contratuais utilizadas, das informações fornecidas pelos serviços externos consultados e ' +
    'das condições comerciais efetivamente pactuadas entre as partes.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(0.7);

  doc.text(
    'Este documento constitui um relatório técnico de auditoria destinado a subsidiar análises internas, ' +
    'processos administrativos de conferência e procedimentos de contestação de cobranças.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(1.2);

  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.moveDown(0.8);

  doc.text(
    'O AUDITCARGO não substitui contratos, documentos fiscais, conhecimentos de transporte, normas ' +
    'legais, perícias oficiais, pareceres técnicos especializados ou decisões administrativas e judiciais.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(0.7);

  doc.text(
    'Em eventual divergência entre este relatório e documentos contratuais ou determinações legais, ' +
    'prevalecerão os instrumentos jurídicos aplicáveis e as decisões das autoridades competentes.',
    x, doc.y, { width: w, lineGap: 2 }
  );
  doc.moveDown(1.5);

  const avisoY = doc.y;
  const avisoH = 38;
  doc.rect(x, avisoY, w, avisoH).fill('#fff7ed');
  doc.rect(x, avisoY, 4, avisoH).fill('#f59e0b');
  doc.fontSize(7.5).fillColor('#92400e').font('Helvetica-Bold');
  doc.text(
    'AUDITCARGO — Sistema de Auditoria Automática de Fretes',
    x + 12, avisoY + 7, { width: w - 20, lineBreak: false }
  );
  doc.fontSize(7).fillColor('#78350f').font('Helvetica');
  doc.text(
    'Este documento é um relatório técnico gerado automaticamente e possui identificador único rastreável.',
    x + 12, avisoY + 21, { width: w - 20, lineBreak: false }
  );
  doc.y = avisoY + avisoH + 4;
}

// ── Dossiê Técnico ────────────────────────────────────────────────────────────
function renderizarDossies(doc, pedidos) {
  doc.addPage();

  doc.rect(0, 0, 595, 90).fill('#0f172a');
  doc.fontSize(22).fillColor('#2563eb').font('Helvetica-Bold');
  doc.text('AUDIT', 50, 28, { continued: true });
  doc.fillColor('#f59e0b').text('CARGO');
  doc.fontSize(10).fillColor('#94a3b8').font('Helvetica');
  doc.text('Dossiê Técnico de Auditoria', 50, 58);
  doc.fontSize(8).fillColor('#64748b').font('Helvetica');
  doc.text(
    `${pedidos.length} registro(s)  |  Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    300, 60, { width: 245 }
  );

  doc.fillColor('#0f172a');
  doc.y = 108;

  pedidos.forEach((pedido, idx) => {
    const evidence = gerarAuditEvidence(pedido);
    renderizarDossie(doc, evidence, idx + 1);
  });
}

function renderizarDossie(doc, ev, numero) {
  if (doc.y > 580) {
    doc.addPage();
    doc.y = 50;
  }

  const x = 50;
  const w = 495;
  const halfW = Math.floor(w / 2);

  // Cabeçalho do dossiê
  const headerY = doc.y;
  doc.rect(x, headerY, w, 20).fill('#1e293b');
  doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica');
  doc.text(`DOSSIÊ #${String(numero).padStart(3, '0')}  `, x + 5, headerY + 6, { continued: true });
  doc.fillColor('#f59e0b').font('Helvetica-Bold');
  doc.text(`${ev.documentoAnalisado.nome}  `, { continued: true });
  doc.fillColor('#64748b').font('Helvetica');
  doc.text(
    `${ev.referenciaUtilizada.label}  |  Confiança: ${ev.referenciaUtilizada.nivelConfianca}`,
    { width: w - 12 }
  );
  doc.y = headerY + 24;

  // Documento Analisado
  renderizarMiniTitulo(doc, x, 'DOCUMENTO ANALISADO');
  renderizarLinhaDupla(doc, x, w, halfW,
    'Origem', ev.documentoAnalisado.origem,
    'Data da Análise', formatarDataHora(ev.documentoAnalisado.dataAnalise)
  );

  // Dados Extraídos
  renderizarMiniTitulo(doc, x, 'DADOS EXTRAÍDOS');
  renderizarLinhaDupla(doc, x, w, halfW,
    'Transportadora', ev.dadosExtraidos.transportadora,
    'Valor Cobrado', `R$ ${formatarMoeda(ev.dadosExtraidos.valorCobrado)}`
  );
  renderizarLinhaDupla(doc, x, w, halfW,
    'CEP Origem', formatarCep(ev.dadosExtraidos.cepOrigem),
    'CEP Destino', formatarCep(ev.dadosExtraidos.cepDestino)
  );
  renderizarLinhaDupla(doc, x, w, halfW,
    'Peso', `${ev.dadosExtraidos.peso != null ? ev.dadosExtraidos.peso : '—'} kg`,
    'Dimensões',
    (ev.dadosExtraidos.comprimento || ev.dadosExtraidos.altura || ev.dadosExtraidos.largura)
      ? `${ev.dadosExtraidos.comprimento || '—'} x ${ev.dadosExtraidos.altura || '—'} x ${ev.dadosExtraidos.largura || '—'} cm`
      : '—'
  );

  // Resultado Encontrado
  renderizarMiniTitulo(doc, x, 'RESULTADO ENCONTRADO');
  renderizarLinhaDupla(doc, x, w, halfW,
    'Valor Cobrado', `R$ ${formatarMoeda(ev.resultadoEncontrado.valorCobrado)}`,
    'Valor de Referência', `R$ ${formatarMoeda(ev.resultadoEncontrado.valorReferencia)}`
  );

  const diff = ev.resultadoEncontrado.diferenca;
  const pct = ev.resultadoEncontrado.percentual;
  const diffStr = diff > 0
    ? `R$ ${formatarMoeda(diff)} a mais cobrado (${pct}%)`
    : `R$ 0,00 — valor correto (${pct}%)`;
  const diffColor = diff > 0 ? '#dc2626' : '#16a34a';

  const diffY = doc.y;
  doc.rect(x, diffY, w, 14).fill('#f8fafc');
  doc.fontSize(7).fillColor('#64748b').font('Helvetica-Bold').text('Diferença:  ', x + 5, diffY + 4, { continued: true });
  doc.font('Helvetica').fillColor(diffColor).text(diffStr);
  doc.y = diffY + 16;

  // Fundamentação
  if (doc.y > 620) { doc.addPage(); doc.y = 50; }
  renderizarMiniTitulo(doc, x, 'FUNDAMENTAÇÃO');
  doc.fontSize(7.5).fillColor('#334155').font('Helvetica');
  doc.text(ev.fundamentacao, x, doc.y, { width: w, lineGap: 1 });
  doc.moveDown(0.4);

  // Rastreabilidade
  renderizarMiniTitulo(doc, x, 'RASTREABILIDADE');
  const rastY = doc.y;
  doc.fontSize(7).fillColor('#64748b').font('Helvetica-Bold').text('Versão Motor:', x, rastY, { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.versaoMotor}    `, { continued: true });
  doc.fillColor('#64748b').font('Helvetica-Bold').text('ID:', { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.identificacaoAuditoria}    `, { continued: true });
  doc.fillColor('#64748b').font('Helvetica-Bold').text('Fonte:', { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.origemDados}`, { width: w });
  doc.moveDown(0.3);

  // Transparência da Fonte
  if (ev.observacoes) {
    renderizarTransparenciaFonte(doc, ev, x, w);
  }

  // Separador
  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.y += 8;
}

// Exibe a origem da referência com destaque visual por tipo de fonte
function renderizarTransparenciaFonte(doc, ev, x, w) {
  const fonte = ev.referenciaUtilizada.tipo;
  const obsText = ev.observacoes;
  const obsY = doc.y;

  if (fonte === 'fallback') {
    doc.fontSize(6.5).font('Helvetica');
    const bodyH = doc.heightOfString(obsText, { width: w - 16 });
    const boxH = bodyH + 24;
    doc.rect(x, obsY, w, boxH).fill('#fffbeb');
    doc.rect(x, obsY, 3, boxH).fill('#f59e0b');
    doc.fontSize(6.5).fillColor('#92400e').font('Helvetica-Bold');
    doc.text('ATENÇÃO — Estimativa Interna (Fallback):', x + 8, obsY + 5, { width: w - 16, lineBreak: false });
    doc.fontSize(6.5).fillColor('#78350f').font('Helvetica');
    doc.text(obsText, x + 8, obsY + 15, { width: w - 16, lineGap: 1 });
    doc.y = Math.max(doc.y, obsY + boxH) + 4;
  } else if (fonte === 'tabela_cliente') {
    doc.fontSize(7).font('Helvetica');
    const bodyH = doc.heightOfString(obsText, { width: w - 16 });
    const boxH = bodyH + 14;
    doc.rect(x, obsY, w, boxH).fill('#f0fdf4');
    doc.rect(x, obsY, 3, boxH).fill('#16a34a');
    doc.fontSize(7).fillColor('#15803d').font('Helvetica-Bold');
    doc.text(obsText, x + 8, obsY + 4, { width: w - 16, lineGap: 1 });
    doc.y = Math.max(doc.y, obsY + boxH) + 4;
  } else if (fonte === 'melhor_envio') {
    doc.fontSize(7).font('Helvetica');
    const bodyH = doc.heightOfString(obsText, { width: w - 16 });
    const boxH = bodyH + 14;
    doc.rect(x, obsY, w, boxH).fill('#eff6ff');
    doc.rect(x, obsY, 3, boxH).fill('#2563eb');
    doc.fontSize(7).fillColor('#1d4ed8').font('Helvetica-Bold');
    doc.text(obsText, x + 8, obsY + 4, { width: w - 16, lineGap: 1 });
    doc.y = Math.max(doc.y, obsY + boxH) + 4;
  } else {
    doc.fontSize(7).fillColor('#64748b').font('Helvetica');
    doc.text(obsText, x, obsY, { width: w });
    doc.moveDown(0.3);
  }
}

// ── Utilitários de layout ─────────────────────────────────────────────────────
function renderizarMiniTitulo(doc, x, texto) {
  doc.moveDown(0.25);
  doc.fontSize(6.5).fillColor('#2563eb').font('Helvetica-Bold').text(texto, x, doc.y);
  doc.y += 2;
}

function renderizarLinhaDupla(doc, x, w, halfW, label1, val1, label2, val2) {
  const lineY = doc.y;
  const labelW = 72;

  doc.fontSize(7).fillColor('#94a3b8').font('Helvetica').text(label1 + ':', x, lineY, { width: labelW });
  doc.fontSize(7.5).fillColor('#1e293b').font('Helvetica-Bold').text(String(val1 || '—'), x + labelW + 2, lineY, { width: halfW - labelW - 8 });

  doc.fontSize(7).fillColor('#94a3b8').font('Helvetica').text(label2 + ':', x + halfW, lineY, { width: labelW });
  doc.fontSize(7.5).fillColor('#1e293b').font('Helvetica-Bold').text(String(val2 || '—'), x + halfW + labelW + 2, lineY, { width: halfW - labelW - 8 });

  doc.y = lineY + 13;
}

function formatarDataHora(dataHora) {
  if (!dataHora) return '—';
  try { return new Date(dataHora).toLocaleString('pt-BR'); } catch { return String(dataHora); }
}

function formatarCep(cep) {
  if (!cep) return '—';
  const c = String(cep).replace(/\D/g, '').padStart(8, '0');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

function desenharCard(doc, x, y, w, h, bgColor, accentColor, titulo, valor) {
  doc.rect(x, y, w, h).fill(bgColor);
  doc.rect(x, y, 4, h).fill(accentColor);
  doc.fontSize(8).fillColor('#64748b').font('Helvetica').text(titulo, x + 10, y + 10, { width: w - 14 });
  doc.fontSize(14).fillColor('#1e293b').font('Helvetica-Bold').text(valor, x + 10, y + 26, { width: w - 14 });
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { gerarRelatorioPDF, getVerifyUrl };
