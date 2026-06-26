# AUDITORIA TÉCNICA — AUDITCARGO

> Gerado em: 2026-06-26  
> Auditor: Claude Sonnet 4.6  
> Escopo: somente leitura — nenhum arquivo foi alterado

---

## 1. Visão Geral

**Objetivo do sistema**  
AUDITCARGO é um auditor automático de fretes para e-commerces. O sistema recebe dados de pedidos (via webhook, integração com VTEX ou upload de boleto/CT-e), calcula o frete que deveria ter sido cobrado, compara com o valor real cobrado pela transportadora e identifica cobranças indevidas. O resultado é apresentado em um dashboard e pode ser exportado como relatório de glosa em PDF para ser enviado à transportadora solicitando reembolso.

**Tecnologias utilizadas**

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js |
| Framework web | Express 4.18 |
| Banco de dados | SQLite local (`@libsql/client`) / Turso (cloud) |
| IA / OCR | Anthropic Claude Sonnet 4.6 (via `@anthropic-ai/sdk`) |
| Geração de PDF | PDFKit 0.14 |
| Upload | Multer 2.2 |
| Parser de PDF | pdf-parse 2.4 |
| Frontend | HTML5 + CSS3 + JavaScript vanilla (sem framework) |
| Hospedagem backend | Render (Free tier) |
| Hospedagem frontend | Vercel (static) |

**Linguagens**: JavaScript (Node.js no backend, vanilla JS no frontend)

**Banco de dados**: SQLite local com fallback automático para Turso (libSQL cloud)

**APIs externas**:
- Anthropic API (Claude Sonnet 4.6) — extração de dados de documentos
- VTEX Commerce Stable API — importação de pedidos

**Serviços integrados**:
- Render.com — hospedagem do servidor Node.js
- Vercel — hospedagem do frontend estático

---

## 2. Estrutura do Projeto

```
AUDITCARGO/
├── server.js                    # Ponto de entrada, inicialização do Express
├── package.json
├── .env                         # Variáveis de ambiente (não commitado)
├── .env.example                 # Template de variáveis
├── vercel.json                  # Config Vercel (root — backend deploy completo)
├── render.yaml                  # Config Render (deploy do backend)
├── demo.js                      # Script de geração de dados de demonstração
│
├── routes/
│   ├── api.js                   # Rotas principais: webhook, resumo, pedidos, config, relatorio, seed
│   ├── upload.js                # Rota de upload de boleto com IA
│   └── vtex.js                  # Rotas de integração VTEX
│
├── services/
│   ├── database.js              # Abstração do banco de dados (libsql/SQLite/Turso)
│   ├── freteCalculator.js       # Engine de cálculo e classificação do frete
│   ├── documentParser.js        # Extração de dados via Claude (texto e visão)
│   ├── relatorioGenerator.js    # Geração do PDF de glosa com PDFKit
│   └── vtexService.js           # Chamadas à API VTEX e processamento de pedidos
│
├── database/
│   └── auditcargo.db            # Arquivo SQLite local
│
└── public/                      # Frontend estático (servido pelo Express / Vercel)
    ├── dashboard.html            # Dashboard principal
    ├── config.html               # Tela de configuração e webhook
    ├── connect.html              # Wizard de conexão VTEX
    ├── install.html              # Landing page de instalação
    ├── script.js                 # JavaScript do dashboard
    ├── config.js                 # Configuração da URL da API (localhost vs. Render)
    ├── style.css                 # Estilos globais
    └── vercel.json               # Config Vercel (frontend-only, rewrites de rotas)
```

---

## 3. Fluxo Principal

### Fluxo A — Webhook (integração genérica)

```
Plataforma de e-commerce (VTEX, Bling, Magento…)
  │
  │  POST /webhook  { pedidoId, cepOrigem, cepDestino, peso, dimensões, freteCobrado }
  ▼
routes/api.js (linha 8)
  │  Validação de campos obrigatórios
  ▼
services/freteCalculator.js — calcularFrete()
  │  1. Calcula peso cubado: (comp × alt × larg) / 6000
  │  2. Usa maior entre peso real e cubado
  │  3. Estima distância pelo primeiro dígito do CEP
  │  4. Aplica tarifa baseada em faixa de peso
  ▼
services/freteCalculator.js — determinarStatus()
  │  Diferença ≤ R$ 0,50         → "correto"
  │  Diferença > R$ 0,50 (≤ 5%) → "economia_identificada"
  │  Diferença > R$ 0,50 (> 5%) → "cobrado_a_mais"
  ▼
services/database.js — INSERT OR REPLACE INTO pedidos
  ▼
Resposta JSON: { success, economia, freteCorreto, status }
```

