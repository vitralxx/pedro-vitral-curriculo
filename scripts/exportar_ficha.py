# -*- coding: utf-8 -*-
"""
exportar_ficha.py — gera o que o Worker precisa saber

Por que existe um passo de exportação, e não simplesmente copiar o arquivo:

  planejamento/fatos.json está no .gitignore e é papel de trabalho. Ele carrega
  campos que existem para o Pedro e para mim, e que não podem chegar num
  endpoint público:

    nota      avaliação interna. Diz coisas como "não citar o exame Cambridge
              porque o formato descrito é Young Learners e não sustenta a
              alegação". É análise honesta e é exatamente o tipo de texto que
              não pode aparecer numa resposta do agente nem num vazamento de
              prompt.

    pendente  fato que ainda não é palavra do Pedro. O prompt manda o agente
              ignorar, mas prompt é camada 1. Se o fato não sai daqui, não tem
              como o agente citá-lo, nem por acidente nem por ataque.

    regras    o briefing do agente, escrito pelo Pedro. Vira prompt de sistema,
              não vira dado consultável.

  Tudo isso fica de fora do que sobe. O que o Worker recebe é a ficha, e só.

Gera dois arquivos:

    worker/ficha.json     os fatos do Pedro, sem os campos internos
    worker/comandos.json  os comandos do terminal, para o agente saber guiar

O segundo existe para que acrescentar um comando continue sendo trivial. O
VITR0-L4 também orienta quem chegou, então ele precisa conhecer os comandos — e
se essa lista fosse copiada à mão para dentro do prompt, viraria uma segunda
cópia da mesma verdade. Duas cópias derivam, e quando derivam o agente passa a
mentir sobre o próprio site: manda digitar um comando que não existe, ou nunca
menciona um que existe.

A fonte é o bloco #ajuda do index.html — o mesmo que o visitante lê quando digita
"help", escrito com as palavras do Pedro. Acrescentar um comando continua sendo:
uma linha no COMANDOS do terminal.js (para executar), uma linha no #ajuda (para
o help mostrar, que você faria de qualquer jeito), e rodar este script.

Uso:
    python exportar_ficha.py

Rodar sempre que fatos.json, o #ajuda ou os comandos mudarem; o Worker precisa
de um novo deploy para enxergar a mudança.
"""

import io
import json
import os
import sys

ORIGEM = os.path.join("planejamento", "fatos.json")
DESTINO = os.path.join("worker", "ficha.json")
PAGINA = "index.html"
DESTINO_COMANDOS = os.path.join("worker", "comandos.json")

# Campos que atravessam. Lista fechada de propósito: campo novo em fatos.json
# não vaza por descuido, tem que ser adicionado aqui conscientemente.
CAMPOS = ("id", "categoria", "titulo", "texto", "origem", "relacionado")

# Procedências que podem sair daqui. 'pendente' não está e não deve estar.
SOBEM = ("literal", "derivado")


def extrair_comandos():
    """Lê os comandos do bloco #ajuda do index.html."""
    import re

    with io.open(PAGINA, encoding="utf-8") as f:
        pagina = f.read()

    inicio = pagina.find('id="ajuda"')
    if inicio < 0:
        sys.exit("não achei o bloco #ajuda no %s" % PAGINA)
    fim = pagina.find("</details>", inicio)
    bloco = pagina[inicio:fim]

    linhas = re.findall(
        r'<code class="cmd">(.*?)</code>\s*—\s*([^<]+)',
        bloco,
    )
    comandos = []
    for cmd, faz in linhas:
        if not cmd:
            continue
        cmd = cmd.replace("&lt;", "<").replace("&gt;", ">").strip()
        comandos.append({"cmd": cmd, "faz": faz.strip()})

    if len(comandos) < 5:
        sys.exit("li só %d comandos do #ajuda — o formato mudou?" % len(comandos))

    # help não está no #ajuda, e faz sentido: quem está lendo o help já o achou.
    # O agente, que não está lendo nada, precisa saber que ele existe.
    if not any(c["cmd"] == "help" for c in comandos):
        comandos.append({"cmd": "help", "faz": "a lista de comandos"})

    return comandos


def enxugar(fato):
    """Devolve o fato só com o que o agente precisa."""
    limpo = {}
    for campo in CAMPOS:
        valor = fato.get(campo)
        # relacionado vazio é a maioria dos fatos. Ocupa token e não informa.
        if campo == "relacionado" and not valor:
            continue
        if valor is None:
            continue
        limpo[campo] = valor
    return limpo


def main():
    if not os.path.exists(ORIGEM):
        sys.exit("não achei %s — rode a partir da raiz do projeto" % ORIGEM)

    with io.open(ORIGEM, encoding="utf-8") as f:
        base = json.load(f)

    fatos = base.get("fatos", [])
    saida, cortados = [], []

    for fato in fatos:
        if fato.get("origem") not in SOBEM:
            cortados.append(fato.get("id", "?"))
            continue
        saida.append(enxugar(fato))

    # Id repetido quebra a validação de citação do Worker de um jeito silencioso:
    # o id existe, então passa, mas o agente pode estar sustentando a afirmação
    # no fato errado. Melhor falhar aqui, alto, do que servir isso.
    vistos = set()
    for fato in saida:
        if fato["id"] in vistos:
            sys.exit("id repetido na ficha: %s" % fato["id"])
        vistos.add(fato["id"])

    ficha = {
        "versao": base.get("versao", ""),
        "aviso": (
            "Ficha do Pedro. Fatos com origem 'literal' podem ser citados como "
            "afirmação sobre ele. Fatos com origem 'derivado' orientam, mas não "
            "viram afirmação."
        ),
        "fatos": saida,
    }

    pasta = os.path.dirname(DESTINO)
    if pasta and not os.path.isdir(pasta):
        os.makedirs(pasta)

    texto = json.dumps(ficha, ensure_ascii=False, indent=1)
    with io.open(DESTINO, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto + "\n")

    literais = sum(1 for x in saida if x["origem"] == "literal")
    print("%s: %d fatos (%d literais, %d derivados)"
          % (DESTINO, len(saida), literais, len(saida) - literais))
    print("cortados: %s" % (", ".join(cortados) if cortados else "nenhum"))
    print("%d caracteres, ~%d tokens de entrada por pergunta"
          % (len(texto), len(texto) // 3))

    # Nenhum resto de avaliação interna pode ter atravessado.
    for proibido in ("nota", "pendente"):
        if ('"%s"' % proibido) in texto:
            sys.exit("ERRO: '%s' apareceu no arquivo exportado" % proibido)

    comandos = extrair_comandos()
    with io.open(DESTINO_COMANDOS, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(comandos, ensure_ascii=False, indent=1) + "\n")
    print("%s: %d comandos (%s)"
          % (DESTINO_COMANDOS, len(comandos),
             ", ".join(c["cmd"] for c in comandos)))


if __name__ == "__main__":
    main()
