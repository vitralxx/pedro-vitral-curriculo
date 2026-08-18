/* ==========================================================================
   ui.js — controles da moldura: modo, som, teclas de função, impressão.
   Independente do terminal.js (passo 3). Carregado com defer.
   ========================================================================== */
(() => {
  'use strict';

  const raiz     = document.documentElement;
  const btnModo  = document.getElementById('btn-modo');
  const btnSom   = document.getElementById('btn-som');
  const linkPdf  = document.querySelector('.btn-pdf');

  /* --------------------------------------------------------------------
     Preferências. localStorage lança exceção em modo anônimo e em algumas
     configurações de file:// — try/catch para o site não morrer por causa
     de uma preferência.
     -------------------------------------------------------------------- */
  const ler = (chave, padrao) => {
    try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; }
  };
  const gravar = (chave, valor) => {
    try { localStorage.setItem(chave, valor); } catch { /* segue sem persistir */ }
  };

  /* --------------------------------------------------------------------
     MODO: retro (padrão) | moderno
     -------------------------------------------------------------------- */
  let modo = ler('modo', 'retro');

  function aplicarModo() {
    if (modo === 'moderno') raiz.setAttribute('data-modo', 'moderno');
    else                    raiz.removeAttribute('data-modo');

    btnModo.innerHTML = '<span class="tecla">F2</span> MODO: ' + modo.toUpperCase();
    // aria-pressed = "o modo moderno está ativo"
    btnModo.setAttribute('aria-pressed', String(modo === 'moderno'));
  }

  function alternarModo() {
    modo = (modo === 'moderno') ? 'retro' : 'moderno';
    gravar('modo', modo);
    aplicarModo();
  }

  /* --------------------------------------------------------------------
     SOM: off (padrão, e é padrão de propósito — som sem pedir licença faz
     o recrutador fechar a aba). O sintetizador entra no passo 3; aqui só
     guardamos o estado, que é o que o terminal vai consultar.
     -------------------------------------------------------------------- */
  let som = ler('som', 'off');

  function aplicarSom() {
    btnSom.innerHTML = '<span class="tecla">F3</span> SOM: ' + som.toUpperCase();
    btnSom.setAttribute('aria-pressed', String(som === 'on'));
    raiz.dataset.som = som;   // o terminal.js lê daqui
  }

  function alternarSom() {
    som = (som === 'on') ? 'off' : 'on';
    gravar('som', som);
    aplicarSom();
  }

  /* --------------------------------------------------------------------
     Revelar. Os botões nascem hidden no HTML: sem JS eles não fariam nada,
     e botão que não faz nada é pior que botão ausente.
     -------------------------------------------------------------------- */
  btnModo.hidden = false;
  btnSom.hidden  = false;
  aplicarModo();
  aplicarSom();

  btnModo.addEventListener('click', alternarModo);
  btnSom .addEventListener('click', alternarSom);

  /* --------------------------------------------------------------------
     Teclas de função. preventDefault porque F1 abre a ajuda do navegador.
     -------------------------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    switch (e.key) {
      case 'F1': e.preventDefault(); linkPdf.click(); break;
      case 'F2': e.preventDefault(); alternarModo();  break;
      case 'F3': e.preventDefault(); alternarSom();   break;
    }
  });

  /* --------------------------------------------------------------------
     Impressão. <details> fechado não abre por CSS — o navegador esconde o
     conteúdo fora do alcance da folha de estilo. Abrimos tudo antes de
     imprimir e devolvemos ao estado anterior depois.
     -------------------------------------------------------------------- */
  let fechadosAntes = [];

  addEventListener('beforeprint', () => {
    fechadosAntes = [...document.querySelectorAll('details:not([open])')];
    fechadosAntes.forEach(d => d.open = true);
  });

  addEventListener('afterprint', () => {
    fechadosAntes.forEach(d => d.open = false);
    fechadosAntes = [];
  });
})();
