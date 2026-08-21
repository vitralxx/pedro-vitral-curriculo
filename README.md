# Currículo interativo de Pedro Vitral

**[vitralxx.github.io/pedro-vitral-curriculo](https://vitralxx.github.io/pedro-vitral-curriculo/)**

Um currículo que funciona como um terminal. Você digita `whoami`, `projects`,
`skills`, e o conteúdo é emitido na tela, linha a linha. Qualquer coisa que não
seja um comando vai para o VITR0-L4, um agente que responde perguntas sobre mim
consultando uma ficha de fatos e citando o que sustenta cada resposta.

Escrito à mão em HTML, CSS e JavaScript. **Sem framework, sem build, sem
dependência nenhuma.** Clonar e abrir o `index.html` já funciona.

```bash
git clone https://github.com/vitralxx/pedro-vitral-curriculo.git
cd pedro-vitral-curriculo
python -m http.server 8000
```

---

## As decisões que valem olhar

**O currículo inteiro existe no HTML, e funciona sem JavaScript.**
O bloco `#fonte` no `index.html` guarda tudo, em marcação semântica. O terminal
clona pedaços dele para dentro de `#saida` e revela o texto digitando. Quem chega
com JS desligado, ou com um leitor de tela, ou com um robô de triagem de
currículo, lê o documento completo. A experiência é um enfeite por cima de uma
página que já era acessível sozinha.

**O motor de digitação revela, ele não reescreve.**
O conteúdo tem links, listas aninhadas e negrito. Montar a string caractere a
caractere destruiria a marcação, então o motor esvazia os nós de texto, guarda o
conteúdo e vai reenchendo. Guias de árvore e marcadores entram junto com a linha
a que pertencem, e não todos de uma vez no começo.

**A velocidade escala pela raiz do tamanho.**
Duração fixa fazia um bloco de 90 caracteres e um de 8 mil saírem no mesmo tempo:
o primeiro rastejava, o segundo piscava. Hoje a duração cresce pela raiz do
tamanho e o orçamento por frame é fracionário e acumulado, o que trouxe a
diferença de velocidade entre o menor e o maior bloco de duas ordens de grandeza
para cerca de oito vezes.

**Acessibilidade não é uma caixa marcada no fim.**
Duas caixas de seleção param o movimento (WCAG 2.2.2), separadas porque são
incômodos diferentes: a página agir sozinha, e ter que esperar o texto chegar.
Contraste AA em toda a paleta. `aria-live` anuncia cada bloco emitido. A detecção
automática de `prefers-reduced-motion` foi removida de propósito: ela travava a
animação sem o visitante poder reverter, e um controle visível cumpre melhor a
mesma norma.

**O som é sintetizado, zero arquivo baixado.**
Web Audio: um estalo é ruído branco por um passa-banda. O timbre da tecla e o da
voz do agente usam o mesmo gesto, mudando buffer, frequência e espaçamento.

**O PDF sai do próprio HTML.**
`scripts/gerar_pdf.py` percorre o `index.html` com um mini-DOM e monta o
documento com ReportLab. Uma fonte só, dois formatos, sem risco de o PDF e o site
contarem histórias diferentes.

---

## VITR0-L4, o agente

Um códice curricular que responde o que está entre as linhas do currículo. Ele
mora num Cloudflare Worker, e o desenho todo parte de uma regra: **o modelo nunca
tem a última palavra.**

| camada | onde | o que faz |
|---|---|---|
| 1 | `worker/src/prompt.js` | o contrato. Faz o agente ser bom, não faz ele ser seguro |
| 2 | antes do modelo | tamanho, injeção óbvia, limite de taxa |
| 3 | depois do modelo | confere cada fato citado, primeira pessoa, tópicos |
| 4 | no cliente | texto puro, nunca `innerHTML` |

O modelo devolve JSON com os ids dos fatos que sustentam a resposta, e o proxy
confere um por um contra a ficha. Id inventado derruba a resposta inteira: se ele
inventou uma referência, já não está mais preso à ficha, e nada do resto merece
confiança. Reprovado, ele ganha uma segunda chance com a correção do que errou;
falhando de novo, o visitante lê um texto escrito por gente, que está sempre certo.

A chave da API nunca chega ao navegador. O resumo da conversa mora no cliente mas
vai **assinado**, então ninguém consegue devolver um histórico que o servidor não
escreveu. O IP do visitante nunca é gravado: o que vai para o contador é um HMAC
truncado que expira sozinho.

**132 testes**, sem gastar um token, incluindo listas de perguntas legítimas que
não podem ser barradas. Em filtro de saída o falso positivo é invisível: ele troca
uma resposta certa por uma genérica e ninguém percebe que o filtro está errado.

```bash
cd worker && node testar.mjs
```

Detalhes de operação, custo e o que fazer quando quebra: [`worker/README.md`](worker/README.md).

---

## Mapa

```
index.html          o currículo inteiro, e a fonte da verdade do terminal
estilo.css          paleta, moldura CRT, layout
terminal.js         comandos, motor de digitação, auto-play, som, o agente
avatar.js           o rosto do VITR0-L4: quando abre, o que sente, onde fica
ascii-face.js       o rosto em si, desenhado em caracteres num canvas
ui.js               modo retro/moderno, som, teclas de função, impressão
worker/             o proxy do agente, e onde mora a chave da API
scripts/            gerar o PDF, exportar a ficha do agente
imgs/               capturas dos projetos
```

---

Se você é recrutador e prefere o formato de sempre, o botão **F1** baixa o PDF,
e o comando `contact` mostra como falar comigo.