---

### Fluxo B — Upload de Boleto / CT-e com IA

```
Usuário clica em "Auditar Novo Frete" e faz upload de PDF/imagem
  │
  │  POST /api/upload  (multipart/form-data, campo: "documento")
  ▼
routes/upload.js
  │  Multer: valida MIME type (PDF, JPG, PNG, GIF, WEBP) e tamanho (≤ 5MB)
  │  Verifica presença de ANTHROPIC_API_KEY
  ▼
services/documentParser.js — extractFreteData()
  │
  ├─ PDF? → pdf-parse extrai texto
  │    ├─ Texto > 30 chars? → extractFromText() → Claude API (Messages, texto)
  │    └─ Sem texto?        → Erro: "PDF sem texto legível. Use JPG/PNG."
  │
  └─ Imagem? → extractFromImage() → Claude API (Messages, vision base64)
       │
       │  Prompt instrui Claude a retornar SOMENTE JSON:
       │  { transportadora, valorCobrado, cepOrigem, cepDestino, peso, comp, alt, larg }
       ▼
services/documentParser.js — parseJSON()
  │  Extrai bloco JSON da resposta com regex
  ▼
routes/upload.js
  │  Valida campos extraídos (CEPs com 8 dígitos, peso > 0, valor > 0)
  │  Campos faltando → HTTP 422 com lista do que não foi extraído
  ▼
services/freteCalculator.js — calcularFrete() + determinarStatus()
  ▼
services/database.js — INSERT OR REPLACE INTO pedidos
  │  pedidoId gerado: "BOLETO-{timestamp}"
  ▼
Resposta JSON: { success, pedidoId, dadosExtraidos, freteCorreto, freteCobrado, economia, status }
  ▼
Frontend (script.js) exibe resultado no modal e atualiza dashboard
```

---

### Fluxo C — Integração VTEX

```
Usuário acessa connect.html e entra com nome da loja + AppKey + AppToken
  │
  │  POST /api/vtex/validate-store
  ▼
services/vtexService.js — validateStore()
  │  GET https://{conta}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1
  │  404 → loja não existe; outros status → loja existe
  ▼
  │  POST /api/vtex/connect
  ▼
services/vtexService.js — validateCredentials()
  │  GET /api/oms/pvt/orders?per_page=1 com headers X-VTEX-API-AppKey/AppToken
  │  200 → credenciais válidas; 401/403 → negado
  ▼
routes/vtex.js — salva credenciais no banco (tabela config)
  │  Inicia syncOrders() em background (não bloqueia a resposta)
  ▼
services/vtexService.js — syncOrders()
  │  Loop paginado: GET /api/oms/pvt/orders?f_status=invoiced&per_page=50
  │  Para cada pedido → processOrder()
  │    ├─ Busca detalhes: GET /api/oms/pvt/orders/{orderId}
  │    ├─ Extrai freteCobrado (totals[Shipping].value / 100)
  │    ├─ Extrai cepDestino (shippingData.address.postalCode)
  │    ├─ Extrai dimensões (packageAttachment) ou estima por quantidade de itens
  │    └─ calcularFrete() + determinarStatus() + INSERT INTO pedidos
  │  delay(120ms) entre pedidos para respeitar rate limit VTEX
  ▼
Dashboard exibe pedidos importados
```

---

### Fluxo D — Relatório de Glosa (PDF)

```
Usuário clica em "Relatório de Glosa" no dashboard
  │
  │  GET /api/relatorio/pdf
  ▼
routes/api.js — buildDadosRelatorio()
  │  SELECT aggregados de pedidos + config do cliente
  ▼
services/relatorioGenerator.js — gerarRelatorioPDF()
  │  PDFKit: cria PDF A4 com cabeçalho, cards de resumo, tabela de pedidos
  │  Stream direto para res (response HTTP)
  ▼
Browser faz download do arquivo relatorio-glosa-{timestamp}.pdf
```

---

## 4. Banco de Dados

