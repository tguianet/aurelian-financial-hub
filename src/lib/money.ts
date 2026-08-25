/**
 * Dinheiro em centavos inteiros. Soma de parcelas = total exatamente.
 */

export function moneyToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function roundMoney(value: number): number {
  return centsToMoney(moneyToCents(value));
}

export function addMoney(...values: number[]): number {
  return centsToMoney(values.reduce((sum, value) => sum + moneyToCents(value), 0));
}

/**
 * Parser BRL. Aceita 1500 | 1.500 | 1.500,50 | R$ 1.500,50 | 1 500,50.
 * Recusa texto inválido. Não interpreta milhar americano ambíguo além de 1-2 casas.
 */
export function parseBRLMoney(input: string): number | null {
  if (typeof input !== "string") return null;
  let raw = input.trim().replace(/\u00a0/g, " ").replace(/R\$\s*/gi, "").replace(/\s/g, "");
  if (!raw) return null;
  const sign = raw.startsWith("-") ? -1 : 1;
  if (raw.startsWith("+") || raw.startsWith("-")) raw = raw.slice(1);
  if (!raw) return null;
  if (!/^[\d.,]+$/.test(raw)) return null;

  let normalized: string;
  if (raw.includes(",")) {
    if ((raw.match(/,/g) ?? []).length > 1) return null;
    const [intPart, decPart = ""] = raw.split(",");
    if (decPart.length > 2) return null;
    if (!intPart || (!/^\d{1,3}(\.\d{3})*$/.test(intPart) && !/^\d+$/.test(intPart))) return null;
    normalized = `${intPart.replace(/\./g, "")}.${decPart}`;
  } else if (raw.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
      normalized = raw.replace(/\./g, "");
    } else if (/^\d+\.\d{1,2}$/.test(raw)) {
      normalized = raw;
    } else {
      return null;
    }
  } else if (/^\d+$/.test(raw)) {
    normalized = raw;
  } else {
    return null;
  }

  const value = Number(normalized) * sign;
  if (!Number.isFinite(value)) return null;
  return roundMoney(value);
}

/**
 * Divide totalCents em n parcelas. Resto vai para a última.
 * 10000/3 → [3333, 3333, 3334]
 */
export function splitMoney(totalCents: number, installments: number): number[] {
  const n = Math.trunc(installments);
  const cents = Math.trunc(totalCents);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("parcelas invalidas");
  }
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("centavos invalidos");
  }
  const base = Math.trunc(cents / n);
  const last = cents - base * (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? last : base));
}

export function splitMoneyAmount(total: number, installments: number): number[] {
  return splitMoney(moneyToCents(total), installments).map(centsToMoney);
}
