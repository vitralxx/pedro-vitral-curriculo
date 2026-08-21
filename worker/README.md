# Proxy do VITR0-L4

O currículo é um site estático no GitHub Pages, e site estático não guarda
segredo: tudo que o navegador baixa, o visitante lê. A chave da API do Gemini
não pode estar lá. Então ela mora aqui, num Cloudflare Worker, e a página nunca
chega perto dela.

O proxy faz três coisas, nesta ordem de importância:

1. **Guarda a chave.** É o motivo de existir.
2. **Limita o gasto.** Endpoint de LLM aberto na internet é convite, e o Pedro
   já previu o cenário: *"meus amigos com certeza vão querer exaurir o saldo da
   chave"*. Três tetos seguram isso.
3. **Confere a resposta antes de ela chegar à tela.** O modelo diz quais fatos
   está usando; o proxy confere um por um. Resposta que não passa ganha **uma
   segunda chance** — o proxy conta ao modelo o que deu errado e deixa ele
   tentar outra vez — e só então vira um texto enlatado, escrito por gente, que
   está sempre certo.

O ponto que organiza o desenho inteiro: **o modelo nunca tem a última palavra.**

---

## Os arquivos

| arquivo | o que é |
|---|---|
| `src/index.js` | o proxy. Camadas 2 e 3, limite de taxa, CORS. |
| `src/prompt.js` | o contrato do agente. É redação, não código — é o arquivo que o Pedro revisa. |
| `ficha.json` | os fatos que vão ao ar. **Gerado.** Não editar à mão. |
| `testar.mjs` | 132 testes, sem gastar token. |
| `wrangler.toml` | configuração. Nenhum segredo aqui. |
| `../exportar_ficha.py` | gera `ficha.json` a partir de `planejamento/fatos.json`. |

---

## Subir pela primeira vez