**Banco**: SQLite local (arquivo `database/auditcargo.db`) com suporte opcional a Turso (libSQL cloud remoto), selecionado automaticamente em `initDB()` conforme presença de `TURSO_URL` e `TURSO_AUTH_TOKEN`.

**Driver**: `@libsql/client` — compatível com SQLite local e Turso cloud com a mesma API.

---

### Tabela: `pedidos`

**Finalidade**: Armazena cada pedido auditado e o resultado da comparação de frete.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INTEGER PK AUTOINCREMENT | Identificador interno |
| `pedidoId` | TEXT UNIQUE | ID do pedido na plataforma de origem |
| `cepOrigem` | TEXT | CEP do remetente (8 dígitos) |
| `cepDestino` | TEXT | CEP do destinatário (8 dígitos) |
| `peso` | REAL | Peso real em kg |
| `comprimento` | REAL | Comprimento em cm |
| `altura` | REAL | Altura em cm |
| `largura` | REAL | Largura em cm |
| `freteCobrado` | REAL | Valor efetivamente cobrado pela transportadora (R$) |
| `freteCorreto` | REAL | Valor calculado pelo AUDITCARGO (R$) |
| `economia` | REAL | Diferença: freteCobrado − freteCorreto (≥ 0) |
| `dataHora` | DATETIME | Timestamp do registro (default: now()) |
| `status` | TEXT | `correto` / `economia_identificada` / `cobrado_a_mais` / `pendente` |
| `enviado` | INTEGER | Flag: e-mail de cobrança enviado (0/1) |
| `observacao` | TEXT | Campo livre (usado para nome da transportadora no upload) |

**Relacionamentos**: nenhum (tabela independente).

---

### Tabela: `config`

**Finalidade**: Armazena configurações chave-valor da instalação — dados do cliente e credenciais VTEX.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `chave` | TEXT PK | Nome da configuração |
| `valor` | TEXT | Valor da configuração |

**Chaves utilizadas**:

| Chave | Finalidade |
|-------|-----------|
| `cliente_nome` | Nome do responsável (aparece no PDF) |
| `cliente_email` | E-mail do cliente |
| `empresa_nome` | Nome da empresa (aparece no PDF) |
| `vtex_account` | Nome da conta VTEX |
| `vtex_appkey` | App Key VTEX (armazenada em plaintext) |
| `vtex_apptoken` | App Token VTEX (armazenado em plaintext) |
| `vtex_origin_cep` | CEP de origem para cálculos VTEX |
| `vtex_connected` | Flag de conexão VTEX (`"true"/"false"`) |
| `vtex_synced_count` | Quantidade de pedidos sincronizados |
| `vtex_last_sync` | Timestamp da última sincronização |
| `vtex_order_count` | Total de pedidos na loja VTEX |

**Relacionamentos**: nenhum.

---

## 5. APIs Integradas

### Anthropic API (Claude)

| Item | Detalhe |
|------|---------|
| Finalidade | Extrair dados estruturados (CEPs, peso, dimensões, valor) de documentos de frete |
| Modelos usados | `claude-sonnet-4-6` |
| Modos de uso | 1) Messages API com conteúdo texto (PDF com texto) 2) Messages API com vision base64 (imagens) |
| Arquivo principal | `services/documentParser.js` |
| Endpoint de entrada | `POST /api/upload` via `routes/upload.js` |
| Max tokens | 512 (suficiente para o JSON retornado) |
| Fallback | Nenhum — se ANTHROPIC_API_KEY ausente, retorna HTTP 503. Se o PDF não tem texto legível, retorna HTTP 422 com mensagem orientando uso de imagem |
| Autenticação | `ANTHROPIC_API_KEY` via variável de ambiente |

---

### VTEX Commerce Stable API

| Item | Detalhe |
|------|---------|
| Finalidade | Validar existência da loja, autenticar credenciais e importar pedidos faturados |
| Base URL | `https://{account}.vtexcommercestable.com.br` |
| Endpoints utilizados | `GET /api/catalog_system/pub/category/tree/1` (validar loja) · `GET /api/oms/pvt/orders` (listar pedidos) · `GET /api/oms/pvt/orders/{orderId}` (detalhe do pedido) |
| Autenticação | Headers `X-VTEX-API-AppKey` e `X-VTEX-API-AppToken` |
| Arquivo principal | `services/vtexService.js` |
| Rotas que usam | `routes/vtex.js` |
| Timeout | 15 segundos por requisição (AbortSignal.timeout) · 8 segundos para validação de loja |
| Rate limiting | `delay(120ms)` entre cada pedido durante sync |
| Fallback | Sync em background — falhas silenciosas por pedido individual (try/catch vazio). Se a resposta da API não for `ok`, o loop para. |

