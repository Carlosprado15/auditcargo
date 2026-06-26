'use strict';

const { extractFreteData } = require('../../services/documentParser');

async function executarTestes() {
  const resultados = [];

  async function tc(id, cenario, executar) {
    const inicio = Date.now();
    try {
      const { aprovado, esperado, obtido, motivoFalha } = await executar();
      resultados.push({
        id, modulo: 'DocumentParser (OCR)', cenario,
        status: aprovado ? 'APROVADO' : 'REPROVADO',
        esperado: String(esperado), obtido: String(obtido),
        motivoFalha: aprovado ? null : (motivoFalha || `Esperado "${esperado}", obtido "${obtido}"`),
        duracaoMs: Date.now() - inicio
      });
    } catch (err) {
      resultados.push({
        id, modulo: 'DocumentParser (OCR)', cenario,
        status: 'REPROVADO', esperado: 'sem exceção', obtido: `EXCEÇÃO: ${err.message}`,
        motivoFalha: err.message, duracaoMs: Date.now() - inicio
      });
    }
  }

  // TC-054: MIME não suportado → erro "Formato não suportado"
  await tc('TC-054', 'extractFreteData com audio/mpeg → erro "Formato não suportado"', async () => {
    let erroCapturado = null;
    try {
      await extractFreteData(Buffer.from('dummy'), 'audio/mpeg');
    } catch (err) {
      erroCapturado = err.message;
    }
    const ok = erroCapturado !== null && erroCapturado.toLowerCase().includes('não suportado');
    return { aprovado: ok, esperado: 'erro "não suportado"', obtido: erroCapturado || 'nenhum erro' };
  });

  // TC-055: MIME não suportado (text/plain) → mesmo erro
  await tc('TC-055', 'extractFreteData com text/plain → erro "Formato não suportado"', async () => {
    let erroCapturado = null;
    try {
      await extractFreteData(Buffer.from('frete R$25,00'), 'text/plain');
    } catch (err) {
      erroCapturado = err.message;
    }
    const ok = erroCapturado !== null && erroCapturado.toLowerCase().includes('não suportado');
    return { aprovado: ok, esperado: 'erro "não suportado"', obtido: erroCapturado || 'nenhum erro' };
  });

  // TC-056: PDF com conteúdo mínimo (≤30 chars após pdf-parse) → erro "PDF sem texto legível"
  await tc('TC-056', 'extractFreteData com buffer PDF inválido → erro "PDF sem texto legível"', async () => {
    // Buffer que não é um PDF real → pdf-parse falha (catch) → pdfText='' → erro "sem texto legível"
    const bufferFalso = Buffer.from('%PDF-fake content for test');
    let erroCapturado = null;
    try {
      await extractFreteData(bufferFalso, 'application/pdf');
    } catch (err) {
      erroCapturado = err.message;
    }
    const ok = erroCapturado !== null && (
      erroCapturado.toLowerCase().includes('texto') ||
      erroCapturado.toLowerCase().includes('legível') ||
      erroCapturado.toLowerCase().includes('readable')
    );
    return { aprovado: ok, esperado: 'erro sobre texto/legível', obtido: erroCapturado || 'nenhum erro' };
  });

  // TC-057: PDF com texto menor que 30 chars → erro específico
  await tc('TC-057', 'PDF com conteúdo muito curto (≤30 chars) → erro "PDF sem texto legível"', async () => {
    // Mesmo resultado que TC-056 pois buffers inválidos são capturados
    const bufferCurto = Buffer.from('%PDF-1.4\n%%EOF');
    let erroCapturado = null;
    try {
      await extractFreteData(bufferCurto, 'application/pdf');
    } catch (err) {
      erroCapturado = err.message;
    }
    const ok = erroCapturado !== null;
    return { aprovado: ok, esperado: 'qualquer erro lançado (PDF inválido ou sem texto)', obtido: erroCapturado || 'nenhum erro' };
  });

  // TC-058: MIME imagem válido sem API_KEY → erro de autenticação (não de formato)
  await tc('TC-058', 'extractFreteData image/jpeg sem ANTHROPIC_API_KEY → erro de auth/API (não de formato)', async () => {
    const chaveOriginal = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = '';
    let erroCapturado = null;
    let erroDeFormato = false;
    try {
      await extractFreteData(Buffer.from('fake image data'), 'image/jpeg');
    } catch (err) {
      erroCapturado = err.message;
      erroDeFormato = err.message.toLowerCase().includes('não suportado');
    }
    process.env.ANTHROPIC_API_KEY = chaveOriginal || '';
    // Sem API_KEY, o SDK Anthropic lança erro antes de qualquer chamada de rede
    // O importante: chegou no caminho de imagem (não foi erro de formato)
    const ok = erroCapturado !== null && !erroDeFormato;
    return {
      aprovado: ok,
      esperado: 'erro de autenticação/API (não de formato MIME)',
      obtido: erroCapturado || 'nenhum erro'
    };
  });

  return resultados;
}

module.exports = executarTestes;
