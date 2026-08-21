/*!
 * AsciiFace — rosto ASCII animado, procedural, sem dependências.
 * Uso:  const face = AsciiFace.mount('#slot', { state:'idle' });
 *       face.set({ state:'talking', glitch:1.6 });
 *       face.look(-0.6, 0.2);  face.say(2500);  face.destroy();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AsciiFace = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    // --- grade ---
    cols: 104, rows: 60, charSize: 7, lineHeight: 1.0, padding: 10,
    // --- aparência ---
    color: '#00ff41', background: '#000000', rgbSplit: true,
    stripes: 0.7,   // listras horizontais (textura da referência)
    noise: 0.18,     // granulação estática
    scanlines: 0.45, // varredura CRT
    flicker: 0.06,
    // --- animação ---
    fps: 16, state: 'idle',   // 'idle' | 'talking' | 'thinking'
    breath: 1,       // oscilação vertical (não há movimento horizontal)
    glitch: 1, blink: 1, gazeWander: 1,
    speechRate: 1,
    // --- pose manual (usados quando o auto correspondente está em 0) ---
    mouthOpen: null, gazeX: null, gazeY: null, brow: null,
    ramp: null,      // null = a rampa padrão; passe a invertida em fundo claro
    paused: false
  };

  // ---------- utilitários ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function se(nx, ny, a, b, n, ox, oy) {
    return Math.pow(Math.abs((nx - (ox || 0)) / a), n) +
           Math.pow(Math.abs((ny - (oy || 0)) / b), n);
  }

  /* Do vazio ao cheio. Em tela escura o caractere denso é o pixel ACESO, então
     brilho alto vira "@". Num fundo claro isso inverte de sentido: denso passa
     a ser tinta, e o ponto iluminado do rosto sairia escuro, como um negativo.
     Por isso a rampa é substituível — ver `ramp` nos DEFAULTS. */
  var RAMP = "  .-=+*x#%8@";
  var GLITCH_CHARS = "@#%8*+=~-:/\\|<>";

  // ---------- geometria do rosto ----------
  // p: parâmetros estáticos | d: estado dinâmico do frame
  function cell(nx, ny, x, y, p, d) {
    var EYE_X = 0.30, EYE_Y = -0.16, MOUTH_Y = 0.42;
    var b = -1; // brilho: -1 = vazio

    // silhueta
    var face = se(nx, ny, 0.62, 0.80, 2.9, 0, -0.02);
    var jaw  = se(nx, ny, 0.50, 0.34, 3.2, 0, 0.50);
    var inFace = face <= 1.0 || jaw <= 1.0;

    if (!inFace) {
      // pescoço
      if (Math.abs(nx) < 0.24 && ny > 0.72 && ny < 0.98) b = 0.62;
      // ombros
      else if (ny > 0.86) {
        var sh = se(nx, ny, 1.15, 0.30, 2.6, 0, 1.22);
        if (sh <= 1.0) b = 0.72 - 0.28 * sh;
      }
      if (b < 0) return ' ';
    } else {
      var edge = Math.min(face, jaw);

      // ---- olhos ----
      for (var sx = -1; sx <= 1; sx += 2) {
        var ex = sx * EYE_X;
        var ds = se(nx, ny, 0.150, 0.086, 2.4, ex, EYE_Y);
        if (ds <= 1.0) {
          if (ds > 0.80) return '@';                       // contorno da órbita
          var lidY = EYE_Y - 0.086 + d.lid * 0.176;        // pálpebra desce
          if (ny < lidY) return d.lid > 0.55 ? '@' : '%';  // pálpebra
          var gx = ex + d.gazeX * 0.045, gy = EYE_Y + d.gazeY * 0.026;
          var di = se(nx, ny, 0.090, 0.070, 2.0, gx, gy);  // íris
          if (di <= 1.0) {
            if (se(nx, ny, 0.042, 0.034, 2.0, gx, gy) <= 1.0) return '@';   // pupila
            if (se(nx, ny, 0.020, 0.017, 2.0, gx - 0.050, gy - 0.028) <= 1.0) return '@'; // brilho
            return di > 0.70 ? '%' : '=';
          }
          return ' ';                                       // esclera vazia
        }
      }

      // ---- sobrancelhas ----
      for (var sb = -1; sb <= 1; sb += 2) {
        var bx = nx - sb * EYE_X;
        var arc = EYE_Y - 0.200 - d.browRaise * 0.055
                + 0.80 * bx * bx + d.browTilt * sb * bx * 1.6;
        if (Math.abs(bx) < 0.150 && Math.abs(ny - arc) < 0.024) return '@';
      }

      // ---- nariz ----
      if (Math.abs(nx) < 0.026 && ny > -0.02 && ny < 0.19) b = 0.92;
      else if (Math.abs(nx) > 0.036 && Math.abs(nx) < 0.088 && ny > 0.185 && ny < 0.225) b = 1.0;

      // ---- boca ----
      var open = d.mouth;
      var mh = 0.026 + open * 0.135;
      var mw = 0.255 - open * 0.045;
      var dm = se(nx, ny, mw, mh, 2.5, 0, MOUTH_Y);
      if (dm <= 1.0) {
        if (dm > 0.74) return '@';                          // lábios
        if (open < 0.10) return '%';
        if (open > 0.35 && ny < MOUTH_Y - mh * 0.42) return '-'; // dentes superiores
        return ' ';                                          // cavidade
      }

      if (b < 0) {
        if (edge > 0.94) return '@';
        if (edge > 0.86) return '8';
        b = 0.80 - 0.42 * edge - 0.14 * ny;
        if (Math.abs(nx) > 0.28 && Math.abs(nx) < 0.50 && ny > 0.14 && ny < 0.44) b += 0.10; // maçãs
        if (Math.abs(nx) < 0.24 && ny < -0.42) b += 0.08;    // testa
      }
    }

    // textura: listras horizontais + granulação (assinatura da referência)
    if (y % 2 === 1) b -= p.stripes * 0.38;
    b += (hash(x, y) - 0.5) * p.noise;

    var rampa = p.ramp || RAMP;
    var i = Math.round(clamp(b, 0, 1) * (rampa.length - 1));
    return rampa.charAt(i);
  }

  function buildRows(p, d) {
    var rows = p.rows, cols = p.cols;
    var cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    var k = rows / 2, ax = 0.60; // proporção da célula monoespaçada
    var out = new Array(rows), y, x, line, ny, nx;
    for (y = 0; y < rows; y++) {
      ny = (y - cy) / k;
      line = '';
      for (x = 0; x < cols; x++) {
        nx = (x - cx) * ax / k;
        line += cell(nx, ny, x, y, p, d);
      }
      out[y] = line;
    }
    return out;
  }

  // ---------- controlador de animação ----------
  function Face(el, opts) {
    this.p = {};
    for (var k in DEFAULTS) this.p[k] = DEFAULTS[k];
    this.set(opts || {}, true);

    this.root = el;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.maxWidth = '100%';
    this.ctx = this.canvas.getContext('2d');
    el.appendChild(this.canvas);

    this.f = 0;
    this.d = {
      lid: 0, gazeX: 0, gazeY: 0, mouth: 0, browRaise: 0, browTilt: 0,
      dy: 0, glitch: 0
    };
    this._tg = { gazeX: 0, gazeY: 0, mouth: 0, browRaise: 0, browTilt: 0 };
    this._blinkAt = 40; this._gazeAt = 60; this._glitchAt = 90; this._glitchLen = 0;
    this._sayUntil = 0;

    this._layout();
    this._last = 0;
    var self = this;
    this._tick = function (t) {
      self._raf = requestAnimationFrame(self._tick);
      if (self.p.paused) return;
      if (t - self._last < 1000 / self.p.fps) return;
      self._last = t;
      self._step();
      self._draw();
    };
    this._raf = requestAnimationFrame(this._tick);
  }

  Face.prototype.set = function (o, skipLayout) {
    var relayout = false;
    for (var k in o) {
      if (!(k in this.p)) continue;
      if (k === 'cols' || k === 'rows' || k === 'charSize' ||
          k === 'lineHeight' || k === 'padding') relayout = true;
      this.p[k] = o[k];
    }
    if (relayout && !skipLayout && this.canvas) { this._layout(); this._draw(); }
    return this;
  };

  Face.prototype.look = function (x, y) {
    this.p.gazeX = clamp(x, -1, 1);
    this.p.gazeY = clamp(y == null ? 0 : y, -1, 1);
    return this;
  };

  /** fala por `ms` milissegundos e volta sozinho para idle */
  Face.prototype.say = function (ms) {
    this.p.state = 'talking';
    this._sayUntil = performance.now() + (ms || 2000);
    return this;
  };

  /* Pensa enquanto alguém procura uma resposta para ele.
     `ms` não é a duração: é a rede de segurança. A espera de verdade acaba
     quando chega say() ou set({state:'idle'}). O prazo existe para o caso de a
     resposta nunca chegar — aí ele volta a idle em vez de pensar para sempre. */
  Face.prototype.think = function (ms) {
    this.p.state = 'thinking';
    this._sayUntil = performance.now() + (ms || 20000);
    return this;
  };

  Face.prototype.blinkNow = function () { this._blinkAt = this.f; return this; };
  Face.prototype.pause = function () { this.p.paused = true; return this; };
  Face.prototype.resume = function () { this.p.paused = false; return this; };

  Face.prototype.destroy = function () {
    cancelAnimationFrame(this._raf);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  Face.prototype._layout = function () {
    var p = this.p, ctx = this.ctx;
    var dpr = window.devicePixelRatio || 1;
    ctx.font = p.charSize + 'px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    this.cw = ctx.measureText('M').width;
    this.lh = p.charSize * p.lineHeight;
    var w = Math.ceil(this.cw * p.cols + p.padding * 2);
    var h = Math.ceil(this.lh * p.rows + p.padding * 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = p.charSize + 'px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    this.W = w; this.H = h;
  };

  Face.prototype._step = function () {
    var p = this.p, d = this.d, t = this._tg, f = ++this.f;

    if (this._sayUntil && performance.now() > this._sayUntil) {
      this._sayUntil = 0; p.state = 'idle';
    }

    // respiração — apenas vertical
    d.dy = Math.sin(f * 0.075) * 0.9 * p.breath + Math.sin(f * 0.031) * 0.4 * p.breath;

    // piscar
    if (p.blink > 0 && f >= this._blinkAt) {
      var since = f - this._blinkAt;
      d.lid = since < 2 ? since / 2 : since < 4 ? 1 : since < 6 ? (6 - since) / 2 : 0;
      if (since > 6) {
        // concentrado pisca menos — é assim que a gente lê concentração
        var espaco = p.state === 'thinking' ? 2.1 : 1;
        this._blinkAt = f + Math.round((45 + Math.random() * 90) * espaco / p.blink);
        if (p.state !== 'thinking' && Math.random() < 0.22) this._blinkAt = f + 8; // piscada dupla
        d.lid = 0;
      }
    } else d.lid = 0;

    // olhar
    if (p.gazeX == null || p.gazeY == null) {
      if (p.state === 'thinking') {
        /* O olhar é o que diz "estou pensando" — não a boca. Quem procura uma
           informação olha para CIMA e para LONGE de quem perguntou, e demora
           mais em cada ponto: está lendo uma coisa que não está na frente dele.
           gazeY negativo é para cima (a íris usa EYE_Y + gazeY). */
        if (f >= this._gazeAt) {
          t.gazeX = (Math.random() * 2 - 1) * 0.95;
          t.gazeY = -0.40 - Math.random() * 0.45;
          this._gazeAt = f + Math.round(50 + Math.random() * 55);
        }
      } else if (p.gazeWander > 0 && f >= this._gazeAt) {
        t.gazeX = (Math.random() * 2 - 1) * 0.85;
        t.gazeY = (Math.random() * 2 - 1) * 0.5;
        this._gazeAt = f + Math.round((30 + Math.random() * 70) / p.gazeWander);
      }
    }
    var tgx = p.gazeX != null ? p.gazeX : t.gazeX;
    var tgy = p.gazeY != null ? p.gazeY : t.gazeY;
    // pensando o olho vai devagar: movimento rápido lê como distração, lento
    // lê como deliberação, e é deliberação que a espera precisa transmitir
    var vel = p.state === 'thinking' ? 0.16 : 0.35;
    d.gazeX = lerp(d.gazeX, tgx, vel);
    d.gazeY = lerp(d.gazeY, tgy, vel);

    // boca
    if (p.mouthOpen != null) {
      t.mouth = p.mouthOpen;
    } else if (p.state === 'talking') {
      var ph = f * 0.42 * p.speechRate;
      var env = 0.5 + 0.5 * Math.sin(ph) * Math.sin(ph * 0.37 + 1.3);
      var pause = Math.sin(f * 0.055 * p.speechRate) > 0.82; // respiros na fala
      t.mouth = pause ? 0 : clamp(env * (0.45 + Math.random() * 0.55), 0, 1);
    } else if (p.state === 'thinking') {
      // Boca fechada, com um "hmm" curto de vez em quando. Se ela abrisse de
      // verdade ele estaria falando — e falar sem ter o que dizer é exatamente
      // o que a espera não pode parecer.
      t.mouth = (f % 88) < 4 ? 0.16 : 0;
    } else {
      t.mouth = 0;
    }
    d.mouth = lerp(d.mouth, t.mouth, 0.55);

    // sobrancelhas
    if (p.brow != null) {
      t.browRaise = p.brow; t.browTilt = 0;
    } else if (p.state === 'talking') {
      t.browRaise = d.mouth > 0.6 ? 0.9 : 0.15;
      t.browTilt = Math.sin(f * 0.09) * 0.05;
    } else if (p.state === 'thinking') {
      // Franzida e assimétrica. browRaise negativo BAIXA a sobrancelha, e
      // sobrancelha baixa é a cara de quem está procurando alguma coisa.
      t.browRaise = -0.30 + Math.sin(f * 0.026) * 0.12;
      t.browTilt = 0.14;
    } else {
      t.browRaise = (f % 210) < 16 ? 0.7 : 0;
      t.browTilt = 0;
    }
    d.browRaise = lerp(d.browRaise, t.browRaise, 0.25);
    d.browTilt = lerp(d.browTilt, t.browTilt, 0.2);

    // glitch
    if (p.glitch > 0) {
      if (this._glitchLen > 0) { this._glitchLen--; d.glitch = this._glitchLen / this._glitchMax; }
      else if (f >= this._glitchAt) {
        this._glitchMax = this._glitchLen = 2 + Math.floor(Math.random() * 4);
        // pensando ele chia mais: é uma máquina velha vasculhando o arquivo,
        // e o chiado é o barulho de trabalho acontecendo
        var ritmo = p.state === 'thinking' ? 0.45 : 1;
        this._glitchAt = f + Math.round((60 + Math.random() * 140) * ritmo / p.glitch);
        d.glitch = 1;
      } else d.glitch = 0;
    } else d.glitch = 0;
  };

  Face.prototype._draw = function () {
    var p = this.p, d = this.d, ctx = this.ctx, f = this.f;
    var rows = buildRows(p, d).map(function (t) { return { t: t, dx: 0 }; });
    var g = d.glitch * p.glitch;

    if (g > 0) {
      var n = Math.round(2 + g * 6), i, yy;
      for (i = 0; i < n; i++) {
        yy = Math.floor(Math.random() * p.rows);
        rows[yy].dx = Math.round((Math.random() * 2 - 1) * g * 9);
      }
      var kk = Math.round(g * 70);
      for (i = 0; i < kk; i++) {
        yy = Math.floor(Math.random() * p.rows);
        var xx = Math.floor(Math.random() * p.cols), s = rows[yy].t;
        if (s.charAt(xx) !== ' ') {
          rows[yy].t = s.slice(0, xx) +
            GLITCH_CHARS.charAt(Math.floor(Math.random() * GLITCH_CHARS.length)) +
            s.slice(xx + 1);
        }
      }
    }

    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, this.W, this.H);

    var self = this;
    function put(col, ox, alpha) {
      ctx.globalAlpha = alpha; ctx.fillStyle = col;
      for (var i = 0; i < rows.length; i++) {
        ctx.fillText(rows[i].t, p.padding + rows[i].dx + ox,
                     p.padding + i * self.lh + d.dy);
      }
    }

    if (p.rgbSplit && g > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      put('#ff0040', -g * 3, 0.45 * g);
      put('#00d0ff', g * 3, 0.45 * g);
      ctx.globalCompositeOperation = 'source-over';
    }
    put(p.color, 0, Math.max(0.25, 1 - p.flicker * Math.abs(Math.sin(f * 0.7)) - g * 0.1));
    ctx.globalAlpha = 1;

    if (p.scanlines > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.4 * p.scanlines) + ')';
      for (var yy2 = 0; yy2 < this.H; yy2 += 3) ctx.fillRect(0, yy2, this.W, 1);
      var by = ((f * 3) % (this.H + 120)) - 60;
      var gr = ctx.createLinearGradient(0, by, 0, by + 50);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,' + (0.05 * p.scanlines) + ')');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, by, this.W, 50);
    }
  };

  // ---------- API pública ----------
  return {
    mount: function (target, opts) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) throw new Error('AsciiFace: alvo não encontrado — ' + target);
      return new Face(el, opts);
    },
    defaults: DEFAULTS,
    // renderiza um frame como array de strings (útil para testes/SSR)
    render: function (opts, dyn) {
      var p = {}; for (var k in DEFAULTS) p[k] = DEFAULTS[k];
      for (var j in (opts || {})) p[j] = opts[j];
      var d = { lid: 0, gazeX: 0, gazeY: 0, mouth: 0, browRaise: 0, browTilt: 0 };
      for (var m in (dyn || {})) d[m] = dyn[m];
      return buildRows(p, d);
    }
  };
}));
