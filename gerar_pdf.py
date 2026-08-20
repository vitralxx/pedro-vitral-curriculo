#!/usr/bin/env python3
"""
gerar_pdf.py — gera o PDF do currículo a partir do index.html.

A seta aponta para cá de propósito: o index.html é a fonte da verdade, e este
script LÊ dela. O contrário (um dados.py que gerasse o HTML) rebaixaria o
arquivo que você edita a artefato de build, e criaria uma terceira cópia do
conteúdo para sair de sincronia.

O PDF é montado a partir do #fonte — a instância pré-ordenada das seções — e
portanto não depende de nada que o visitante tenha feito no console.

Uso:
    python gerar_pdf.py                  # ordem natural do HTML
    python gerar_pdf.py --alvo=ml        # reordena os projetos
    python gerar_pdf.py --saida=out.pdf

Requer: pip install reportlab
"""

import argparse
import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table,
    TableStyle,
)

# ---------------------------------------------------------------------------
# Ajustes
# ---------------------------------------------------------------------------
SITE = "https://vitralxx.github.io/pedro-vitral-curriculo/"

TINTA  = HexColor("#14181A")   # texto principal
SUAVE  = HexColor("#5A646A")   # metadados, datas, tecnologias
ACENTO = HexColor("#0D6B45")   # títulos de seção e links

# Quais projetos entram no PDF, nesta ordem. O site mostra todos; o papel é
# caro e currículo de estágio cabe em uma ou duas páginas. Projeto sem conteúdo
# escrito é ignorado, então dá para listar aqui antes de terminar de preencher.
#
# As competências acompanham esta lista: um "usado em" que apontasse para um
# projeto ausente deixaria o leitor com um nome sem lugar nenhum no documento.
PROJETOS_PDF = ["agenda-viert"]

# Ordem dos projetos por alvo. Ausente = a ordem de PROJETOS_PDF.
ORDEM_ALVO = {
    "ml":       ["cubagem-stone", "agenda-viert", "denaro-bot", "khalkaria-rpg"],
    "dev":      ["denaro-bot", "agenda-viert", "cubagem-stone", "khalkaria-rpg"],
    "pesquisa": ["cubagem-stone", "khalkaria-rpg", "agenda-viert", "denaro-bot"],
}

# Proporção das duas colunas principais e a calha entre elas.
COL_ESQ, CALHA = 0.33, 6 * mm

VAZIAS = {"br", "meta", "link", "input", "img", "hr", "source"}