---

## 6. Engine de Auditoria

A engine de auditoria está inteiramente em `services/freteCalculator.js` e consiste em duas funções.

### `calcularFrete({ cepOrigem, cepDestino, peso, comprimento, altura, largura })`

**Passo 1 — Peso cubado**
```
pesoCubado = (comprimento × altura × largura) / 6000
pesoFinal  = max(peso, pesoCubado)
```

A divisão por 6000 é o fator padrão da indústria brasileira para cubagem de frete.

**Passo 2 — Estimativa de distância**

A distância é estimada pelo **primeiro dígito do CEP** de origem e destino (não pelo CEP completo):

| Primeiro dígito | Região |
|----------------|--------|
| 0 | SP-capital |
| 1 | SP-interior |
| 2 | RJ |
| 3 | MG |
| 4 | BA/SE |
| 5 | PR/SC (PE também) |
| 6 | CE/MA/PI |
| 7 | GO/TO/MS |
| 8 | RS (PR também) |
| 9 | MT/RO/AM |

| Diferença entre dígitos | Distância estimada |
|------------------------|-------------------|
| 0 (mesma região) | 100 km |
| 1 | 300 km |
| 2 | 600 km |
| 3 | 900 km |
| 4–5 | 1.400 km |
| 6–9 | 2.200 km |

**Passo 3 — Tarifa**

| Faixa de peso (pesoFinal) | Tarifa base | R$ por kg |
|--------------------------|-------------|-----------|
| ≤ 0,3 kg | R$ 6,50 | R$ 0,90 |
| ≤ 1 kg | R$ 8,00 | R$ 1,10 |
| ≤ 5 kg | R$ 10,00 | R$ 1,30 |
| ≤ 10 kg | R$ 14,00 | R$ 1,50 |
| ≤ 30 kg | R$ 20,00 | R$ 1,80 |
| > 30 kg | R$ 35,00 | R$ 2,20 |

**Fórmula final**:
```
freteCorreto = tarifaBase + (pesoFinal × tarifaPorKg) + (distância × 0,003)
```

---

### `determinarStatus(freteCobrado, freteCorreto)`

```
diff       = freteCobrado − freteCorreto
percentual = (diff / freteCorreto) × 100

|diff| ≤ 0,50     → "correto"
diff > 0,50 E percentual > 5  → "cobrado_a_mais"
diff > 0,50 E percentual ≤ 5  → "economia_identificada"
diff < -0,50 (cobrado a menos) → "correto"   ← comportamento atual
```

A **economia** armazenada é calculada como `max(0, freteCobrado − freteCorreto)` — nunca negativa.

---

## 7. Segurança

### Autenticação e Autorização
**Não existe nenhum sistema de autenticação.** Todos os endpoints da API são públicos e acessíveis sem qualquer token, sessão ou chave. Qualquer pessoa que conheça a URL do servidor pode:
- Consultar todos os pedidos
- Deletar a conexão VTEX
- Inserir dados via webhook
- Baixar o relatório PDF completo

### Armazenamento de Credenciais VTEX
As credenciais VTEX (`vtex_appkey` e `vtex_apptoken`) são armazenadas em **plaintext** na tabela `config` do SQLite. Não há criptografia em repouso.

### Uso de `.env`
- `ANTHROPIC_API_KEY` — chave da API Anthropic
- `TURSO_URL` / `TURSO_AUTH_TOKEN` — credenciais do banco cloud
- `FRONTEND_URL` — para CORS em produção
- Arquivo `.env` está no `.gitignore` implicitamente (não é comitado), mas está no disco local

### CORS
Configurado para aceitar somente `FRONTEND_URL` em produção (quando a variável está definida). Em desenvolvimento, `cors({ origin: true })` aceita qualquer origem.

### Validação de Upload
Multer executa dupla verificação antes do processamento pela IA:
1. **MIME type**: aceita apenas `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`
2. **Tamanho**: limite de 5MB

