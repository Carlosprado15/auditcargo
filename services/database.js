const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'database');
const DB_PATH = path.join(DB_DIR, 'auditcargo.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let _db = null;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }

  _db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
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
    );
    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );
    INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_nome','Seu Cliente');
    INSERT OR IGNORE INTO config (chave, valor) VALUES ('cliente_email','cliente@email.com');
    INSERT OR IGNORE INTO config (chave, valor) VALUES ('empresa_nome','Minha Empresa');
  `);

  save();
  return _db;
}

function save() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

// Executa SQL sem retorno
function run(sql, params = []) {
  _db.run(sql, params);
  save();
}

// Retorna primeira linha como objeto
function get(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return result;
}

// Retorna todas as linhas como array de objetos
function all(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Executa e retorna o last insert rowid via SELECT
function runInsert(sql, params = []) {
  _db.run(sql, params);
  const row = get('SELECT last_insert_rowid() AS id');
  save();
  return row ? row.id : null;
}

module.exports = { initDB, run, get, all, runInsert, save };
