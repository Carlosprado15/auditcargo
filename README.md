# AUDITCARGO — Auditor Automático de Fretes

MVP para auditoria automática de fretes em e-commerces.

## Instalação

```bash
npm install
npm start
```

Acesse: http://localhost:3000

## Estrutura

- `server.js` — Servidor Express
- `routes/api.js` — Rotas da API e webhook
- `services/database.js` — SQLite (auto-criado)
- `services/freteCalculator.js` — Cálculo de frete por estimativa
- `services/relatorioGenerator.js` — Geração de PDF via PDFKit
- `public/` — Frontend (HTML/CSS/JS puro)

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /webhook | Recebe pedido e audita frete |
| GET | /api/resumo | Totais e economia |
| GET | /api/grafico | Dados dos últimos 15 dias |
| GET | /api/pedidos | Lista de pedidos |
| GET | /api/pedidos/:id | Detalhe de um pedido |
| GET | /api/relatorio/pdf | Download do PDF de glosa |
| GET | /api/config | Configurações atuais |
| POST | /api/config | Salva configurações |
| POST | /api/seed | Insere dados de exemplo |

## Payload do Webhook

```json
{
  "pedidoId": "PED-001",
  "cepOrigem": "01310100",
  "cepDestino": "20040020",
  "peso": 2.5,
  "comprimento": 30,
  "altura": 20,
  "largura": 20,
  "freteCobrado": 45.90
}
```
