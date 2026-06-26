// Cálculo de frete por estimativa baseada em peso cubado e distância por DDD
function calcularFrete({ cepOrigem, cepDestino, peso, comprimento, altura, largura }) {
  const pesoCubado = (comprimento * altura * largura) / 6000;
  const pesoFinal = Math.max(peso, pesoCubado);

  const dddOrigem = parseInt(String(cepOrigem).substring(0, 1));
  const dddDestino = parseInt(String(cepDestino).substring(0, 1));
  const distanciaEstimada = calcularDistanciaEstimada(dddOrigem, dddDestino);

  let tarifaBase = 8.00;
  let tarifaPorKg = 1.20;
  let tarifaPorKm = 0.003;

  // Faixas de peso
  if (pesoFinal <= 0.3) {
    tarifaBase = 6.50;
    tarifaPorKg = 0.90;
  } else if (pesoFinal <= 1) {
    tarifaBase = 8.00;
    tarifaPorKg = 1.10;
  } else if (pesoFinal <= 5) {
    tarifaBase = 10.00;
    tarifaPorKg = 1.30;
  } else if (pesoFinal <= 10) {
    tarifaBase = 14.00;
    tarifaPorKg = 1.50;
  } else if (pesoFinal <= 30) {
    tarifaBase = 20.00;
    tarifaPorKg = 1.80;
  } else {
    tarifaBase = 35.00;
    tarifaPorKg = 2.20;
  }

  const freteCorreto = tarifaBase + (pesoFinal * tarifaPorKg) + (distanciaEstimada * tarifaPorKm);

  return Math.round(freteCorreto * 100) / 100;
}

function calcularDistanciaEstimada(dddOrigem, dddDestino) {
  // Matriz simplificada de distâncias por região (primeiros dígitos do CEP)
  const regioes = {
    0: 'SP-capital',  // 01000-09999
    1: 'SP-interior', // 10000-19999
    2: 'RJ',          // 20000-28999
    3: 'MG',          // 30000-39999
    4: 'BA-SE',       // 40000-49999
    5: 'PR-SC',       // 50000-59999 (PE também)
    6: 'CE-MA-PI',    // 60000-69999
    7: 'GO-TO-MS',    // 70000-79999
    8: 'RS',          // 80000-89999 (PR também)
    9: 'MT-RO-AM',    // 90000-99999
  };

  if (dddOrigem === dddDestino) return 100;

  const diff = Math.abs(dddOrigem - dddDestino);
  if (diff <= 1) return 300;
  if (diff <= 2) return 600;
  if (diff <= 3) return 900;
  if (diff <= 5) return 1400;
  return 2200;
}

function determinarStatus(freteCobrado, freteCorreto) {
  const diff = freteCobrado - freteCorreto;
  const percentual = (diff / freteCorreto) * 100;

  if (Math.abs(diff) <= 0.50) return 'correto';
  if (diff > 0.50) {
    if (percentual > 5) return 'cobrado_a_mais';
    return 'economia_identificada';
  }
  return 'correto';
}

module.exports = { calcularFrete, determinarStatus };
