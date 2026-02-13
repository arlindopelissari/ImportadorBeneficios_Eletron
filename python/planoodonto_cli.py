# planoodonto_cli.py
# Uso:
#   py planoodonto_cli.py --pdf "arquivo.pdf" --db "sys.db"
# Dependencias:
#   py -m pip install pdfplumber

import argparse
import re
import sqlite3
import sys

import pdfplumber

RE_HEADER = re.compile(r"Nr\.?Odontoprev\s+Chapa\s+Nome\s+Plano\s+Dep\s+Data\s+Valor", re.IGNORECASE)
RE_VALOR  = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{2}$")
RE_DATA   = re.compile(r"^\d{2}/\d{4}$")
RE_TOTAL  = re.compile(r"(Total Geral|Total)\s*:\s*([-\d\.]+,\d{2})", re.IGNORECASE)


def money_to_float(v: str) -> float:
    return float(v.replace(".", "").replace(",", "."))


def criar_tabela(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS planoodonto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nr_odontoprev TEXT,
            chapa TEXT,
            nome TEXT,
            plano TEXT,
            dep TEXT,
            data TEXT,
            valor REAL
        )
        """
    )


def limpar(conn: sqlite3.Connection):
    conn.execute("DELETE FROM planoodonto")


def extrair_total_pdf(texto_completo: str):
    matches = list(RE_TOTAL.finditer(texto_completo))
    if not matches:
        return None

    total_geral = None
    ultimo_total = None
    for m in matches:
        label = (m.group(1) or "").lower()
        val = money_to_float(m.group(2))
        if "geral" in label:
            total_geral = val
        ultimo_total = val

    return total_geral if total_geral is not None else ultimo_total


def parse_linha_dados(line: str):
    tokens = re.sub(r"\s+", " ", line.strip()).split()
    if len(tokens) < 6:
        return None

    # valor (final)
    if not RE_VALOR.match(tokens[-1]):
        return None
    valor = money_to_float(tokens[-1])

    # data (penúltimo)
    if not RE_DATA.match(tokens[-2]):
        return None
    data = tokens[-2]

    # dep (antes da data), se existir
    dep = None
    if len(tokens) >= 3 and tokens[-3].isdigit():
        dep = tokens[-3]
        core = tokens[:-3]
    else:
        core = tokens[:-2]

    if len(core) < 3:
        return None

    nr = core[0]
    chapa = core[1]

    # regra antiga: tenta achar início do plano
    idx_plano = None

    # 1) tenta "Convencional" (se existir)
    if "Convencional" in core:
        idx_plano = core.index("Convencional")
    else:
        # 2) fallback: tenta achar o começo do plano por palavras comuns (ajuste se quiser)
        # Ex: "CORD", "PLUS", "MASTER", etc. (mantive simples)
        for i in range(2, len(core)):
            # se tiver alguma palavra que "parece plano", vira âncora
            if core[i].isupper() and len(core[i]) >= 4:
                # não é perfeito, mas mantém a regra antiga com fallback
                pass

    if idx_plano is not None and idx_plano >= 2:
        nome_tokens = core[2:idx_plano]
        plano_tokens = core[idx_plano:]
    else:
        nome_tokens = core[2:]
        plano_tokens = []

    nome = " ".join(nome_tokens).strip() or None
    plano = " ".join(plano_tokens).strip() or None

    # >>> NOVA REGRA: se nome passar de 39, joga o resto pro plano
    if nome and len(nome) > 39:
        overflow = nome[39:].strip()
        nome = nome[:39].rstrip()

        if overflow:
            if plano:
                plano = f"{overflow} {plano}".strip()
            else:
                plano = overflow

    return (nr, chapa, nome, plano, dep, data, valor)


def extrair_texto(pdf_path: str) -> str:
    texto_paginas = []
    with pdfplumber.open(pdf_path) as pdf:
        for p in pdf.pages:
            texto_paginas.append(p.extract_text() or "")
    return "\n".join(texto_paginas)


def run(pdf_path: str, db_path: str, truncate: bool = True) -> int:
    try:
        texto = extrair_texto(pdf_path)

        if not RE_HEADER.search(texto):
            print("ERRO: layout OdontoPrev nao reconhecido (cabecalho nao bate).", file=sys.stderr)
            return 1

        total_pdf = extrair_total_pdf(texto)
        if total_pdf is None:
            print("ERRO: nao achei 'Total' no PDF.", file=sys.stderr)
            return 1

        registros = []
        for line in texto.splitlines():
            row = parse_linha_dados(line)
            if row:
                registros.append(row)

        if not registros:
            print("ERRO: nenhum registro com valor foi encontrado.", file=sys.stderr)
            return 1

        soma = round(sum(r[-1] for r in registros), 2)
        total_pdf = round(total_pdf, 2)

        if soma != total_pdf:
            print(f"ERRO: soma ({soma:.2f}) diferente do total do PDF ({total_pdf:.2f}).", file=sys.stderr)
            return 1

        conn = sqlite3.connect(db_path)
        try:
            criar_tabela(conn)
            if truncate:
                limpar(conn)

            conn.executemany(
                """
                INSERT INTO planoodonto (nr_odontoprev, chapa, nome, plano, dep, data, valor)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                registros,
            )
            conn.commit()
        finally:
            conn.close()

        print(f"OK: {len(registros)} registros importados em planoodonto")
        return 0

    except Exception as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 2


def main():
    ap = argparse.ArgumentParser(description="Importa PDF OdontoPrev para SQLite (planoodonto)")
    ap.add_argument("--pdf", required=True, help="caminho do PDF")
    ap.add_argument("--db", required=True, help="caminho do SQLite (ex: sys.db)")
    ap.add_argument("--no-truncate", action="store_true", help="nao limpar a tabela antes de inserir")

    args = ap.parse_args()
    sys.exit(run(args.pdf, args.db, truncate=(not args.no_truncate)))


if __name__ == "__main__":
    main()
