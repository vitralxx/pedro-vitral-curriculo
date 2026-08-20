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
      estalo();
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

  function agendarRetomada() {
    clearTimeout(timer);
    if (!autoType) { alvoContagem = 0; return; }
    alvoContagem = performance.now() + ESPERA_RETOMADA;
    agendar(() => {
      if (!autoType) return;
      // Ainda tem texto no campo: a pessoa está no meio de um comando.
      if (input.value.trim()) { agendarRetomada(); return; }
      pausado = false;
      form.classList.add('aguardando');
      tocar();
    }, ESPERA_RETOMADA);
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
    if (!autoType || pausado || emitindo) return;

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