# ===========================================================================
# 1. Mini-DOM
# ===========================================================================
class No:
    __slots__ = ("tag", "attrs", "filhos", "pai")

    def __init__(self, tag, attrs=None, pai=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.filhos = []
        self.pai = pai

    @property
    def classes(self):
        return self.attrs.get("class", "").split()

    def tem(self, classe):
        return classe in self.classes

    def elementos(self):
        return [f for f in self.filhos if isinstance(f, No)]

    def texto(self):
        partes = (f if isinstance(f, str) else f.texto() for f in self.filhos)
        return "".join(partes)

    def todos(self, tag=None, classe=None, ident=None):
        achados = []
        for f in self.elementos():
            if ((tag is None or f.tag == tag)
                    and (classe is None or f.tem(classe))
                    and (ident is None or f.attrs.get("id") == ident)):
                achados.append(f)
            achados.extend(f.todos(tag, classe, ident))
        return achados

    def um(self, tag=None, classe=None, ident=None):
        r = self.todos(tag, classe, ident)
        return r[0] if r else None

    def diretos(self, tag=None, classe=None):
        return [f for f in self.elementos()
                if (tag is None or f.tag == tag)
                and (classe is None or f.tem(classe))]


class Leitor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.raiz = No("#raiz")
        self.atual = self.raiz

    def handle_starttag(self, tag, attrs):
        no = No(tag, attrs, self.atual)
        self.atual.filhos.append(no)
        if tag not in VAZIAS:
            self.atual = no

    def handle_startendtag(self, tag, attrs):
        self.atual.filhos.append(No(tag, attrs, self.atual))

    def handle_endtag(self, tag):
        # Sobe até encontrar a tag aberta correspondente. Tolera HTML frouxo.
        no = self.atual
        while no is not self.raiz and no.tag != tag:
            no = no.pai
        if no is not self.raiz:
            self.atual = no.pai

    def handle_data(self, dado):
        self.atual.filhos.append(dado)


def ler_html(caminho):
    leitor = Leitor()
    leitor.feed(Path(caminho).read_text(encoding="utf-8"))
    return leitor.raiz


# ===========================================================================
# 2. Conversão para a mini-marcação do ReportLab
# ===========================================================================
def limpar(s):
    return re.sub(r"\s+", " ", s).strip()


def vazio(txt):
    """Placeholder ainda não preenchido — não deve aparecer no PDF.

    Sem o colchete de fechamento: um "[PREENCHER: dd/mm/aaaa]" também é
    placeholder, e a checagem pelo texto exato deixava esses passarem."""
    return not txt or "[PREENCHER" in txt


def inline(no, _raiz=True):
    """Conteúdo inline em <b>/<i>/<link>, que é o que o Paragraph entende.

    Mesmo motivo do texto_puro: limpar() em cada nível comia o espaço entre o
    texto e o <span> seguinte."""
    saida = []
    for f in no.filhos:
        if isinstance(f, str):
            saida.append(html.escape(f, quote=False))
            continue
        if f.tem("cmd"):
            continue                      # dica de comando não existe em papel
        if f.tag in ("strong", "b"):
            saida.append(f"<b>{inline(f, False)}</b>")
        elif f.tag in ("em", "i"):
            saida.append(f"<i>{inline(f, False)}</i>")
        elif f.tag == "a":
            href = f.attrs.get("href", "")
            saida.append(f'<link href="{html.escape(href)}" color="#{ACENTO.hexval()[2:]}">'
                         f"{inline(f, False)}</link>")
        elif f.tag == "br":
            saida.append("<br/>")
        elif f.tem("periodo") or f.tem("usado-em"):
            saida.append(f'<font color="#{SUAVE.hexval()[2:]}">{inline(f, False)}</font>')
        else:
            saida.append(inline(f, False))
    bruto = "".join(saida)
    return limpar(bruto) if _raiz else bruto


def texto_puro_de(marcado):
    """Texto sem a mini-marcação, só para testar placeholder."""
    return re.sub(r"<[^>]+>", "", marcado)


def texto_puro(no, _raiz=True):
    """Texto sem marcação.

    _raiz existe porque limpar() faz strip: aplicá-lo em cada nó aninhado
    comia o espaço que separava o texto do <span> seguinte, e
    "Data de nascimento <span>17/09/2006</span>" virava um amontoado.
    Junta cru, limpa uma vez só no fim."""
    partes = [f if isinstance(f, str)
              else ("" if f.tem("cmd") else texto_puro(f, False))
              for f in no.filhos]
    bruto = "".join(partes)
    return limpar(bruto) if _raiz else bruto


# ===========================================================================
# 3. Estilos
# ===========================================================================
def estilos():
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.1,
                          leading=12.4, textColor=TINTA)
    # A coluna lateral é estreita: corpo menor evita rio de espaço no
    # justificado e ganha as linhas que faltam para caber numa página.
    lateral = ParagraphStyle("lateral", parent=base, fontSize=8.4, leading=11.2)
    return {
        "nome": ParagraphStyle("nome", parent=base, fontName="Helvetica-Bold",
                               fontSize=21, leading=23, spaceAfter=2.5),
        "contato": ParagraphStyle("contato", parent=base, fontSize=8.6,
                                  leading=11.5, textColor=SUAVE),
        "headline": ParagraphStyle("headline", parent=base, fontSize=9.8,
                                   leading=13.2, spaceBefore=3),
        "secao": ParagraphStyle("secao", parent=base, fontName="Helvetica-Bold",
                                fontSize=8.3, leading=9.6, textColor=ACENTO,
                                spaceAfter=1.5),
        "corpo": ParagraphStyle("corpo", parent=base, alignment=TA_JUSTIFY,
                                spaceAfter=3),
        "item": ParagraphStyle("item", parent=base, leftIndent=9,
                               bulletIndent=0, spaceAfter=2),
        "projeto": ParagraphStyle("projeto", parent=base,
                                  fontName="Helvetica-Bold", fontSize=10.4,
                                  leading=12.8, spaceAfter=1.5),
        "tec": ParagraphStyle("tec", parent=base, fontSize=8.1, leading=10.4,
                              textColor=SUAVE, spaceBefore=1.5),
        # --- coluna lateral ---
        "lat": lateral,
        "lat_forte": ParagraphStyle("lat_forte", parent=lateral,
                                    fontName="Helvetica-Bold", spaceBefore=3),
        "lat_meta": ParagraphStyle("lat_meta", parent=lateral, fontSize=7.9,
                                   textColor=SUAVE, spaceAfter=3.5),
        "rodape": ParagraphStyle("rodape", parent=base, fontSize=7.8,
                                 textColor=SUAVE),
    }


