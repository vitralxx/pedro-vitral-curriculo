/* ==========================================================================
   avatar.js — VITR0-L4, o rosto.

   Nasce MINIMIZADO: só a placa com o nome, na goteira esquerda. O rosto abre
   quando o agente fala, ou quando o visitante clica na placa.

   API para o terminal:
       VITR0.pensar()    abre e fica procurando, enquanto alguém busca a resposta
       VITR0.falar(ms, humor)  abre, fala por um tempo, e volta a idle sozinho
       VITR0.calar()     volta a idle na hora
       VITR0.recolher()  volta para o lado do console
       VITR0.animar(b)   liga e desliga toda a animação
       VITR0.olhar(x,y)  força a direção do olhar

   pensar() e falar() existem separados por um motivo que não é enfeite. O rosto
   e o texto do terminal ficam em cantos opostos da tela, e se os dois se mexerem
   ao mesmo tempo o visitante perde os dois. Então eles se revezam: enquanto a
   resposta está sendo buscada o rosto tem a tela só para ele, e quando o texto
   começa a sair ele já silenciou.

   O terminal não precisa saber que existe um canvas do outro lado. No dia que
   o agente entrar, quem fala continua sendo quem chama falar().
   ========================================================================== */
(() => {
  'use strict';

  const slot  = document.getElementById('vitr0');
  const corpo = document.getElementById('vitr0-corpo');
  const botao = document.getElementById('vitr0-alternar');
  if (!slot || !corpo || !botao || typeof AsciiFace === 'undefined') return;

  const ler = (k, p) => { try { return localStorage.getItem(k) ?? p; } catch { return p; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* segue */ } };

  /* --------------------------------------------------------------------
     O rosto no Modo Moderno

     O CRT inteiro é feito para uma tela que brilha no escuro: listra, chuvisco,
     varredura e cintilação leem como fósforo. Nos mesmos valores sobre fundo
     claro eles não leem como nada, leem como sujeira, e o rosto vira um borrão
     cinza numa página limpa.

     Então o Modo Moderno não é só trocar duas cores: é desligar a textura e
     ficar só com o desenho em caracteres, que é a identidade dele. O chiado
     não some de todo, só fica raro — máquina velha continua sendo máquina
     velha, mas em modo moderno ela está bem cuidada.
     -------------------------------------------------------------------- */
  const MODERNO = {
    stripes: 0, noise: 0.05, scanlines: 0, flicker: 0,
    rgbSplit: false, glitch: 0.30,
    /* A rampa invertida. Sem ela o rosto sai como um negativo no fundo claro:
       a rampa mapeia brilho para densidade de caractere, e caractere denso, que
       em tela escura é o pixel aceso, em papel branco é tinta. O ponto
       iluminado da bochecha virava a mancha mais escura do desenho. */
    ramp: '@8%#x*+=-.  ',
  };

  /* Cor, fundo e textura, lidos do tema que estiver valendo agora. Vai por
     ÚLTIMO em toda aplicação: assim nenhum preset e nenhum humor consegue
     reacender a textura do CRT quando o visitante pediu a versão calma. */
  function tema() {
    const css = getComputedStyle(document.documentElement);
    const moderno = document.documentElement.dataset.modo === 'moderno';
    return {
      color: css.getPropertyValue('--verde-medio').trim() || '#4fd98a',
      background: css.getPropertyValue('--fundo').trim() || '#050b07',
      ...(moderno ? MODERNO : {}),
    };
  }

  /* --------------------------------------------------------------------
     Dois tamanhos, e a textura acompanha.

     Os números de textura vieram da calibragem do Pedro no demo, feita em
     tela grande. Aplicados a um rosto pequeno, listra e granulação comem as
     feições: com 44 linhas em 196px, cada célula tem 4px e o ruído vira o
     desenho inteiro. Então textura escala junto com o tamanho.

     O teto do FALANDO é a goteira: com a coluna de texto em ~788px centrada,
     sobra (janela - 788) / 2 de cada lado. charSize 6 dá 231px, que cabe a
     partir de 1320px de janela — o mesmo ponto onde o CSS revela o avatar.
     -------------------------------------------------------------------- */
  const GRADE = { cols: 64, rows: 44 };   // enquadra cabeça e um pouco de ombro

  const PARADO  = { charSize: 4, stripes: 0.55, noise: 0.22,
                    scanlines: 0.55, flicker: 0.03, glitch: 1.0 };
  const FALANDO = { charSize: 6, stripes: 1.00, noise: 0.44,
                    scanlines: 1.00, flicker: 0.06, glitch: 2.00 };

  /* Pensando ele já está do tamanho de quem foi chamado, mas com a textura um
     pouco mais quieta que a fala: o que aumenta é o chiado, não o brilho. O
     ascii-face ainda encurta o intervalo do glitch por conta própria quando o
     estado é 'thinking', então este 1.6 rende mais chiado que o 2.0 da fala. */
  const PENSANDO = { charSize: 6, stripes: 0.85, noise: 0.38,
                     scanlines: 0.90, flicker: 0.05, glitch: 1.60 };

  /* Se ninguém mandar parar — a chamada travou, a rede caiu — ele volta a idle
     sozinho. Rosto pensando para sempre é pior do que rosto parado. */
  const PENSANDO_MAX = 20000;

  /* --------------------------------------------------------------------
     Humores

     O rosto muda conforme O QUE ACONTECEU, e quem decide isso é o Worker, não
     o modelo. A diferença importa: se o modelo pudesse pedir "raiva", bastaria
     um visitante descobrir como irritar o VITR0-L4 para virar um jogo — e todo
     o desenho de segurança parte de que emoção não é canal de conversa com o
     agente. Derivado do evento, não há o que farmar.

     `barrado` é a única cara de irritação que existe, e ela aparece só quando o
     Worker barrou uma injeção. É julgamento da máquina sobre uma coisa que ela
     mesma viu, e por isso é o único lugar onde irritação é segura.

     Cada humor é só uma camada por cima do FALANDO. Nenhum deles muda o TEXTO:
     o que o visitante lê é o mesmo, muda a cara de quem está lendo para ele.
     -------------------------------------------------------------------- */
  const HUMORES = {
    // respondeu com fato: a cara padrão, sem camada nenhuma
    respondeu: {},

    // procurou e não achou: sobrancelha erguida, menos chiado
    vazio:    { brow: 0.65, glitch: 1.30, noise: 0.34 },

    // se conteve: sobrancelha baixa e a imagem um pouco mais instável
    contido:  { brow: -0.25, glitch: 2.60, noise: 0.55, flicker: 0.09 },

    // barrou uma injeção: seca, curta, sem simpatia
    barrado:  { brow: -0.55, glitch: 3.20, noise: 0.60, flicker: 0.12, stripes: 1.20 },

    // fora do ar: mal está aqui
    fora:     { brow: -0.10, glitch: 3.00, noise: 0.70, flicker: 0.14, scanlines: 1.30 },
  };

  /* brow fica travado enquanto o humor durar, então PARADO precisa devolver o
     controle ao automático. Sem este null a sobrancelha congelaria na cara do
     último humor e ficaria assim para sempre. */
  const SOLTAR_POSE = { brow: null, mouthOpen: null };

  const rosto = AsciiFace.mount(corpo, {
    ...GRADE, ...PARADO,
    fps: 25, breath: 1.90, blink: 1.20, speechRate: 1.30,
    gazeX: null, gazeY: null, state: 'idle',
    ...tema(),
  });

  /* Qual preset está vestido agora. Existe para o observador de tema conseguir
     repintar sem saber se ele estava parado, pensando ou falando. */
  let vestido = PARADO;

  function vestir(preset, extra) {
    if (preset) vestido = preset;
    rosto.set({ ...(preset || vestido), ...(extra || {}), ...tema() });
  }

  /* --------------------------------------------------------------------
     Estado

     aberto   — o rosto está à mostra
     dispensado — o visitante FECHOU na mão. Enquanto isso valer, mensagem
                  nova não abre sozinha: fechar tem que significar fechar.
     -------------------------------------------------------------------- */
  const salvo    = ler('vitr0', '');   // '' = visitante nunca mexeu
  let aberto     = salvo === 'aberto';
  let dispensado = salvo === 'min';    // só quando ele FECHOU na mão

  /* Ele não existe na tela até ser chamado pela primeira vez. Aparecer do nada,
     já falando, no canto do olho de quem está lendo, assusta. Uma vez revelado,
     fica revelado também nas próximas visitas: a chegada é apresentação, e
     apresentação só acontece uma vez. */
  let revelado = ler('vitr0-revelado', '0') === '1';

  let visivel = true, naTela = true, ligado = true;
  let timerFala = 0, timerChegada = 0;

  function reavaliar() {
    // Canvas parado quando não há ninguém olhando: 64x44 células a 25fps é
    // bateria do visitante. Fechado, escondido ou fora da tela, ele para.
    const rodar = ligado && aberto && visivel && naTela;
    rodar ? rosto.resume() : rosto.pause();
    slot.dataset.estado   = aberto ? 'aberto' : 'minimizado';
    slot.dataset.rodando  = String(rodar);
    slot.dataset.anim     = String(ligado);
    slot.dataset.revelado = String(revelado);
    if (!slot.dataset.onde) slot.dataset.onde = 'console';
    botao.setAttribute('aria-expanded', String(aberto));
  }

  function abrir(porVontadeDoUsuario) {
    aberto = true;
    if (porVontadeDoUsuario) dispensado = false;
    gravar('vitr0', 'aberto');
    reavaliar();
  }

  function fechar(porVontadeDoUsuario) {
    aberto = false;
    if (porVontadeDoUsuario) dispensado = true;
    gravar('vitr0', 'min');
    clearTimeout(timerFala);
    window.SOM?.zumbido(false);
    vestir(PARADO, { ...SOLTAR_POSE, state: 'idle' });
    reavaliar();
  }

  botao.addEventListener('click', () => (aberto ? fechar(true) : abrir(true)));

  document.addEventListener('visibilitychange', () => {
    visivel = !document.hidden;
    reavaliar();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      naTela = e.isIntersecting;
      reavaliar();
    }, { threshold: 0.05 }).observe(slot);
  }

  /* Modo Moderno troca a paleta E a textura; o rosto acompanha as duas. Antes
     só a cor era atualizada, e o fundo continuava preto — um retângulo escuro
     grudado numa página clara. */
  new MutationObserver(() => vestir())
    .observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-modo']
    });

  /* --------------------------------------------------------------------
     API
     -------------------------------------------------------------------- */
  /* A chegada é encenada em duas etapas de propósito: a placa se materializa
     com glitch, e só depois o rosto abre e fala. Os dois eventos juntos
     competiriam entre si e com o texto que está saindo no terminal. */
  function revelar(aoTerminar) {
    revelado = true;
    gravar('vitr0-revelado', '1');
    slot.dataset.revelado = 'true';

    if (!ligado) { aoTerminar(); return; }

    slot.dataset.chegando = 'true';
    window.SOM?.chegada();
    clearTimeout(timerChegada);
    timerChegada = setTimeout(() => {
      slot.dataset.chegando = 'false';
      aoTerminar();
    }, 850);
  }

  window.VITR0 = {
    /* Enquanto alguém procura a resposta. O olhar sobe e vagueia, a boca fica
       fechada, o chiado aumenta.

       Na PRIMEIRA pergunta isso resolve de graça um problema que antes custava
       tempo: a chegada de 850ms passa a acontecer aqui dentro, durante a espera
       da API, em vez de atrasar o texto. O visitante nunca espera pela
       apresentação — ele já estava esperando pela resposta.

       Não devolve tempo de espera para ninguém: quem chamou já está esperando. */
    pensar() {
      if (!ligado || dispensado) return;
      if (!revelado) { revelar(() => this.pensar()); return; }
      if (!aberto) abrir(false);

      clearTimeout(timerFala);
      vestir(PENSANDO, SOLTAR_POSE);   // pensar tem pose própria, não a do humor
      rosto.think(PENSANDO_MAX);
      window.SOM?.zumbido(true);

      /* A subida acontece AQUI, e não na hora de falar, e isso é a coisa mais
         importante deste método. Pensando é o único momento em que nada mais
         se mexe na tela: o comando já foi ecoado, a resposta ainda não começou.
         Mover o rosto agora é grátis. Mover junto com o texto saindo seria
         reintroduzir os dois pontos de atenção que a gente passou a semana
         separando. */
      slot.dataset.onde = 'fala';

      timerFala = setTimeout(() => this.calar(), PENSANDO_MAX);
    },

    /* Devolve quantos milissegundos quem chamou deve ESPERAR antes de começar
       a escrever o texto. Sem isso, rosto e texto disputam a atenção no mesmo
       instante, em cantos opostos da tela, e o visitante perde os dois.
       Devolve 0 quando o rosto não vai aparecer: aí nada atrasa. */
    falar(ms, humor) {
      if (!ligado) return 0;
      if (dispensado) return 0;   // fechado na mão: não reabre sozinho

      if (!revelado) {
        // primeira vez: materializa, e só então abre e fala
        revelar(() => this.falar(ms, humor));
        return 850;               // duração da chegada
      }

      const precisavaAbrir = !aberto;
      if (precisavaAbrir) abrir(false);

      const dura = ms || 1500;
      window.SOM?.zumbido(false);   // parou de procurar
      window.SOM?.bip();
      slot.dataset.onde = 'fala';
      /* FALANDO como base, a pose solta por cima, e o humor por último: o humor
         é camada, não substituto. SOLTAR_POSE antes dele garante que a
         sobrancelha do humor anterior não sobreviva quando o novo não tem uma. */
      vestir(FALANDO, { ...SOLTAR_POSE, ...(HUMORES[humor] || HUMORES.respondeu) });
      rosto.say(dura);
      clearTimeout(timerFala);
      timerFala = setTimeout(() => this.calar(), dura);

      return precisavaAbrir ? 300 : 0;   // 300 = a transição do painel abrindo
    },

    calar() {
      clearTimeout(timerFala);
      window.SOM?.zumbido(false);
      // SOLTAR_POSE devolve a sobrancelha ao automático
      vestir(PARADO, { ...SOLTAR_POSE, state: 'idle' });
    },

    /* Volta para o lado do console. Quem chama é o terminal, quando começa a
       imprimir um COMANDO — ou seja, quando a conversa acabou e a tela voltou a
       ser do currículo. O movimento cai num momento em que a atenção já está
       mudando de lugar de qualquer jeito. */
    recolher() {
      slot.dataset.onde = 'console';
    },

    animar(b) {
      ligado = !!b;
      if (!ligado) { clearTimeout(timerFala); this.calar(); }
      reavaliar();
    },

    olhar(x, y) { rosto.look(x, y); },
  };

  reavaliar();
})();
