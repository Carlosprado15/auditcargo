'use strict';

const { calcularFrete, determinarStatus } = require('../../services/freteCalculator');
const { CENARIOS_FRETE } = require('../massaDeTestes');

async function executarTestes() {
  const resultados = [];

  function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido } = executar();
      resultados.push({
        id, modulo: 'FreteCalculator', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : `Esperado "${esperado}", obtido "${obtido}"`,
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'FreteCalculator', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-001: Valores iguais
  tc('TC-001', 'determinarStatus — valores exatamente iguais → correto', () => {
    const r = determinarStatus(50.00, 50.00);
    return { aprovado: r === 'correto', esperado: 'correto', obtido: r };
  });

  // TC-002: Diferença dentro da margem de R$0,50
  tc('TC-002', 'determinarStatus — diferença R$0,30 dentro da margem → correto', () => {
    const r = determinarStatus(CENARIOS_FRETE.correto.freteCobrado, CENARIOS_FRETE.correto.freteCorreto);
    return { aprovado: r === CENARIOS_FRETE.correto.statusEsperado, esperado: CENARIOS_FRETE.correto.statusEsperado, obtido: r };
  });

  // TC-003: Cobrado muito acima (20% de diferença)
  tc('TC-003', 'determinarStatus — sobretaxa 20% → cobrado_a_mais', () => {
    const r = determinarStatus(CENARIOS_FRETE.cobradoAMais.freteCobrado, CENARIOS_FRETE.cobradoAMais.freteCorreto);
    return { aprovado: r === CENARIOS_FRETE.cobradoAMais.statusEsperado, esperado: CENARIOS_FRETE.cobradoAMais.statusEsperado, obtido: r };
  });

  // TC-004: Diferença pequena (2%) acima do limite — economia_identificada
  tc('TC-004', 'determinarStatus — diferença R$1 (2%) → economia_identificada', () => {
    const r = determinarStatus(CENARIOS_FRETE.economiaIdentificada.freteCobrado, CENARIOS_FRETE.economiaIdentificada.freteCorreto);
    return { aprovado: r === CENARIOS_FRETE.economiaIdentificada.statusEsperado, esperado: CENARIOS_FRETE.economiaIdentificada.statusEsperado, obtido: r };
  });

  // TC-005: Cobrado abaixo da referência (undercharge não é auditado)
  tc('TC-005', 'determinarStatus — cobrado R$20 abaixo da referência → correto (undercharge ignorado)', () => {
    const r = determinarStatus(CENARIOS_FRETE.abaixoDaTabela.freteCobrado, CENARIOS_FRETE.abaixoDaTabela.freteCorreto);
    return { aprovado: r === CENARIOS_FRETE.abaixoDaTabela.statusEsperado, esperado: CENARIOS_FRETE.abaixoDaTabela.statusEsperado, obtido: r };
  });

  // TC-006: Exatamente no limite de tolerância (R$0,50)
  tc('TC-006', 'determinarStatus — diferença exata de R$0,50 → correto (dentro da tolerância)', () => {
    const r = determinarStatus(CENARIOS_FRETE.exatamenteNaTolerancia.freteCobrado, CENARIOS_FRETE.exatamenteNaTolerancia.freteCorreto);
    return { aprovado: r === CENARIOS_FRETE.exatamenteNaTolerancia.statusEsperado, esperado: CENARIOS_FRETE.exatamenteNaTolerancia.statusEsperado, obtido: r };
  });

  // TC-007: calcularFrete — pacote leve mesmo estado (CEPs com mesmo 1º dígito → 100km)
  tc('TC-007', 'calcularFrete — pacote 0.1kg, mesma região (distância 100km) → valor ≥ tarifaBase mínima', () => {
    const r = calcularFrete({ cepOrigem: '01001000', cepDestino: '05001000', peso: 0.1, comprimento: 10, altura: 5, largura: 5 });
    const pesoFinal = Math.max(0.1, (10 * 5 * 5) / 6000); // 0.1 > 0.0416
    const esperado = Math.round((6.50 + pesoFinal * 0.90 + 100 * 0.003) * 100) / 100;
    return { aprovado: r === esperado, esperado, obtido: r };
  });

  // TC-008: calcularFrete — pacote médio (3kg), região vizinha (diff=1 → 300km)
  tc('TC-008', 'calcularFrete — pacote 3kg faixa 1–5kg, região vizinha 300km → calcula corretamente', () => {
    const r = calcularFrete({ cepOrigem: '01001000', cepDestino: '10001000', peso: 3.0, comprimento: 20, altura: 15, largura: 15 });
    const pesoCubado = (20 * 15 * 15) / 6000; // 0.75 < 3.0
    const pesoFinal = 3.0;
    const esperado = Math.round((10.00 + pesoFinal * 1.30 + 300 * 0.003) * 100) / 100;
    return { aprovado: r === esperado, esperado, obtido: r };
  });

  // TC-009: calcularFrete — pacote pesado (35kg), região remota (diff=9 → 2200km)
  tc('TC-009', 'calcularFrete — pacote 35kg, região remota → usa faixa >30kg e distância 2200km', () => {
    const r = calcularFrete({ cepOrigem: '01001000', cepDestino: '90001000', peso: 35.0, comprimento: 60, altura: 40, largura: 40 });
    const pesoCubado = (60 * 40 * 40) / 6000; // 16 < 35
    const pesoFinal = 35.0;
    const esperado = Math.round((35.00 + pesoFinal * 2.20 + 2200 * 0.003) * 100) / 100;
    return { aprovado: r === esperado, esperado, obtido: r };
  });

  // TC-010: calcularFrete — peso cubado maior que peso físico
  tc('TC-010', 'calcularFrete — peso cubado (16.67kg) > peso físico (3kg) → usa faixa 10–30kg', () => {
    // comprimento=100, altura=100, largura=10 → cubado = (100*100*10)/6000 = 16.666...
    const r = calcularFrete({ cepOrigem: '01001000', cepDestino: '01002000', peso: 3.0, comprimento: 100, altura: 100, largura: 10 });
    const pesoCubado = (100 * 100 * 10) / 6000; // 16.666...
    const pesoFinal = pesoCubado; // maior que 3.0
    // pesoFinal ≈ 16.67 → faixa 10–30kg: tarifaBase=20.00, tarifaPorKg=1.80
    const esperado = Math.round((20.00 + pesoFinal * 1.80 + 100 * 0.003) * 100) / 100;
    return { aprovado: r === esperado, esperado, obtido: r };
  });

  return resultados;
}

module.exports = executarTestes;
