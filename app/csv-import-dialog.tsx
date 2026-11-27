'use client';

import { useRef, useState } from 'react';
import type { CsvImportSummary } from '@/lib/domain';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger
} from '@/components/ui/dialog';

import {
  MAX_CSV_CHARS,
  parseProductCsv,
  type CsvPreview
} from '@/lib/csv-import';

const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(cents / 100);

export default function CsvImportDialog({
  disabled,
  onImport
}: {
  disabled: boolean;
  onImport: (csv: string) => Promise<CsvImportSummary>;
}) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState('');
  const [preview, setPreview] =
    useState<CsvPreview | null>(null);

  const request = useRef(0);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] =
    useState<CsvImportSummary | null>(null);

  function changeOpen(next: boolean) {
    if (importing) return;
    setOpen(next);

    if (!next) {
      request.current++;
      setReading(false);
      setFileName('');
      setReadError('');
      setPreview(null);
      setCsvText('');
      setSummary(null);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;

    const current = ++request.current;

    setFileName(file.name);
    setReadError('');
    setPreview(null);
    setCsvText('');
    setSummary(null);
    setReading(true);

    try {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        throw new Error('Selecione um arquivo .csv.');
      }

      if (file.size > MAX_CSV_CHARS * 4 + 3) {
        throw new Error('Arquivo muito grande.');
      }

      const buffer = await file.arrayBuffer();
      let text: string;

      try {
        text = new TextDecoder('utf-8', {
          fatal: true
        }).decode(buffer);
      } catch {
        throw new Error(
          'Codificação inválida. Salve o CSV em UTF-8.'
        );
      }

      if (request.current === current) {
        setPreview(parseProductCsv(text));
        setCsvText(text);
      }
    } catch (error) {
      if (request.current === current) {
        setReadError(
          error instanceof Error
            ? error.message
            : 'Não foi possível ler o CSV.'
        );
      }
    } finally {
      if (request.current === current) {
        setReading(false);
      }
    }
  }

  async function confirmImport() {
    if (
      !preview ||
      preview.errors.length ||
      !csvText ||
      importing ||
      summary
    ) return;

    setImporting(true);
    setReadError('');

    try {
      const result = await onImport(csvText);
      setSummary(result);
    } catch (error) {
      setReadError(
        error instanceof Error
          ? error.message
          : 'Não foi possível importar.'
      );
    } finally {
      setImporting(false);
    }
  }

  const rows = preview?.products.flatMap(product =>
    product.variants.map(variant => ({
      product,
      variant
    }))
  ) ?? [];

  const pieces = rows.reduce(
    (sum, row) => sum + row.variant.stock,
    0
  );

  const valid =
    preview !== null && preview.errors.length === 0;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        className="secondary"
        disabled={disabled}
      >
        Importar CSV
      </DialogTrigger>

      <DialogContent className="app-dialog wide">
        <DialogTitle>
          Importar produtos por CSV
        </DialogTitle>

        <DialogDescription>
          Selecione um arquivo UTF-8 separado por ponto
          e vírgula para conferir os produtos e suas
          variações.
        </DialogDescription>

        <label className="field">
          <span>Arquivo CSV de produtos</span>

          <input
            type="file"
            accept=".csv,text/csv"
            disabled={reading || importing}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void readFile(file);
            }}
          />
        </label>

        {fileName && (
          <p className="text-sm break-all">
            Arquivo: <strong>{fileName}</strong>
          </p>
        )}

        {reading && (
          <p role="status">Lendo arquivo…</p>
        )}

        {readError && (
          <div className="error" role="alert">
            {readError}
          </div>
        )}

        {preview && preview.errors.length > 0 && (
          <div className="error" role="alert">
            <div className="w-full">
              <strong>
                Arquivo inválido: {preview.errors.length} erro(s)
              </strong>

              <p>
                Corrija os registros antes de importar.
                Nenhum dado foi salvo.
              </p>

              <ul className="mt-2 list-disc pl-5">
                {preview.errors.map((error, index) => (
                  <li key={index}>
                    Linha {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {valid && (
          <>
            <div className="guidance" role="status">
              <span>
                Arquivo válido: {preview.products.length} produto(s),
                {' '}{rows.length} variação(ões)
                e {pieces} peça(s).
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[650px] border-collapse text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {[
                      'Linha',
                      'Código externo',
                      'Produto',
                      'Cor',
                      'Tamanho',
                      'Preço',
                      'Estoque inicial'
                    ].map(column => (
                      <th
                        className="p-3"
                        scope="col"
                        key={column}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map(({ product, variant }) => (
                    <tr
                      className="border-t"
                      key={variant.line}
                    >
                      <td className="p-3">{variant.line}</td>
                      <td className="p-3">{product.externalCode}</td>
                      <td className="p-3">{product.name}</td>
                      <td className="p-3">{variant.color}</td>
                      <td className="p-3">{variant.size}</td>
                      <td className="whitespace-nowrap p-3">
                        {money(product.price)}
                      </td>
                      <td className="p-3">{variant.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-sm text-muted-foreground">
          A importação aceita até 50 novos produtos por vez.
          Códigos já importados serão ignorados.
          Novos produtos usarão a categoria Importados,
          custo provisório zero e o mesmo preço no
          varejo e atacado.
        </p>

        {summary && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900" role="status">
            <strong>Importação concluída</strong>

            <p>
              {summary.imported.length} produto(s) cadastrado(s).
              {' '}{summary.skipped.length} código(s) já importado(s).
            </p>

            {summary.imported.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {summary.imported.map(link => (
                  <li key={link.productId}>
                    {link.externalCode} → {link.productCode}
                  </li>
                ))}
              </ul>
            )}

            {summary.skipped.length > 0 && (
              <p className="mt-2">
                Ignorados: {summary.skipped.join(', ')}.
                O estoque existente foi preservado.
              </p>
            )}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={importing}
            onClick={() => changeOpen(false)}
          >
            Fechar
          </button>

          <button
            type="button"
            className="primary"
            disabled={
              !valid || reading || importing || summary !== null
            }
            onClick={() => void confirmImport()}
          >
            {importing ? 'Importando…' : 'Confirmar importação'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
