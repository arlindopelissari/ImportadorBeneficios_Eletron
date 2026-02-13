# planounimed_cli.py
# Uso:
#   py planounimed_cli.py --pdf "arquivo.pdf" --db "sys.db"
# Dependencias:
#   py -m pip install pdfplumber

import argparse
import re
import sqlite3
import sys

import pdfplumber

# padroes
RE_COD   = re.compile(r"^\d{3}\.\d{4}\.\d{8}-\d$")           # exemplo 123.4567.20250101-1
RE_CPF   = re.compile(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$")        # 000.000.000-00
RE_DATE  = re.compile(r"^\d{2}/\d{2}/\d{4}$")                # 31/12/2025
RE_MONEY = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{2}$")        # 1.234,56 (aceita negativo)

TP_SET = {"T", "D"}


def money_to_float(v: str) -> float:
    return float(v.replace(".", "").replace(",", "."))


def criar_tabela(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS planounimed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT,
            beneficiario TEXT,
            tp TEXT,
            id_rubrica TEXT,
            dependencia TEXT,
            plano TEXT,
            data_limite TEXT,
            rubrica TEXT,
            piac REAL,
            cpf TEXT,
            data_inclusao TEXT,
            valor REAL
        )
        """
    )


def limpar_tabela(conn: sqlite3.Connection):
    conn.execute("DELETE FROM planounimed")


def linha_util(line: str) -> bool:
    if not line:
        return False

    ignora_start = (
        "Demonstrativo Analítico",
        "Emissão:",
        "Página:",
        "Contrato",
        "Unidade:",
        "Código",
        "Total",
        "Subtotal",
        "SubTotal",
        "Total Geral",
        "http://",
    )
    for s in ignora_start:
        if line.startswith(s):
            return False

    toks = line.split()
    has_cpf = any(RE_CPF.match(t) for t in toks)
    has_money = any(RE_MONEY.match(t) for t in toks)
    return has_cpf and has_money


def parse_line(line: str):
    toks = line.split()

    # 1) valores
    money_tokens = [t for t in toks if RE_MONEY.match(t)]
    if not money_tokens:
        return None

    valor = money_to_float(money_tokens[-1])
    piac = money_to_float(money_tokens[-2]) if len(money_tokens) >= 2 else 0.0

    # 2) datas
    date_tokens = [t for t in toks if RE_DATE.match(t)]
    if not date_tokens:
        return None

    data_inclusao = date_tokens[-1]
    data_limite = date_tokens[-2] if len(date_tokens) >= 2 else None

    # 3) cpf
    cpf_idx = next((i for i, t in enumerate(toks) if RE_CPF.match(t)), None)
    if cpf_idx is None:
        return None
    cpf = toks[cpf_idx]

    left = toks[:cpf_idx]
    right = toks[cpf_idx + 1 :]

    # 4) codigo
    codigo = left[0] if left else None

    # 5) beneficiario
    beneficiario = None
    if len(left) >= 2:
        left_body = left[1:]
        if left_body and left_body[-1].isdigit():
            nome_tokens = left_body[:-1]
        else:
            nome_tokens = left_body
        beneficiario = " ".join(nome_tokens).strip() or None

    # 6) right sem datas/dinheiros
    right_clean = [t for t in right if (not RE_DATE.match(t)) and (not RE_MONEY.match(t))]

    # 7) tp
    tp_idx = next((i for i, t in enumerate(right_clean) if t in TP_SET), None)
    if tp_idx is None:
        return None

    plano = " ".join(right_clean[:tp_idx]).strip() or None
    tp = right_clean[tp_idx]

    id_rubrica = right_clean[tp_idx + 1] if (tp_idx + 1) < len(right_clean) else None
    rest = right_clean[tp_idx + 2 :] if (tp_idx + 2) <= len(right_clean) else []

    dependencia = None
    if tp == "D" and rest:
        dependencia = rest[0]
        rubrica_tokens = rest[1:]
    else:
        rubrica_tokens = rest

    rubrica = " ".join(rubrica_tokens).strip() or None

    if not (codigo and cpf and data_inclusao and tp and id_rubrica):
        return None

    # codigo pode nao bater RE_COD dependendo do layout; nao bloqueia
    return (
        codigo,
        beneficiario,
        tp,
        id_rubrica,
        dependencia,
        plano,
        data_limite,
        rubrica,
        piac,
        cpf,
        data_inclusao,
        valor,
    )


def extrair_registros(pdf_path: str):
    registros = []
    with pdfplumber.open(pdf_path) as f:
        for page in f.pages:
            text = page.extract_text() or ""
            for raw in text.splitlines():
                line = re.sub(r"\s+", " ", raw.strip())
                if not linha_util(line):
                    continue
                row = parse_line(line)
                if row:
                    registros.append(row)
    return registros


def run(pdf_path: str, db_path: str, truncate: bool = True) -> int:
    try:
        registros = extrair_registros(pdf_path)
        if not registros:
            print("ERRO: layout Unimed nao reconhecido ou sem linhas validas.", file=sys.stderr)
            return 1

        conn = sqlite3.connect(db_path)
        try:
            criar_tabela(conn)
            if truncate:
                limpar_tabela(conn)

            conn.executemany(
                """
                INSERT INTO planounimed (
                    codigo, beneficiario, tp, id_rubrica, dependencia,
                    plano, data_limite, rubrica, piac, cpf, data_inclusao, valor
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                registros,
            )
            conn.commit()
        finally:
            conn.close()

        print(f"OK: {len(registros)} registros importados em planounimed")
        return 0

    except Exception as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 2


def main():
    ap = argparse.ArgumentParser(description="Importa PDF Unimed para SQLite (planounimed)")
    ap.add_argument("--pdf", required=True, help="caminho do PDF")
    ap.add_argument("--db", required=True, help="caminho do SQLite (ex: sys.db)")
    ap.add_argument("--no-truncate", action="store_true", help="nao limpar a tabela antes de inserir")

    args = ap.parse_args()
    sys.exit(run(args.pdf, args.db, truncate=(not args.no_truncate)))


if __name__ == "__main__":
    main()
