const BASE = window.API_BASE || '';
let graficoData = [];
let pedidoAtual = null;

// ── TOAST ─────────────────────────────────────────────
function toast(msg, tipo = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const colors = { success: 'var(--green-light)', error: '#f87171', info: 'var(--blue-light)' };
  el.innerHTML = `<i class="fa ${icons[tipo] || 'fa-circle-info'}" style="color:${colors[tipo]}"></i> ${msg}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── FORMAT ────────────────────────────────────────────
function fmtMoeda(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDataHora(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── RESUMO ────────────────────────────────────────────
async function carregarResumo() {
  try {
    const r = await fetch(BASE + '/api/resumo');
    const d = await r.json();
    document.getElementById('totalGasto').textContent = fmtMoeda(d.totalGasto);
    document.getElementById('totalReal').textContent = fmtMoeda(d.totalReal);
    document.getElementById('economiaTotal').textContent = fmtMoeda(d.economia);
    document.getElementById('porcentagem').textContent = d.porcentagem + '%';
    document.getElementById('totalPedidos').textContent = d.totalPedidos + ' pedido' + (d.totalPedidos !== 1 ? 's' : '') + ' auditado' + (d.totalPedidos !== 1 ? 's' : '');
  } catch (e) {
    toast('Erro ao carregar resumo', 'error');
  }
}

// ── GRÁFICO ───────────────────────────────────────────
async function carregarGrafico() {
  try {
    const r = await fetch(BASE + '/api/grafico');
    graficoData = await r.json();
    renderGrafico();
  } catch (e) {
    toast('Erro ao carregar gráfico', 'error');
  }
}

function renderGrafico() {
  const canvas = document.getElementById('graficoCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.offsetWidth || 800;
  const H = 240;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const PAD = { top: 20, right: 20, bottom: 50, left: 65 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  const allVals = graficoData.flatMap(d => [d.freteCobrado, d.freteCorreto]).filter(v => v > 0);
  const maxVal = allVals.length ? Math.max(...allVals) * 1.15 : 100;

  const n = graficoData.length;
  const groupW = chartW / n;
  const barW = Math.min(groupW * 0.35, 20);
  const gap = barW * 0.5;

  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = PAD.top + chartH - (i / steps) * chartH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const val = (maxVal * i / steps);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('R$' + (val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)), PAD.left - 6, y + 3.5);
  }

  graficoData.forEach((d, i) => {
    const cx = PAD.left + i * groupW + groupW / 2;
    const x1 = cx - gap / 2 - barW;
    const x2 = cx + gap / 2;

    const h1 = maxVal > 0 ? (d.freteCobrado / maxVal) * chartH : 0;
    ctx.fillStyle = '#2563eb';
    roundRect(ctx, x1, PAD.top + chartH - h1, barW, h1, 3);
    ctx.fill();

    const h2 = maxVal > 0 ? (d.freteCorreto / maxVal) * chartH : 0;
    ctx.fillStyle = '#16a34a';
    roundRect(ctx, x2, PAD.top + chartH - h2, barW, h2, 3);
    ctx.fill();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const parts = d.data.split('-');
    ctx.fillText(`${parts[2]}/${parts[1]}`, cx, PAD.top + chartH + 16);
  });

  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top + chartH);
  ctx.lineTo(PAD.left + chartW, PAD.top + chartH);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  canvas._meta = { PAD, chartW, chartH, groupW, maxVal, barW, gap, n };
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 1) { ctx.rect(x, y, w, h); return; }
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const canvas = document.getElementById('graficoCanvas');
if (canvas) {
  canvas.addEventListener('mousemove', (e) => {
    const tt = document.getElementById('chartTooltip');
    if (!canvas._meta || !graficoData.length) return;
    const { PAD, groupW } = canvas._meta;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.floor((mx - PAD.left) / groupW);
    if (idx < 0 || idx >= graficoData.length) { tt.style.display = 'none'; return; }
    const d = graficoData[idx];
    const parts = d.data.split('-');
    tt.style.display = 'block';
    tt.style.left = (e.clientX + 16) + 'px';
    tt.style.top = (e.clientY - 20) + 'px';
    tt.innerHTML = `
      <div class="tt-date">${parts[2]}/${parts[1]}/${parts[0]}</div>
      <div class="tt-blue"><i class="fa fa-square"></i> Cobrado: R$ ${Number(d.freteCobrado).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
      <div class="tt-green" style="margin-top:4px"><i class="fa fa-square"></i> Correto: R$ ${Number(d.freteCorreto).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
    `;
  });
  canvas.addEventListener('mouseleave', () => {
    document.getElementById('chartTooltip').style.display = 'none';
  });
}

window.addEventListener('resize', () => {
  if (graficoData.length) renderGrafico();
});

// ── PEDIDOS ───────────────────────────────────────────
async function carregarPedidos() {
  try {
    const r = await fetch(BASE + '/api/pedidos');
    const pedidos = await r.json();
    const tbody = document.getElementById('pedidosBody');
    if (!tbody) return;

    if (!pedidos.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa fa-inbox"></i><h3>Sem pedidos ainda</h3><p>Envie pedidos via webhook ou clique em "Dados de Exemplo"</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = pedidos.slice(0, 10).map((p, i) => {
      const statusMap = {
        correto: '<span class="status-badge status-correto">🟢 Correto</span>',
        cobrado_a_mais: '<span class="status-badge status-cobrado_a_mais">🔴 Cobrado a mais</span>',
        economia_identificada: '<span class="status-badge status-economia_identificada">⚡ Economia</span>',
        pendente: '<span class="status-badge status-pendente">⏳ Pendente</span>',
      };
      const cobrarBtn = p.economia > 0
        ? `<button class="btn btn-sm btn-primary" onclick="abrirModalCobrar(${p.id})"><i class="fa fa-envelope"></i> Cobrar</button>`
        : `<span style="color:var(--muted);font-size:0.8rem">—</span>`;

      return `
        <tr>
          <td style="color:var(--muted)">${i + 1}</td>
          <td style="font-weight:600;font-family:monospace">${p.pedidoId}</td>
          <td class="val-cobrado">${fmtMoeda(p.freteCobrado)}</td>
          <td class="val-correto">${fmtMoeda(p.freteCorreto)}</td>
          <td class="${p.economia > 0 ? 'val-economia' : 'val-zero'}">${fmtMoeda(p.economia)}</td>
          <td>${statusMap[p.status] || statusMap.pendente}</td>
          <td style="color:var(--muted);font-size:0.8rem">${fmtDataHora(p.dataHora)}</td>
          <td>${cobrarBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    toast('Erro ao carregar pedidos', 'error');
  }
}

// ── MODAL COBRAR ──────────────────────────────────────
async function abrirModalCobrar(id) {
  try {
    const r = await fetch(BASE + '/api/pedidos/' + id);
    pedidoAtual = await r.json();

    document.getElementById('emailAssunto').value = `Solicitação de Reembolso - Pedido ${pedidoAtual.pedidoId}`;
    document.getElementById('emailCorpo').value =
`Prezados,

Conforme auditoria realizada pelo AUDITCARGO, identificamos cobrança indevida de frete no valor de R$ ${Number(pedidoAtual.economia).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para o pedido ${pedidoAtual.pedidoId}.

Detalhes:
- Pedido ID: ${pedidoAtual.pedidoId}
- Frete cobrado: R$ ${Number(pedidoAtual.freteCobrado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Frete correto calculado: R$ ${Number(pedidoAtual.freteCorreto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Diferença (economia): R$ ${Number(pedidoAtual.economia).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

Solicito reembolso ou abatimento na próxima fatura.

Atenciosamente,
AUDITCARGO — Auditoria Automática de Fretes`;

    document.getElementById('modalCobrar').classList.add('open');
  } catch (e) {
    toast('Erro ao carregar pedido', 'error');
  }
}

function fecharModal() {
  document.getElementById('modalCobrar').classList.remove('open');
}

document.getElementById('modalCobrar')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalCobrar')) fecharModal();
});

