const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | number | Date): string {
  return dateFormatter.format(value instanceof Date ? value : new Date(value));
}

export function formatDateTime(value: string | number | Date): string {
  return dateTimeFormatter.format(value instanceof Date ? value : new Date(value));
}
