const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function formatMoney(cents: number) {
  return moneyFormatter.format(cents / 100);
}

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function parseMoney(value: string): number | null {
  const clean = value.trim().replace(/^R\$\s*/, '');

  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(clean)) {
    return null;
  }

  const [whole, fraction = ''] = clean.replaceAll('.', '').split(',');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