function abrirEmailCliente() {
  const para = encodeURIComponent(document.getElementById('emailPara').value);
  const assunto = encodeURIComponent(document.getElementById('emailAssunto').value);
  const corpo = encodeURIComponent(document.getElementById('emailCorpo').value);
  window.open(`mailto:${para}?subject=${assunto}&body=${corpo}`);
  if (pedidoAtual) {
    fetch(BASE + '/api/pedidos/' + pedidoAtual.id + '/enviado', { method: 'PATCH' }).catch(() => {});
  }
  toast('E-mail aberto no cliente de e-mail!', 'success');
}

function copiarEmail() {
  navigator.clipboard.writeText(document.getElementById('emailCorpo').value)
    .then(() => toast('E-mail copiado!', 'success'));
}

// ── AÇÕES ─────────────────────────────────────────────
async function recalcular() {
  toast('Atualizando dados...', 'info');
  await Promise.all([carregarResumo(), carregarGrafico(), carregarPedidos()]);
  toast('Dados atualizados!', 'success');
}

function baixarRelatorio() {
  toast('Gerando PDF...', 'info');
  window.open(BASE + '/api/relatorio/pdf', '_blank');
}

async function seedDados() {
  try {
    toast('Inserindo dados de exemplo...', 'info');
    const r = await fetch(BASE + '/api/seed', { method: 'POST' });
    const d = await r.json();
    if (d.success) { toast(d.message, 'success'); await recalcular(); }
    else toast(d.message || 'Todos os dados já existem', 'info');
  } catch (e) {
    toast('Erro ao inserir dados de exemplo', 'error');
  }
}

