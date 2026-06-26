'use strict';

// Massa de dados totalmente fictícia para homologação interna.
// Todos os CEPs, pedidos, valores e tabelas aqui são inventados.
// CEPs de teste usam prefixo 000000XX (claramente inválidos no Brasil).

const PREFIX = 'HOMOLOG_TEST_';

const PEDIDOS = {
  correto: {
    pedidoId: `${PREFIX}PED001`,
    cepOrigem: '01001000', cepDestino: '09001000',
    peso: 2.0, comprimento: 20, altura: 15, largura: 15,
    freteCobrado: 32.50, freteCorreto: 32.20, economia: 0,
    status: 'correto', fonte_referencia: 'fallback', nivel_confianca: 'BAIXA',
    versao_motor: '1.0', observacao_auditoria: 'Calculado pelo motor estimativo interno'
  },
  cobradoAMais: {
    pedidoId: `${PREFIX}PED002`,
    cepOrigem: '01001000', cepDestino: '80001000',
    peso: 5.0, comprimento: 40, altura: 30, largura: 25,
    freteCobrado: 120.00, freteCorreto: 85.00, economia: 35.00,
    status: 'cobrado_a_mais', fonte_referencia: 'tabela_cliente', nivel_confianca: 'ALTA',
    versao_motor: '1.0',
    observacao_auditoria: 'Tabela "HOMOLOG_TEST_JADLOG_2025" - Jadlog'
  },
  abaixoTabela: {
    pedidoId: `${PREFIX}PED003`,
    cepOrigem: '01001000', cepDestino: '30001000',
    peso: 1.0, comprimento: 15, altura: 10, largura: 10,
    freteCobrado: 18.00, freteCorreto: 22.00, economia: 0,
    status: 'correto', fonte_referencia: 'melhor_envio', nivel_confianca: 'ALTA',
    versao_motor: '1.0', observacao_auditoria: 'Cotação real via Melhor Envio (3 transportadoras)'
  },
  fallbackUsado: {
    pedidoId: `${PREFIX}PED004`,
    cepOrigem: '01001000', cepDestino: '69001000',
    peso: 3.0, comprimento: 30, altura: 20, largura: 20,
    freteCobrado: 75.00, freteCorreto: 62.00, economia: 13.00,
    status: 'cobrado_a_mais', fonte_referencia: 'fallback', nivel_confianca: 'BAIXA',
    versao_motor: '1.0', observacao_auditoria: 'Calculado pelo motor estimativo interno'
  },
  economiaIdentificada: {
    pedidoId: `${PREFIX}PED005`,
    cepOrigem: '01001000', cepDestino: '40001000',
    peso: 4.0, comprimento: 35, altura: 25, largura: 20,
    freteCobrado: 68.00, freteCorreto: 65.00, economia: 3.00,
    status: 'economia_identificada', fonte_referencia: 'tabela_cliente', nivel_confianca: 'ALTA',
    versao_motor: '1.0',
    observacao_auditoria: 'Tabela "HOMOLOG_TEST_CORREIOS_2025" - Correios'
  }
};

const TABELAS_CONTRATUAIS = {
  jadlog: {
    nome: `${PREFIX}JADLOG_2025`,
    transportadora: 'Jadlog',
    data_inicio: '2025-01-01',
    data_fim: null,
    status: 'ativa',
    observacoes: 'Tabela de homologação - não usar em produção',
    faixas: [
      { cep_inicial: '00000010', cep_final: '00000019', peso_inicial: 0, peso_final: 5, valor_frete: 28.00 },
      { cep_inicial: '00000010', cep_final: '00000019', peso_inicial: 5, peso_final: 15, valor_frete: 45.00 },
      { cep_inicial: '00000010', cep_final: '00000019', peso_inicial: 15, peso_final: 30, valor_frete: 75.00 }
    ]
  },
  correiosComEncargos: {
    nome: `${PREFIX}CORREIOS_ENCARGOS_2025`,
    transportadora: 'Correios',
    data_inicio: '2025-01-01',
    data_fim: null,
    status: 'ativa',
    observacoes: 'Tabela com encargos adicionais para homologação',
    faixas: [
      {
        cep_inicial: '00000020', cep_final: '00000029', peso_inicial: 0, peso_final: 10,
        valor_frete: 30.00, gris: 2.50, pedagio: 1.80
      }
    ]
  },
  vencida: {
    nome: `${PREFIX}TABELA_VENCIDA_2024`,
    transportadora: 'Transportadora Vencida',
    data_inicio: '2024-01-01',
    data_fim: '2024-12-31',
    status: 'ativa',
    observacoes: 'Tabela vencida para teste de validade',
    faixas: [
      { cep_inicial: '00000030', cep_final: '00000039', peso_inicial: 0, peso_final: 50, valor_frete: 99.00 }
    ]
  },
  inativa: {
    nome: `${PREFIX}TABELA_INATIVA`,
    transportadora: 'Transportadora Inativa',
    data_inicio: '2025-01-01',
    data_fim: null,
    status: 'inativa',
    observacoes: 'Tabela inativa para teste de status',
    faixas: [
      { cep_inicial: '00000040', cep_final: '00000049', peso_inicial: 0, peso_final: 50, valor_frete: 88.00 }
    ]
  },
  engineTest: {
    nome: `${PREFIX}ENGINE_TEST_2025`,
    transportadora: `${PREFIX}CARRIER`,
    data_inicio: '2025-01-01',
    data_fim: null,
    status: 'ativa',
    observacoes: 'Tabela para testes do motor de referência',
    faixas: [
      { cep_inicial: '00000050', cep_final: '00000059', peso_inicial: 0, peso_final: 20, valor_frete: 52.00 }
    ]
  }
};

