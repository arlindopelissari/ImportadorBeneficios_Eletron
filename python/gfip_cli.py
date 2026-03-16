import argparse
import os
import re
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_PACKAGES = os.path.join(os.path.dirname(BASE_DIR), 'python-runtime', 'site-packages')

if os.path.isdir(SITE_PACKAGES) and SITE_PACKAGES not in sys.path:
    sys.path.insert(0, SITE_PACKAGES)

import pdfplumber

RE_PIS = re.compile(r"(?P<pis>\d{3}\.\d{5}\.\d{2}-\d)\s+(?P<admissao>\d{2}/\d{2}/\d{4})")
RE_MONEY = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
ALLOWED_TABLES = {"gfip", "gfip_atual", "gfip_anterior"}

SKIP_PREFIXES = (
    "MINISTÉRIO",
    "GFIP - SEFIP",
    "PÁG",
    "PAG",
    "RELAÇÃO DOS TRABALHADORES",
    "RECOLHIMENTO AO FGTS",
    "EMPRESA:",
    "COMP:",
    "TOMADOR/OBRA:",
    "NOME TRABALHADOR",
    "REM SEM 13",
    "BASE CÁL PREV SOCIAL",
)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def normalize_numeric_line(line: str) -> str:
    text = normalize_space(line).upper().replace("O", "0")
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"(\d),\s*(\d)", r"\1,\2", text)
        text = re.sub(r"(\d,\d)\s+(\d)\b", r"\1\2", text)
    return normalize_space(text)


def should_skip_line(line: str) -> bool:
    if not line:
        return True

    upper = line.upper()
    if upper.startswith(SKIP_PREFIXES):
        return True

    if "NOME TRABALHADOR" in upper or "PIS/PASEP/CI" in upper:
        return True

    if upper.startswith("858") and len(re.sub(r"\D", "", upper)) >= 20:
        return True

    return False


def is_name_only_candidate(line: str) -> bool:
    if not line or should_skip_line(line):
        return False
    if RE_PIS.search(line):
        return False
    if RE_MONEY.search(normalize_numeric_line(line)):
        return False
    if re.search(r"\d", line):
        return False
    words = normalize_space(line).split()
    return len(words) >= 2


def parse_header_line(line: str):
    match = RE_PIS.search(line)
    if not match:
        return None

    name = normalize_space(line[: match.start()])
    return {
        "nome": name,
        "pis_pasep_ci": match.group("pis"),
        "admissao": match.group("admissao"),
    }


def extract_money_values(line: str):
    return RE_MONEY.findall(normalize_numeric_line(line))


def resolve_table_name(table_name: str) -> str:
    value = (table_name or "gfip_atual").strip().lower()
    if value not in ALLOWED_TABLES:
        raise ValueError(f"Tabela GFIP nao suportada: {table_name}")
    return value


