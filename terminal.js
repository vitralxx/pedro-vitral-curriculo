/* ==========================================================================
   terminal.js — o terminal emite o currículo.

   Princípio: #fonte é a fonte da verdade e nunca é alterada. Todo comando
   clona um pedaço dela para dentro de #saida e revela o texto digitando.

   Sequência de abertura:
     1. cabeçalho é digitado em ~4s (nome + as duas listas). Só isso na tela.
     2. pausa: o console fica piscando, convidando.
     3. o terminal digita cada comando NO CAMPO, letra a letra, e só então
        imprime a resposta. É isso que ensina o recrutador que digitar libera
        conteúdo — ele vê a mão invisível fazendo.
   ========================================================================== */
(() => {
  'use strict';

  const fonte     = document.getElementById('fonte');
  const saida     = document.getElementById('saida');
  const anuncio   = document.getElementById('anuncio');
  const form      = document.getElementById('terminal-form');
  const input     = document.getElementById('cmd');
  const ghost     = document.getElementById('ghost');
  const sugestoes = document.getElementById('sugestoes');
  const chips     = document.getElementById('chips');
  const consoleEl = document.querySelector('.console');
  const cabecalho = document.querySelector('.topo');
  const convite   = form.querySelector('.convite');

  const chkAuto   = document.getElementById('auto-type');
  const chkAnim   = document.getElementById('text-animation');

  /* auto-type é o mecanismo de parada, e substitui a detecção de
     prefers-reduced-motion que existia aqui. A detecção automática travava a
     animação sem o usuário poder reverter; a WCAG 2.2.2 pede um MECANISMO
     para parar conteúdo em movimento, e um controle visível cumpre isso
     melhor do que uma decisão tomada pelas costas de quem visita. */
  const lerPref    = (k, p) => { try { return localStorage.getItem(k) ?? p; } catch { return p; } };
  const gravarPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* segue sem persistir */ } };

  /* Dois eixos independentes:
       autoType — o terminal se dirige sozinho (digita comandos, roda a sequência)
       textAnim — o texto é revelado progressivamente, em vez de aparecer inteiro
     Separados porque são incômodos diferentes: um é a página agir sem pedir
     licença, o outro é ter que esperar o texto chegar. */
  let autoType = lerPref('autotype', '1') === '1';
  let textAnim = lerPref('textanim', '1') === '1';
  chkAuto.checked = autoType;
  chkAnim.checked = textAnim;

  // pageshow dispara DEPOIS da restauração de formulário do navegador (e do
  // bfcache, ao voltar pelo botão). Sem isso a caixa desenha um estado e o
  // terminal se comporta de outro.
  addEventListener('pageshow', () => {
    chkAuto.checked = autoType;
    chkAnim.checked = textAnim;
  });

  const PROMPT = 'comando:>';

  /* ======================================================================
     1. DICIONÁRIO DE COMANDOS
     ====================================================================== */
  const PROJETOS = ['agenda-viert', 'cubagem-stone', 'denaro-bot', 'khalkaria-rpg'];

  const COMANDOS = {
    whoami:   { seletor: '#perfil'   },
    edu:      { seletor: '#formacao' },
    projects: { seletor: '#projetos' },   // lista: projetos ficam recolhidos
    skills:   { seletor: '#stack'    },
    language: { seletor: '#idiomas'  },
    contact:  { seletor: '#contato'  },
    help:     { seletor: '#ajuda'    },
    clear:    { limpar: true         },
  };

  const VOCABULARIO = [
    ...Object.keys(COMANDOS),
    ...PROJETOS.map(p => 'projects/' + p),
  ].sort();

  function resolver(bruto) {
    const c = bruto.trim().toLowerCase();
    if (COMANDOS[c]) return COMANDOS[c];
    const m = /^projects\/(.+)$/.exec(c);
    if (m && PROJETOS.includes(m[1])) return { seletor: '#projeto-' + m[1], expandir: true };
    return null;
  }

  const ERROS = [
    cmd => `bash: ${cmd}: comando não encontrado. Tenta "help", é literalmente o que ele faz.`,
    cmd => `${cmd}: não. Mas admiro a iniciativa.`,
    cmd => `zsh: command not found: ${cmd}. Meu currículo é bom, não é onisciente.`,
    cmd => `Erro 404: ${cmd} não existe. "help" existe.`,
    cmd => `${cmd}? Rolei o dado e deu 1. Falha crítica.`,
    cmd => `Procurei "${cmd}" no inventário e não achei. Tenta "help" pra ver o que tem.`,
    cmd => `Esse comando eu ainda não aprendi. Faltou XP.`,
    cmd => `Copiei "${cmd}" do StackOverflow e mesmo assim não rolou.`,
    cmd => `Nem com sudo, chefe.`,
    cmd => `${cmd} deve ter ficado numa branch que eu esqueci de dar merge.`,
    cmd => `Deu ruim com "${cmd}". Mas fica tranquilo, não foi em produção.`,
    cmd => `Não entendi "${cmd}". Digita "help" que eu te mostro o mapa.`,
  ];

  /* ======================================================================
     2. ROLAGEM QUE ACOMPANHA
     A página não pode crescer fora da tela — o recrutador acha que quebrou.
     Enquanto o texto sai, arrastamos a janela para manter a última linha
     logo acima do console. Se ele rolar para cima para ler, paramos de
     arrastar até que volte ao rodapé.
     ====================================================================== */
  let seguindo = true;

  /* Medimos INTENÇÃO, não posição. Numa página que cresce enquanto escreve,
     medir "distância até o fundo" é inútil: o primeiro bloco emitido já joga
     o fundo a milhares de pixels e a heurística conclui, errado, que o
     usuário rolou para longe. wheel e touchmove só o usuário gera —
     scrollBy programático não dispara nenhum dos dois. */
  const largar = () => { seguindo = false; };
  addEventListener('wheel',     largar, { passive: true });
  addEventListener('touchmove', largar, { passive: true });

  // Voltou ao rodapé por conta própria: retoma o acompanhamento.
  addEventListener('scroll', () => {
    const fundo = document.documentElement.scrollHeight - innerHeight;
    if (fundo - scrollY < 120) seguindo = true;
  }, { passive: true });

  function seguir(el) {
    if (!seguindo) return;
    const teto    = consoleEl.getBoundingClientRect().top;
    const base    = el.getBoundingClientRect().bottom;
    const excesso = base - teto + 24;
    if (excesso > 2) scrollBy(0, excesso);
  }

  /* ======================================================================
     3. SOM — sintetizado na Web Audio, zero arquivo baixado.
     Um estalo é ruído branco com decaimento muito rápido num passa-banda.
     O navegador bloqueia áudio antes do primeiro gesto do usuário, então o
     contexto só nasce no primeiro clique ou tecla.
     ====================================================================== */
  let ctx = null, ruido = null, ultimoClique = 0;

  function ligarAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const dur = 0.02;
    ruido = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = ruido.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
  }

  function estalo() {
    if (document.documentElement.dataset.som !== 'on' || !ctx) return;
    // Limitador: sem ele, digitação rápida vira metralhadora com clipping.
    const agora = performance.now();
    if (agora - ultimoClique < 40) return;
    ultimoClique = agora;

    const src = ctx.createBufferSource(); src.buffer = ruido;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = 1500 + Math.random() * 900;
    filtro.Q.value = 0.7;
    const vol = ctx.createGain(); vol.gain.value = 0.06;
    src.connect(filtro).connect(vol).connect(ctx.destination);
    src.start();
  }

  /* ======================================================================
     4. MOTOR DE DIGITAÇÃO
     Revela, não reescreve. O conteúdo tem <a>, <strong> e listas aninhadas —
     montar string caractere a caractere destruiria a marcação. Então:
     esvazia os nós de texto, guarda o conteúdo, e vai reenchendo.

     O orçamento por frame é FRACIONÁRIO e acumulado. Assim a duração é a
     mesma independente do tamanho do bloco, e blocos curtos podem sair
     devagar (menos de 1 caractere por frame) — que é o que faz o cabeçalho
     levar 4 segundos em vez de piscar.
     ====================================================================== */
  /* Um CONJUNTO, não uma referência só. Se duas animações rodarem ao mesmo
     tempo, guardar apenas a última deixa a primeira órfã: o texto dela fica
     pela metade para sempre, porque ninguém mais consegue chamar o completar
     dela. Com o conjunto, completarTudo() alcança todas. */
  const emCurso = new Set();

  function completarTudo() {
    [...emCurso].forEach(fn => fn());
  }

  function digitar(raiz, aoTerminar, frames) {
    const it = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const nos = [];
    let n;
    while ((n = it.nextNode())) {
      if (!n.nodeValue.trim()) continue;      // espaços entre tags: preserva
      nos.push({ no: n, texto: n.nodeValue });
      n.nodeValue = '';
    }

    const total = nos.reduce((s, x) => s + x.texto.length, 0);
    const porFrame = total / (frames || 90);   // 90 frames ≈ 1,5s
    let i = 0, pos = 0, acumulado = 0, vivo = true;

    raiz.classList.add('digitando');

    function completar() {
      if (!vivo) return;
      vivo = false;
      for (; i < nos.length; i++) nos[i].no.nodeValue = nos[i].texto;
      raiz.classList.remove('digitando');
      emCurso.delete(completar);
      anuncio.textContent = raiz.textContent.replace(/\s+/g, ' ').trim();
      seguir(raiz);
      if (aoTerminar) aoTerminar();
    }

    if (!textAnim || total === 0) { completar(); return; }

    function passo() {
      if (!vivo) return;
      acumulado += porFrame;
      let orcamento = Math.floor(acumulado);
      acumulado -= orcamento;

      while (orcamento > 0 && i < nos.length) {
        const atual = nos[i];
        const falta = atual.texto.length - pos;
        const leva  = Math.min(orcamento, falta);
        pos += leva; orcamento -= leva;
        atual.no.nodeValue = atual.texto.slice(0, pos);
        if (pos >= atual.texto.length) { i++; pos = 0; }
      }

      estalo();
      seguir(raiz);
      if (i >= nos.length) { completar(); return; }
      requestAnimationFrame(passo);
    }

    emCurso.add(completar);
    requestAnimationFrame(passo);
  }

  /* ======================================================================
     5. EMISSÃO
     ====================================================================== */
  function limparIds(el) {
    el.removeAttribute('id');
    el.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  }

  function ecoar(cmd) {
    const linha = document.createElement('p');
    linha.className = 'entrada';
    const p = document.createElement('span');
    p.className = 'prompt-eco';
    p.textContent = PROMPT;
    const eco = document.createElement('span');
    eco.className = 'eco';
    eco.textContent = ' ' + cmd;
    linha.append(p, eco);
    saida.appendChild(linha);
    seguir(linha);
  }

  function imprimirErro(cmd) {
    const p = document.createElement('p');
    p.className = 'resposta erro';
    p.textContent = ERROS[Math.floor(Math.random() * ERROS.length)](cmd);
    saida.appendChild(p);
    digitar(p);
  }

  function imprimir(def, aoTerminar) {
    const original = fonte.querySelector(def.seletor);
    if (!original) { if (aoTerminar) aoTerminar(); return; }

    const clone = original.cloneNode(true);
    limparIds(clone);
    if (clone.tagName === 'DETAILS') clone.open = true;
    // "projects" lista nomes recolhidos; "projects/<nome>" abre o projeto.
    clone.querySelectorAll('details').forEach(d => { d.open = !!def.expandir; });

    const env = document.createElement('div');
    env.className = 'resposta';
    env.appendChild(clone);
    saida.appendChild(env);

    digitar(env, aoTerminar);
  }

  function executar(bruto) {
    const cmd = bruto.trim();
    if (!cmd) return;
    completarTudo();                       // completa tudo que estiver saindo
    ecoar(cmd);

    const def = resolver(cmd);
    if (!def)       { imprimirErro(cmd); return; }
    if (def.limpar) { saida.replaceChildren(); anuncio.textContent = 'Tela limpa.'; return; }
    imprimir(def);
  }

  /* ======================================================================
     6. AUTO-PLAY
     A maioria dos recrutadores não vai digitar. O terminal se toca sozinho —
     mas digitando no campo, para que fique claro de onde o conteúdo vem.
     Qualquer interação real assume o controle e mata o auto-play.
     ====================================================================== */
  const SEQUENCIA = ['whoami', 'edu', 'projects', 'skills', 'language', 'contact'];

  const ABERTURA_FRAMES = 240;   // ~4s de digitação do cabeçalho
  const ESPERA_CONVITE  = 2500;  // pausa antes de começar a se tocar sozinho
  const ESPERA_ENTRE    = 5000;  // entre um comando e o próximo

  let autoVivo = true;
  let timer = null;
  const jaEmitidos = new Set();   // o que a sequência já cuspiu

  function interromper() {
    if (!autoVivo) return;
    autoVivo = false;
    clearTimeout(timer);
    input.value = '';                       // limpa o comando que a máquina digitava
    ghost.replaceChildren();                // e o cursor postiço: agora vale o nativo
    form.classList.remove('aguardando');
  }

  /* Cursor de bloco na camada ghost, logo após o texto já digitado. */
  function mostrarCursor(texto) {
    ghost.replaceChildren();
    if (texto) {
      const ja = document.createElement('span');
      ja.className = 'ja';
      ja.textContent = texto;
      ghost.appendChild(ja);
    }
    const cur = document.createElement('span');
    cur.className = 'cursor';
    cur.textContent = '▮';
    ghost.appendChild(cur);
  }

  /* Digita o comando NO CAMPO, letra a letra, em ritmo humano.
     É a peça central: sem ver isso, ninguém entende o mecanismo. */
  function digitarComando(cmd, aoTerminar) {
    input.value = '';

    // Sem animação de texto o comando aparece inteiro, mas o auto-play continua:
    // são dois incômodos diferentes e cada um tem sua caixa.
    if (!textAnim) {
      input.value = cmd;
      mostrarCursor(cmd);
      timer = setTimeout(() => { input.value = ''; mostrarCursor(''); aoTerminar(); }, 500);
      return;
    }

    let i = 0;
    (function tecla() {
      if (!autoVivo) { input.value = ''; ghost.replaceChildren(); return; }
      input.value = cmd.slice(0, ++i);
      mostrarCursor(input.value);
      estalo();
      if (i < cmd.length) {
        timer = setTimeout(tecla, 60 + Math.random() * 55);   // ritmo irregular = humano
      } else {
        timer = setTimeout(() => { input.value = ''; mostrarCursor(''); aoTerminar(); }, 450);
      }
    })();
  }

  function tocar(fila) {
    let k = 0;
    (function proximo() {
      if (!autoVivo || k >= fila.length) return;
      const cmd = fila[k++];
      digitarComando(cmd, () => {
        if (!autoVivo) return;
        ecoar(cmd);
        jaEmitidos.add(cmd);
        // Encadeia na CONCLUSÃO da digitação, não no relógio: com pausa fixa
        // um bloco longo começaria antes de o anterior terminar de sair.
        imprimir(resolver(cmd), () => {
          timer = setTimeout(proximo, ESPERA_ENTRE);
        });
      });
    })();
  }

  /* ======================================================================
     7. AUTOCOMPLETE — ghost text + lista filtrada
     ====================================================================== */
  let selecionado = -1;
  const historico = [];
  let posHistorico = 0;

  function candidatos(valor) {
    const v = valor.trim().toLowerCase();
    if (!v) return [];
    return VOCABULARIO.filter(c => c.startsWith(v) && c !== v);
  }

  function atualizarSugestoes() {
    const valor = input.value;
    const lista = candidatos(valor);

    if (lista.length) {
      ghost.replaceChildren();
      const ja = document.createElement('span');
      ja.className = 'ja';
      ja.textContent = valor;
      ghost.append(ja, document.createTextNode(lista[0].slice(valor.trim().length)));
    } else {
      ghost.textContent = '';
    }

    sugestoes.replaceChildren();
    selecionado = -1;

    if (!lista.length) {
      sugestoes.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    lista.forEach((c) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = c;
      li.addEventListener('mousedown', (e) => {   // mousedown: antes do blur
        e.preventDefault();
        input.value = c;
        fecharSugestoes();
        enviar();
      });
      sugestoes.appendChild(li);
    });

    sugestoes.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function fecharSugestoes() {
    sugestoes.hidden = true;
    sugestoes.replaceChildren();
    ghost.textContent = '';
    selecionado = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function mover(delta) {
    const itens = [...sugestoes.children];
    if (!itens.length) return false;
    if (selecionado >= 0) itens[selecionado].setAttribute('aria-selected', 'false');
    selecionado = (selecionado + delta + itens.length) % itens.length;
    itens[selecionado].setAttribute('aria-selected', 'true');
    itens[selecionado].scrollIntoView({ block: 'nearest' });
    input.value = itens[selecionado].textContent;
    ghost.textContent = '';
    return true;
  }

  function aceitarGhost() {
    const lista = candidatos(input.value);
    if (!lista.length) return false;
    input.value = lista[0];
    atualizarSugestoes();
    return true;
  }

  /* ======================================================================
     8. LIGAÇÃO
     ====================================================================== */
  form.hidden = false;
  form.classList.add('aguardando');
  mostrarCursor('');

  function enviar() {
    const cmd = input.value;
    if (!cmd.trim()) return;
    historico.push(cmd.trim());
    posHistorico = historico.length;
    fecharSugestoes();
    convite.classList.add('sumiu');   // já entendeu o mecanismo, libera espaço
    executar(cmd);
    input.value = '';
  }

  input.addEventListener('focus', interromper);
  input.addEventListener('input', () => { interromper(); atualizarSugestoes(); estalo(); });

  input.addEventListener('keydown', (e) => {
    interromper();
    ligarAudio();

    switch (e.key) {
      // Não dependemos só da submissão implícita do formulário: preventDefault
      // garante o mesmo caminho em qualquer navegador, sem disparar duas vezes.
      case 'Enter':
        e.preventDefault();
        enviar();
        break;

      case 'Tab':
      case 'ArrowRight':
        if (e.key === 'Tab' || input.selectionStart === input.value.length) {
          if (aceitarGhost()) e.preventDefault();
        }
        break;

      case 'ArrowDown':
        if (mover(1)) e.preventDefault();
        break;

      case 'ArrowUp':
        if (sugestoes.hidden) {
          if (historico.length) {
            posHistorico = Math.max(0, posHistorico - 1);
            input.value = historico[posHistorico] || '';
            e.preventDefault();
          }
        } else if (mover(-1)) e.preventDefault();
        break;

      case 'Escape':
        fecharSugestoes();
        break;
    }
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
  input.addEventListener('blur', () => setTimeout(fecharSugestoes, 120));

  // Chips: com JS viram comandos; sem JS continuam sendo âncoras.
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    e.preventDefault();
    interromper();
    ligarAudio();
    convite.classList.add('sumiu');
    executar(chip.dataset.cmd);
    input.focus();
  });

  // Clicar na saída também assume o controle. Teclas soltas (Ctrl, Shift,
  // F5, Ctrl+Shift+R) NÃO interrompem — antes qualquer tecla matava o
  // auto-play, inclusive as de recarregar a página.
  saida.addEventListener('click', interromper);

  /* ======================================================================
     9. ABERTURA
     ====================================================================== */
  /* Sem auto-type, o cabeçalho já está renderizado pelo HTML e não há nada a
     animar. Mas página vazia é pior do que animação indesejada: quem desligou
     ainda precisa de um ponto de partida. "help" dá isso sem despejar o
     currículo inteiro por cima de quem justamente quer explorar sozinho. */
  /* Tela em branco é pior do que animação indesejada: quem desligou o auto-type
     ainda precisa de um ponto de partida. "help" dá isso sem despejar o
     currículo inteiro por cima de quem justamente quer explorar sozinho. */
  function garantirPontoDePartida() {
    if (saida.children.length) return;
    ecoar('help');
    jaEmitidos.add('help');
    imprimir(resolver('help'));
  }

  function pararAutoPlay() {
    interromper();
    garantirPontoDePartida();
  }

  chkAuto.addEventListener('change', () => {
    autoType = chkAuto.checked;
    gravarPref('autotype', autoType ? '1' : '0');
    if (!autoType) pararAutoPlay();
    // Religar não reinicia a sequência — retomar do nada seria assustador.
  });

  chkAnim.addEventListener('change', () => {
    textAnim = chkAnim.checked;
    gravarPref('textanim', textAnim ? '1' : '0');
    // Desligar completa na hora o que estiver saindo, mas NÃO para o auto-play:
    // os dois eixos são independentes.
    if (!textAnim) completarTudo();
  });

  // O cabeçalho é animação de texto, não auto-play: sai mesmo com auto-type
  // desligado (e instantâneo se text-animation estiver desligado).
  digitar(cabecalho, () => {
    if (autoType) timer = setTimeout(() => tocar(SEQUENCIA), ESPERA_CONVITE);
    else          pararAutoPlay();
  }, ABERTURA_FRAMES);
})();
