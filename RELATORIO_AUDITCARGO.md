# RELATORIO AUDITCARGO — Análise Técnica Completa

> Gerado em: 2026-06-26
> Base: leitura direta de todos os arquivos do projeto

---

## 1. ARQUITETURA ATUAL

### O que o sistema faz hoje tecnicamente

O AUDITCARGO é um auditor de fretes que recebe dados de pedidos (CEPs de origem e destino, peso, dimensões e valor cobrado pela transportadora), calcula internamente quanto o frete *deveria* ter custado e registra a diferença como "economia". O usuário acessa um dashboard para ver os valores e, se houver cobrança indevida, pode gerar um PDF de glosa ou abrir um e-mail para solicitar reembolso.

### Fluxo completo de dados

```
[Fonte de dados]
       │
       ├─ Modo PUSH: POST /webhook   ← plataforma de e-commerce envia JSON
       └─ Modo PULL: VTEX sync       ← sistema busca pedidos via API VTEX
               │
               ▼
  [freteCalculator.js]
  calcularFrete(cepOrigem, cepDestino, peso, comprimento, altura, largura)
  → Retorna freteCorreto (estimativa própria)
               │
               ▼
  [database.js / sql.js]
  INSERT OR REPLACE INTO pedidos (pedidoId, freteCobrado, freteCorreto, economia, status, ...)
               │
               ▼
  [REST API]  ←── [Frontend (browser)]
  GET /api/resumo     → cards de totais no dashboard
  GET /api/grafico    → dados para gráfico de barras (últimos 15 dias)
  GET /api/pedidos    → tabela de pedidos (LIMIT 50)
  GET /api/relatorio/pdf → PDF de glosa via PDFKit
```

### Integrações existentes

**VTEX (implementada e funcional):**
- Validação da loja: `GET /{account}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1` — loja real retorna 200 ou 400; inexistente retorna 404
- Validação de credenciais: `GET /api/oms/pvt/orders?per_page=1` — 200 = válido, 401/403 = inválido
- Sync de pedidos: `GET /api/oms/pvt/orders?f_status=invoiced&per_page=50&page=N` — paginado, max 100 pedidos, delay de 120ms entre requisições para respeitar rate limit
- Extração por pedido: `GET /api/oms/pvt/orders/{orderId}` — extrai frete de `totals[Shipping].value/100`, CEP destino de `shippingData.address.postalCode`, dimensões de `packageAttachment.packages[0].dimensions`
- Autenticação: App Key + App Token via headers `X-VTEX-API-AppKey` / `X-VTEX-API-AppToken`

**Webhook genérico (implementado, integração manual):**
- `POST /webhook` aceita JSON com 8 campos: pedidoId, cepOrigem, cepDestino, peso, comprimento, altura, largura, freteCobrado
- Sem autenticação no endpoint — qualquer POST com o payload correto é aceito

### Banco de dados

**Motor:** `sql.js` (SQLite via WebAssembly — sem dependência nativa)
**Arquivo:** `database/auditcargo.db`
**Persistência:** carregado em memória na inicialização, gravado em disco (`fs.writeFileSync`) após cada escrita

**Tabela `pedidos`:**
```sql
id           INTEGER PRIMARY KEY AUTOINCREMENT
pedidoId     TEXT UNIQUE
cepOrigem    TEXT
cepDestino   TEXT
peso         REAL
comprimento  REAL
altura       REAL
largura      REAL
freteCobrado REAL         -- valor cobrado pela transportadora
freteCorreto REAL         -- valor calculado pelo AUDITCARGO
economia     REAL         -- max(0, freteCobrado - freteCorreto)
dataHora     DATETIME     -- DEFAULT datetime('now')
status       TEXT         -- 'correto' | 'cobrado_a_mais' | 'economia_identificada' | 'pendente'
enviado      INTEGER      -- 0 ou 1 (cobrança enviada à transportadora)
observacao   TEXT         -- campo existe mas nunca é preenchido pelo sistema
```