// ── VTEX ──────────────────────────────────────────────
async function carregarVtexStatus() {
  try {
    const r = await fetch(BASE + '/api/vtex/status');
    const s = await r.json();

    const banner = document.getElementById('vtexBanner');
    const cta = document.getElementById('vtexConnectCTA');
    const navStatus = document.getElementById('vtexNavStatus');

    if (s.connected) {
      if (banner) banner.style.display = 'flex';
      if (cta) cta.style.display = 'none';
      if (navStatus) navStatus.style.display = 'flex';
      const tag = document.getElementById('vtexStoreTag');
      if (tag) tag.textContent = s.account;
      const navLabel = document.getElementById('vtexNavLabel');
      if (navLabel) navLabel.textContent = s.account;
      const syncLabel = document.getElementById('vtexLastSync');
      if (syncLabel && s.lastSync) {
        const d = new Date(s.lastSync);
        syncLabel.textContent = `Última sync: ${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${s.syncedCount} pedidos importados`;
      }
    } else {
      if (banner) banner.style.display = 'none';
      if (cta) cta.style.display = 'block';
      if (navStatus) navStatus.style.display = 'none';
    }
  } catch {}
}

async function vtexSyncNow() {
  const btn = document.getElementById('vtexSyncBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-circle-notch" style="animation:spin 0.8s linear infinite"></i> Sincronizando...'; }
  toast('Sincronizando com VTEX...', 'info');
  try {
    const r = await fetch(BASE + '/api/vtex/sync', { method: 'POST' });
    const d = await r.json();
    if (d.success) {
      toast(`${d.synced} pedidos sincronizados!`, 'success');
      await Promise.all([carregarResumo(), carregarGrafico(), carregarPedidos(), carregarVtexStatus()]);
    } else {
      toast(d.error || 'Erro ao sincronizar', 'error');
    }
  } catch {
    toast('Erro de conexão', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-rotate"></i> Sincronizar agora'; }
  }
}

async function vtexDisconnect() {
  if (!confirm('Desconectar a VTEX? Os pedidos já importados serão mantidos.')) return;
  await fetch(BASE + '/api/vtex/disconnect', { method: 'DELETE' });
  toast('VTEX desconectada', 'info');
  carregarVtexStatus();
}

// ── UPLOAD BOLETO ─────────────────────────────────────
function abrirModalUpload() {
  resetarUpload();
  document.getElementById('modalUpload').classList.add('open');
}

function fecharModalUpload() {
  document.getElementById('modalUpload').classList.remove('open');
  resetarUpload();
}

function resetarUpload() {
  document.getElementById('uploadStep1').style.display = '';
  document.getElementById('uploadStep2').style.display = 'none';
  document.getElementById('uploadStep3').style.display = 'none';
  document.getElementById('uploadInput').value = '';
}

function handleFileDrop(event) {
  event.preventDefault();
  document.getElementById('uploadDropZone').style.borderColor = 'rgba(37,99,235,0.3)';
  const file = event.dataTransfer.files[0];
  if (file) processarUpload(file);
}

async function processarUpload(file) {
  if (!file) return;

  document.getElementById('uploadStep1').style.display = 'none';
  document.getElementById('uploadStep2').style.display = '';
  document.getElementById('uploadStep3').style.display = 'none';

  const formData = new FormData();
  formData.append('documento', file);

  try {
    const r = await fetch(BASE + '/api/upload', { method: 'POST', body: formData });
    const d = await r.json();

    document.getElementById('uploadStep2').style.display = 'none';
    document.getElementById('uploadStep3').style.display = '';

    if (d.success) {
      const statusMap = {
        correto: { icon: '🟢', label: 'Correto', color: 'var(--green-light)' },
        cobrado_a_mais: { icon: '🔴', label: 'Cobrado a mais', color: '#f87171' },
        economia_identificada: { icon: '⚡', label: 'Economia identificada', color: 'var(--gold)' },
      };
      const s = statusMap[d.status] || { icon: '⏳', label: d.status, color: 'var(--muted)' };
      const ext = d.dadosExtraidos || {};

      document.getElementById('uploadResultContent').innerHTML = `
        <div style="background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);border-radius:10px;padding:16px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <i class="fa fa-circle-check" style="color:var(--green-light)"></i>
            <span style="font-weight:700">Auditoria concluída!</span>
            <span style="margin-left:auto;color:${s.color};font-weight:600">${s.icon} ${s.label}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem">
            <div><span style="color:var(--muted)">Frete cobrado:</span><br><strong>${fmtMoeda(d.freteCobrado)}</strong></div>
            <div><span style="color:var(--muted)">Frete correto:</span><br><strong style="color:var(--green-light)">${fmtMoeda(d.freteCorreto)}</strong></div>
            <div style="grid-column:1/-1"><span style="color:var(--muted)">Economia identificada:</span><br><strong style="color:var(--gold);font-size:1.05rem">${fmtMoeda(d.economia)}</strong></div>
          </div>
        </div>
        <div style="font-size:0.8rem;color:var(--muted);background:var(--card);border-radius:8px;padding:10px 14px">
          <div style="font-weight:600;margin-bottom:6px;color:var(--text)">Dados extraídos pela IA</div>
          ${ext.transportadora ? `<div>Transportadora: <strong>${ext.transportadora}</strong></div>` : ''}
          <div>CEP origem → destino: <strong>${ext.cepOrigem || '—'} → ${ext.cepDestino || '—'}</strong></div>
          <div>Peso: <strong>${ext.peso ? ext.peso + ' kg' : '—'}</strong>${ext.comprimento ? ` · Dimensões: ${ext.comprimento}×${ext.altura}×${ext.largura} cm` : ''}</div>
        </div>
      `;
      await recalcular();
    } else {
      document.getElementById('uploadResultContent').innerHTML = `
        <div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.2);border-radius:10px;padding:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <i class="fa fa-circle-xmark" style="color:#f87171"></i>
            <span style="font-weight:700">Erro na extração</span>
          </div>
          <div style="font-size:0.85rem;color:var(--muted)">${d.error || 'Não foi possível processar o documento.'}</div>
          ${d.dadosExtraidos ? `<div style="margin-top:8px;font-size:0.78rem;color:var(--muted)">Dados parcialmente extraídos: ${JSON.stringify(d.dadosExtraidos)}</div>` : ''}
        </div>
      `;
    }
  } catch (e) {
    document.getElementById('uploadStep2').style.display = 'none';
    document.getElementById('uploadStep3').style.display = '';
    document.getElementById('uploadResultContent').innerHTML = `
      <div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.2);border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <i class="fa fa-circle-xmark" style="color:#f87171"></i>
          <span style="font-weight:700">Erro de conexão</span>
        </div>
        <div style="font-size:0.85rem;color:var(--muted)">Não foi possível conectar ao servidor. Tente novamente.</div>
      </div>
    `;
  }
}

document.getElementById('modalUpload')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalUpload')) fecharModalUpload();
});

// ── INIT ──────────────────────────────────────────────
async function init() {
  const overlay = document.getElementById('loadingOverlay');
  try {
    await Promise.all([carregarResumo(), carregarGrafico(), carregarPedidos(), carregarVtexStatus()]);
  } finally {
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(() => overlay.remove(), 300);
    }
  }
}

init();
