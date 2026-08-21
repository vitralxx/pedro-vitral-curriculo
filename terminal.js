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
  const novidade  = document.getElementById('novidade');
  const chromeEl  = document.querySelector('.chrome');

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

  /* O avatar precisa saber a altura do console para achar a faixa logo acima
     dele, que é onde a resposta mais recente aparece. Essa altura não é fixa:
     os chips quebram em duas linhas conforme a janela. Então ela é medida, e
     remedida quando muda — número chutado no CSS ficaria errado em metade das
     larguras. */
  if (consoleEl && 'ResizeObserver' in window) {
    const medir = () => {
      const caixa = consoleEl.getBoundingClientRect();
      const raiz = document.documentElement.style;
      raiz.setProperty('--console-altura', caixa.height + 'px');
      /* E a borda esquerda da coluna. Calcular isso no CSS a partir de
         --largura erra por alguns pixels: a unidade ch depende da fonte do
         elemento onde é lida, e a coluna ainda tem o preenchimento do container
         por fora. Sete pixels de erro é o suficiente para o rosto encostar no
         texto. Medido, o número está sempre certo. */
      raiz.setProperty('--coluna-esq', caixa.left + 'px');

      /* E a altura da moldura de baixo. Era um token fixo de 3,3rem, o que já
         era um chute: no celular a barra quebra em duas linhas por causa do
         controle de volume, e o console sticky ficaria escondido atrás dela. */
      if (chromeEl) {
        raiz.setProperty('--altura-chrome', chromeEl.offsetHeight + 'px');
      }
    };
    new ResizeObserver(medir).observe(consoleEl);
    if (chromeEl) new ResizeObserver(medir).observe(chromeEl);
    addEventListener('resize', medir);
    medir();
  }

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
    hobbies:  { seletor: '#interesses' },
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
    if (fundo - scrollY < 120) { seguindo = true; esconderNovidade(); }
  }, { passive: true });

  function seguir(el) {
    if (!seguindo) return;
    const teto    = consoleEl.getBoundingClientRect().top;
    const base    = el.getBoundingClientRect().bottom;
    const excesso = base - teto + 24;
    if (excesso > 2) scrollBy(0, excesso);
  }

  /* Aviso de conteúdo novo. Só o auto-play usa isto: arrastar a tela de quem
     está lendo, sem ele ter pedido, é irritante. Comando digitado pelo
     usuário é outro caso — ele quer ver o resultado, então desce sempre. */
  function avisarNovidade() {
    if (novidade) novidade.hidden = false;
  }
  function esconderNovidade() {
    if (novidade) novidade.hidden = true;
  }
  function descerAoFim() {
    seguindo = true;
    esconderNovidade();
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }
  if (novidade) novidade.addEventListener('click', descerAoFim);

  /* ======================================================================
     3. SOM — sintetizado na Web Audio, zero arquivo baixado.
     Um estalo é ruído branco com decaimento muito rápido num passa-banda.
     O navegador bloqueia áudio antes do primeiro gesto do usuário, então o
     contexto só nasce no primeiro clique ou tecla.
     ====================================================================== */
  let ctx = null, ruido = null, ruidoGrave = null, mestre = null;
  let ultimoClique = 0, ultimoGrave = 0;

  function ligarAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    /* Tudo passa por um ganho só. Sem ele, mudar o volume exigiria alcançar
       cada som já tocando — inclusive o zumbido, que é contínuo. Com ele, o
       slider mexe num número e o resto obedece, incluindo o que já está no ar. */
    mestre = ctx.createGain();
    mestre.gain.value = volumeAtual();
    mestre.connect(ctx.destination);

    const dur = 0.02;
    ruido = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = ruido.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }

    /* O segundo ruído é a voz do VITR0-L4: quatro vezes mais longo e com
       decaimento mais lento (expoente 1.6 contra 3). O expoente é o que muda o
       caráter — decaimento abrupto vira estalo de tecla, decaimento arrastado
       vira sílaba. Mesmo material, gesto diferente. */
    const durGrave = 0.085;
    ruidoGrave = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * durGrave), ctx.sampleRate);
    const g = ruidoGrave.getChannelData(0);
    for (let i = 0; i < g.length; i++) {
      g[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / g.length, 1.6);
    }
  }

  const somLigado = () => document.documentElement.dataset.som === 'on' && ctx;

  /* 0 a 1, lido do atributo que o ui.js escreve. O teto de 0,9 evita que o
     slider no máximo somado aos ganhos de cada som estoure e distorça. */
  function volumeAtual() {
    const bruto = Number(document.documentElement.dataset.volume);
    return (Number.isFinite(bruto) ? Math.min(100, Math.max(0, bruto)) : 70) / 100 * 0.9;
  }

  new MutationObserver(() => {
    if (mestre) mestre.gain.value = volumeAtual();
  }).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-volume']
  });

  /* Um estalo é ruído por um passa-banda. Só três coisas separam a tecla da
     voz: o buffer, a faixa de frequência e o intervalo mínimo entre dois. */
  function bater(buffer, freq, largura, volume) {
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = freq;
    filtro.Q.value = largura;
    const vol = ctx.createGain(); vol.gain.value = volume;
    src.connect(filtro).connect(vol).connect(mestre);
    src.start();
  }

  function estalo() {
    if (!somLigado()) return;
    // Limitador: sem ele, digitação rápida vira metralhadora com clipping.
    const agora = performance.now();
    if (agora - ultimoClique < 40) return;
    ultimoClique = agora;

    bater(ruido, 1500 + Math.random() * 900, 0.7, 0.06);
  }

  /* A voz dele. Mais grave e mais longa que a tecla, e mais espaçada: 90ms de
     intervalo mínimo contra 40ms. É isso que faz soar como fala e não como
     digitação — a boca dele se mexe mais devagar que os dedos de alguém.

     Não é um som novo por cima do texto; é o MESMO gesto do estalo, com outro
     timbre. Quando o terminal imprime currículo você ouve teclado; quando o
     VITR0-L4 fala você ouve a máquina falando. Dois emissores, dois timbres. */
  function estaloGrave() {
    if (!somLigado()) return;
    const agora = performance.now();
    if (agora - ultimoGrave < 90) return;
    ultimoGrave = agora;
    bater(ruidoGrave, 260 + Math.random() * 190, 1.4, 0.055);
  }

  /* O contexto de áudio só pode nascer dentro de um gesto do usuário — é regra
     do navegador. Ele nascia só no primeiro toque no campo ou clique num chip,
     e isso tinha um efeito silencioso e chato: quem ligava o som no F3 e ficava
     assistindo não ouvia NADA, porque a animação toca estalo() e estalo()
     desiste quando não há contexto. Ligar o som é um gesto tão bom quanto os
     outros, então serve para acordar o áudio. */
  new MutationObserver(() => {
    if (document.documentElement.dataset.som === 'on') ligarAudio();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-som'] });

  addEventListener('pointerdown', ligarAudio, { once: true });
  addEventListener('keydown', ligarAudio, { once: true });

  /* ----------------------------------------------------------------------
     A voz do VITR0-L4

     Mesmo esquema do estalo: tudo sintetizado, zero arquivo baixado. A regra
     que mantém isso barato é que nenhum som dura mais do que o gesto que ele
     acompanha, e o único contínuo (o zumbido) é desligado por quem o ligou.

     Volumes baixos de propósito. Som de interface que se impõe é som que a
     pessoa desliga, e aí ela perde os outros junto.
     ---------------------------------------------------------------------- */
  function tom(freq, dur, tipo, volume, freqFinal) {
    if (!somLigado()) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = tipo || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (freqFinal) osc.frequency.exponentialRampToValueAtTime(freqFinal, t0 + dur);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.0001, t0);
    vol.gain.linearRampToValueAtTime(volume, t0 + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(vol).connect(mestre);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /* Chegada: um capacitor carregando. Três estalos secos e desalinhados, e uma
     varredura subindo por baixo — casa com os 0,85s de glitch da materialização. */
  function chegada() {
    if (!somLigado()) return;
    for (let n = 0; n < 3; n++) {
      setTimeout(() => { ultimoClique = 0; estalo(); }, n * 95 + Math.random() * 50);
    }
    tom(90, 0.55, 'sawtooth', 0.05, 520);
  }

  /* Zumbido: o motor girando enquanto ele procura. Contínuo, grave, com uma
     oscilação leve para não soar como um tom puro de teste de áudio. */
  let zunido = null;
  function zumbido(ligar) {
    if (!ligar) {
      if (zunido) { zunido.parar(); zunido = null; }
      return;
    }
    if (zunido || !somLigado()) return;

    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 68;

    const lfo = ctx.createOscillator();          // trêmulo do motor
    lfo.frequency.value = 5.5;
    const lfoVol = ctx.createGain();
    lfoVol.gain.value = 6;
    lfo.connect(lfoVol).connect(osc.frequency);

    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.0001, t0);
    vol.gain.linearRampToValueAtTime(0.032, t0 + 0.3);
    osc.connect(vol).connect(mestre);
    osc.start(t0); lfo.start(t0);

    zunido = {
      parar() {
        const t = ctx.currentTime;
        vol.gain.cancelScheduledValues(t);
        vol.gain.setValueAtTime(Math.max(vol.gain.value, 0.0001), t);
        vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.stop(t + 0.32); lfo.stop(t + 0.32);
      },
    };
  }

  // Duas notas curtas, subindo: ele achou o que procurava e vai falar.
  function bip() {
    tom(660, 0.06, 'square', 0.042);
    setTimeout(() => tom(880, 0.05, 'square', 0.036), 72);
  }

  /* O avatar mora em outro arquivo e não tem contexto de áudio próprio — nem
     deve ter, dois contextos seria desperdício e dessincronia. Ele chama por
     aqui, com ?., então funciona igual se este arquivo não tiver carregado. */
  window.SOM = { estalo, estaloGrave, chegada, zumbido, bip };

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

  /* preparar() e animar() são separados de propósito.

     A abertura anima três regiões em sequência (moldura, console, cabeçalho).
     Se cada uma só fosse esvaziada quando chegasse a sua vez, as outras duas
     ficariam visíveis e completas por segundos antes de apagar e redigitar,
     que é pior do que não animar. Esvaziar as três no mesmo instante do
     carregamento resolve: ninguém vê o conteúdo antes da hora. */
  /* Quanto tempo um bloco leva para sair.

     Antes a DURAÇÃO era fixa (90 frames para tudo), então a velocidade
     variava com o tamanho: "language", com 39 caracteres, saía a 0,4
     caractere por frame, e "projects", com milhares, a mais de 90. Uma
     diferença de duas ordens de grandeza, e o bloco grande virava um borrão.

     Fixar a VELOCIDADE seria o extremo oposto: o bloco grande levaria meio
     minuto. A raiz quadrada é o meio-termo: dobrar o texto aumenta a duração
     em 40%, então o bloco maior ainda sai proporcionalmente mais rápido, mas
     longe do borrão. Os limites cortam os extremos dos dois lados. */
  const FRAMES_MIN = 100;    // 0,5s: nada mais rápido que isso registra
  const FRAMES_MAX = 420;   // 7s: acima disso vira espera, não animação
  const FRAMES_K   = 5;

  function framesPara(total) {
    return Math.min(FRAMES_MAX,
           Math.max(FRAMES_MIN, Math.round(FRAMES_K * Math.sqrt(total))));
  }

  function preparar(raiz) {
    /* Percorre ELEMENTOS e TEXTO na ordem do documento.

       Só encher nós de texto não bastava: guia de árvore, marcador [+]/[-] e
       linha divisória são pseudo-elemento e borda do CSS, não texto. Eles
       apareciam todos de uma vez enquanto as letras ainda saíam. Aqui cada
       elemento guarda quantos nós de texto vieram antes dele e fica escondido
       até a digitação chegar nele, e aí entra inteiro, com decoração e tudo,
       que é como um terminal de verdade imprime: linha a linha. */
    /* Conteúdo de <details> fechado fica de fora. Ele não está na tela, mas
       contava no orçamento: "projects" tem 8 mil caracteres, dos quais só uns
       200 aparecem (os nomes dos projetos), e o resto vive dentro das fichas
       recolhidas. O motor gastava a animação inteira digitando o invisível.
       De quebra, quem expandir uma ficha durante a animação encontra o texto
       lá, em vez de um bloco vazio. */
    const it = document.createTreeWalker(
      raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(no) {
          const el = no.nodeType === Node.ELEMENT_NODE ? no : no.parentElement;
          const pai = el && el.parentElement;
          if (pai && pai.tagName === 'DETAILS' && !pai.open
              && el.tagName !== 'SUMMARY') {
            return NodeFilter.FILTER_REJECT;   // rejeita a subárvore inteira
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

    const nos = [];      // { no, texto } de cada nó de texto
    const marcos = [];   // [elemento, índice do texto que o libera]
    let n;

    while ((n = it.nextNode())) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        marcos.push([n, nos.length]);
      } else if (n.nodeValue.trim()) {
        nos.push({ no: n, texto: n.nodeValue });
        n.nodeValue = '';
      }
    }

    const total = nos.reduce((s, x) => s + x.texto.length, 0);
    if (textAnim && total) {
      marcos.forEach(([el]) => el.classList.add('nao-revelado'));
    }
    return { raiz, nos, marcos, total };
  }

  function animar(estado, aoTerminar, frames) {
    const { raiz, nos, marcos, total } = estado;
    const porFrame = total / (frames || framesPara(total));

    // Quem está emitindo decide o timbre: o terminal tecla, o VITR0-L4 fala.
    const som = raiz.classList && raiz.classList.contains('agente')
      ? estaloGrave : estalo;
    let i = 0, pos = 0, acumulado = 0, ponteiro = 0, vivo = true;

    raiz.classList.add('digitando');

    function revelarAte(indice) {
      while (ponteiro < marcos.length && marcos[ponteiro][1] <= indice) {
        marcos[ponteiro][0].classList.remove('nao-revelado');
        ponteiro++;
      }
    }

    function completar() {
      if (!vivo) return;
      vivo = false;
      for (; i < nos.length; i++) nos[i].no.nodeValue = nos[i].texto;
      for (; ponteiro < marcos.length; ponteiro++) {
        marcos[ponteiro][0].classList.remove('nao-revelado');
      }
      raiz.classList.remove('digitando');
      emCurso.delete(completar);
      anuncio.textContent = raiz.textContent.replace(/\s+/g, ' ').trim();
      seguir(raiz);
      if (aoTerminar) aoTerminar();
    }

    if (!textAnim || total === 0) { completar(); return; }

    revelarAte(0);

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

      revelarAte(i);
      som();
      seguir(raiz);
      if (i >= nos.length) { completar(); return; }
      requestAnimationFrame(passo);
    }

    emCurso.add(completar);
    requestAnimationFrame(passo);
  }

  // Atalho para quem esvazia e anima no mesmo instante (todo comando emitido).
  function digitar(raiz, aoTerminar, frames) {
    animar(preparar(raiz), aoTerminar, frames);
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

  /* ======================================================================
     5b. O AGENTE — VITR0-L4

     Qualquer coisa que não seja um comando conhecido chega aqui. Antes virava
     uma piada e acabava; agora vai para o proxy, e a piada só volta a existir
     quando o agente não está no ar.

     Só o ENDEREÇO mora aqui. A chave da API, a ficha, os limites de taxa e toda
     a conferência ficam no Worker — esta página é estática e pública, e tudo
     que ela baixa qualquer visitante consegue ler.
     ====================================================================== */

  /* Vazio = agente desligado, e esse é o estado certo por padrão. Quem clonar o
     repositório e abrir o index.html vê o terminal se comportando exatamente
     como antes, com as mensagens bem-humoradas. O site nunca depende do agente
     para funcionar; ele só fica melhor quando o agente está lá.

     Preenchido em 21/08/2026, depois do `wrangler deploy`. Para desligar o
     agente e voltar ao terminal de antes, basta esvaziar esta string. */
  const AGENTE = 'https://vitr0-l4.pedrovitral.workers.dev/perguntar';

  /* Palavra do Pedro, fixa. Não passa pelo modelo: custa zero token, não deriva
     e aparece mesmo com a API fora do ar. O prompt manda o VITR0-L4 NÃO se
     apresentar justamente porque quem apresenta é esta linha. */
  const APRESENTACAO =
    '*brr* Prazer, me chamo VITR0-L4, códice curricular do Pedro Vitral: ' +
    'respondo algumas coisas que me recordo sobre ele e meu propósito é sanar ' +
    'suas dúvidas! Este terminal opera o currículo dele, help mostra os ' +
    'comandos, e qualquer pergunta é mais trabalho para mim. *zunn*';

  const SEM_REDE =
    '*bzzt* Não consegui alcançar meus circuitos daqui. O currículo inteiro ' +
    'continua aqui pelos comandos; digite help.';

  const OCUPADO = '*whirr* Uma coisa de cada vez. Já estou procurando a anterior.';

  /* O resumo da conversa vive aqui, em memória, e some ao recarregar. Vem
     ASSINADO pelo Worker: se alguém editar, o Worker descarta e a conversa
     recomeça. É o que impede o campo de virar caneta para escrever dentro do
     prompt de sistema. */
  let memoria = '', assinatura = '';
  let apresentado = false, perguntando = false;

  function escrever(texto, classe, aoTerminar, humor) {
    const p = document.createElement('p');
    p.className = 'resposta ' + classe;
    /* textContent, sempre. É a camada 4 inteira em uma linha: nem uma resposta
       forjada consegue injetar marcação nesta página. */
    p.textContent = texto;
    saida.appendChild(p);

    const dura = Math.max(1600, framesPara(texto.length) * (1000 / 60));

    /* falar() devolve quanto tempo o rosto precisa para se materializar e
       abrir. O texto espera esse tanto, senão os dois disputam a atenção no
       mesmo instante em cantos opostos da tela. Zero quando o rosto não vai
       aparecer, e aí nada atrasa. */
    const espera = window.VITR0?.falar(dura, humor) || 0;

    /* preparar() esvazia AGORA, animar() só depois da espera. Chamar digitar()
       atrasado deixaria o texto completo na tela durante a espera, para então
       sumir e ser redigitado — o mesmo defeito que a abertura já teve. */
    const estado = preparar(p);
    const ir = () => animar(estado, aoTerminar);
    if (espera) setTimeout(ir, espera); else ir();
  }

  /* O endereço sai da PÁGINA, nunca da resposta do modelo. O modelo redige o
     assunto e o corpo; se ele escolhesse o destinatário, uma resposta forjada
     mandaria o recrutador escrever para outra pessoa. */
  function enderecoDoPedro() {
    const a = fonte.querySelector('a[href^="mailto:"]');
    return a ? a.getAttribute('href').slice(7) : '';
  }

  function oferecer(acoes) {
    if (!Array.isArray(acoes) || !acoes.length) return;

    const nav = document.createElement('nav');
    nav.className = 'acoes';
    nav.setAttribute('aria-label', 'Sugestões do VITR0-L4');

    for (const acao of acoes) {
      /* O Worker já filtrou por lista fechada; aqui só é desenhado o que este
         cliente sabe desenhar. Tipo desconhecido some sem quebrar nada, o que
         deixa o Worker poder ganhar tipos novos antes do cliente. */
      if (acao.tipo !== 'email') continue;
      const para = enderecoDoPedro();
      if (!para) continue;

      const botao = document.createElement('a');
      botao.className = 'chip';
      botao.textContent = 'escrever para o Pedro';
      botao.href = 'mailto:' + para +
        '?subject=' + encodeURIComponent(acao.assunto) +
        '&body=' + encodeURIComponent(acao.corpo);
      nav.appendChild(botao);
    }

    if (nav.children.length) { saida.appendChild(nav); seguir(nav); }
  }

  function consultar(texto) {
    return fetch(AGENTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pergunta: texto, memoria, sig: assinatura }),
    // O Worker devolve texto pronto até quando recusa: 429 e 503 têm corpo.
    }).then(r => r.json());
  }

  async function perguntarAoAgente(texto) {
    if (perguntando) { escrever(OCUPADO, 'agente'); return; }
    perguntando = true;

    /* A chamada sai ANTES da apresentação. Assim a espera da rede corre por
       baixo do texto que já está sendo digitado, em vez de depois dele — e na
       primeira pergunta a apresentação sai de graça, dentro de um tempo que o
       visitante ia esperar de qualquer jeito. */
    const resposta = consultar(texto).catch(() => null);

    if (!apresentado) {
      apresentado = true;
      await new Promise(pronto => escrever(APRESENTACAO, 'agente', pronto));
    }

    // Agora sim ele procura: boca fechada, olhar para cima, chiado.
    window.VITR0?.pensar();

    const d = await resposta;
    perguntando = false;

    if (!d || typeof d.resposta !== 'string') {
      escrever(SEM_REDE, 'agente erro', null, 'fora');
      return;
    }

    if (d.memoria && d.sig) { memoria = d.memoria; assinatura = d.sig; }

    escrever(
      d.resposta,
      d.fonte === 'enlatada' ? 'agente erro' : 'agente',
      () => {
        oferecer(d.acoes);
        /* Depois de uma conversa, o auto-play espera bem mais que o normal.
           Quem acabou de perguntar alguma coisa provavelmente vai perguntar
           outra, e o terminal digitando sozinho no meio disso atropela. */
        agendarRetomada(ESPERA_POS_AGENTE);
      },
      d.estado
    );
  }

  function imprimirErro(cmd) {
    // Sem Worker no ar, o terminal continua sendo o que sempre foi.
    if (!AGENTE) {
      escrever(ERROS[Math.floor(Math.random() * ERROS.length)](cmd), 'erro');
      return;
    }
    perguntarAoAgente(cmd);
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

    /* Comando impresso quer dizer que a conversa acabou e a tela voltou a ser
       do currículo. O rosto desce para o lado do console — e desce agora, no
       instante em que a atenção já está mudando de lugar, e não no meio da
       leitura de um bloco. */
    window.VITR0?.recolher();

    digitar(env, aoTerminar);
  }

  function executar(bruto) {
    const cmd = bruto.trim();
    if (!cmd) return;
    completarTudo();                       // completa tudo que estiver saindo
    // Comando digitado é pedido explícito de ver o resultado: desce sempre.
    seguindo = true;
    esconderNovidade();
    ecoar(cmd);

    const def = resolver(cmd);
    if (!def)       { imprimirErro(cmd); return; }
    if (def.limpar) {
      saida.replaceChildren();
      anuncio.textContent = 'Tela limpa.';
      // A tela vazia devolve a sequência inteira à fila; sem reagendar aqui,
      // o auto-play ficaria parado esperando um toque que ninguém marcou.
      if (autoType && !pausado) agendarToque(ESPERA_ENTRE);
      return;
    }
    imprimir(def);
  }

  /* ======================================================================
     6. AUTO-PLAY
     A maioria dos recrutadores não vai digitar. O terminal se toca sozinho —
     mas digitando no campo, para que fique claro de onde o conteúdo vem.
     Qualquer interação real assume o controle e mata o auto-play.
     ====================================================================== */
  const SEQUENCIA = ['whoami', 'edu', 'projects', 'skills', 'language', 'contact', 'hobbies'];

  const ABERTURA_FRAMES  = 300;   // ~8,3s de digitação do cabeçalho
  const CONSOLE_FRAMES   = 150;    // ~1,2s montando o console
  const CHROME_FRAMES    = 75;    // ~0,8s montando os botões F1/F2/F3
  const ESPERA_CONVITE   = 2500;  // pausa antes de começar a se tocar sozinho
  const ESPERA_ENTRE     = 8000;  // entre um comando e o próximo
  /* Depois de uma resposta do agente. Muito maior que a retomada normal: a
     conversa é o momento em que o visitante está mais engajado, e é o pior
     momento possível para o terminal tomar o teclado de volta. */
  const ESPERA_POS_AGENTE = 22000;
  const ESPERA_RETOMADA  = 8000; // silêncio do usuário antes de retomar sozinho

  /* Duas variáveis, e a distinção importa:
       autoType — a caixa marcada. É a vontade declarada do usuário.
       pausado  — o usuário mexeu agora e a máquina cedeu a vez.

     Antes existia só um "autoVivo", que qualquer interação matava para sempre.
     Cedeu a vez uma vez, acabou. Agora só desmarcar a caixa encerra: qualquer
     outra interrupção é temporária, e depois de ESPERA_RETOMADA em silêncio a
     sequência volta de onde parou. */
  let pausado = false;
  let timer = null;

  /* Um comando por vez, e um timer por vez.

     A duplicação vinha daqui: `timer` servia a três propósitos (tecla do
     comando, próximo comando, retomada) e várias atribuições trocavam o handle
     sem cancelar o anterior. O timeout esquecido continuava vivo e disparava
     tocar() uma segunda vez ENQUANTO o comando ainda estava sendo digitado.
     Como ecoar() só acontece no fim da digitação, proximoPendente() ainda não
     via aquele comando no console e devolvia o mesmo de novo.

     agendar() cancela sempre. `emitindo` é o cinto de segurança: mesmo que
     escape algum timer, tocar() não começa um comando com outro em curso. */
  let emitindo = false;

  function agendar(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  /* Instante em que o próximo comando automático sai. Serve só para a
     contagem regressiva no campo: saber quanto falta tira o susto de a
     página começar a escrever sozinha do nada. */
  let alvoContagem = 0;

  function agendarToque(ms) {
    alvoContagem = performance.now() + ms;
    agendar(tocar, ms);
  }

  /* De onde retomar: lê o que JÁ ESTÁ no console em vez de confiar num
     contador interno. Assim funciona igual se o usuário digitou o comando
     na mão, se clicou no chip, ou se rodou "clear" e zerou tudo. */
  function jaNoConsole() {
    return new Set([...saida.querySelectorAll('.entrada .eco')]
      .map(e => e.textContent.trim().toLowerCase()));
  }

  function proximoPendente() {
    const feitos = jaNoConsole();
    return SEQUENCIA.find(c => !feitos.has(c)) || null;
  }

  function agendarRetomada(espera) {
    const ms = espera || ESPERA_RETOMADA;
    clearTimeout(timer);
    if (!autoType) { alvoContagem = 0; return; }
    alvoContagem = performance.now() + ms;
    agendar(() => {
      if (!autoType) return;
      // Ainda tem texto no campo: a pessoa está no meio de um comando.
      if (input.value.trim()) { agendarRetomada(); return; }
      // O agente ainda está procurando: a vez continua sendo dele.
      if (perguntando) { agendarRetomada(); return; }
      pausado = false;
      form.classList.add('aguardando');
      tocar();
    }, ms);
  }

  function interromper() {
    clearTimeout(timer);
    emitindo = false;          // a máquina cedeu a vez no meio do comando
    if (!pausado) {
      pausado = true;
      input.value = '';          // apaga o comando que a máquina estava digitando
      ghost.replaceChildren();   // e o cursor postiço: agora vale o nativo
      form.classList.remove('aguardando');
    }
    // Cada nova interação empurra a retomada para frente.
    agendarRetomada();
  }

  /* Cursor de bloco na camada ghost, logo após o texto já digitado. */
  function mostrarCursor(texto, dica) {
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

    if (dica) {
      const d = document.createElement('span');
      d.className = 'dica-tempo';
      d.textContent = '  ' + dica;
      ghost.appendChild(d);
    }
  }

  /* Tique da contagem. Só pinta quando o campo está realmente livre: com
     texto digitado ou com o foco no campo, quem manda no ghost é o
     autocompletar, e duas coisas disputando o mesmo espaço viram lixo.
     300ms é suficiente para um relógio em segundos e não custa nada. */
  let mostrandoTempo = false;

  setInterval(() => {
    if (input.value || document.activeElement === input || emitindo) return;

    /* proximoPendente() é a trava que importa: alvoContagem é gravado quando
       o toque é AGENDADO, mas quem descobre que a sequência acabou é o
       tocar(), só na hora de disparar. Sem esta checagem a contagem seguia
       correndo para um comando que nunca viria, e pior: interromper()
       reagenda a retomada a cada interação, então qualquer clique
       ressuscitava a contagem com o console já completo. */
    const falta = (autoType && alvoContagem && proximoPendente())
      ? Math.ceil((alvoContagem - performance.now()) / 1000)
      : 0;

    if (falta > 0) {
      mostrarCursor('', `próximo em ${falta}s`);
      mostrandoTempo = true;
    } else if (mostrandoTempo || !ghost.firstChild) {
      // Sem contagem, mas o campo livre continua precisando do cursor: ele é o
      // sinal de que o terminal está vivo. interromper() esvazia o ghost, e sem
      // esta segunda condição o cursor sumia de vez depois da sequência acabar.
      mostrarCursor('');
      mostrandoTempo = false;
    }
  }, 300);

  /* Digita o comando NO CAMPO, letra a letra, em ritmo humano.
     É a peça central: sem ver isso, ninguém entende o mecanismo. */
  function digitarComando(cmd, aoTerminar) {
    input.value = '';

    // Sem animação de texto o comando aparece inteiro, mas o auto-play continua:
    // são dois incômodos diferentes e cada um tem sua caixa.
    if (!textAnim) {
      input.value = cmd;
      mostrarCursor(cmd);
      agendar(() => { input.value = ''; mostrarCursor(''); aoTerminar(); }, 500);
      return;
    }

    let i = 0;
    (function tecla() {
      if (!autoType || pausado) { input.value = ''; ghost.replaceChildren(); return; }
      input.value = cmd.slice(0, ++i);
      mostrarCursor(input.value);
      estalo();
      if (i < cmd.length) {
        agendar(tecla, 60 + Math.random() * 55);   // ritmo irregular = humano
      } else {
        agendar(() => { input.value = ''; mostrarCursor(''); aoTerminar(); }, 450);
      }
    })();
  }

  function tocar() {
    /* `perguntando` é a adição que faltava. Sem ela, o auto-play digitava um
       comando no meio da espera do agente: o visitante fazia uma pergunta, o
       VITR0-L4 ficava procurando, e do nada um chip aparecia sozinho na tela.
       Quebra a ilusão de que alguém está pensando ali. */
    if (!autoType || pausado || emitindo || perguntando) return;

    const cmd = proximoPendente();
    if (!cmd) return;                       // sequência completa, nada a fazer

    emitindo = true;
    digitarComando(cmd, () => {
      if (!autoType || pausado) { emitindo = false; return; }
      ecoar(cmd);
      // Não arrasta a tela de quem está lendo mais acima: avisa e espera.
      if (!seguindo) avisarNovidade();
      // Encadeia na CONCLUSÃO da digitação, não no relógio: com pausa fixa
      // um bloco longo começaria antes de o anterior terminar de sair.
      imprimir(resolver(cmd), () => {
        emitindo = false;
        // Se o usuário assumiu enquanto isto saía, quem manda é a retomada
        // que interromper() já agendou. Agendar aqui a apagaria.
        if (!autoType || pausado) return;
        agendarToque(ESPERA_ENTRE);
      });
    });
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
  window.VITR0?.animar(textAnim);

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
  /* Tela em branco é pior do que animação indesejada: quem desligou o auto-type
     ainda precisa de um ponto de partida. "help" dá isso sem despejar o
     currículo inteiro por cima de quem justamente quer explorar sozinho. */
  function garantirPontoDePartida() {
    if (saida.children.length) return;
    ecoar('help');
    imprimir(resolver('help'));
  }

  chkAuto.addEventListener('change', () => {
    autoType = chkAuto.checked;
    gravarPref('autotype', autoType ? '1' : '0');
    if (autoType) {
      // Religar retoma de onde parou: proximoPendente() lê o console e pula
      // o que já saiu, inclusive o que o próprio usuário digitou.
      pausado = false;
      emitindo = false;
      form.classList.add('aguardando');
      agendarToque(600);
    } else {
      clearTimeout(timer);
      pausado = true;
      alvoContagem = 0;
      input.value = '';
      ghost.replaceChildren();
      form.classList.remove('aguardando');
      garantirPontoDePartida();
    }
  });

  chkAnim.addEventListener('change', () => {
    textAnim = chkAnim.checked;
    gravarPref('textanim', textAnim ? '1' : '0');
    // Desligar completa na hora o que estiver saindo, mas NÃO para o auto-play:
    // os dois eixos são independentes.
    window.VITR0?.animar(textAnim);
    if (!textAnim) completarTudo();
  });

  /* A abertura constrói a tela inteira com o mesmo motor, nesta ordem:
     moldura, console, cabeçalho. É a ordem de um terminal ligando, a interface
     sobe primeiro e o conteúdo imprime depois.

     As três são esvaziadas AGORA, juntas, e só então animadas em sequência.
     Preparar cada uma na sua vez deixaria as outras visíveis e completas por
     segundos antes de apagar para redigitar. */
  const abertura = [
    [preparar(chromeEl),  CHROME_FRAMES],
    [preparar(consoleEl), CONSOLE_FRAMES],
    [preparar(cabecalho), ABERTURA_FRAMES],
  ];

  (function proximaCena(k) {
    if (k >= abertura.length) {
      mostrarCursor('');
      if (autoType && !pausado) {
        // !pausado: se alguém já mexeu durante a abertura, quem manda é a
        // retomada que interromper() agendou.
        agendarToque(ESPERA_CONVITE);
      } else if (!autoType) {
        pausado = true;
        form.classList.remove('aguardando');
        garantirPontoDePartida();
      }
      return;
    }
    const [estado, frames] = abertura[k];
    animar(estado, () => proximaCena(k + 1), frames);
  })(0);
})();