**Tabela `config` (chave-valor):**
```
cliente_nome          -- nome do responsável (exibido no PDF)
cliente_email         -- e-mail (não usado para envio automático)
empresa_nome          -- nome da empresa (exibido no PDF)
vtex_account          -- nome da loja VTEX
vtex_appkey           -- App Key (armazenado em plaintext)
vtex_apptoken         -- App Token (armazenado em plaintext)
vtex_origin_cep       -- CEP do depósito/galpão
vtex_connected        -- 'true' ou ausente
vtex_synced_count     -- quantidade de pedidos importados no último sync
vtex_last_sync        -- ISO timestamp do último sync
vtex_order_count      -- total de pedidos na loja VTEX (retornado na validação)
```

---

## 2. FUNCIONALIDADES EXISTENTES

### Backend — o que já processa

| Endpoint | Método | Funcionamento |
|---|---|---|
| `/webhook` | POST | Valida campos, calcula frete correto, salva auditoria |
| `/api/resumo` | GET | Agrega totais: gasto, correto, economia, %, contagem |
| `/api/grafico` | GET | 15 dias agrupados por data (preenche dias sem dados com zero) |
| `/api/pedidos` | GET | Últimos 50 pedidos ordenados por data DESC |
| `/api/pedidos/:id` | GET | Detalhes completos de um pedido |
| `/api/pedidos/:id/enviado` | PATCH | Marca flag `enviado = 1` |
| `/api/relatorio` | GET | JSON completo para relatório |
| `/api/relatorio/pdf` | GET | PDF de glosa gerado via PDFKit, piped direto para o response |
| `/api/config` | GET | Lê configurações da tabela config |
| `/api/config` | POST | Salva cliente_nome, cliente_email, empresa_nome |
| `/api/seed` | POST | Insere 10 pedidos de exemplo hardcoded |
| `/api/vtex/validate-store` | POST | Valida existência da loja VTEX |
| `/api/vtex/connect` | POST | Valida credenciais, salva no BD, dispara sync em background |
| `/api/vtex/status` | GET | Estado da conexão VTEX (connected, account, lastSync, counts) |
| `/api/vtex/sync` | POST | Sync manual de até 100 pedidos |
| `/api/vtex/disconnect` | DELETE | Remove todas as chaves `vtex_*` do config |
| `/health` | GET | `{status: 'ok', version: '1.0.0', name: 'AUDITCARGO'}` |

### Frontend — o que já faz

**`install.html`**
- Landing page de conversão com radial gradient, badge animado, lista de features, stats (38%, 100%, 60s — valores fixos no HTML)
- Botão único "Instalar AUDITCARGO" → `connect.html`
- Auto-redireciona para dashboard se VTEX já estiver conectada

**`connect.html`** (wizard OAuth-like)
- Step 1: campo de nome da loja com sufixo `.vtexcommercestable.com.br`, validação em tempo real via API
- Step 2: App Key, App Token (com toggle de visibilidade), CEP do depósito, lista de permissões, link para tutorial VTEX
- Step 3: animação de sync com 4 passos (verificar loja → validar credenciais → importar pedidos → auditar fretes)
- Step 4: tela de sucesso com contagem de pedidos da loja e botão para o dashboard
- Auto-redireciona para dashboard se já conectada

**`dashboard.html`**
- Loading overlay com spinner durante inicialização
- Banner verde (VTEX conectada): nome da loja, botão de sync manual, botão desconectar, timestamp do último sync
- CTA azul dashed (VTEX não conectada): link para connect.html
- 3 cards: Total Gasto, Valor Real, Economia Total (com %)
- Gráfico de barras duplas via Canvas API puro (sem biblioteca): frete cobrado vs correto, 15 dias, tooltips no hover, responsivo
- Tabela: últimos 10 pedidos exibidos (busca 50 mas renderiza `slice(0, 10)`)
- Modal de cobrança: preenche e-mail automaticamente com dados do pedido, botão "Abrir no Gmail/Outlook" via `mailto:`, botão copiar

**`config.html`**
- Exibe e permite copiar a URL do webhook
- Formulário para dados do cliente (nome, e-mail, empresa)
- Botão "Enviar Pedido de Teste" que chama o webhook local
- Exibe formato completo do payload com syntax highlight

**`config.js`**
- Detecta ambiente pelo hostname: `localhost` → `BASE = ''` (same-origin) | qualquer outro → `BASE = 'https://auditcargo-api.onrender.com'`
- Carregado por todos os HTMLs via `<script src="config.js">`

