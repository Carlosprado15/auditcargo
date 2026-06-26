const db = require('./database');
const { calcularFrete, determinarStatus } = require('./freteCalculator');

async function vtexFetch(account, path, appKey, appToken) {
  const url = `https://${account}.vtexcommercestable.com.br${path}`;
  const resp = await fetch(url, {
    headers: {
      'X-VTEX-API-AppKey': appKey,
      'X-VTEX-API-AppToken': appToken,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  });
  return resp;
}

// Verifica se a loja existe usando o endpoint de catálogo público
// Lojas reais: 200 ou 400 | Lojas inexistentes: 404
async function validateStore(account) {
  if (!/^[a-z0-9-]+$/i.test(account) || account.length < 3) {
    return { valid: false, error: 'Nome inválido. Use apenas letras, números e hífens.' };
  }
  try {
    const resp = await fetch(
      `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.status === 404) {
      return { valid: false, error: 'Loja não encontrada na VTEX. Verifique o nome.' };
    }
    return { valid: true, statusCode: resp.status };
  } catch (e) {
    return { valid: false, error: 'Não foi possível conectar. Verifique sua internet.' };
  }
}

// Valida credenciais testando um endpoint autenticado
async function validateCredentials(account, appKey, appToken) {
  try {
    const resp = await vtexFetch(account, '/api/oms/pvt/orders?per_page=1&orderBy=creationDate,desc', appKey, appToken);
    if (resp.status === 200) {
      const data = await resp.json();
      return { valid: true, orderCount: data.paging?.total || 0 };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, error: 'Acesso negado. Verifique sua Chave e Token de acesso.' };
    }
    return { valid: false, error: `Erro ${resp.status} ao conectar com a VTEX.` };
  } catch (e) {
    return { valid: false, error: `Falha na conexão: ${e.message}` };
  }
}

// Busca pedidos paginados e audita cada um
async function syncOrders(account, appKey, appToken, originCep, limit = 100) {
  let synced = 0;
  let page = 1;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  while (synced < limit) {
    const perPage = Math.min(50, limit - synced);
    const resp = await vtexFetch(account,
      `/api/oms/pvt/orders?f_status=invoiced&per_page=${perPage}&page=${page}&orderBy=creationDate,desc`,
      appKey, appToken
    );

    if (!resp.ok) break;

    const body = await resp.json();
    const list = body.list || [];
    if (!list.length) break;

    for (const order of list) {
      try {
        const ok = await processOrder(account, appKey, appToken, order.orderId, originCep);
        if (ok) synced++;
      } catch {}
      await delay(120); // respeita rate limit VTEX
    }

    if (list.length < perPage) break;
    page++;
  }

  return { synced };
}

async function processOrder(account, appKey, appToken, orderId, originCep) {
  const resp = await vtexFetch(account, `/api/oms/pvt/orders/${orderId}`, appKey, appToken);
  if (!resp.ok) return false;

  const order = await resp.json();

  // Custo do frete cobrado (centavos → reais)
  const shippingTotal = order.totals?.find(t => t.id === 'Shipping');
  if (!shippingTotal || shippingTotal.value <= 0) return false;
  const freteCobrado = shippingTotal.value / 100;

  // CEP de destino
  const postalRaw = order.shippingData?.address?.postalCode;
  if (!postalRaw) return false;
  const cepDestino = postalRaw.replace(/\D/g, '');

  // Dimensões do pacote
  let peso = 0.5, comprimento = 20, altura = 15, largura = 15;

  const pkgs = order.packageAttachment?.packages;
  if (pkgs?.length && pkgs[0].dimensions) {
    const d = pkgs[0].dimensions;
    peso = (d.weight || 500) / 1000;
    comprimento = d.length || 20;
    altura = d.height || 15;
    largura = d.width || 15;
  } else {
    // Estimativa por itens
    const qtd = order.items?.reduce((s, i) => s + (i.quantity || 1), 0) || 1;
    peso = qtd * 0.4;
    comprimento = 20 + qtd * 3;
  }

  const freteCorreto = calcularFrete({ cepOrigem: originCep, cepDestino, peso, comprimento, altura, largura });
  const economia = Math.max(0, freteCobrado - freteCorreto);
  const status = determinarStatus(freteCobrado, freteCorreto);

  await db.run(
    `INSERT OR REPLACE INTO pedidos
      (pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [orderId, originCep, cepDestino, peso, comprimento, altura, largura, freteCobrado, freteCorreto, economia, status]
  );

  return true;
}

module.exports = { validateStore, validateCredentials, syncOrders };
