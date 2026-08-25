/**
 * Datas financeiras (DATE): calendário local, nunca UTC cortado.
 * Timestamps de auditoria (created_at/updated_at) continuam TIMESTAMPTZ.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function clampDayOfMonth(year: number, month: number, desiredDay: number): number {
  const last = daysInMonth(year, month);
  return Math.min(Math.max(Math.trunc(desiredDay), 1), last);
}

export function isoFromYMD(year: number, month: number, day: number): string {
  const clamped = clampDayOfMonth(year, month, day);
  return `${year}-${pad2(month)}-${pad2(clamped)}`;
}

/** Dia civil local. Nunca usar toISOString().slice(0, 10) para DATE. */
export function localDateIso(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isValidDateIso(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return day <= daysInMonth(year, month);
}

/** Interpreta YYYY-MM-DD (ou prefixo de timestamptz) como meia-noite local. */
export function parseDateOnly(value: string): Date {
  const iso = value.slice(0, 10);
  if (!isValidDateIso(iso)) {
    throw new Error(`data financeira invalida: ${value}`);
  }
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function formatDateOnly(iso: string | null | undefined, locale = "pt-BR"): string {
  if (!iso) return "—";
  try {
    return parseDateOnly(iso).toLocaleDateString(locale);
  } catch {
    return "—";
  }
}

/**
 * Soma meses preservando o dia desejado.
 * 31/01 + 1 mês → 28/02 (ou 29/02); + 2 meses → 31/03.
 */
export function addMonthsClamped(dateIso: string, months: number, desiredDay?: number): string {
  const base = parseDateOnly(dateIso);
  const keep = desiredDay ?? base.getDate();
  const total = base.getFullYear() * 12 + base.getMonth() + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return isoFromYMD(year, month, keep);
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = parseDateOnly(dateIso);
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

export function firstOfMonthIso(date: Date = new Date()): string {
  return isoFromYMD(date.getFullYear(), date.getMonth() + 1, 1);
}

/** ISO weekday 1=segunda … 7=domingo. */
export function isoWeekday(dateIso: string): number {
  const d = parseDateOnly(dateIso);
  return ((d.getDay() + 6) % 7) + 1;
}

/**
 * Sanitiza data vinda de IA/documento.
 * Aceita YYYY-MM-DD, DD/MM/YYYY e DD-MM-YYYY. Recusa calendário inválido (sem clamp).
 */
export function parseLooseDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidDateIso(candidate) ? candidate : null;
  }
  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!br) return null;
  const day = Number(br[1]);
  const month = Number(br[2]);
  const year = Number(br[3]);
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateIso(candidate) ? candidate : null;
}

export function compareDateIso(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}