### O que está funcionando 100%

- Recebimento e auditoria de pedidos via webhook (push)
- Integração completa com VTEX (pull): validação de loja, credenciais, sync paginado, sync manual
- Dashboard com cards, gráfico Canvas e tabela
- Geração de PDF de glosa via PDFKit
- Wizard de onboarding VTEX (3 passos)
- Configuração e persistência de dados do cliente
- Dados de exemplo via seed
- Deploy separado: backend no Render, frontend no Vercel
- CORS configurável via variável `FRONTEND_URL`
- Demo script (`demo.js`) com 50 pedidos simulados e barra de progresso

---

## 3. LIMITAÇÕES ATUAIS

### Motor de cálculo de frete — limitação crítica

O cálculo de frete é uma **estimativa própria**, não uma consulta a tabelas reais de transportadoras.

**Como funciona hoje (`freteCalculator.js`):**
```
pesoCubado = (comprimento × altura × largura) / 6000
pesoFinal  = max(peso, pesoCubado)

distância  = estimada pelo PRIMEIRO DÍGITO do CEP (0 a 9)
             → diferença 0 = 100 km; diferença 6+ = 2200 km
             (São Paulo e Minas Gerais ficam na mesma faixa: dígitos 0/1/3)

frete = tarifaBase + (pesoFinal × tarifaPorKg) + (distância × 0,003)
```

**O que a fórmula NÃO captura:**
- Tabelas reais de transportadoras (Correios, Jadlog, Azul Cargo, Total Express, etc.)
- GRIS (Gerenciamento de Risco), TDA, TDE, pedágio, taxa de coleta
- Seguro de carga
- Diferença de prazo (SEDEX vs PAC vs Econômico)
- Zonas de entrega reais (transportadoras usam CEP por CEP, não por primeiro dígito)
- Peso máximo por faixa, dimensional mínimo
- Cubagem fator diferente (algumas transportadoras usam fator 5000 ou 4000, não 6000)

**Consequência:** o sistema identifica diferenças, mas o valor "correto" calculado pode não corresponder à tarifa real da transportadora, tornando a glosa contestável.

### Limitações de plataforma e hardcodes

- Somente VTEX tem integração nativa
- Sync VTEX limitado a 100 pedidos por chamada (hardcoded em `routes/vtex.js:82`)
- Sync VTEX só busca pedidos com `f_status=invoiced` — pedidos cancelados ou em outros status não são auditados
- Tabela de pedidos exibe `slice(0, 10)` no frontend mas busca 50 — os outros 40 não aparecem
- `GET /api/pedidos` tem `LIMIT 50` hardcoded — lojas com mais pedidos nunca verão o histórico completo
- Dashboard sem paginação, sem filtros por data, status ou valor
- Delay de 30ms entre requests no `demo.js` e 120ms no sync VTEX — pode ser insuficiente para lojas com API rate limit mais agressivo
- Stats na landing page (38%, 100%, 60s) são valores fixos no HTML, não calculados

### O que está incompleto ou mockado

| Item | Estado |
|---|---|
| Campo `observacao` na tabela `pedidos` | Criado no schema, nunca preenchido |
| Envio de e-mail real (SMTP) | Não existe — abre `mailto:` no cliente de e-mail do usuário |
| Polling automático VTEX | Não existe — sync só quando chamado via botão ou na conexão inicial |
| Autenticação/login | Não existe — dashboard e API são públicos |
| Criptografia de credenciais | Não existe — App Key/Token ficam em plaintext no SQLite |
| Plataformas listadas na landing (Bling, Tiny, Magento, WooCommerce) | Listadas como "compatíveis" mas sem integração nativa implementada |
| Multi-tenancy | Não existe — banco único sem campo de tenant |
| Exportação CSV/Excel | Não existe |
| Filtros no dashboard | Não existem |
| Rate limiting no webhook | Não existe |

### Inconsistência de UX

O wizard `connect.html` informa: *"Suas credenciais ficam armazenadas apenas no seu computador."*
No deploy Vercel + Render, as credenciais ficam no banco SQLite do servidor Render — não no computador do usuário. Esta afirmação é incorreta no cenário de produção.

