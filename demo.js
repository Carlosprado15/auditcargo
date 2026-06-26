/**
 * demo.js — Gera 50 pedidos de teste via webhook para demonstração do AUDITCARGO
 * Uso: npm run demo
 */
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TOTAL = 50;

const CEPS_ORIGEM = ['01310100', '04547130', '09060870', '22250040'];
const CEPS_DESTINO = [
  '20040020', '30130010', '40020010', '60175050', '70040010',
  '80010010', '90010020', '50050080', '64000040', '69010080',
  '78000300', '79002230', '88010400', '96010000', '58013020'
];

const PRODUTOS = [
  { nome: 'Notebook',       peso: 2.5,  c: 38, a: 6,  l: 26 },
  { nome: 'Tênis',          peso: 0.8,  c: 32, a: 12, l: 20 },
  { nome: 'Televisão 43"',  peso: 12.0, c: 100,a: 64, l: 10 },
  { nome: 'Livro',          peso: 0.4,  c: 22, a: 3,  l: 16 },
  { nome: 'Perfume',        peso: 0.3,  c: 15, a: 12, l: 8  },
  { nome: 'Fone Bluetooth', peso: 0.35, c: 18, a: 8,  l: 14 },
  { nome: 'Mochila',        peso: 1.2,  c: 40, a: 50, l: 25 },
  { nome: 'Cafeteira',      peso: 3.0,  c: 30, a: 32, l: 22 },
  { nome: 'Tablet',         peso: 0.7,  c: 26, a: 18, l: 2  },
  { nome: 'Liquidificador', peso: 2.2,  c: 28, a: 35, l: 22 },
  { nome: 'Relógio',        peso: 0.2,  c: 12, a: 10, l: 8  },
  { nome: 'Cadeira Gamer',  peso: 18.0, c: 70, a: 75, l: 65 },
  { nome: 'Monitor',        peso: 5.5,  c: 60, a: 40, l: 10 },
  { nome: 'Teclado',        peso: 1.0,  c: 44, a: 4,  l: 14 },
  { nome: 'Caixa de Som',   peso: 1.8,  c: 24, a: 16, l: 16 },
];

// Markup de transportadoras (simula cobranças excessivas entre 5% e 60%)
const MARKUPS = [1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.40, 1.50, 1.60, 1.00, 0.98, 1.35, 1.45, 1.55, 1.08];

function calcFreteCorreto({ peso, comprimento, altura, largura, cepOrigem, cepDestino }) {
  const pesoCubado = (comprimento * altura * largura) / 6000;
  const pesoFinal = Math.max(peso, pesoCubado);
  const d0 = parseInt(String(cepOrigem)[0]);
  const d1 = parseInt(String(cepDestino)[0]);
  const diff = Math.abs(d0 - d1);
  const dist = diff === 0 ? 100 : diff <= 1 ? 300 : diff <= 2 ? 600 : diff <= 3 ? 900 : diff <= 5 ? 1400 : 2200;

  let base = 8, kgRate = 1.2;
  if (pesoFinal <= 0.3) { base = 6.5; kgRate = 0.9; }
  else if (pesoFinal <= 1) { base = 8; kgRate = 1.1; }
  else if (pesoFinal <= 5) { base = 10; kgRate = 1.3; }
  else if (pesoFinal <= 10) { base = 14; kgRate = 1.5; }
  else if (pesoFinal <= 30) { base = 20; kgRate = 1.8; }
  else { base = 35; kgRate = 2.2; }

  return Math.round((base + pesoFinal * kgRate + dist * 0.003) * 100) / 100;
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verificarServidor() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      AUDITCARGO — Gerador de Demo        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Verifica servidor
  process.stdout.write('🔍 Verificando servidor... ');
  const ok = await verificarServidor();
  if (!ok) {
    console.log('\n❌ ERRO: Servidor não está rodando em localhost:3000');
    console.log('   Execute primeiro: npm start');
    process.exit(1);
  }
  console.log('✅ Online!\n');

  console.log(`📦 Enviando ${TOTAL} pedidos de teste para o webhook...\n`);

  let enviados = 0;
  let economiaTotal = 0;
  let erros = 0;

  for (let i = 1; i <= TOTAL; i++) {
    const produto = rand(PRODUTOS);
    const markup = rand(MARKUPS);
    const cepOrigem = rand(CEPS_ORIGEM);
    const cepDestino = rand(CEPS_DESTINO);

    const freteBase = calcFreteCorreto({ peso: produto.peso, comprimento: produto.c, altura: produto.a, largura: produto.l, cepOrigem, cepDestino });
    const freteCobrado = Math.round(freteBase * markup * 100) / 100;

    const pedido = {
      pedidoId: `DEMO-${String(i).padStart(3, '0')}`,
      cepOrigem,
      cepDestino,
      peso: produto.peso,
      comprimento: produto.c,
      altura: produto.a,
      largura: produto.l,
      freteCobrado
    };

    try {
      const resp = await post('/webhook', pedido);
      if (resp.success) {
        enviados++;
        economiaTotal += parseFloat(resp.economia || 0);
        const bar = '█'.repeat(Math.floor((i / TOTAL) * 30));
        const empty = '░'.repeat(30 - bar.length);
        process.stdout.write(`\r  [${bar}${empty}] ${i}/${TOTAL} — Economia acumulada: R$ ${economiaTotal.toFixed(2)}    `);
      }
    } catch (e) {
      erros++;
    }

    await sleep(30);
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║              ✅  DEMO CONCLUÍDO!                 ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  📦 Pedidos enviados  : ${String(enviados).padEnd(24)}║`);
  console.log(`║  💰 Economia total    : R$ ${economiaTotal.toFixed(2).padEnd(21)}║`);
  if (erros > 0)
    console.log(`║  ⚠️  Erros            : ${String(erros).padEnd(24)}║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  🌐 Acesse o dashboard:                          ║');
  console.log('║     http://localhost:3000/dashboard              ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('\n❌ Erro inesperado:', err.message);
  process.exit(1);
});
