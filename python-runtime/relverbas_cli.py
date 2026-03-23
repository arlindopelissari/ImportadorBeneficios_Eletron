import argparse
import csv
import gc
import os
import re
import sqlite3
import sys
import unicodedata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_PACKAGES = os.path.join(os.path.dirname(BASE_DIR), 'python-runtime', 'site-packages')

if os.path.isdir(SITE_PACKAGES) and SITE_PACKAGES not in sys.path:
    sys.path.insert(0, SITE_PACKAGES)

import pdfplumber
from pdfminer.pdfpage import PDFPage
from pdfminer.pdftypes import resolve1
from pdfplumber.page import Page as PdfPlumberPage

TABLE_NAME = 'relverbas'
EXPECTED_COLUMNS = 11
IGNORED_SAMPLE_LIMIT = 100
PDF_PROGRESS_EVERY = 25
PDF_REOPEN_CHUNK_PAGES = 200
TEXT_PAGE_NUMBER = 0
LINE_TOLERANCE = 3.0
DB_COMMIT_EVERY_PAGES = 25
WORD_EXTRACTION_SETTINGS = {
    'x_tolerance': 2,
    'y_tolerance': 2,
    'keep_blank_chars': False,
    'use_text_flow': False,
}

COLUMN_LAYOUT = (
    ('fl', 0, 62, 'join'),
    ('matricula', 62, 109, 'join'),
    ('nome', 109, 248, 'space'),
    ('cpf', 248, 320, 'join'),
    ('ano_mes', 320, 384, 'join'),
    ('cod_verba', 384, 434, 'join'),
    ('desc_verba', 434, 561, 'space'),
    ('ref_qtd', 561, 638, 'join'),
    ('valor', 638, 688, 'join'),
    ('data_pagto', 688, 750, 'join'),
    ('ccusto', 750, 9999, 'join'),
)

IGNORED_REASON_LABELS = {
    'linha_em_branco': 'linha_em_branco',
    'cabecalho_colunas': 'cabecalho_colunas',
    'paginacao': 'paginacao',
    'titulo_relatorio': 'titulo_relatorio',
    'metadado_obra': 'metadado_obra',
    'metadado_periodo': 'metadado_periodo',
    'assinatura_digital': 'assinatura_digital',
    'linha_incompleta': 'linha_incompleta',
}


def normalize_space(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value or '').replace('\xa0', ' ')).strip()


