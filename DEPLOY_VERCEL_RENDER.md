# DEPLOY AUDITCARGO — Vercel + Render

---

## PASSO 1 — Backend no Render (5 min)

### 1.1 Suba o código no GitHub
```bash
cd C:\Users\Bi\AUDITCARGO
git init
git add .
git commit -m "feat: AUDITCARGO MVP"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/auditcargo.git
git push -u origin main
```

### 1.2 Crie o serviço no Render
1. Acesse **render.com** → New → Web Service
2. Conecte o repositório `auditcargo`
3. Configure:
   - **Name:** `auditcargo-api`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. Clique **Deploy Web Service**
5. Aguarde ~3 min → copie a URL: `https://auditcargo-api-XXXX.onrender.com`

---

## PASSO 2 — Atualize a URL do backend (1 min)

Edite **`public/config.js`** e substitua a URL:

```js
window.API_BASE = window.location.hostname === 'localhost'
  ? ''
  : 'https://auditcargo-api-XXXX.onrender.com'; // ← COLE SUA URL DO RENDER AQUI
```

Depois faça push:
```bash
git add public/config.js
git commit -m "config: url do backend Render"
git push
```

---

## PASSO 3 — Frontend na Vercel (3 min)

### Opção A — Via CLI (recomendado)
```bash
npm install -g vercel
vercel --cwd public --prod
```
Responda às perguntas:
- Project name: `auditcargo`
- Framework: `Other`
- Directory: `.` (já está em /public)

### Opção B — Via Dashboard
1. Acesse **vercel.com** → New Project
2. Importe o repositório `auditcargo` do GitHub
3. Configure:
   - **Root Directory:** `public`
   - **Framework Preset:** Other
   - **Build Command:** *(deixe vazio)*
   - **Output Directory:** `.`
4. Clique **Deploy**

Copie a URL: `https://auditcargo.vercel.app`

---

## PASSO 4 — Configure CORS no Render (1 min)

No painel do Render → seu serviço → **Environment**:
```
FRONTEND_URL = https://auditcargo.vercel.app
```
Clique **Save** → aguarda redeploy automático.

---

## RESULTADO FINAL

| O quê | URL |
|-------|-----|
| **Frontend (cliente acessa)** | `https://auditcargo.vercel.app/install.html` |
| **Dashboard** | `https://auditcargo.vercel.app/dashboard.html` |
| **Webhook (VTEX/Bling)** | `https://auditcargo-api-XXXX.onrender.com/webhook` |
| **API** | `https://auditcargo-api-XXXX.onrender.com/api/...` |

**URL para enviar ao cliente:**
```
https://auditcargo.vercel.app/install.html
```

---

## ⚠️ Limitação do plano gratuito Render

O banco SQLite fica em memória volátil — **dados se perdem a cada redeploy**.

Para dados persistentes (produção real), no Render:
- Dashboard → seu serviço → **Disks** → Add Disk
- Mount Path: `/opt/render/project/src/database`
- Custo: $0.25/GB/mês (~$1/mês)

Ou migre para **Turso** (SQLite cloud gratuito):
```bash
npm install @libsql/client
```
*(solicite a migração se precisar)*

---

## Comandos de verificação pós-deploy

```bash
# Testa backend
curl https://auditcargo-api-XXXX.onrender.com/health

# Testa webhook
curl -X POST https://auditcargo-api-XXXX.onrender.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"pedidoId":"TESTE-01","cepOrigem":"01310100","cepDestino":"20040020","peso":2.5,"comprimento":30,"altura":20,"largura":20,"freteCobrado":45.90}'
```