---

## 4. MODELO DE DADOS

### Dados coletados hoje por pedido

```
Identificação:  pedidoId (string único — pode ser ID da VTEX ou qualquer string)
Logística:      cepOrigem, cepDestino (strings, 8 dígitos)
Físico:         peso (kg), comprimento (cm), altura (cm), largura (cm)
Financeiro:     freteCobrado (R$), freteCorreto (R$), economia (R$)
Classificação:  status (correto | cobrado_a_mais | economia_identificada | pendente)
Controle:       dataHora, enviado (flag de cobrança), observacao (vazio)
```

### Dados que o sistema NÃO coleta por pedido

```
Transportadora (nome da empresa que cobrou)
Rastreamento / código de rastreio
Destinatário (nome, cidade, estado)
Produtos do pedido (itens, SKUs, categorias)
Valor do pedido (só o frete)
Prazo de entrega contratado
Tipo de serviço (expresso, econômico, etc.)
Nota fiscal (NF-e)
```

### O que seria necessário para suportar qualquer empresa

O esquema atual suporta apenas um único cliente sem identificação. Para multi-tenancy real:

**Tabela `empresas`** (nova)
```sql
id           INTEGER PRIMARY KEY
nome         TEXT
email        TEXT UNIQUE
plano        TEXT    -- free | pro | enterprise
ativo        INTEGER
criado_em    DATETIME
```

**Tabela `usuarios`** (nova)
```sql
id           INTEGER PRIMARY KEY
empresa_id   INTEGER FK → empresas.id
email        TEXT UNIQUE
senha_hash   TEXT
papel        TEXT    -- admin | viewer
```

**Tabela `integracoes`** (nova)
```sql
id                INTEGER PRIMARY KEY
empresa_id        INTEGER FK → empresas.id
plataforma        TEXT    -- vtex | bling | tiny | woocommerce | webhook | planilha
credenciais       TEXT    -- JSON criptografado
cep_origem        TEXT
ativo             INTEGER
ultimo_sync       DATETIME
pedidos_sincronizados INTEGER
```

**Tabela `pedidos`** (adicionar campo)
```sql
empresa_id   INTEGER FK → empresas.id   -- particionamento por tenant
```

**Tabela `tabelas_frete`** (nova — para auditoria real)
```sql
id              INTEGER PRIMARY KEY
empresa_id      INTEGER FK → empresas.id
transportadora  TEXT
tipo_servico    TEXT
vigencia_inicio DATE
vigencia_fim    DATE
faixas_json     TEXT    -- JSON com faixas de peso × CEP × preço
```

---

## 5. GAPS IDENTIFICADOS

### GAP 1 — Motor de cálculo sem base real (crítico)

**Problema:** A fórmula atual é uma aproximação simplificada que não reflete as tabelas reais de nenhuma transportadora. A "economia" identificada pode ser diferente da glosa que a transportadora vai aceitar.

**O que falta:**
- Importação de tabelas de frete reais por transportadora (planilha → BD)
- Integração com APIs de cotação: Frenet, Melhor Envio, ou APIs diretas dos Correios/Jadlog/Azul
- Ou pelo menos: tabelas de frete editáveis por cliente no dashboard

**Impacto:** sem isso, o sistema é uma ferramenta de *estimativa*, não de *auditoria legal*.

### GAP 2 — Sem autenticação

**Problema:** Qualquer pessoa com a URL do Render tem acesso total ao dashboard, pode ver todos os pedidos, as credenciais VTEX (via API), gerar PDFs e alterar configurações.

**O que falta:**
- Login por e-mail + senha (mínimo para MVP comercial)
- JWT ou session com expiração
- Proteção de todos os endpoints `/api/*` exceto `/health` e `/webhook`

### GAP 3 — Single-tenant

**Problema:** O banco não tem campo de empresa/tenant. Um único servidor atende um único cliente. Para vender o produto para múltiplos clientes, seria necessário criar uma instância separada para cada um.

**O que falta:**
- Campo `empresa_id` na tabela `pedidos`
- Tabela de empresas e usuários
- Isolamento de dados na camada da API
- Sistema de cadastro/onboarding

