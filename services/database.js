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
      observacao TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    )`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_nome','Seu Cliente')`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_email','cliente@email.com')`,
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('empresa_nome','Minha Empresa')`,
  ];

  for (const sql of setupStatements) {
    await _client.execute(sql);
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
