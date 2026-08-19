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
     GALERIA E VISOR EM TELA CHEIA

     Delegação no document, e não um listener por galeria, porque o terminal
     CLONA os projetos de #fonte para dentro de #saida. Um listener preso ao
     elemento original não acompanharia o clone; a delegação vale para
     qualquer galeria que exista agora ou venha a existir.
     -------------------------------------------------------------------- */
  const imagensDe = (galeria) =>
    [...galeria.querySelectorAll('.galeria-quadro img')];

  const indiceAtivo = (imagens) =>
    Math.max(0, imagens.findIndex(i => i.classList.contains('ativa')));

  function trocar(galeria, passo) {
    const imagens = imagensDe(galeria);
    if (imagens.length < 2) return indiceAtivo(imagens);

    const atual = indiceAtivo(imagens);
    const nova = (atual + passo + imagens.length) % imagens.length;
    imagens[atual].classList.remove('ativa');
    imagens[nova].classList.add('ativa');

    const contador = galeria.querySelector('.galeria-contador');
    if (contador) contador.textContent = `${nova + 1} / ${imagens.length}`;
    return nova;
  }

  /* ---- visor ---------------------------------------------------------- */
  let visor = null;          // construído sob demanda, uma vez só
  let galeriaAberta = null;  // de onde o visor foi aberto
  let focoAnterior = null;   // para devolver o foco ao fechar

  function montarVisor() {
    if (visor) return visor;

    visor = document.createElement('div');
    visor.className = 'visor';
    visor.hidden = true;
    visor.setAttribute('role', 'dialog');
    visor.setAttribute('aria-modal', 'true');
    visor.setAttribute('aria-label', 'Imagem em tela cheia');
    visor.innerHTML = `
      <button type="button" class="visor-btn visor-fechar" aria-label="Fechar (Esc)">[X]</button>
      <button type="button" class="visor-btn visor-ant" data-passo="-1" aria-label="Imagem anterior">[&lt;]</button>
      <figure class="visor-palco">
        <img alt="">
        <figcaption class="visor-legenda"></figcaption>
        <span class="visor-contador"></span>
      </figure>
      <button type="button" class="visor-btn visor-prox" data-passo="1" aria-label="Próxima imagem">[&gt;]</button>`;

    document.body.appendChild(visor);

    visor.addEventListener('click', (e) => {
      const btn = e.target.closest('.visor-btn');
      if (btn) {
        if (btn.classList.contains('visor-fechar')) fecharVisor();
        else pintarVisor(trocar(galeriaAberta, Number(btn.dataset.passo)));
        return;
      }
      // Clique fora da imagem fecha. O <figure> inteiro conta como "dentro",
      // senão clicar na legenda fecharia sem querer.
      if (!e.target.closest('.visor-palco')) fecharVisor();
    });

    return visor;
  }

  function pintarVisor(indice) {
    const imagens = imagensDe(galeriaAberta);
    const fonte = imagens[indice];
    const alvo = visor.querySelector('.visor-palco img');
    alvo.src = fonte.currentSrc || fonte.src;
    alvo.alt = fonte.alt || '';
    visor.querySelector('.visor-legenda').textContent = fonte.alt || '';
    visor.querySelector('.visor-contador').textContent =
      `${indice + 1} / ${imagens.length}`;

    const varias = imagens.length > 1;
    visor.querySelector('.visor-ant').hidden = !varias;
    visor.querySelector('.visor-prox').hidden = !varias;
  }

  function abrirVisor(galeria, indice) {
    montarVisor();
    galeriaAberta = galeria;
    focoAnterior = document.activeElement;
    pintarVisor(indice);
    visor.hidden = false;
    document.documentElement.classList.add('visor-aberto');
    visor.querySelector('.visor-fechar').focus();
  }

  function fecharVisor() {
    if (!visor || visor.hidden) return;
    visor.hidden = true;
    document.documentElement.classList.remove('visor-aberto');
    // Devolve o foco a quem abriu: quem navega por teclado não pode ser
    // largado no começo da página depois de fechar um modal.
    if (focoAnterior && focoAnterior.isConnected) focoAnterior.focus();
    galeriaAberta = null;
  }

  /* ---- ligação -------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const botao = e.target.closest('.galeria-btn');
    if (botao) {
      trocar(botao.closest('.galeria'), Number(botao.dataset.passo) || 1);
      return;
    }

    const img = e.target.closest('.galeria-quadro img');
    if (img) {
      const galeria = img.closest('.galeria');
      abrirVisor(galeria, indiceAtivo(imagensDe(galeria)));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!visor || visor.hidden) return;
    if (e.key === 'Escape')     { e.preventDefault(); fecharVisor(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); pintarVisor(trocar(galeriaAberta, -1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); pintarVisor(trocar(galeriaAberta,  1)); }
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