### GAP 4 — Integrações além de VTEX

**Problema:** A landing page lista Bling, Tiny, Magento e WooCommerce como "compatíveis", mas nenhum tem integração nativa. Só existe o webhook genérico, que requer configuração técnica manual.

**O que falta por plataforma:**
- **Bling:** OAuth 2.0 + webhooks de pedido (`/v3/pedidos/vendas`)
- **Tiny ERP:** token de API + endpoint `/pedidos.pesquisa.php`
- **WooCommerce:** webhook nativo (pedido criado/atualizado) ou WC REST API
- **Magento 2:** REST API `/V1/orders` + OAuth 1.0a
- **Shopify:** webhook `orders/fulfilled` ou Admin API

### GAP 5 — Entrada de dados para empresas sem e-commerce

**Problema:** Distribuidoras, indústrias e transportadoras que pagam frete mas não têm plataforma de e-commerce não têm como alimentar o sistema.

**O que falta:**
- Upload de planilha Excel/CSV com pedidos (colunas mapeáveis)
- Importação de arquivo TXT/EDI de DANFE ou transportadora
- API documentada para integração com sistemas ERP (SAP, Totvs, Sankhya)

### GAP 6 — Persistência de dados em produção

**Problema:** O Render Free Tier usa filesystem efêmero. O banco SQLite (`database/auditcargo.db`) é apagado a cada redeploy do serviço.

**O que falta (por ordem de custo):**
- Adicionar Disk no Render (~$1/mês) com mount path `/opt/render/project/src/database`
- Migrar para Turso (SQLite cloud, plano gratuito generoso)
- Migrar para PostgreSQL (Render tem plano gratuito com 1GB)

### GAP 7 — Automação do ciclo de cobrança

**Problema:** O sistema identifica a economia mas o processo de cobrança é 100% manual: o usuário copia um texto de e-mail e envia do próprio cliente de e-mail.

**O que falta:**
- Envio de e-mail direto via SMTP/API (SendGrid, Resend, Nodemailer)
- Tracking de disputas: `pendente → enviado → respondido → reembolsado → negado`
- Histórico de comunicação com a transportadora por pedido
- Geração de carta formal com assinatura digital

### GAP 8 — Sem alertas em tempo real

**Problema:** Quando o AUDITCARGO identifica uma cobrança indevida, ninguém é notificado. O usuário precisa entrar no dashboard para ver.

**O que falta:**
- Webhook de saída configurável (notifica sistema do cliente)
- E-mail automático de alerta por threshold (ex: "economia > R$ 50 em um pedido")
- Integração com Slack/WhatsApp Business/Telegram via Zapier ou direta

### GAP 9 — Dashboard sem profundidade analítica

**Problema:** O dashboard atual é um resumo. Empresas com alto volume precisam de análise mais granular.

**O que falta:**
- Filtros por período, transportadora, status, CEP destino
- Paginação real (hoje LIMIT 50, exibe 10)
- Busca por ID do pedido
- Exportação CSV/Excel
- Agrupamento por transportadora (quando esse dado for coletado)
- Comparação mês a mês
- Top 10 pedidos com maior cobrança indevida

---

## Resumo executivo dos gaps por prioridade

| Prioridade | Gap | Esforço estimado |
|---|---|---|
| 🔴 CRÍTICO | Motor de cálculo com tabelas reais | Alto — requer integração com API de cotação ou cadastro de tabelas |
| 🔴 CRÍTICO | Autenticação básica | Médio — JWT ou session com middleware |
| 🔴 CRÍTICO | Persistência confiável (SQLite em disco real) | Baixo — Disk no Render ou migração Turso |
| 🟡 IMPORTANTE | Multi-tenancy | Alto — mudança estrutural no banco e na API |
| 🟡 IMPORTANTE | Integrações Bling/Tiny/WooCommerce | Médio por plataforma |
| 🟡 IMPORTANTE | Ciclo de cobrança automatizado | Médio — SMTP + tracking de status |
| 🟢 DESEJÁVEL | Entrada via planilha | Médio |
| 🟢 DESEJÁVEL | Dashboard com filtros e paginação | Baixo |
| 🟢 DESEJÁVEL | Alertas em tempo real | Baixo |