def titulo(texto, st, primeiro=False):
    """Título de seção com o fio fino embaixo. Devolve lista de flowables —
    KeepTogether dentro de célula de tabela dá problema de medição."""
    return ([] if primeiro else [Spacer(1, 8)]) + [
        Paragraph(texto.upper(), st["secao"]),
        HRFlowable(width="100%", thickness=0.6, color=ACENTO,
                   spaceBefore=1, spaceAfter=4),
    ]


# ===========================================================================
# 4. Extração + montagem
# ===========================================================================
def itens_de(lista):
    """<li> diretos de uma <ul>, ignorando os das sublistas."""
    return lista.diretos("li") if lista else []


def texto_do_li(li):
    """Texto do <li> sem o conteúdo das sublistas aninhadas."""
    partes = []
    for f in li.filhos:
        if isinstance(f, str):
            partes.append(html.escape(f, quote=False))
        elif f.tag == "ul" or f.tem("cmd"):
            continue
        else:
            partes.append(inline(f))
    return limpar(" ".join(p for p in partes if p))


def sem_filhos(li, excluir=()):
    """Texto do <li> descartando sublistas e os nós indicados."""
    partes = []
    for f in li.filhos:
        if isinstance(f, str):
            partes.append(html.escape(f, quote=False))
        elif f in excluir or f.tag == "ul" or f.tem("cmd"):
            continue
        else:
            partes.append(inline(f))
    return limpar(" ".join(p for p in partes if p))


def rotulo_e_usos(li):
    """Separa 'Python' de 'cubagem-stone, [PREENCHER]'.

    O placeholder sai da anotação sem derrubar o item: 'Python' é uma
    competência válida mesmo que a lista de onde foi usada esteja incompleta.
    Tratar os dois como uma coisa só apagava grupos inteiros do PDF.
    """
    span = li.um(classe="usado-em")
    usos = []
    if span:
        usos = [u.strip() for u in texto_puro(span).split(",")]
        usos = [u for u in usos if u and not vazio(u)]
    return sem_filhos(li, excluir=(span,) if span else ()), usos


def cinza(txt):
    return f'<font color="#{SUAVE.hexval()[2:]}">{txt}</font>'


