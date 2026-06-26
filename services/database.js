require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const DB_DIR = path.join(__dirname, '..', 'database');
const DB_FILE = path.join(DB_DIR, 'auditcargo.db');

let _client = null;

function rowToObj(row, columns) {
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

async function initDB() {
  if (process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN) {
    _client = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log('✅ Banco: Turso (cloud)');
  } else {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    _client = createClient({ url: `file:${DB_FILE}` });
    console.log('✅ Banco: SQLite local');
  }

  const setupStatements = [
    `CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedidoId TEXT UNIQUE,
      cepOrigem TEXT,
      cepDestino TEXT,
      peso REAL,
      comprimento REAL,
      altura REAL,
      largura REAL,
      freteCobrado REAL,
      freteCorreto REAL,
      economia REAL,
      dataHora DATETIME DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pendente',
      enviado INTEGER DEFAULT 0,
      observacao TEXT,
      fonte_referencia TEXT,
      nivel_confianca TEXT,
      versao_motor TEXT,
      observacao_auditoria TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS melhor_envio_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave_cache TEXT NOT NULL,
      cep_origem TEXT,
      cep_destino TEXT,
      peso REAL,
      comprimento REAL,
      altura REAL,
      largura REAL,
      preco REAL,
      status_http INTEGER,
      tempo_resposta_ms INTEGER,
      data_consulta_api TEXT,
      criado_em DATETIME DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS tabelas_frete (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      transportadora TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT,
      status TEXT NOT NULL DEFAULT 'ativa',
      observacoes TEXT,
      criado_em DATETIME DEFAULT (datetime('now')),
      atualizado_em DATETIME DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS faixas_tarifarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tabela_id INTEGER NOT NULL REFERENCES tabelas_frete(id),
      cep_inicial TEXT NOT NULL,
      cep_final TEXT NOT NULL,
      peso_inicial REAL NOT NULL,
      peso_final REAL NOT NULL,
      valor_frete REAL NOT NULL,
      cubagem REAL,
      gris REAL,
      pedagio REAL,
      ad_valorem REAL,
      icms REAL,
      taxas_adicionais TEXT,
      criado_em DATETIME DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS logs_importacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tabela_id INTEGER REFERENCES tabelas_frete(id),
      arquivo_origem TEXT,
      total_registros INTEGER,
      importados INTEGER,
      ignorados INTEGER,
      erros INTEGER,
      usuario TEXT,
      importado_em DATETIME DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_uuid TEXT UNIQUE NOT NULL,
      audit_hash TEXT,
      data_emissao_relatorio TEXT NOT NULL,
      total_pedidos INTEGER DEFAULT 0,
      total_documentos INTEGER DEFAULT 0,
      total_paginas INTEGER DEFAULT 0,
      versao_motor TEXT,
      fontes_utilizadas TEXT,
      criado_em DATETIME DEFAULT (datetime('now'))
    )`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_nome','Seu Cliente')`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_email','cliente@email.com')`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('empresa_nome','Minha Empresa')`,
  ];

  for (const sql of setupStatements) {
    await _client.execute(sql);
  }

  // Migrations: adicionar novas colunas em bancos existentes sem remover nenhuma coluna
  const migrations = [
    `ALTER TABLE pedidos ADD COLUMN fonte_referencia TEXT`,
    `ALTER TABLE pedidos ADD COLUMN nivel_confianca TEXT`,
    `ALTER TABLE pedidos ADD COLUMN versao_motor TEXT`,
    `ALTER TABLE pedidos ADD COLUMN observacao_auditoria TEXT`,
    `ALTER TABLE tabelas_frete ADD COLUMN arquivo_origem TEXT`,
    `ALTER TABLE tabelas_frete ADD COLUMN usuario TEXT`,
    `ALTER TABLE relatorios ADD COLUMN total_paginas INTEGER DEFAULT 0`,
  ];
  for (const migration of migrations) {
    try { await _client.execute(migration); } catch {}
  }

  return _client;
}

// Executa SQL sem retorno
async function run(sql, params = []) {
  await _client.execute({ sql, args: params });
}

// Retorna primeira linha como objeto
async function get(sql, params = []) {
  const result = await _client.execute({ sql, args: params });
  if (!result.rows.length) return undefined;
  return rowToObj(result.rows[0], result.columns);
}

// Retorna todas as linhas como array de objetos
async function all(sql, params = []) {
  const result = await _client.execute({ sql, args: params });
  return result.rows.map(row => rowToObj(row, result.columns));
}

// Executa INSERT e retorna o lastInsertRowid
async function runInsert(sql, params = []) {
  const result = await _client.execute({ sql, args: params });
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

// No-op: Turso e libsql persistem automaticamente
function save() {}

module.exports = { initDB, run, get, all, runInsert, save };
