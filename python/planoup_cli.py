# planoup_cli.py
# Uso:
#   py planoup_cli.py --pdf "arquivo.pdf" --db "sys.db"
# Dependencias:
#   py -m pip install pdfplumber
 
import argparse
import re
import sqlite3
import sys

import pdfplumber

RE_CPF   = re.compile(r"^\d{11}$")
RE_DATE  = re.compile(r"^\d{2}/\d{2}/\d{4}$")
RE_MONEY = re.compile(r"^\d{1,3}(\.\d{3})*,\d{2}$")
RE_NBEN  = re.compile(r"^\d+(\.\d+)*$")


def money_to_float(v: str) -> float:
    return float(v.replace(".", "").replace(",", "."))


def init_db(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS planoup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            n_beneficiario TEXT,
            beneficiario   TEXT,
            matr_func      TEXT,
            cpf            TEXT,
            plano          TEXT,
            tp             TEXT,
            id_rubrica     TEXT,
            dependencia    TEXT,
            data_limite    TEXT,
            dt_inclusao    TEXT,
            rubrica        TEXT,
            valor          REAL,
            valor_total    REAL
        )
        """
    )


def limpar(conn: sqlite3.Connection):
    conn.execute("DELETE FROM planoup")


def linha_util(line: str) -> bool:
    if not line:
        return False

    ignora = (
        "Demonstrativo Analítico",
        "Emissão:",
        "Página:",
        "Contrato",
        "Unidade:",
        "N° Beneficiário",
        "N. Fiscal",
        "Total Contrato",
        "SubTotal",
        "Subtotal",
        "Total Geral",
        "Up Health",
        "http://",
    )
    for i in ignora:
        if line.startswith(i):
            return False

    toks = line.split()
    return any(RE_CPF.match(t) for t in toks) and any(RE_MONEY.match(t) for t in toks)


def pop_last_match(tokens, regex):
    for i in range(len(tokens) - 1, -1, -1):
        if regex.match(tokens[i]):
            return tokens.pop(i)
    return None


def parse_line(line: str):
    tokens = line.split()

    last_money = pop_last_match(tokens, RE_MONEY)
    if not last_money:
        return None

    prev_money = pop_last_match(tokens, RE_MONEY)

    if prev_money is None:
        valor_s = last_money
        valor_total_s = None
    else:
        valor_s = prev_money
        valor_total_s = last_money

    valor = money_to_float(valor_s)

    dt_inclusao = pop_last_match(tokens, RE_DATE)
    if not dt_inclusao:
        return None

    data_limite = pop_last_match(tokens, RE_DATE)

    cpf_idx = next((i for i, t in enumerate(tokens) if RE_CPF.match(t)), None)
    if cpf_idx is None:
        return None
    cpf = tokens[cpf_idx]

    tail = tokens[cpf_idx + 1 :]
    plano = tail[0] if len(tail) >= 1 else None
    tp    = tail[1] if len(tail) >= 2 else None
    id_   = tail[2] if len(tail) >= 3 else None

    dependencia = " ".join(tail[3:]).strip() if len(tail) > 3 else None
    dependencia = dependencia or None

    if valor_total_s:
        valor_total = money_to_float(valor_total_s)
    else:
        valor_total = 0.0 if tp == "D" else None

    left = tokens[:cpf_idx]

    n_benef = None
    n_pos = None
    for i in range(min(3, len(left))):
        if RE_NBEN.match(left[i]):
            n_benef = left[i]
            n_pos = i
            break

    matr_func = None
    if left and left[-1].isdigit():
        matr_func = left[-1]
        nome_tokens = left[(n_pos + 1 if n_pos is not None else 0) : -1]
    else:
        nome_tokens = left[(n_pos + 1 if n_pos is not None else 0) :]

    beneficiario = " ".join(nome_tokens).strip() or None

    rubrica = None
    try:
        cut = line.split(dt_inclusao, 1)[1]
        cut = cut.replace(valor_s, " ")
        if valor_total_s:
            cut = cut.replace(valor_total_s, " ")
        if data_limite:
            cut = cut.replace(data_limite, " ")
        rubrica = re.sub(r"\s+", " ", cut).strip() or None
    except Exception:
        rubrica = None

    if not (cpf and tp and dt_inclusao and valor_s):
        return None

    return (
        n_benef,
        beneficiario,
        matr_func,
        cpf,
        plano,
        tp,
        id_,
        dependencia,
        data_limite,
        dt_inclusao,
        rubrica,
        valor,
        valor_total,
    )


def extrair_registros(pdf_path: str):
    regs = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for raw in (page.extract_text() or "").splitlines():
                line = re.sub(r"\s+", " ", raw.strip())
                if not linha_util(line):
                    continue
                parsed = parse_line(line)
                if parsed:
                    regs.append(parsed)
    return regs


def run(pdf_path: str, db_path: str, truncate: bool = True) -> int:
    try:
        regs = extrair_registros(pdf_path)
        if not regs:
            print("ERRO: layout UpHealth nao reconhecido ou sem linhas validas.", file=sys.stderr)
            return 1

        conn = sqlite3.connect(db_path)
        try:
            init_db(conn)
            if truncate:
                limpar(conn)

            conn.executemany(
                """
                INSERT INTO planoup (
                    n_beneficiario, beneficiario, matr_func, cpf, plano, tp, id_rubrica,
                    dependencia, data_limite, dt_inclusao, rubrica, valor, valor_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                regs,
            )
            conn.commit()
        finally:
            conn.close()

        print(f"OK: {len(regs)} registros importados em planoup")
        return 0

    except Exception as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 2


def main():
    ap = argparse.ArgumentParser(description="Importa PDF UpHealth para SQLite (planoup)")
    ap.add_argument("--pdf", required=True, help="caminho do PDF")
    ap.add_argument("--db", required=True, help="caminho do SQLite (ex: sys.db)")
    ap.add_argument("--no-truncate", action="store_true", help="nao limpar a tabela antes de inserir")

    args = ap.parse_args()
    sys.exit(run(args.pdf, args.db, truncate=(not args.no_truncate)))


if __name__ == "__main__":
    main()