def montar(raiz, alvo, st, largura):
    fonte = raiz.um(ident="fonte")
    topo = raiz.um(classe="topo")
    if fonte is None or topo is None:
        sys.exit("index.html sem #fonte ou .topo — o layout mudou?")

    # ======================= faixa superior, largura inteira ===============
    fluxo = [Paragraph(texto_puro(topo.um("h1")), st["nome"])]

    contato = fonte.um(ident="contato")
    if contato:
        # Todos os itens, não só os <a>: a data de nascimento é texto puro e
        # ficava de fora quando a linha só recolhia link.
        partes = [inline(li) for li in itens_de(contato.um("ul"))]
        # Data de nascimento e localização vivem no #perfil, não no #contato.
        # Em papel, dado pessoal pertence à linha de contato: sem isto eles
        # simplesmente não chegavam ao PDF.
        perfil_dados = fonte.um(ident="perfil")
        if perfil_dados:
            partes += [inline(li) for li in perfil_dados.todos("li")
                       if li.um(classe="periodo") and not li.um("ul")]
        partes = [x for x in partes if x and not vazio(texto_puro_de(x))]
        fluxo.append(Paragraph("  ·  ".join(partes), st["contato"]))

    headline = topo.um(classe="headline")
    if headline:
        fluxo.append(Paragraph(inline(headline), st["headline"]))
    fluxo.append(Spacer(1, 6))

    # ======================= projetos (antes de tudo) ======================
    # Montados primeiro de propósito: é daqui que sai a lista do que de fato
    # entrou no papel, e a coluna lateral precisa dela para não citar projeto
    # que o leitor não tem como consultar.
    porta = {}
    projetos = fonte.um(ident="projetos")
    if projetos:
        for art in projetos.todos("article"):
            porta[(art.attrs.get("id") or "").replace("projeto-", "")] = art

    todos_projetos = set(porta)          # o que conta como nome de projeto
    no_pdf = set()                       # o que chegou a ser impresso
    blocos = []

    ordem = ORDEM_ALVO.get(alvo) or PROJETOS_PDF
    escolhidos = [n for n in ordem if n in porta][:len(PROJETOS_PDF)]

    for nome in escolhidos:
        art = porta[nome]
        corpo = []
        for classe in ("problema", "solucao", "porque"):
            q = art.um(classe=classe)
            if q is None or vazio(texto_puro(q)):
                continue
            corpo.append(Paragraph(inline(q), st["corpo"]))
        # Projeto sem uma linha sequer de conteúdo não entra — nem o nome,
        # nem a lista de tecnologias. Antes a lista de tecnologias sozinha
        # bastava para o projeto vazar para o papel.
        if not corpo:
            continue

        no_pdf.add(nome)
        blocos.append(Paragraph(texto_puro(art.um("h4")), st["projeto"]))
        blocos += corpo
        tec = art.um("ul", classe="tec")
        if tec:
            nomes = [texto_puro(li) for li in itens_de(tec)]
            nomes = [n for n in nomes if not vazio(n)]
            if nomes:
                blocos.append(Paragraph("  ·  ".join(nomes), st["tec"]))
        blocos.append(Spacer(1, 6))

    # ======================= coluna lateral ================================
    esq = []

    formacao = fonte.um(ident="formacao")
    if formacao:
        esq += titulo("Formação", st, primeiro=True)
        # Percorre TODOS os .corpo: o HTML separa "Ensino superior" de
        # "Educação básica" em dois blocos, e pegar só o primeiro <ul>
        # descartava metade da formação, intercâmbio incluído.
        for corpo in formacao.diretos("div"):
            rotulo = corpo.um("h4")
            if rotulo:
                esq.append(Paragraph(texto_puro(rotulo), st["lat_forte"]))
            lista = corpo.um("ul")
            if not lista:
                continue
            for li in itens_de(lista):
                periodo = li.um(classe="periodo")
                esq.append(Paragraph(sem_filhos(li, (periodo,) if periodo else ()),
                                     st["lat"]))
                if periodo:
                    esq.append(Paragraph(texto_puro(periodo), st["lat_meta"]))

    stack = fonte.um(ident="stack")
    if stack:
        grupos = []
        for grupo in itens_de(stack.um("ul")):
            itens = []
            for sub in itens_de(grupo.um("ul")):
                rotulo, usos = rotulo_e_usos(sub)
                if vazio(rotulo):
                    continue
                # Só cita projeto que está no documento. O que não é nome de
                # projeto ("jogos em Unity", "este currículo") passa direto.
                usos = [u for u in usos
                        if u not in todos_projetos or u in no_pdf]
                itens.append(rotulo + (f" {cinza('(' + ', '.join(usos) + ')')}"
                                       if usos else ""))
            if itens:
                grupos.append((texto_do_li(grupo), itens))
        if grupos:
            esq += titulo("Conhecimentos", st)
            for nome, itens in grupos:
                esq.append(Paragraph(nome, st["lat_forte"]))
                esq.append(Paragraph(" · ".join(itens), st["lat_meta"]))

    interesses = fonte.um(ident="interesses")
    if interesses:
        linhas = [texto_do_li(li) for li in itens_de(interesses.um("ul"))]
        linhas = [l for l in linhas if not vazio(l)]
        if linhas:
            esq += titulo("Interesses", st)
            for l in linhas:
                esq.append(Paragraph(l, st["lat"]))

    idiomas = fonte.um(ident="idiomas")
    if idiomas:
        linhas = [texto_do_li(li) for li in itens_de(idiomas.um("ul"))]
        linhas = [l for l in linhas if not vazio(l)]
        if linhas:
            esq += titulo("Idiomas", st)
            for l in linhas:
                esq.append(Paragraph(l, st["lat"]))

    # ======================= coluna principal ==============================
    dir_ = []

    # Perfil e Atuação fundidos numa seção só.
    perfil = fonte.um(ident="perfil")
    paragrafos = perfil.todos("p") if perfil else []
    arvores = topo.diretos("ul")
    balas = []
    if arvores:
        grupos_topo = itens_de(arvores[0])
        if grupos_topo:
            balas = itens_de(grupos_topo[0].um("ul"))

    if paragrafos or balas:
        dir_ += titulo("Perfil", st, primeiro=True)
        for i, q in enumerate(paragrafos):
            txt = inline(q)
            # A frase do HTML termina em ":" para apresentar a lista que vinha
            # logo abaixo dela — lista que não entra no PDF. Sem isso, o
            # parágrafo fica com dois-pontos apontando para o nada.
            if i == len(paragrafos) - 1 and balas and txt.endswith(":"):
                txt = txt[:-1] + "."
            dir_.append(Paragraph(txt, st["corpo"]))
        for li in balas:
            dir_.append(Paragraph(texto_do_li(li), st["item"], bulletText="•"))

    if blocos:
        dir_ += titulo("Projetos", st)
        dir_ += blocos

    # ======================= junta as duas colunas =========================
    larg_esq = largura * COL_ESQ
    # splitInRow: a tabela de duas colunas é UMA linha só, e linha de tabela não
    # quebra entre páginas por padrão. Com isto a própria linha se parte, a
    # lateral termina na página 1 e a coluna principal continua na 2.
    colunas = Table([[esq, dir_]], colWidths=[larg_esq, largura - larg_esq],
                    splitByRow=1, splitInRow=1)
    colunas.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (0, 0), 0),
        ("RIGHTPADDING",  (0, 0), (0, 0), CALHA / 2),
        ("LEFTPADDING",   (1, 0), (1, 0), CALHA / 2),
        ("RIGHTPADDING",  (1, 0), (1, 0), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        # fio no meio da calha: dá estrutura sem pesar tinta
        ("LINEAFTER",     (0, 0), (0, 0), 0.4, HexColor("#D9DEDC")),
    ]))
    fluxo.append(colunas)

    # ======================= rodapé ========================================
    fluxo.append(Spacer(1, 10))
    fluxo.append(HRFlowable(width="100%", thickness=0.4, color=SUAVE,
                            spaceAfter=3))
    fluxo.append(Paragraph(
        f'Versão interativa: <link href="{SITE}" color="#{ACENTO.hexval()[2:]}">'
        f"{SITE}</link>", st["rodape"]))
    return fluxo


