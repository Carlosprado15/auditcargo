const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');

const EXTRACTION_PROMPT = `Analise este documento de frete (boleto, conhecimento de transporte, NF-e, etiqueta de envio ou nota fiscal) e extraia os dados no formato JSON abaixo. Se um campo não for encontrado, use null.

Retorne APENAS o JSON, sem texto adicional, sem markdown:
{
  "transportadora": "nome da transportadora ou null",
  "valorCobrado": 0.00,
  "cepOrigem": "00000000",
  "cepDestino": "00000000",
  "peso": 0.0,
  "comprimento": 0,
  "altura": 0,
  "largura": 0
}

Regras de extração:
- valorCobrado: valor total do frete em reais (número decimal, ex: 45.90)
- CEPs: somente dígitos, exatamente 8 caracteres (remover traços e espaços)
- peso: em kg (converter gramas dividindo por 1000)
- dimensões: em cm (comprimento x altura x largura)
- Se não encontrar dimensões, retorne null nesses campos`;

function parseJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('IA não retornou JSON válido');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('Erro ao interpretar JSON da IA');
  }
}

async function extractFromText(text) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `${EXTRACTION_PROMPT}\n\nTexto do documento:\n${text.slice(0, 8000)}`
    }]
  });
  return parseJSON(msg.content[0].text);
}

async function extractFromImage(buffer, mimeType) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') }
        },
        { type: 'text', text: EXTRACTION_PROMPT }
      ]
    }]
  });
  return parseJSON(msg.content[0].text);
}

async function extractFreteData(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    let pdfText = '';
    try {
      const parsed = await pdfParse(buffer);
      pdfText = parsed.text || '';
    } catch {}

    if (pdfText.trim().length > 30) {
      return extractFromText(pdfText);
    }
    throw new Error('PDF sem texto legível. Tente enviar uma imagem JPG ou PNG do documento.');
  }

  const supportedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!supportedImages.includes(mimeType)) {
    throw new Error(`Formato não suportado: ${mimeType}. Use PDF, JPG ou PNG.`);
  }
  return extractFromImage(buffer, mimeType);
}

module.exports = { extractFreteData };
