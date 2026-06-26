require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, 'PORT=3000\nNODE_ENV=development\n');
}

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:3000']
  : true;
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/dashboard.html'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/config', (req, res) => res.redirect('/config.html'));
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', name: 'AUDITCARGO' }));

async function main() {
  const { initDB } = require('./services/database');
  await initDB();

  const apiRouter = require('./routes/api');
  const vtexRouter = require('./routes/vtex');
  app.use('/api', apiRouter);
  app.use('/api/vtex', vtexRouter);
  app.use('/', apiRouter);

  app.get('/install', (req, res) => res.redirect('/install.html'));
  app.get('/connect', (req, res) => res.redirect('/connect.html'));

  app.listen(PORT, () => {
    const line = '═'.repeat(46);
    console.log(`\n╔${line}╗`);
    console.log(`║          🚀  AUDITCARGO v1.1  ✅ Pronto          ║`);
    console.log(`╠${line}╣`);
    console.log(`║  Instalar  :  http://localhost:${PORT}/install.html      ║`);
    console.log(`║  Dashboard :  http://localhost:${PORT}/dashboard.html    ║`);
    console.log(`║  Webhook   :  http://localhost:${PORT}/webhook           ║`);
    console.log(`╚${line}╝\n`);
  });
}

main().catch(err => {
  console.error('Erro ao iniciar AUDITCARGO:', err);
  process.exit(1);
});
