# Importador Benefícios (Electron + SQLite)

## Estrutura (telas separadas)
- Dashboard: `renderer/index.html`
- Funcionários (XLSX): `renderer/employees.html`
- Planos (PDF): `renderer/benefits.html`
- Manutenção (Dependentes / vínculos): `renderer/maintenance.html`

## Rodar
```bash
npm install
npm start
```

## Banco
O arquivo `sys.db` fica no **mesmo diretório do app** (process.cwd()).

## Regras
- Import XLSX faz UPSERT em `funcionario`
- Import XLSX apaga tabelas de benefícios e executa o **único DELETE** de demitidos (Situação=7/007 + data limite quando meses > 0)
- PDF é importado via Python (scripts em `python/`)

> Dica: se no Windows seu Python é `py`, ajuste em `services/pythonRunner.js`.