Arquivos com MIME type não permitido são rejeitados com erro antes de atingir o parser. Não há validação adicional de magic bytes (conteúdo real do arquivo).

### Proteção Contra Arquivos Inválidos
PDFs sem texto legível são rejeitados com HTTP 422 e mensagem clara. Imagens de formatos não suportados são rejeitadas. Não há sandbox para o processamento — o pdf-parse é executado diretamente em memória.

### Tratamento de Erros
Todas as rotas têm try/catch. Erros internos retornam HTTP 500 com `{ error: err.message }` — o que pode expor mensagens internas ao cliente em produção. Não há distinção entre erros internos e erros de validação em alguns casos.

### Rate Limiting
Não existe rate limiting em nenhum endpoint. O endpoint `/api/upload` (que consome créditos da Anthropic API) pode ser chamado sem restrição.

---

## 8. Dashboard

O frontend é composto por quatro telas HTML estáticas.

### Tela 1: `install.html` — Landing Page
**Finalidade**: Página de entrada para novos usuários. Exibe headline de marketing, lista de funcionalidades e botão CTA para iniciar a instalação. Redireciona automaticamente para o dashboard se a VTEX já estiver conectada.

### Tela 2: `connect.html` — Wizard de Conexão VTEX
**Finalidade**: Fluxo em 4 passos para conectar a loja VTEX ao AUDITCARGO.
- **Passo 1**: Input do nome da loja, validação em tempo real via API
- **Passo 2**: Input de AppKey, AppToken e CEP de origem, com toggle de visibilidade do token
- **Passo 3**: Tela de progresso animada (sync steps)
- **Passo 4**: Tela de sucesso com estatísticas da loja

### Tela 3: `dashboard.html` — Dashboard Principal
**Finalidade**: Monitoramento em tempo real da auditoria de fretes.
- **Navbar**: Links para Dashboard e Configurar; status da VTEX (quando conectada)
- **Banner VTEX**: Aparece quando conectado — mostra última sync, botão de sync manual e botão de desconexão
- **CTA VTEX**: Aparece quando desconectado — convida o usuário a conectar
- **Cards de resumo**: Total gasto em frete, Valor real calculado, Economia total + percentual
- **Gráfico de barras**: Evolução diária dos últimos 15 dias (frete cobrado × frete correto), desenhado com Canvas API puro com tooltip interativo
- **Tabela de pedidos**: Últimos 50 pedidos (renderiza os 10 primeiros na tabela), com status colorido e botão "Cobrar" para pedidos com economia
- **Modal "Auditar Novo Frete"**: Upload drag-and-drop de PDF/imagem com fluxo em 3 passos (seleção → processando → resultado)
- **Modal "Solicitar Reembolso"**: E-mail pré-preenchido para enviar à transportadora, com ação de abrir no cliente de e-mail nativo (mailto:) e copiar texto

### Tela 4: `config.html` — Configurações
**Finalidade**: Configuração da integração e dados do cliente.
- **Webhook URL**: Exibe e permite copiar o endpoint `/webhook` (calculado dinamicamente)
- **Testador de webhook**: Envia um pedido de teste ao endpoint e exibe a resposta JSON
- **Dados do cliente**: Formulário para salvar nome, e-mail e empresa (usados no relatório PDF)
- **Instruções de integração**: Guia em 3 passos para integrar com plataformas de e-commerce
- **Formato do payload**: Documentação inline do JSON esperado pelo webhook com exemplo de resposta

---

## 9. Funcionalidades

### Concluídas

- Receber pedidos via webhook HTTP POST com auditoria automática imediata
- Cálculo de frete por peso cubado e estimativa de distância por região
- Classificação de status: `correto`, `economia_identificada`, `cobrado_a_mais`
- Armazenamento de todos os pedidos auditados no banco de dados
- Dashboard com cards de resumo (total gasto, valor correto, economia, percentual)
- Gráfico de barras interativo dos últimos 15 dias (Canvas API puro, sem biblioteca)
- Tabela dos últimos pedidos com status colorido
- Geração de relatório de glosa em PDF (download via streaming)
- Upload de boleto/CT-e em PDF ou imagem com extração via IA (Claude)
- Extração de CEPs, peso, dimensões e valor de documentos via Claude Sonnet
- Integração VTEX: validação de loja, autenticação por AppKey/AppToken
- Importação paginada de pedidos VTEX faturados com sync em background
- Sincronização manual da VTEX pelo dashboard
- Status da conexão VTEX persistido no banco
- Modal de e-mail pré-preenchido para solicitar reembolso à transportadora
- Flag `enviado` para marcar pedidos cujo e-mail foi aberto
- Seed de dados de exemplo (10 pedidos pré-definidos)
- Script `demo.js` para gerar 50 pedidos realistas via webhook
- Tela de landing page (`install.html`) com CTA de instalação
- Tela de configuração com testador de webhook inline
- Suporte a SQLite local e Turso cloud (seleção automática por variável de ambiente)
- CORS configurável por variável de ambiente
- Endpoint `/health` para monitoramento da aplicação
- Deploy separado: backend no Render, frontend no Vercel

