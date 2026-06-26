// ⚠️ Após deploy no Render, substitua a URL abaixo e faça push:
window.API_BASE = window.location.hostname === 'localhost'
  ? ''  // dev local → usa mesmo servidor
  : 'https://auditcargo-api.onrender.com'; // ← SUA URL DO RENDER (atualizar após step 1)