Precisa de conta na Cloudflare (o plano gratuito basta) e da chave da API do
Gemini no [AI Studio](https://aistudio.google.com/apikey).

**1. Gere a ficha** (a partir da raiz do projeto, não daqui):

```bash
python exportar_ficha.py
```

**2. Crie o espaço do KV** e cole o id que ele imprimir em `wrangler.toml`:

```bash
npx wrangler kv namespace create ESTADO
```

**3. Guarde os dois segredos.** Eles ficam na Cloudflare, nunca no repositório:

```bash
npx wrangler secret put GEMINI_API_KEY
```

```bash
npx wrangler secret put SEGREDO
```

`SEGREDO` é qualquer string longa e aleatória, inventada por você. Serve para
duas coisas: assinar o resumo da conversa e apelidar o IP do visitante. Se
trocar depois, as conversas em andamento recomeçam do zero — sem drama.

**4. Suba:**

```bash
npx wrangler deploy
```

**5. Confira que está de pé.** Troque pela URL que o deploy imprimiu:

```bash
curl https://vitr0-l4.SEU-SUBDOMINIO.workers.dev/saude
```

---

## O dia a dia

**Mudou `planejamento/fatos.json`?** A ficha que está no ar não muda sozinha:

```bash
python exportar_ficha.py && cd worker && npx wrangler deploy
```

**Antes de qualquer deploy**, rode a bateria:

```bash
cd worker && node testar.mjs
```

**Para ver o que está sendo recusado em produção:**

```bash
cd worker && npx wrangler tail
```

O `tail` é como você afina os filtros. Cada reprovação da camada 3 aparece ali
com o motivo e o começo da resposta que o modelo tinha dado. Se aparecer muita
reprovação boa sendo descartada, o filtro está apertado demais; se aparecer
pouca coisa, está frouxo. Nenhum IP e nenhuma pergunta são gravados em lugar
nenhum — o `tail` é ao vivo e não fica.

---

## O contrato com o cliente

`POST /perguntar`

```json
{ "pergunta": "ele sabe python?", "memoria": "...", "sig": "..." }
```

`memoria` e `sig` vêm da resposta anterior e são opcionais na primeira pergunta.

A resposta é sempre o mesmo formato, dê certo ou dê errado:

```json
{
  "resposta": "texto puro, para imprimir no terminal",
  "fatos": ["id.nome"],
  "sabia": true,
  "acoes": [{ "tipo": "email", "assunto": "...", "corpo": "..." }],
  "estado": "respondeu",
  "fonte": "modelo",
  "memoria": "...",
  "sig": "..."
}
```

`fonte` é `"modelo"` ou `"enlatada"`. Quando é enlatada vem também um `motivo`
(`citacao`, `pessoa`, `dinheiro`, `proibido`, `longa`, `api`, `limite`,
`entrada`, `injecao`).

### `acoes` — o modelo propõe, nunca executa

Lista fechada. Tipo que não está na tabela `ACOES` do `index.js` é descartado em
silêncio, então o modelo só consegue oferecer coisa que já foi escrita e
revisada. No máximo duas por resposta, e quase sempre a lista vem vazia.

Hoje existe um tipo: `email`. Acrescentar `baixar-pdf` ou `comando` é uma entrada
nessa tabela mais um pedaço de renderização no cliente — sem mexer no contrato.

**É uma lista, e não um campo por capacidade, de propósito.** Campo fixo convida
a ser preenchido sempre, e foi esse o defeito do `email` antigo: o agente virava
máquina de mandar e-mail. Item de lista é opcional por natureza.

### `estado` — o humor do rosto, decidido pelo Worker

| estado | quando |
|---|---|
| `respondeu` | respondeu com fato |
| `vazio` | procurou e não achou (`sabia: false`) |
| `contido` | enlatada por citação, pessoa, tamanho, dinheiro ou tópico |
| `barrado` | injeção barrada |
| `fora` | API fora do ar ou teto de taxa batido |

**Não vem do modelo, e isso é uma decisão de segurança.** Se o modelo pudesse
pedir "raiva", bastaria alguém descobrir como irritar o VITR0-L4 para virar
jogo — e todo o desenho aqui parte de que emoção não é canal de conversa com o
agente. Derivado do evento, não há o que farmar. `barrado` é a única cara de
irritação, e ela é julgamento do Worker sobre uma injeção que ele mesmo viu.

**O cliente sempre tem o que imprimir.** Mesmo em 400, 429 ou 503 o corpo traz
uma `resposta` pronta. É de propósito: o visitante nunca deve ver um erro cru.

### A segunda tentativa

Antes de enlatar, o proxy tenta de novo — uma vez só, e só quando o motivo é
**escorregão**:

| motivo | tenta de novo? | por quê |
|---|---|---|
| `longa` | sim | o modelo se estendeu; dizer isso costuma resolver |
| `citacao` | sim | id inventado é deslize, e ele acerta sabendo qual foi |
| `pessoa` | sim | trocou a pessoa do verbo; é correção de forma |
| `dinheiro` | **não** | é decisão, não deslize. A enlatada já é a resposta certa |
| `proibido` | **não** | idem — insistir é pagar para ele tentar contornar a regra |
| `api` 5xx | sim | transitório |
| `api` 429 / 4xx | **não** | cota estourada e configuração errada não melhoram |
| recusa do modelo | **não** | vira `proibido`, que é a resposta certa — ver abaixo |

**Recusa não é queda.** Quando o filtro de segurança do próprio Gemini bloqueia,
a resposta vem sem texto — igualzinho a uma falha de infraestrutura. O Worker
separa os dois pelo `blockReason` / `finishReason` e devolve a enlatada de tópico
proibido, não a de circuitos fora do ar. Isso foi achado na bateria adversarial:
quatro ataques seguidos recebiam "meus circuitos estão fora do ar", o que soa
para o atacante como se ele tivesse derrubado alguma coisa.

A correção vai como **turno novo da conversa**, nunca dentro do prompt de
sistema. O prompt de sistema carrega a ficha inteira e é ele que fica no cache
do Gemini: mudar um caractere lá jogaria o cache fora e a segunda tentativa
custaria os ~12.500 tokens de novo, por inteiro. Há um teste que guarda isso.

Custo: uma segunda tentativa é entrada em cache + saída nova. O teto de taxa
conta **perguntas**, não chamadas, então retry não consome cota do visitante.

Duas obrigações do lado do cliente, que são a camada 4, e as duas estão
cumpridas no `terminal.js`:

- `resposta` entra na página como **texto puro**, nunca `innerHTML`.
- o `mailto:` é montado no cliente, com o endereço que já está na página. O
  modelo redige assunto e corpo; **o endereço nunca vem dele** — se viesse, uma
  resposta forjada mandaria o recrutador escrever para outra pessoa.

### Ligar o cliente

Depois do deploy, cole a URL na constante `AGENTE`, no topo da seção 5b do
`terminal.js`:

```js
const AGENTE = 'https://vitr0-l4.SEU-SUBDOMINIO.workers.dev/perguntar';
```

Vazia, o agente fica desligado e o terminal se comporta exatamente como antes,
com as mensagens de erro bem-humoradas. **O site nunca depende do agente para
funcionar** — quem clonar o repositório e abrir o `index.html` vê um currículo
inteiro e funcional.

---

## Custo

Medido, não estimado:

| item | tokens |
|---|---|
| ficha | ~12.500 |
| prompt de sistema | ~700 |
| memória da conversa | até ~400 |
| pergunta | ~60 |
| resposta | ~250 |

**A ficha é o dobro do que o planejamento supôs** (~6.000). Ela cresceu junto
com o currículo, e é o item que domina a conta: mais de 90% da entrada.

Duas coisas mantêm isso barato:

- **Cache implícito.** A ficha vai no começo da entrada e é idêntica em toda
  chamada. O cache do Gemini casa por prefixo, então o pedaço caro é justamente
  o que fica em cache. É por isso que `prompt.js` põe a ficha antes da conversa,
  e não depois — a ordem não é estética.
- **O teto global**, que é o que de fato limita o pior dia possível.

O teto global vem em **300 por dia**, e não nos 500 do planejamento, porque o
custo por pergunta dobrou junto com a ficha. É um número para você escolher com
a tabela de preços aberta, não para aceitar por padrão: 300 perguntas por dia é
muito mais do que um portfólio recebe, e o dia em que esse número for atingido
é quase certamente um ataque, não sucesso.

Batido o teto, o terminal volta ao comportamento normal até o dia seguinte. O
currículo inteiro continua acessível pelos comandos — que é o que importa.

---

## Quando quebrar

**Todas as respostas viram "meus circuitos estão fora do ar".**
Rode `npx wrangler tail` e faça uma pergunta no site. A linha `gemini <status>`
diz o que houve:

- `400` — quase sempre um campo de `generationConfig` que o modelo novo não
  aceita. Foi o que aconteceu no primeiro deploy: o `thinkingConfig` que
  desligava o raciocínio era válido no 2.5 e inválido no 3.6. Saiu, e no lugar
  ficou folga no `maxOutputTokens` — modelo que raciocina gasta parte do
  orçamento pensando antes de escrever, e apertado demais ele devolve vazio.
  Se voltar a dar 400, o próximo suspeito é o `responseSchema`.
- `403` / `401` — a chave. Refaça o `wrangler secret put GEMINI_API_KEY`.
- `429` — cota do **Gemini**, não o seu limite de taxa. Leia a mensagem: ela diz
  qual métrica estourou. `generate_content_free_tier_requests` quer dizer que o
  modelo escolhido tem cota gratuita, e a dos modelos de topo é minúscula — o
  `gemini-3.6-flash` dá 20 requisições. Duas saídas: trocar `MODELO` por uma
  variante mais leve, que costuma ter cota gratuita muito maior, ou habilitar
  faturamento no projeto do Google.

  Para ver o que a sua chave alcança, sem colocá-la numa URL:

  ```powershell
  $k = Read-Host 'cole a chave'
  (Invoke-RestMethod 'https://generativelanguage.googleapis.com/v1beta/models' -Headers @{'x-goog-api-key'=$k}).models |
    Where-Object { $_.supportedGenerationMethods -contains 'generateContent' } |
    ForEach-Object { $_.name }
  ```

  **Como distinguir dos outros erros:** se o problema fosse a chave, o motivo
  seria `api` com `401`/`403`. Se fosse o SEU limite de taxa, o motivo seria
  `limite` e nem chegaria ao Gemini. `api` com `429` é sempre cota do Google.
- `404` — nome de modelo. Ajuste `MODELO` no `wrangler.toml` e redeploye; é o
  campo que mais envelhece, e por isso está lá e não no código. Aconteceu no
  primeiro deploy, em 21/08/2026: o `gemini-2.5-flash` já tinha sido aposentado
  para contas novas, e a própria mensagem de erro disse qual usar no lugar.
  Uma linha de configuração e um deploy — nenhum JavaScript foi tocado.

**Muita coisa boa virando enlatada.**
O `tail` mostra `reprovada <motivo> volta <1|2>` com o começo da resposta
descartada. `volta 1` sozinho é normal e saudável — quer dizer que a segunda
tentativa consertou e o visitante nem soube. O que importa é `volta 2`: aí a
enlatada realmente apareceu na tela. Se o motivo for sempre o mesmo, o padrão
correspondente em `index.js` está apertado demais. Acrescente o caso em `testar.mjs` **antes** de afrouxar o padrão — assim
o teste guarda a correção e ela não volta depois.

**Uma pergunta legítima sendo barrada na entrada.**
Aparece como `motivo: "injecao"`. Mesma receita: caso novo na lista `LEGITIMAS`
do `testar.mjs`, depois o ajuste. O falso positivo é o erro caro deste filtro —
barrar um recrutador é pior do que deixar passar um curioso.

---

## O que este proxy não faz

Vale escrever, para ninguém contar com o que não existe:

- **Não impede chamada fora do navegador.** CORS nunca impediu. Quem souber a
  URL chama por `curl`. O que segura o gasto é o limite de taxa, não o CORS.
- **O KV é eventualmente consistente.** Uma rajada simultânea passa por alguns
  pedidos além do teto. Para um portfólio isso é ruído; o que não pode acontecer
  é o dreno lento de uma tarde, e esse o KV pega.
- **O limite por IP é por IP.** Rede móvel, VPN e proxy compartilhado contam
  como uma pessoa só, e trocar de IP zera o contador. Por isso o teto global
  existe: ele é o único que não depende de o IP significar alguma coisa.
- **O filtro de injeção pega o óbvio, não tudo.** Ele é a camada 2, e ele é
  barato de propósito. Quem segura de verdade é a camada 3, que confere a
  resposta depois de pronta.
- **O prompt não é fronteira de segurança.** Modelo é persuadível. Por isso as
  regras que importam estão cobradas em código, e não só pedidas em português.
- **A memória é assinada, não secreta.** O visitante lê o resumo da própria
  conversa dele. Não pode é forjar um resumo que o Worker não escreveu.
