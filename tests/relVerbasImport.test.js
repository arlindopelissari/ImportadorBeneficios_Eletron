const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relverbas-import-'));
}

function runPython(pythonExe, args, options = {}) {
  return spawnSync(pythonExe, args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    ...options
  });
}

function queryDbAsJson(pythonExe, dbPath, sql) {
  const queryScript = [
    'import json',
    'import sqlite3',
    'import sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'sql = sys.argv[2]',
    'cur = conn.execute(sql)',
    'cols = [item[0] for item in cur.description]',
    'rows = [dict(zip(cols, row)) for row in cur.fetchall()]',
    'print(json.dumps(rows))',
    'conn.close()'
  ].join('\n');

  const run = runPython(pythonExe, ['-', dbPath, sql], {
    input: queryScript,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  return JSON.parse(run.stdout.trim() || '[]');
}

test('importador Rel. Verbas ignora cabecalhos auxiliares e normaliza valores quebrados', (t) => {
  const tempDir = makeTempDir();
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const dbPath = path.join(tempDir, 'relverbas.db');
  const textPath = path.join(__dirname, 'fixtures', 'relverbas_sample.tsv');
  const pythonExe = path.join(__dirname, '..', 'python-runtime', 'python.exe');
  const scriptPath = path.join(__dirname, '..', 'python-runtime', 'relverbas_cli.py');

  const run = runPython(pythonExe, [
    '-u',
    scriptPath,
    '--text-file',
    textPath,
    '--db',
    dbPath
  ]);

  assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.match(run.stdout, /OK: 5 registros importados em relverbas/);
  assert.match(run.stdout, /AVISO: 2 linha\(s\) auxiliar\(es\) ignorada\(s\)\./);
  assert.match(run.stdout, /cabecalho_colunas=2/);
  assert.match(run.stdout, /CPFANO/);

  const rows = queryDbAsJson(pythonExe, dbPath, `
    SELECT
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
      pagina_pdf
    FROM relverbas
    ORDER BY ordem
  `);

  assert.equal(rows.length, 5);

  assert.deepEqual(rows[0], {
    ordem: 1,
    fl: '01',
    matricula: '03147',
    nome: 'SILVIO VICENTE FERREIRA MARIA',
    cpf: '16958312848',
    ano_mes: '200807',
    cod_verba: '103',
    desc_verba: 'HORAS NORMAIS',
    ref_qtd: '190,58',
    valor: '914,78',
    data_pagto: '20080806',
    ccusto: '510100108',
    pagina_pdf: 0
  });

  assert.deepEqual(rows[1], {
    ordem: 2,
    fl: '01',
    matricula: '03147',
    nome: 'SILVIO VICENTE FERREIRA MARIA',
    cpf: '16958312848',
    ano_mes: '200807',
    cod_verba: '105',
    desc_verba: 'DSR DESC.SEM.REM.',
    ref_qtd: '36,65',
    valor: '175,92',
    data_pagto: '20080806',
    ccusto: '510100108',
    pagina_pdf: 0
  });

  assert.deepEqual(rows[2].valor, '61,44');
  assert.deepEqual(rows[3].valor, '0,21');
  assert.deepEqual(rows[4].valor, '-');
  assert.equal(rows[4].cod_verba, '137');
});