const CENARIOS_FRETE = {
  correto: {
    descricao: 'Cobrança correta — diferença dentro da margem de R$0,50',
    freteCobrado: 50.00, freteCorreto: 50.30, statusEsperado: 'correto'
  },
  cobradoAMais: {
    descricao: 'Cobrança acima da tabela — diferença de 20%',
    freteCobrado: 60.00, freteCorreto: 50.00, statusEsperado: 'cobrado_a_mais'
  },
  economiaIdentificada: {
    descricao: 'Diferença pequena acima do limite — 2%',
    freteCobrado: 51.00, freteCorreto: 50.00, statusEsperado: 'economia_identificada'
  },
  abaixoDaTabela: {
    descricao: 'Cobrança abaixo da referência — R$20,00 a menos',
    freteCobrado: 30.00, freteCorreto: 50.00, statusEsperado: 'correto'
  },
  exatamenteNaTolerancia: {
    descricao: 'Diferença exatamente no limite R$0,50',
    freteCobrado: 50.50, freteCorreto: 50.00, statusEsperado: 'correto'
  }
};

const CSVS = {
  valido: [
    'cep_inicial,cep_final,peso_inicial,peso_final,valor_frete',
    '00000010,00000019,0,5,28.00',
    '00000010,00000019,5,10,45.00',
    '00000010,00000019,10,30,75.00'
  ].join('\n'),

  validoPontoEVirgula: [
    'cep_inicial;cep_final;peso_inicial;peso_final;valor_frete',
    '00000010;00000019;0;5;28,00',
    '00000010;00000019;5;10;45,00'
  ].join('\n'),

  comAliases: [
    'cepi,cepf,pesode,pesoate,tarifa',
    '00000010,00000019,0,5,35.00'
  ].join('\n'),

  comLinhaVazia: [
    'cep_inicial,cep_final,peso_inicial,peso_final,valor_frete',
    '00000010,00000019,0,5,28.00',
    '',
    '00000010,00000019,5,10,45.00'
  ].join('\n'),

  cepInvalido: [
    'cep_inicial,cep_final,peso_inicial,peso_final,valor_frete',
    'ABCDEFGH,09999999,0,5,35.00'
  ].join('\n'),

  pesoInvalido: [
    'cep_inicial,cep_final,peso_inicial,peso_final,valor_frete',
    '00000010,00000019,10,5,35.00'
  ].join('\n'),

  valorZero: [
    'cep_inicial,cep_final,peso_inicial,peso_final,valor_frete',
    '00000010,00000019,0,5,0'
  ].join('\n'),

  semColunasObrigatorias: [
    'nome,endereco,cidade',
    'João,Rua A,SP'
  ].join('\n')
};

const METADADOS_CSV = {
  jadlog: {
    nome: `${PREFIX}IMPORT_JADLOG`,
    transportadora: 'Jadlog',
    data_inicio: '2025-01-01'
  },
  correios: {
    nome: `${PREFIX}IMPORT_CORREIOS`,
    transportadora: 'Correios',
    data_inicio: '2025-01-01'
  },
  xlsx: {
    nome: `${PREFIX}IMPORT_XLSX`,
    transportadora: 'Total Express',
    data_inicio: '2025-01-01'
  }
};

const PARAMS_ENGINE = {
  comTabela: {
    cepOrigem: '00000001', cepDestino: '00000055',
    peso: 3.0, comprimento: 20, altura: 20, largura: 20,
    transportadora: `${PREFIX}CARRIER`
  },
  semTabela: {
    cepOrigem: '00000001', cepDestino: '00000099',
    peso: 999, comprimento: 100, altura: 100, largura: 100,
    transportadora: 'CARRIER_INEXISTENTE_HOMOLOG'
  },
  cacheTest: {
    cepOrigem: '00000002', cepDestino: '00000055',
    peso: 1.5, comprimento: 15, altura: 15, largura: 15,
    transportadora: 'CARRIER_INEXISTENTE_HOMOLOG'
  },
  cacheExpirado: {
    cepOrigem: '00000003', cepDestino: '00000055',
    peso: 2.5, comprimento: 18, altura: 18, largura: 18,
    transportadora: 'CARRIER_INEXISTENTE_HOMOLOG'
  },
  apiIndisponivel: {
    cepOrigem: '00000004', cepDestino: '00000055',
    peso: 4.0, comprimento: 22, altura: 22, largura: 22,
    transportadora: 'CARRIER_INEXISTENTE_HOMOLOG'
  }
};

module.exports = { PREFIX, PEDIDOS, TABELAS_CONTRATUAIS, CENARIOS_FRETE, CSVS, METADADOS_CSV, PARAMS_ENGINE };
