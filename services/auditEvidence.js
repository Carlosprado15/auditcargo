const FONTE_LABELS = {
  tabela_cliente: 'Tabela Contratual',
  melhor_envio: 'API Melhor Envio',
  fallback: 'Estimativa Interna (Fallback)'
};

function extrairTransportadora(pedido) {
  const obs = pedido.observacao_auditoria || '';
  // Pattern from tabelaContratual.js: 'Tabela "Name" - CarrierName'
  const match = obs.match(/Tabela\s+"[^"]*"\s+-\s+(.+)/i);
  if (match) return match[1].trim();
  if (obs.toLowerCase().includes('melhor envio')) return 'Múltiplas (Melhor Envio)';
  return 'Não identificado';
}

function gerarFundamentacao(pedido) {
  const fonte = pedido.fonte_referencia || 'fallback';
  const confianca = pedido.nivel_confianca || 'BAIXA';
  const obs = pedido.observacao_auditoria || '';
  const origemObs = obs ? ` Detalhe da fonte: ${obs}.` : '';

  if (fonte === 'tabela_cliente') {
    return (
      `O valor de referência foi obtido a partir da tabela contratual cadastrada no sistema, que representa ` +
      `o acordo comercial vigente entre o embarcador e a transportadora. ` +
      `Critério utilizado: correspondência do CEP de destino (${pedido.cepDestino}) e faixa de peso ` +
      `(${pedido.peso} kg) com as faixas tarifárias da tabela ativa com maior prioridade de data. ` +
      `As taxas adicionais aplicáveis (GRIS, pedágio, ad valorem, ICMS) foram somadas ao valor base conforme contrato. ` +
      `Nível de confiança: ${confianca} — comparação direta com valor acordado em contrato.${origemObs}`
    );
  }

  if (fonte === 'melhor_envio') {
    return (
      `O valor de referência foi obtido via consulta à API Melhor Envio, representando o preço de mercado ` +
      `praticado para a rota e características do envio. ` +
      `Critério utilizado: menor preço disponível entre as transportadoras retornadas pela API para o CEP de ` +
      `destino (${pedido.cepDestino}) com peso de ${pedido.peso} kg e dimensões ${pedido.comprimento || '—'} x ` +
      `${pedido.altura || '—'} x ${pedido.largura || '—'} cm. ` +
      `O resultado foi obtido de cache ou consulta direta à API, com validade de 24 horas. ` +
      `Nível de confiança: ${confianca} — preço de mercado verificado em tempo real.${origemObs}`
    );
  }

  return (
    `Na ausência de tabela contratual cadastrada e de resposta disponível da API de mercado, o valor de ` +
    `referência foi obtido por estimativa interna baseada em fórmula proporcional ao peso cubado e à região ` +
    `geográfica de destino. Critério utilizado: cálculo interno por cubagem para a rota ` +
    `${pedido.cepOrigem} → ${pedido.cepDestino}, com peso de ${pedido.peso} kg. ` +
    `Este método representa uma estimativa e não um valor contratual ou de mercado verificado. ` +
    `Nível de confiança: ${confianca} — estimativa calculada sem fonte externa disponível.${origemObs}`
  );
}

function gerarObservacoes(pedido) {
  const fonte = pedido.fonte_referencia || 'fallback';

  if (fonte === 'fallback') {
    return (
      'ATENÇÃO: Esta comparação foi realizada utilizando cálculo estimativo (fallback interno), pois não havia ' +
      'tabela contratual cadastrada nem resposta da API de mercado disponível no momento da auditoria. ' +
      'Recomenda-se validação adicional com a tabela contratual da transportadora antes de qualquer contestação formal.'
    );
  }

  if (fonte === 'tabela_cliente') {
    return 'Fonte verificada: tabela contratual cadastrada no sistema. Comparação direta com o valor acordado em contrato.';
  }

  if (fonte === 'melhor_envio') {
    return 'Fonte verificada: API Melhor Envio (preço de mercado). Comparação com o menor preço disponível para a rota.';
  }

  return '';
}

function gerarAuditEvidence(pedido) {
  const freteCobrado = Number(pedido.freteCobrado) || 0;
  const freteCorreto = Number(pedido.freteCorreto) || 0;
  const diferenca = Math.max(0, freteCobrado - freteCorreto);
  const percentual = freteCobrado > 0 ? ((diferenca / freteCobrado) * 100).toFixed(1) : '0.0';
  const fonte = pedido.fonte_referencia || 'fallback';

  return {
    documentoAnalisado: {
      origem: 'Sistema AUDITCARGO',
      nome: pedido.pedidoId,
      dataAnalise: pedido.dataHora
    },
    dadosExtraidos: {
      transportadora: extrairTransportadora(pedido),
      cepOrigem: pedido.cepOrigem,
      cepDestino: pedido.cepDestino,
      peso: pedido.peso,
      comprimento: pedido.comprimento,
      altura: pedido.altura,
      largura: pedido.largura,
      valorCobrado: freteCobrado
    },
    referenciaUtilizada: {
      tipo: fonte,
      label: FONTE_LABELS[fonte] || 'Não identificado',
      nivelConfianca: pedido.nivel_confianca || 'BAIXA'
    },
    resultadoEncontrado: {
      valorCobrado: freteCobrado,
      valorReferencia: freteCorreto,
      diferenca,
      percentual
    },
    fundamentacao: gerarFundamentacao(pedido),
    rastreabilidade: {
      versaoMotor: pedido.versao_motor || '1.0',
      dataHora: pedido.dataHora,
      origemDados: FONTE_LABELS[fonte] || 'Não identificado',
      identificacaoAuditoria: `${pedido.id ? 'ID#' + pedido.id + ' / ' : ''}${pedido.pedidoId}`
    },
    observacoes: gerarObservacoes(pedido)
  };
}

module.exports = { gerarAuditEvidence };
