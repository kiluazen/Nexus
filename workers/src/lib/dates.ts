export function parseDate(value: string | null | undefined): string {
  if (value == null || value === "") return todayUtc();
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ValidationError(`Invalid date format: ${JSON.stringify(value)}. Use YYYY-MM-DD.`);
  }
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (isNaN(d.getTime())) {
    throw new ValidationError(`Invalid date: ${trimmed}.`);
  }
  return trimmed;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUtc(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