def main():
    ap = argparse.ArgumentParser(description="Gera o PDF a partir do index.html")
    ap.add_argument("--entrada", default="index.html")
    ap.add_argument("--saida", default="curriculo-pedro.pdf")
    ap.add_argument("--alvo", choices=sorted(ORDEM_ALVO), default=None,
                    help="reordena os projetos para a vaga")
    args = ap.parse_args()

    raiz = ler_html(args.entrada)
    st = estilos()

    margem_lat, margem_top = 17 * mm, 14 * mm
    largura = A4[0] - 2 * margem_lat

    doc = SimpleDocTemplate(
        args.saida, pagesize=A4,
        leftMargin=margem_lat, rightMargin=margem_lat,
        topMargin=margem_top, bottomMargin=margem_top,
        title="Currículo — Pedro Vitral", author="Pedro Carvalho Lamarca Vitral",
        subject="Currículo", creator="gerar_pdf.py",
    )
    try:
        doc.build(montar(raiz, args.alvo, st, largura))
    except Exception as e:
        sys.exit(f"Falha ao montar o PDF: {e}\n"
                 f"Reduza PROJETOS_PDF (hoje {PROJETOS_PDF}) ou encurte os textos.")

    print(f"{args.saida} gerado a partir de {args.entrada}"
          + (f" (alvo: {args.alvo})" if args.alvo else ""))


if __name__ == "__main__":
    main()
