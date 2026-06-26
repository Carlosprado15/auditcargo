const PDFDocument = require('pdfkit');

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

  doc.end();
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