### Parcialmente Concluídas

- **Desconexão VTEX**: a rota `DELETE /api/vtex/disconnect` existe e remove as credenciais do banco, mas os pedidos já importados são mantidos (comportamento correto, mas não há aviso claro na UI sobre o que acontece com os dados)
- **Suporte a PDF escaneado**: o sistema detecta PDFs sem texto e retorna erro orientando o uso de imagem — mas não faz OCR em PDFs escaneados diretamente (precisa que o usuário converta para imagem)
- **Compatibilidade com outras plataformas**: a página `install.html` lista Bling, Tiny, Magento, WooCommerce como compatíveis, mas apenas o webhook genérico (JSON manual) e a integração VTEX estão implementados

### Planejadas mas não implementadas

- Integração nativa com Bling, Tiny ERP, Magento, WooCommerce (apenas mencionadas na UI)
- Autenticação / login de usuários
- Multi-tenancy (múltiplas empresas/usuários)
- OCR em PDFs escaneados (imagens embutidas em PDF)
- Notificações automáticas por e-mail quando economia é identificada
- Agendamento automático de sync periódica

---

## 10. Dependências

| Dependência | Versão | Função |
|-------------|--------|--------|
| `express` | ^4.18.2 | Framework HTTP — roteamento, middlewares, servidor estático |
| `@anthropic-ai/sdk` | ^0.106.0 | Cliente oficial da API Anthropic para chamadas ao Claude |
| `@libsql/client` | ^0.17.4 | Driver libSQL — suporte a SQLite local e Turso cloud com a mesma API |
| `multer` | ^2.2.0 | Middleware de upload de arquivos (multipart/form-data), armazenamento em memória |
| `pdf-parse` | ^2.4.5 | Extração de texto de PDFs para posterior envio ao Claude |
| `pdfkit` | ^0.14.0 | Geração programática de PDFs (relatório de glosa) |
| `cors` | ^2.8.5 | Middleware CORS com suporte a origem configurável |
| `dotenv` | ^16.3.1 | Carregamento de variáveis de ambiente do arquivo `.env` |
| `sql.js` | ^1.11.0 | **Não utilizado** — consta no package.json mas foi substituído por `@libsql/client` |
| `nodemon` | ^3.0.3 | Dev only — reinício automático do servidor em mudanças de arquivo |

---

## 11. Escalabilidade

### Suporta múltiplas empresas?
**Não.** O sistema é single-tenant: uma instalação = uma empresa. Não existe conceito de usuário, organização ou espaço isolado. Toda a tabela `config` e `pedidos` é compartilhada por toda a instalação.

### Suporta múltiplos usuários?
**Não.** Não existe autenticação nem conceito de usuário. Qualquer pessoa com acesso à URL pode visualizar e modificar todos os dados.

### Suporta processamento em lote?
**Parcialmente.** A importação VTEX processa até 100 pedidos por sync, paginados em grupos de 50, com delay de 120ms entre requisições. O script `demo.js` envia 50 pedidos sequencialmente. Não existe fila de jobs, worker threads ou processamento paralelo.

### Suporta crescimento?
**Com limitações.** O uso de `@libsql/client` + Turso permite escalar o banco para cloud sem trocar o código. No entanto:
- A tabela `pedidos` não tem índices além da PK e `UNIQUE(pedidoId)` — consultas com `ORDER BY dataHora DESC` em milhares de registros podem degradar
- O endpoint `/api/pedidos` retorna `LIMIT 50` sem paginação real (sem `offset`)
- Toda a lógica roda em um único processo Node.js sem clustering
- Não há cache — cada acesso ao dashboard dispara 3 queries ao banco