def create_table(conn: sqlite3.Connection, table_name: str):
    index_name = f"idx_{table_name}_pis"
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS "{table_name}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ordem INTEGER NOT NULL,
            nome_trabalhador TEXT NOT NULL,
            pis_pasep_ci TEXT NOT NULL,
            admissao TEXT NOT NULL,
            rem_sem_13_sal TEXT NOT NULL DEFAULT '',
            rem_13_sal TEXT NOT NULL DEFAULT '',
            base_cal_13_sal_prev_social TEXT NOT NULL DEFAULT '',
            contrib_seg_devida TEXT NOT NULL DEFAULT '',
            deposito TEXT NOT NULL DEFAULT '',
            jam TEXT NOT NULL DEFAULT '',
            pdf_origem TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS "{index_name}"
        ON "{table_name}"(pis_pasep_ci)
        """
    )


def clear_table(conn: sqlite3.Connection, table_name: str):
    conn.execute(f'DELETE FROM "{table_name}"')


def parse_lines(lines, pdf_name: str):
    records = []
    warnings = []
    current_name = ""
    carry_name = ""
    pending = None

    for raw in lines:
        line = normalize_space(raw)
        if should_skip_line(line):
            continue

        header = parse_header_line(line)
        if header:
            if pending is not None:
                warnings.append(f"Linha de valores ausente para: {pending['pis_pasep_ci']}")

            nome = header["nome"] or carry_name or current_name
            if not nome:
                warnings.append(f"Linha sem nome associavel ignorada: {line}")
                pending = None
                continue

            if header["nome"]:
                current_name = header["nome"]
                carry_name = ""

            pending = {
                "nome_trabalhador": nome,
                "pis_pasep_ci": header["pis_pasep_ci"],
                "admissao": header["admissao"],
            }
            continue

        money_values = extract_money_values(line)
        if money_values and pending:
            if len(money_values) < 4:
                warnings.append(f"Linha numerica incompleta para: {pending['pis_pasep_ci']}")
                pending = None
                continue

            records.append(
                (
                    len(records) + 1,
                    pending["nome_trabalhador"],
                    pending["pis_pasep_ci"],
                    pending["admissao"],
                    money_values[0] if len(money_values) > 0 else "",
                    money_values[1] if len(money_values) > 1 else "",
                    money_values[2] if len(money_values) > 2 else "",
                    money_values[3] if len(money_values) > 3 else "",
                    money_values[4] if len(money_values) > 4 else "",
                    money_values[5] if len(money_values) > 5 else "",
                    pdf_name,
                )
            )
            pending = None
            carry_name = ""
            continue

        if is_name_only_candidate(line):
            carry_name = line
            current_name = line

    if pending is not None:
        warnings.append(f"Registro final sem linha de valores: {pending['pis_pasep_ci']}")

    return records, warnings


def extract_lines_from_pdf(pdf_path: str):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.splitlines())
    return lines


def extract_lines_from_text(text_path: str):
    with open(text_path, "r", encoding="utf-8") as fh:
        return fh.read().splitlines()


def run(
    db_path: str,
    pdf_path: str = "",
    text_path: str = "",
    truncate: bool = True,
    table_name: str = "gfip_atual",
) -> int:
    try:
        resolved_table = resolve_table_name(table_name)
        source_name = os.path.basename(pdf_path or text_path or "")
        lines = extract_lines_from_text(text_path) if text_path else extract_lines_from_pdf(pdf_path)
        records, warnings = parse_lines(lines, source_name)

        if not records:
            print("ERRO: layout GFIP nao reconhecido ou sem linhas validas.", file=sys.stderr)
            return 1

        conn = sqlite3.connect(db_path)
        try:
            create_table(conn, resolved_table)
            if truncate:
                clear_table(conn, resolved_table)

            conn.executemany(
                f"""
                INSERT INTO "{resolved_table}" (
                    ordem,
                    nome_trabalhador,
                    pis_pasep_ci,
                    admissao,
                    rem_sem_13_sal,
                    rem_13_sal,
                    base_cal_13_sal_prev_social,
                    contrib_seg_devida,
                    deposito,
                    jam,
                    pdf_origem
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                records,
            )
            conn.commit()
        finally:
            conn.close()

        for item in warnings:
            print(f"AVISO: {item}")

        print(f"OK: {len(records)} registros importados em {resolved_table}")
        return 0
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(description="Importa GFIP em PDF para SQLite (gfip)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--pdf", help="caminho do PDF")
    group.add_argument("--text-file", help="arquivo de texto com linhas extraidas da GFIP")
    parser.add_argument("--db", required=True, help="caminho do SQLite (ex: sys.db)")
    parser.add_argument("--table", default="gfip_atual", help="tabela de destino (gfip_atual/gfip_anterior)")
    parser.add_argument("--no-truncate", action="store_true", help="nao limpar a tabela antes de inserir")
    args = parser.parse_args()

    sys.exit(
        run(
            db_path=args.db,
            pdf_path=args.pdf or "",
            text_path=args.text_file or "",
            truncate=(not args.no_truncate),
            table_name=args.table,
        )
    )


if __name__ == "__main__":
    main()
