import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CSV_HEADER,
  parseProductCsv
} from '../lib/csv-import.ts';

const header = CSV_HEADER.join(';');

const example = name =>
  readFileSync(
    new URL('../exemplos/' + name, import.meta.url),
    'utf8'
  );

test('CSV válido agrupa um produto com duas variações', () => {
  const { products, errors } =
    parseProductCsv(example('produtos.csv'));

  assert.deepEqual(errors, []);

  assert.deepEqual(products, [{
    line: 2,
    externalCode: 'CAM-002',
    name: 'Camiseta esportiva',
    price: 6990,
    variants: [
      { line: 2, color: 'Azul', size: 'M', stock: 10 },
      { line: 3, color: 'Azul', size: 'G', stock: 5 }
    ]
  }]);
});

test('CSV inválido identifica duplicação e estoque negativo', () => {
  const { errors } =
    parseProductCsv(example('produtos-invalidos.csv'));

  assert.deepEqual(errors.map(error => error.line), [3, 4]);
  assert.match(errors[0].message, /duplicada/);
  assert.match(errors[1].message, /estoque_inicial/);
});

test('Aceita BOM, CRLF e campos entre aspas', () => {
  const result = parseProductCsv(
    '\uFEFF' + header +
    '\r\nCAM;"Camiseta; ""especial""";Azul;M;6990;0\r\n'
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.products[0].name, 'Camiseta; "especial"');
  assert.equal(result.products[0].variants[0].stock, 0);
});

test('Rejeita cabeçalho, arquivo vazio e colunas inválidas', () => {
  assert.match(
    parseProductCsv('codigo,produto').errors[0].message,
    /Cabeçalho/
  );

  assert.match(
    parseProductCsv(header + '\n').errors[0].message,
    /não contém/
  );

  assert.equal(
    parseProductCsv(header + '\nCAM;Camiseta').errors[0].line,
    2
  );
});

test('Rejeita preços e estoques inválidos', () => {
  const cases = [
    ['59.90', '1'],
    ['', '1'],
    ['1e3', '1'],
    ['0', '1'],
    ['6990', ''],
    ['6990', '-1'],
    ['6990', '100001']
  ];

  for (const [price, stock] of cases) {
    const result = parseProductCsv(
      header + '\nCAM;Camiseta;Azul;M;' + price + ';' + stock
    );

    assert.ok(result.errors.length);
  }
});

test('Rejeita conflitos de nome ou preço no mesmo código', () => {
  const result = parseProductCsv(
    header +
    '\nCAM;Camiseta;Azul;M;6990;10' +
    '\ncam;Outra;Azul;G;7990;5'
  );

  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /Nome e preço/);
});

test('Detecta variações equivalentes', () => {
  const result = parseProductCsv(
    header +
    '\nCAM;Camiseta;Azul-bebê;Único;6990;10' +
    '\ncam;Camiseta;azul bebe;Tamanho unico;6990;5'
  );

  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /duplicada/);
});

test('Preserva números das linhas e rejeita aspas malformadas', () => {
  const result = parseProductCsv(
    header + '\n\nCAM;Camiseta;Azul;M;6990;-1'
  );

  assert.equal(result.errors[0].line, 3);

  assert.match(
    parseProductCsv(header + '\nCAM;"sem fechamento')
      .errors[0].message,
    /não fechadas/
  );
});

test('Rejeita arquivos grandes, codificação e excesso de variações', () => {
  assert.match(
    parseProductCsv('a'.repeat(100001)).errors[0].message,
    /limite/
  );

  assert.match(
    parseProductCsv(
      header + '\nCAM;Camisa\uFFFD;Azul;M;6990;1'
    ).errors[0].message,
    /UTF-8/
  );

  const rows = Array.from(
    { length: 151 },
    (_, i) => 'CAM;Camisa;Azul;' + (i + 1) + ';6990;1'
  );

  assert.match(
    parseProductCsv(header + '\n' + rows.join('\n'))
      .errors[0].message,
    /150 variações/
  );
});

import {
  applyAction,
  applyCsvImport,
  planCsvImport,
  emptyState
} from '../lib/domain.ts';

test('Importa com SKU interno, vínculo externo e movimentações de entrada', () => {
  const initial = emptyState();
  const { products } = parseProductCsv(example('produtos.csv'));

  const { state, summary } = applyCsvImport(
    initial,
    products,
    ['TRM-000002']
  );

  assert.equal(initial.products.length, 0);
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].code, 'TRM-000002');
  assert.equal(state.products[0].retail, 6990);

  assert.deepEqual(
    state.products[0].variants.map(v => v.stock),
    [10, 5]
  );

  assert.equal(state.movements.length, 2);
  assert.equal(summary.imported[0].externalCode, 'CAM-002');

  assert.equal(
    summary.imported[0].productId,
    state.products[0].id
  );

  assert.equal(
    summary.imported[0].variants[0].variantId,
    state.products[0].variants[0].id
  );

  assert.deepEqual(
    state.csvImportLinks,
    summary.imported
  );
});

test('Reimportar preserva estoque movimentado, IDs e histórico', () => {
  const { products } = parseProductCsv(example('produtos.csv'));

  const first = applyCsvImport(
    emptyState(),
    products,
    ['TRM-000002']
  ).state;

  const product = first.products[0];

  const moved = applyAction(first, {
    action: 'stock',
    productId: product.id,
    variantId: product.variants[0].id,
    qty: -2,
    reason: 'Teste de reimportação'
  });

  const { state, summary } = applyCsvImport(
    moved,
    products,
    []
  );

  assert.deepEqual(summary, {
    imported: [],
    skipped: ['CAM-002']
  });

  assert.deepEqual(state, moved);
  assert.equal(state.products[0].variants[0].stock, 8);
});

test('Código externo sem distinção de caixa também é ignorado', () => {
  const { products } = parseProductCsv(example('produtos.csv'));

  const state = applyCsvImport(
    emptyState(),
    products,
    ['TRM-000002']
  ).state;

  const repeated = [{
    ...products[0],
    externalCode: 'cam-002'
  }];

  assert.equal(
    planCsvImport(state, repeated).newProducts.length,
    0
  );
});

test('Exclusão de cadastro não libera nova carga inicial do mesmo código', () => {
  const { products } = parseProductCsv(example('produtos.csv'));

  const loaded = applyCsvImport(
    emptyState(),
    products,
    ['TRM-000002']
  ).state;

  const deleted = applyAction(loaded, {
    action: 'delete-product',
    id: loaded.products[0].id
  });

  assert.equal(deleted.products.length, 0);

  const { state, summary } = applyCsvImport(
    deleted,
    products,
    []
  );

  assert.equal(state.products.length, 0);
  assert.deepEqual(summary.skipped, ['CAM-002']);
});

test('Falha no segundo produto não altera a loja original', () => {
  const { products } = parseProductCsv(example('produtos.csv'));

  const second = {
    ...products[0],
    externalCode: 'CAM-003',
    name: 'Outra camiseta'
  };

  const initial = emptyState();

  assert.throws(
    () => applyCsvImport(
      initial,
      [products[0], second],
      ['TRM-000002', 'TRM-000002']
    ),
    /Já existe/
  );

  assert.equal(initial.products.length, 0);
  assert.equal(initial.movements.length, 0);
});