### Principais limitações atuais

1. Single-tenant por design
2. Sem autenticação — qualquer pessoa com a URL tem acesso total
3. Sem índice em `dataHora` na tabela `pedidos`
4. Sem paginação real nas listagens (hard limit de 50)
5. Sem fila para processamento assíncrono do upload com IA
6. VTEX sync limitado a 100 pedidos por execução, sem estado de checkpoint
7. Render Free tier hiberna após inatividade — primeira requisição pode ter latência de 30–60s

---

## 12. Dívida Técnica

Problemas reais encontrados na leitura do código:

**1. Ausência total de autenticação (crítico)**
Nenhum endpoint da API requer autenticação. `DELETE /api/vtex/disconnect`, `GET /api/relatorio/pdf`, `POST /webhook` e todos os demais são acessíveis publicamente. Qualquer pessoa pode limpar os dados de VTEX ou injetar pedidos falsos.

**2. Credenciais VTEX armazenadas em plaintext no banco**
`vtex_appkey` e `vtex_apptoken` são inseridas diretamente na tabela `config` sem criptografia. Se o arquivo `auditcargo.db` for acessado diretamente, as credenciais são expostas.

**3. Motor de cálculo de frete é uma estimativa, não uma tarifa real**
`freteCalculator.js` usa um modelo simplificado baseado no primeiro dígito do CEP (9 regiões) e faixas de peso com tarifas fixas. Não consulta nenhuma tabela real de transportadora. O valor de "frete correto" é uma estimativa que pode divergir substancialmente dos contratos reais.

**4. `determinarStatus` não trata cobranças abaixo do esperado**
Quando `freteCobrado < freteCorreto` por mais de R$0,50 (transportadora cobrou menos), a função retorna `"correto"` em vez de um status específico. Não é um erro grave no fluxo atual (a economia nunca é negativa por causa do `Math.max(0, ...)`), mas o status é semanticamente impreciso.

**5. Dependência `sql.js` listada mas não utilizada**
`package.json` inclui `sql.js ^1.11.0` como dependência de produção, mas não é importada em nenhum arquivo. É um resquício da migração para `@libsql/client`. Adiciona ~7MB ao `node_modules` sem utilidade.

**6. `demo.js` duplica a lógica de `freteCalculator.js`**
O script de demo reimplementa manualmente o algoritmo de `calcularFrete` (linhas 38–55) em vez de importar `services/freteCalculator.js`. Se as tarifas mudarem, precisarão ser alteradas em dois lugares.

**7. Erro silencioso no parsing de PDF**
Em `documentParser.js` linha 71–73, o erro de `pdf-parse` é capturado com `catch {}` vazio. Se o parsing falhar por razão diferente de "PDF sem texto", o erro é silenciado e `pdfText` fica vazio, levando à mensagem genérica de "PDF sem texto legível".

**8. `config.js` com URL hardcoded do Render**
O arquivo `public/config.js` contém `https://auditcargo-api.onrender.com` hardcoded. Se a URL do backend mudar, é necessário editar o arquivo e fazer novo deploy do frontend. Não é parametrizável via variável de ambiente no Vercel sem trocar a abordagem.

**9. Sem índice na coluna `dataHora` da tabela `pedidos`**
As queries mais frequentes (`ORDER BY dataHora DESC`, `WHERE dataHora >= DATE('now', '-14 days')`) não têm índice de suporte. Não é crítico com poucos registros, mas degradará com volume alto.

**10. Sem rate limiting no endpoint de upload**
`POST /api/upload` chama a Anthropic API a cada requisição. Sem rate limiting, um usuário pode gerar consumo excessivo de créditos ou causar custos inesperados.

**11. Mensagens de erro internas expostas ao cliente**
Em vários handlers, `res.status(500).json({ error: err.message })` expõe a mensagem de erro interno diretamente ao browser. Em produção, isso pode revelar stack traces ou detalhes do sistema.

**12. Vercel.json duplicado com semânticas diferentes**
Existe `vercel.json` na raiz (configura deploy do projeto completo com `outputDirectory: public`) e `public/vercel.json` (configura rewrites para o frontend estático). Os dois arquivos têm propósitos diferentes e podem confundir na manutenção.

---

## 13. Arquivos Críticos

