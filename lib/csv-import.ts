export const CSV_HEADER = [
  'codigo_externo',
  'produto',
  'cor',
  'tamanho',
  'preco_centavos',
  'estoque_inicial'
] as const;

export const MAX_CSV_CHARS = 100_000;
export const MAX_CSV_ROWS = 500;

export type CsvError = {
  line: number;
  message: string;
};

export type CsvVariant = {
  line: number;
  color: string;
  size: string;
  stock: number;
};

export type CsvProduct = {
  line: number;
  externalCode: string;
  name: string;
  price: number;
  variants: CsvVariant[];
};

export type CsvPreview = {
  products: CsvProduct[];
  errors: CsvError[];
};

type Row = {
  line: number;
  fields: string[];
};

function readRows(source: string): {
  rows: Row[];
  error?: CsvError;
} {
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

  const rows: Row[] = [];

  let fields: string[] = [];
  let field = '';
  let line = 1;
  let startLine = 1;

  let mode: 'start' | 'bare' | 'quoted' | 'closed' = 'start';

  function finishField() {
    fields.push(field);
    field = '';
    mode = 'start';
  }

  function finishRow() {
    finishField();

    if (fields.length !== 1 || fields[0].trim() !== '') {
      rows.push({ line: startLine, fields });
    }

    fields = [];
    startLine = line + 1;
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (mode === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          mode = 'closed';
        }
      } else {
        field += char;
        if (char === '\n') line++;
      }

      continue;
    }

    if (char === ';') {
      finishField();
    } else if (char === '\n') {
      finishRow();
      line++;
    } else if (mode === 'closed') {
      return {
        rows,
        error: {
          line: startLine,
          message: 'Caractere inesperado após o fechamento de aspas.'
        }
      };
    } else if (char === '"') {
      if (mode !== 'start') {
        return {
          rows,
          error: {
            line: startLine,
            message: 'Aspas em campo sem delimitação.'
          }
        };
      }

      mode = 'quoted';
    } else {
      field += char;
      mode = 'bare';
    }
  }

  if (mode === 'quoted') {
    return {
      rows,
      error: {
        line: startLine,
        message: 'Campo com aspas não fechadas.'
      }
    };
  }

  if (fields.length || field || mode === 'closed') {
    finishRow();
  }

  return { rows };
}

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function variantKey(color: string, size: string) {
  const colorKey = fold(
    color.replace(/[-–—]+/g, ' ').replace(/\s+/g, ' ').trim()
  );

  const sizeKey = fold(size.replace(/\s+/g, ' ').trim());

  return JSON.stringify([
    colorKey,
    sizeKey === 'tamanho unico' ? 'unico' : sizeKey
  ]);
}

function isText(value: string, max: number) {
  return value.length > 0
    && value.length <= max
    && !/[\x00-\x1f\x7f]/.test(value);
}

function integer(
  value: string,
  min: number,
  max: number
): number | null {
  if (!/^\d+$/.test(value)) return null;

  const number = Number(value);

  return Number.isSafeInteger(number)
    && number >= min
    && number <= max
    ? number
    : null;
}

export function parseProductCsv(text: string): CsvPreview {
  const products: CsvProduct[] = [];
  const errors: CsvError[] = [];
  const result = { products, errors };

  if (text.length > MAX_CSV_CHARS) {
    errors.push({
      line: 1,
      message: 'Arquivo acima do limite de 100.000 caracteres.'
    });

    return result;
  }

  if (text.includes('\uFFFD')) {
    errors.push({
      line: 1,
      message: 'Codificação inválida. Salve o CSV em UTF-8.'
    });

    return result;
  }

  const { rows, error } = readRows(text);

  if (error) {
    errors.push(error);
    return result;
  }

  const header = rows[0];

  if (
    !header ||
    header.fields.length !== CSV_HEADER.length ||
    !CSV_HEADER.every(
      (name, index) => header.fields[index].trim() === name
    )
  ) {
    errors.push({
      line: header?.line ?? 1,
      message: 'Cabeçalho inválido. Use: ' + CSV_HEADER.join(';')
    });

    return result;
  }

  if (rows.length === 1) {
    errors.push({
      line: header.line,
      message: 'O arquivo não contém produtos.'
    });

    return result;
  }

  if (rows.length - 1 > MAX_CSV_ROWS) {
    errors.push({
      line: 1,
      message: 'Importe no máximo 500 linhas de produtos por arquivo.'
    });

    return result;
  }

  const byCode = new Map<
    string,
    {
      product: CsvProduct;
      variants: Map<string, number>;
    }
  >();

  for (const row of rows.slice(1)) {
    const report = (message: string) => {
      errors.push({ line: row.line, message });
    };

    if (row.fields.length !== CSV_HEADER.length) {
      report('A linha deve conter exatamente 6 colunas.');
      continue;
    }

    const [
      externalCode,
      name,
      color,
      size,
      rawPrice,
      rawStock
    ] = row.fields.map(value => value.trim());

    const price = integer(rawPrice, 1, 100_000_000);
    const stock = integer(rawStock, 0, 100_000);

    const firstError = errors.length;

    if (!isText(externalCode, 60)) {
      report('Código externo obrigatório, com até 60 caracteres.');
    }

    if (!isText(name, 200)) {
      report('Produto obrigatório, com até 200 caracteres.');
    }

    if (
      !isText(color, 60) ||
      !fold(color.replace(/[-–—]+/g, ' ').trim())
    ) {
      report('Cor obrigatória e válida, com até 60 caracteres.');
    }

    if (!isText(size, 20)) {
      report('Tamanho obrigatório e válido, com até 20 caracteres.');
    }

    if (price === null) {
      report('preco_centavos deve ser um inteiro entre 1 e 100000000.');
    }

    if (stock === null) {
      report('estoque_inicial deve ser um inteiro entre 0 e 100000.');
    }

    if (
      errors.length !== firstError ||
      price === null ||
      stock === null
    ) {
      continue;
    }

    const key = externalCode.toUpperCase();

    let group = byCode.get(key);

    if (!group) {
      const product: CsvProduct = {
        line: row.line,
        externalCode,
        name,
        price,
        variants: []
      };

      group = {
        product,
        variants: new Map()
      };

      byCode.set(key, group);
      products.push(product);
    }

    if (
      group.product.name !== name ||
      group.product.price !== price
    ) {
      report(
        'Nome e preço devem ser iguais para o mesmo código externo ' +
        '(linha ' + group.product.line + ').'
      );

      continue;
    }

    const vKey = variantKey(color, size);
    const previous = group.variants.get(vKey);

    if (previous !== undefined) {
      report(
        'Variação duplicada (cor e tamanho já informados na linha ' +
        previous + ').'
      );

      continue;
    }

    if (group.product.variants.length >= 150) {
      report('Cada produto pode ter no máximo 150 variações.');
      continue;
    }

    group.variants.set(vKey, row.line);

    group.product.variants.push({
      line: row.line,
      color,
      size,
      stock
    });
  }

  return result;
}