def normalize_ascii(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ''
    folded = unicodedata.normalize('NFKD', text)
    return ''.join(ch for ch in folded if not unicodedata.combining(ch))


def compact_token(value: str) -> str:
    return re.sub(r'[^A-Z0-9]+', '', normalize_ascii(value).upper())


def normalize_digits(value: str) -> str:
    return re.sub(r'\s+', '', str(value or ''))


def normalize_amount(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ''
    if text in {'-', '--'}:
        return '-'
    return re.sub(r'\s+', '', text)


def is_blank_row(row) -> bool:
    return not row or all(not normalize_space(cell) for cell in row)


def is_header_row(row) -> bool:
    if not row:
        return False

    compact = compact_token(' '.join(str(cell or '') for cell in row))
    required_tokens = (
        'FL',
        'MATRICULA',
        'NOME',
        'CPF',
        'CODVERBA',
        'DESCVERBA',
        'REFQTD',
        'DATAPAGTO',
        'CCUSTO',
    )
    return compact.startswith('FLMATRICULANOMECPF') and all(token in compact for token in required_tokens)


def get_ignored_row_reason(row):
    joined = normalize_space(' '.join(str(cell or '') for cell in row))
    if not joined:
        return 'linha_em_branco'

    compact = compact_token(joined)
    if compact.startswith('FLS'):
        return 'paginacao'
    if compact.startswith('RELATORIOVERBAS') or 'FICHAFINANCEIRA' in compact:
        return 'titulo_relatorio'
    if compact.startswith('OBRA'):
        return 'metadado_obra'
    if compact.startswith('PERIODO'):
        return 'metadado_periodo'
    if ('ASSINADO' in compact and 'ELETRONICAMENTE' in compact) or 'VALIDARITIGOVBR' in compact:
        return 'assinatura_digital'
    return None


def is_ignored_row(row) -> bool:
    return get_ignored_row_reason(row) is not None


def format_row_sample(row) -> str:
    text = normalize_space(' | '.join(normalize_space(cell) for cell in row if normalize_space(cell)))
    if len(text) > 220:
        return f'{text[:217]}...'
    return text


def build_sample_signature(reason: str, sample_text: str) -> str:
    compact = compact_token(sample_text)
    if reason in {
        'cabecalho_colunas',
        'paginacao',
        'titulo_relatorio',
        'metadado_obra',
        'metadado_periodo',
    }:
        return reason

    compact = re.sub(r'\d+', '#', compact)
    if len(compact) > 120:
        compact = compact[:120]
    return f'{reason}:{compact}'


def create_ignored_stats():
    return {
        'count': 0,
        'reasons': {},
        'samples': {},
        'sample_order': [],
    }


def register_ignored_row(stats, page_number: int, row, reason: str):
    if stats is None or not reason:
        return

    stats['count'] += 1
    stats['reasons'][reason] = stats['reasons'].get(reason, 0) + 1

    sample_text = format_row_sample(row)
    sample_key = build_sample_signature(reason, sample_text)
    sample = stats['samples'].get(sample_key)
    if sample is not None:
        sample['count'] += 1
        return

    if len(stats['sample_order']) >= IGNORED_SAMPLE_LIMIT:
        return

    stats['samples'][sample_key] = {
        'page_number': page_number,
        'reason': reason,
        'text': sample_text or '(vazia)',
        'count': 1,
    }
    stats['sample_order'].append(sample_key)


def print_ignored_summary(stats):
    if not stats or not stats.get('count'):
        return

    print(f'AVISO: {stats["count"]} linha(s) auxiliar(es) ignorada(s).', flush=True)

    reason_parts = []
    for reason in sorted(stats['reasons']):
        label = IGNORED_REASON_LABELS.get(reason, reason)
        reason_parts.append(f'{label}={stats["reasons"][reason]}')
    if reason_parts:
        print(f'AVISO: resumo ignoradas -> {", ".join(reason_parts)}', flush=True)

    if stats['sample_order']:
        print(f'AVISO: exemplos de linhas ignoradas (ate {IGNORED_SAMPLE_LIMIT} unicas):', flush=True)
        for sample_key in stats['sample_order']:
            sample = stats['samples'][sample_key]
            label = IGNORED_REASON_LABELS.get(sample['reason'], sample['reason'])
            print(
                f'AVISO: [pag {sample["page_number"]}] {label} x{sample["count"]}: {sample["text"]}',
                flush=True,
            )


def build_record(row, order_number: int, page_number: int, pdf_name: str):
    if not row:
        return None, 'linha_em_branco'

    raw = list(row[:EXPECTED_COLUMNS])
    if len(raw) < EXPECTED_COLUMNS:
        raw.extend([''] * (EXPECTED_COLUMNS - len(raw)))

    if is_blank_row(raw):
        return None, 'linha_em_branco'
    if is_header_row(raw):
        return None, 'cabecalho_colunas'

    ignored_reason = get_ignored_row_reason(raw)
    if ignored_reason:
        return None, ignored_reason

    fl = normalize_digits(raw[0])
    matricula = normalize_digits(raw[1])
    nome = normalize_space(raw[2])
    cpf = normalize_digits(raw[3])
    ano_mes = normalize_digits(raw[4])
    cod_verba = normalize_digits(raw[5])
    desc_verba = normalize_space(raw[6])
    ref_qtd = normalize_amount(raw[7])
    valor = normalize_amount(raw[8])
    data_pagto = normalize_digits(raw[9])
    ccusto = normalize_digits(raw[10])

    if not (matricula and nome and cpf and ano_mes and cod_verba):
        return None, 'linha_incompleta'

    return (
        order_number,
        fl,
        matricula,
        nome,
        cpf,
        ano_mes,
        cod_verba,
        desc_verba,
        ref_qtd,
        valor,
        data_pagto,
        ccusto,
        page_number,
        pdf_name,
    ), None


def sanitize_row(row, order_number: int, page_number: int, pdf_name: str):
    record, _reason = build_record(row, order_number, page_number, pdf_name)
    return record


def merge_parts(parts, mode: str) -> str:
    cleaned = [normalize_space(part) for part in parts if normalize_space(part)]
    if not cleaned:
        return ''
    if mode == 'space':
        return ' '.join(cleaned)
    return ''.join(cleaned)


def resolve_column_index(x0: float) -> int:
    for index, (_name, start, end, _mode) in enumerate(COLUMN_LAYOUT):
        if start <= x0 < end:
            return index
    return len(COLUMN_LAYOUT) - 1


def group_words_by_line(words):
    sorted_words = sorted(words, key=lambda item: (float(item.get('top', 0)), float(item.get('x0', 0))))
    lines = []
    current = []
    current_top = None

    for word in sorted_words:
        top = float(word.get('top', 0))
        if current_top is None or abs(top - current_top) <= LINE_TOLERANCE:
            current.append(word)
            if current_top is None:
                current_top = top
            continue

        lines.append(sorted(current, key=lambda item: float(item.get('x0', 0))))
        current = [word]
        current_top = top

    if current:
        lines.append(sorted(current, key=lambda item: float(item.get('x0', 0))))

    return lines


def extract_page_rows(page):
    words = page.extract_words(**WORD_EXTRACTION_SETTINGS) or []
    if not words:
        return []

    rows = []
    for line_words in group_words_by_line(words):
        parts = [[] for _ in COLUMN_LAYOUT]
        for word in line_words:
            idx = resolve_column_index(float(word.get('x0', 0)))
            parts[idx].append(word.get('text', ''))

        row = [
            merge_parts(cell_parts, mode)
            for cell_parts, (_name, _start, _end, mode) in zip(parts, COLUMN_LAYOUT)
        ]
        rows.append(row)

    return rows


def iterate_text_rows(text_path: str):
    with open(text_path, 'r', encoding='utf-8', newline='') as fh:
        reader = csv.reader(fh, delimiter='\t')
        for row in reader:
            yield TEXT_PAGE_NUMBER, row


def build_records(row_iter, pdf_name: str):
    records = []
    ignored_stats = create_ignored_stats()

    for page_number, row in row_iter:
        record, reason = build_record(row, len(records) + 1, page_number, pdf_name)
        if record is None:
            register_ignored_row(ignored_stats, page_number, row, reason)
            continue
        records.append(record)

    return records, ignored_stats


def create_table(conn: sqlite3.Connection):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS "{TABLE_NAME}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ordem INTEGER NOT NULL,
            fl TEXT NOT NULL DEFAULT '',
            matricula TEXT NOT NULL DEFAULT '',
            nome TEXT NOT NULL DEFAULT '',
            cpf TEXT NOT NULL DEFAULT '',
            ano_mes TEXT NOT NULL DEFAULT '',
            cod_verba TEXT NOT NULL DEFAULT '',
            desc_verba TEXT NOT NULL DEFAULT '',
            ref_qtd TEXT NOT NULL DEFAULT '',
            valor TEXT NOT NULL DEFAULT '',
            data_pagto TEXT NOT NULL DEFAULT '',
            ccusto TEXT NOT NULL DEFAULT '',
            pagina_pdf INTEGER NOT NULL DEFAULT 0,
            pdf_origem TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS "idx_{TABLE_NAME}_matricula"
        ON "{TABLE_NAME}"(matricula)
        """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS "idx_{TABLE_NAME}_cpf"
        ON "{TABLE_NAME}"(cpf)
        """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS "idx_{TABLE_NAME}_ano_mes"
        ON "{TABLE_NAME}"(ano_mes)
        """
    )


def clear_table(conn: sqlite3.Connection):
    conn.execute(f'DELETE FROM "{TABLE_NAME}"')


def insert_records(conn: sqlite3.Connection, records):
    if not records:
        return

    conn.executemany(
        f"""
        INSERT INTO "{TABLE_NAME}" (
            ordem,
            fl,
            matricula,
            nome,
            cpf,
            ano_mes,
            cod_verba,
            desc_verba,
            ref_qtd,
            valor,
            data_pagto,
            ccusto,
            pagina_pdf,
            pdf_origem
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        records,
    )


def get_pdf_page_count(pdf) -> int:
    try:
        pages_root = resolve1(pdf.doc.catalog.get('Pages'))
        count = resolve1(pages_root.get('Count'))
        return int(count or 0)
    except Exception:
        return 0


def import_pdf_streaming(conn: sqlite3.Connection, pdf_path: str):
    source_name = os.path.basename(pdf_path or '')
    total_inserted = 0
    ignored_stats = create_ignored_stats()
    pending = []
    pages_since_commit = 0

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = get_pdf_page_count(pdf)

    if not total_pages:
        with pdfplumber.open(pdf_path) as pdf:
            total_pages = sum(1 for _ in PDFPage.create_pages(pdf.doc))

    total_label = total_pages if total_pages else '?'
    print(f'Processando PDF com {total_label} pagina(s)...', flush=True)

    for chunk_start in range(1, total_pages + 1, PDF_REOPEN_CHUNK_PAGES):
        chunk_end = min(chunk_start + PDF_REOPEN_CHUNK_PAGES - 1, total_pages)

        with pdfplumber.open(pdf_path) as pdf:
            for page_number, pdf_page in enumerate(PDFPage.create_pages(pdf.doc), start=1):
                if page_number < chunk_start:
                    continue
                if page_number > chunk_end:
                    break

                page = PdfPlumberPage(pdf, pdf_page, page_number=page_number, initial_doctop=0)
                try:
                    page_rows = extract_page_rows(page)
                    for row in page_rows:
                        record, reason = build_record(
                            row,
                            total_inserted + len(pending) + 1,
                            page_number,
                            source_name,
                        )
                        if record is None:
                            register_ignored_row(ignored_stats, page_number, row, reason)
                            continue
                        pending.append(record)
                finally:
                    page.close()

                insert_records(conn, pending)
                total_inserted += len(pending)
                pending.clear()
                pages_since_commit += 1

                if pages_since_commit >= DB_COMMIT_EVERY_PAGES:
                    conn.commit()
                    pages_since_commit = 0

                if page_number == total_pages or (page_number % PDF_PROGRESS_EVERY) == 0:
                    print(
                        f'Paginas processadas: {page_number}/{total_label} | registros importados: {total_inserted}',
                        flush=True,
                    )

        if pages_since_commit:
            conn.commit()
            pages_since_commit = 0

        conn.execute('PRAGMA shrink_memory')
        gc.collect()

    return total_inserted, ignored_stats


def run(
    db_path: str,
    pdf_path: str = '',
    text_path: str = '',
    truncate: bool = True,
) -> int:
    try:
        conn = sqlite3.connect(db_path)
        try:
            conn.execute('PRAGMA temp_store = FILE')
            conn.execute('PRAGMA cache_size = -8192')
            create_table(conn)
            if truncate:
                clear_table(conn)
            conn.commit()

            if text_path:
                source_name = os.path.basename(text_path or '')
                row_iter = iterate_text_rows(text_path)
                records, ignored_stats = build_records(row_iter, source_name)
                if not records:
                    print('ERRO: layout Relatorio Verbas nao reconhecido ou sem linhas validas.', file=sys.stderr)
                    return 1
                insert_records(conn, records)
                conn.commit()
                total_records = len(records)
            else:
                total_records, ignored_stats = import_pdf_streaming(conn, pdf_path)
                if not total_records:
                    print('ERRO: layout Relatorio Verbas nao reconhecido ou sem linhas validas.', file=sys.stderr)
                    return 1
        finally:
            conn.close()

        print_ignored_summary(ignored_stats)

        print(f'OK: {total_records} registros importados em {TABLE_NAME}', flush=True)
        return 0
    except Exception as exc:
        print(f'ERRO: {exc}', file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(description='Importa Relatorio Verbas em PDF para SQLite (relverbas)')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--pdf', help='caminho do PDF')
    group.add_argument('--text-file', help='arquivo TSV com linhas de teste')
    parser.add_argument('--db', required=True, help='caminho do SQLite (ex: sys.db)')
    parser.add_argument('--no-truncate', action='store_true', help='nao limpar a tabela antes de inserir')
    args = parser.parse_args()

    sys.exit(
        run(
            db_path=args.db,
            pdf_path=args.pdf or '',
            text_path=args.text_file or '',
            truncate=(not args.no_truncate),
        )
    )


if __name__ == '__main__':
    main()
