const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gfip-import-'));
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

test('importador GFIP reaproveita o nome quando a linha seguinte comeca no PIS', (t) => {
  const tempDir = makeTempDir();
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const dbPath = path.join(tempDir, 'gfip.db');
  const textPath = path.join(__dirname, 'fixtures', 'gfip_sample.txt');
  const pythonExe = path.join(__dirname, '..', 'python-runtime', 'python.exe');
  const scriptPath = path.join(__dirname, '..', 'python-runtime', 'gfip_cli.py');
  const tableName = 'gfip_anterior';

  const run = runPython(pythonExe, [
    '-u',
    scriptPath,
    '--text-file',
    textPath,
    '--db',
    dbPath,
    '--table',
    tableName
  ]);

  assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.match(run.stdout, /OK: 7 registros importados em gfip_anterior/);

  const rows = queryDbAsJson(pythonExe, dbPath, `
    SELECT
      ordem,
      nome_trabalhador,
      pis_pasep_ci,
      admissao,
      rem_sem_13_sal,
      rem_13_sal,
      contrib_seg_devida
    FROM ${tableName}
    ORDER BY ordem
  `);

  assert.equal(rows.length, 7);

  assert.deepEqual(rows[0], {
    ordem: 1,
    nome_trabalhador: 'GELSO LÚCIO GUTLER',
    pis_pasep_ci: '121.35652.60-3',
    admissao: '02/05/2001',
    rem_sem_13_sal: '3.828,60',
    rem_13_sal: '0,00',
    contrib_seg_devida: '308,17'
  });

  assert.deepEqual(rows[2], {
    ordem: 3,
    nome_trabalhador: 'JAILTON NOGUEIRA PAIXAO',
    pis_pasep_ci: '126.71984.29-6',
    admissao: '01/06/2006',
    rem_sem_13_sal: '674,92',
    rem_13_sal: '0,00',
    contrib_seg_devida: '51,63'
  });

  assert.deepEqual(rows[3], {
    ordem: 4,
    nome_trabalhador: 'JAILTON NOGUEIRA PAIXAO',
    pis_pasep_ci: '125.38261.29-7',
    admissao: '12/01/2000',
    rem_sem_13_sal: '1.054,90',
    rem_13_sal: '0,00',
    contrib_seg_devida: '94,94'
  });

  assert.deepEqual(rows[4], {
    ordem: 5,
    nome_trabalhador: 'JOSE CARLOS DE SOUZA',
    pis_pasep_ci: '124.62262.19-0',
    admissao: '27/04/2005',
    rem_sem_13_sal: '800,08',
    rem_13_sal: '0,00',
    contrib_seg_devida: '61,20'
  });

  assert.deepEqual(rows[5], {
    ordem: 6,
    nome_trabalhador: 'JOSE CARLOS DE SOUZA',
    pis_pasep_ci: '129.77717.29-5',
    admissao: '03/03/2006',
    rem_sem_13_sal: '928,45',
    rem_13_sal: '0,00',
    contrib_seg_devida: '80,31'
  });

  const [jecimar] = queryDbAsJson(pythonExe, dbPath, `
    SELECT nome_trabalhador, pis_pasep_ci, admissao, rem_sem_13_sal, contrib_seg_devida
    FROM ${tableName}
    WHERE nome_trabalhador = 'JECIMAR FERREIRA'
  `);

  assert.deepEqual(jecimar, {
    nome_trabalhador: 'JECIMAR FERREIRA',
    pis_pasep_ci: '126.12345.67-8',
    admissao: '15/09/2003',
    rem_sem_13_sal: '1.234,56',
    contrib_seg_devida: '99,99'
  });
});
