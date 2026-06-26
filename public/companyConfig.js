window.COMPANY = {
  name: 'AUDITCARGO',
  product: 'Plataforma Inteligente de Auditoria de Fretes',
  site: 'https://www.auditcargo.com.br',
  email: 'contato@auditcargo.com.br',
  emailComercial: 'comercial@auditcargo.com.br',
  emailSuporte: 'suporte@auditcargo.com.br',
  privacyPolicy: 'https://www.auditcargo.com.br/privacidade',
  terms: 'https://www.auditcargo.com.br/termos',
  year: 2026
};

document.addEventListener('DOMContentLoaded', function () {
  var C = window.COMPANY;
  var fill = function (attr, email) {
    document.querySelectorAll('[data-company-email="' + attr + '"]').forEach(function (el) {
      el.textContent = email;
      if (el.tagName === 'A') el.href = 'mailto:' + email;
    });
  };
  fill('contato', C.email);
  fill('comercial', C.emailComercial);
  fill('suporte', C.emailSuporte);
  document.querySelectorAll('[data-company-year]').forEach(function (el) {
    el.textContent = C.year;
  });
});
