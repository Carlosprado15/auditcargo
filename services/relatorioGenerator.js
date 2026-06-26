const PDFDocument = require('pdfkit');
const { gerarAuditEvidence } = require('./auditEvidence');

function gerarRelatorioPDF(dados, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-glosa-${Date.now()}.pdf"`);
  doc.pipe(res);

  // Fundo do cabeçalho
  doc.rect(0, 0, 595, 120).fill('#0f172a');

  // Logo AUDIT
  doc.fontSize(28).fillColor('#2563eb').font('Helvetica-Bold');
  doc.text('AUDIT', 50, 40, { continued: true });
  doc.fillColor('#f59e0b').text('CARGO');

  // Subtítulo
  doc.fontSize(11).fillColor('#94a3b8').font('Helvetica');
  doc.text('Auditor Automático de Fretes', 50, 75);

  // Título do relatório
  doc.fontSize(13).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('RELATÓRIO DE GLOSA', 350, 45);
  doc.fontSize(9).fillColor('#94a3b8').font('Helvetica');
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 350, 68);
  doc.text(`Cliente: ${dados.clienteNome}`, 350, 83);
  doc.text(`Empresa: ${dados.empresaNome}`, 350, 98);

  // Reset cor
  doc.fillColor('#0f172a');

  // Linha separadora
  doc.moveTo(50, 135).lineTo(545, 135).strokeColor('#e2e8f0').stroke();

  // Resumo executivo
  doc.y = 150;
  doc.fontSize(14).fillColor('#1e293b').font('Helvetica-Bold').text('Resumo Executivo', 50);
  doc.moveDown(0.5);

  const resumoY = doc.y;
  const cardW = 155;
  const cardH = 65;
  const gap = 8;

  // Card 1 - Total Gasto
  desenharCard(doc, 50, resumoY, cardW, cardH, '#fff7ed', '#f59e0b', 'TOTAL COBRADO', `R$ ${formatarMoeda(dados.totalGasto)}`);
  // Card 2 - Valor Real
  desenharCard(doc, 50 + cardW + gap, resumoY, cardW, cardH, '#f0fdf4', '#16a34a', 'VALOR CORRETO', `R$ ${formatarMoeda(dados.totalReal)}`);
  // Card 3 - Economia
  desenharCard(doc, 50 + (cardW + gap) * 2, resumoY, cardW, cardH, '#eff6ff', '#2563eb', 'ECONOMIA TOTAL', `R$ ${formatarMoeda(dados.economia)}`);

  doc.y = resumoY + cardH + 20;

  // Percentual de economia
  doc.fontSize(10).fillColor('#64748b').font('Helvetica');
  doc.text(
    `Percentual de economia: ${dados.porcentagem}%  |  Total de pedidos auditados: ${dados.totalPedidos}`,
    50, doc.y, { align: 'center', width: 495 }
  );

  doc.moveDown(1.5);

  // Linha separadora
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  // Motor de Referência
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

  // Linha separadora
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  // Título da tabela
  doc.fontSize(14).fillColor('#1e293b').font('Helvetica-Bold').text('Detalhamento dos Pedidos', 50);
  doc.moveDown(0.5);

  // Cabeçalho da tabela
  const tableTop = doc.y;
  const cols = [50, 140, 255, 360, 455];
  const colWidths = [85, 110, 100, 90, 90];
  const headers = ['Pedido ID', 'Frete Cobrado', 'Frete Correto', 'Economia', 'Status'];

  doc.rect(50, tableTop, 495, 22).fill('#1e293b');
  doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, cols[i] + 4, tableTop + 7, { width: colWidths[i] - 8 });
  });

  // Linhas da tabela
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

    // Borda inferior da linha
    doc.moveTo(50, rowY + 20).lineTo(545, rowY + 20).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    rowY += 20;
  });

  // Total final
  rowY += 10;
  doc.rect(50, rowY, 495, 28).fill('#0f172a');
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('TOTAL A GLOSAR:', cols[0] + 4, rowY + 8, { width: 350 });
  doc.fillColor('#f59e0b');
  doc.text(`R$ ${formatarMoeda(dados.economia)}`, cols[3] + 4, rowY + 8, { width: 185 });

  // Rodapé
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

  // Dossiê Técnico de Auditoria
  if (dados.pedidos && dados.pedidos.length > 0) {
    renderizarDossies(doc, dados.pedidos);
  }

  doc.end();
}

function renderizarDossies(doc, pedidos) {
  doc.addPage();

  // Cabeçalho da seção de dossiês
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
  // Verifica se há espaço suficiente para ao menos o cabeçalho + dados básicos
  if (doc.y > 580) {
    doc.addPage();
    doc.y = 50;
  }

  const x = 50;
  const w = 495;
  const halfW = Math.floor(w / 2);

  // --- Cabeçalho do dossiê ---
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

  // --- Documento Analisado ---
  renderizarMiniTitulo(doc, x, 'DOCUMENTO ANALISADO');
  renderizarLinhaDupla(doc, x, w, halfW,
    'Origem', ev.documentoAnalisado.origem,
    'Data da Análise', formatarDataHora(ev.documentoAnalisado.dataAnalise)
  );

  // --- Dados Extraídos ---
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

  // --- Resultado Encontrado ---
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

  // --- Fundamentação ---
  if (doc.y > 620) { doc.addPage(); doc.y = 50; }
  renderizarMiniTitulo(doc, x, 'FUNDAMENTAÇÃO');
  doc.fontSize(7.5).fillColor('#334155').font('Helvetica');
  doc.text(ev.fundamentacao, x, doc.y, { width: w, lineGap: 1 });
  doc.moveDown(0.4);

  // --- Rastreabilidade ---
  renderizarMiniTitulo(doc, x, 'RASTREABILIDADE');
  const rastY = doc.y;
  doc.fontSize(7).fillColor('#64748b').font('Helvetica-Bold').text('Versão Motor:', x, rastY, { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.versaoMotor}    `, { continued: true });
  doc.fillColor('#64748b').font('Helvetica-Bold').text('ID:', { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.identificacaoAuditoria}    `, { continued: true });
  doc.fillColor('#64748b').font('Helvetica-Bold').text('Fonte:', { continued: true });
  doc.font('Helvetica').fillColor('#475569').text(` ${ev.rastreabilidade.origemDados}`, { width: w });
  doc.moveDown(0.3);

  // --- Observações ---
  if (ev.observacoes) {
    const isWarning = ev.referenciaUtilizada.tipo === 'fallback';
    if (isWarning) {
      doc.rect(x, doc.y, w, 1).fill('#f59e0b');
      doc.y += 3;
    }
    doc.fontSize(7).fillColor(isWarning ? '#92400e' : '#64748b').font(isWarning ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(ev.observacoes, x, doc.y, { width: w });
    doc.moveDown(0.3);
  }

  // Separador
  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.y += 8;
}

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

module.exports = { gerarRelatorioPDF };