| # | Arquivo | Responsabilidade |
|---|---------|-----------------|
| 1 | [server.js](server.js) | Ponto de entrada: inicializa Express, monta middlewares e rotas, inicializa o banco |
| 2 | [services/freteCalculator.js](services/freteCalculator.js) | Núcleo do produto: calcula frete estimado e classifica se há cobrança indevida |
| 3 | [services/documentParser.js](services/documentParser.js) | Integração com Claude API: extrai dados estruturados de PDF e imagens |
| 4 | [services/database.js](services/database.js) | Abstração do banco: suporte a SQLite local e Turso cloud, inicialização das tabelas |
| 5 | [services/vtexService.js](services/vtexService.js) | Integração VTEX: validação, autenticação, importação paginada de pedidos |
| 6 | [routes/api.js](routes/api.js) | Rotas principais: webhook, resumo, gráfico, pedidos, relatório, config, seed |
| 7 | [routes/upload.js](routes/upload.js) | Rota de upload: recebe arquivo, orquestra parser + calculator + banco |
| 8 | [routes/vtex.js](routes/vtex.js) | Rotas VTEX: connect, status, sync, disconnect |
| 9 | [services/relatorioGenerator.js](services/relatorioGenerator.js) | Gera PDF de glosa formatado com PDFKit, streamed diretamente para o response |
| 10 | [public/dashboard.html](public/dashboard.html) | Tela principal: cards, gráfico, tabela, modais de upload e cobrança |
| 11 | [public/script.js](public/script.js) | Toda a lógica do dashboard: fetch das APIs, renderização do gráfico Canvas, modais |
| 12 | [public/connect.html](public/connect.html) | Wizard VTEX em 4 passos com animações e validação de formulário inline |
| 13 | [public/config.html](public/config.html) | Configuração do webhook, dados do cliente e testador de integração |
| 14 | [public/install.html](public/install.html) | Landing page de instalação com CTA e lista de plataformas compatíveis |
| 15 | [public/config.js](public/config.js) | Define `window.API_BASE` — separa URL do backend entre dev e produção |
| 16 | [public/style.css](public/style.css) | Estilos globais do frontend (tema dark, componentes, responsividade) |
| 17 | [.env.example](.env.example) | Template de todas as variáveis de ambiente necessárias |
| 18 | [vercel.json](vercel.json) | Configuração de deploy do frontend no Vercel (outputDirectory, rewrites) |
| 19 | [render.yaml](render.yaml) | Configuração de deploy do backend no Render (buildCommand, healthCheck, env) |
| 20 | [demo.js](demo.js) | Script de geração de 50 pedidos demo com simulação realista de markups de transportadora |

---

## 14. Resumo Executivo

### Status: 🟡 Quase pronto

**O sistema funciona** para o seu caso de uso principal: uma empresa, um operador, auditando os próprios fretes. O fluxo completo de webhook → cálculo → dashboard → PDF está implementado, testado via script de demo e deployável. A integração com VTEX está funcional. O upload com IA está funcional.

**O que impede o status verde:**

1. **Ausência de autenticação** é o bloqueador mais crítico. A URL pública do backend (`auditcargo-api.onrender.com`) expõe todos os dados e operações sem nenhuma proteção. Para uso interno com URL não divulgada isso pode ser aceitável como MVP, mas é impróprio para qualquer exposição real.

2. **Motor de frete é estimativo.** O valor de "frete correto" calculado pelo sistema é baseado em tarifas fixas hipotéticas e distâncias estimadas por região de CEP. Ele não reflete os contratos reais com transportadoras. O sistema identifica tendências e anomalias estatísticas, mas o valor exato de glosa precisa de validação manual antes de ser enviado à transportadora.

3. **Single-tenant por design.** O produto está construído para uma única empresa por instalação. Transformá-lo em SaaS multi-tenant exigiria mudanças estruturais no banco e nas rotas.

**Para produção segura em ambiente controlado (uso interno de uma empresa):** o sistema está quase pronto — faltam autenticação básica e clareza sobre as limitações do cálculo de frete.

**Para oferta como produto SaaS:** requer autenticação, multi-tenancy, e idealmente integração com tabelas reais de transportadoras (Correios, Jadlog, Total Express, etc.) em vez do modelo estimativo atual.

---

*Fim do relatório — nenhum arquivo foi modificado durante esta auditoria.*
