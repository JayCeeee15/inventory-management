export const APP_LOCALE = 'en-PH';
export const APP_CURRENCY = 'PHP';

const pesoFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: 'currency',
  currency: APP_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatPeso(value: number | null | undefined): string {
  const numericValue = Number(value ?? 0);
  return pesoFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}
