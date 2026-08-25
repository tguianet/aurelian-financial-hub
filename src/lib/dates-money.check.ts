import { addMonthsClamped, localDateIso, parseLooseDate } from "./date";
import { isFinancialOverdue } from "./finance";
import { addMoney, parseBRLMoney, splitMoney, splitMoneyAmount } from "./money";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function nearly(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function runDatesMoneyChecks() {
  const late = new Date(2026, 7, 24, 23, 30, 0);
  assert(localDateIso(late) === "2026-08-24", `T1 hoje local: ${localDateIso(late)}`);

  const jan31 = "2026-01-31";
  assert(addMonthsClamped(jan31, 0, 31) === "2026-01-31", "T2 jan");
  assert(addMonthsClamped(jan31, 1, 31) === "2026-02-28", "T2 fev 2026");
  assert(addMonthsClamped(jan31, 2, 31) === "2026-03-31", "T2 mar");
  assert(addMonthsClamped(jan31, 3, 31) === "2026-04-30", "T2 abr");

  assert(addMonthsClamped("2028-01-31", 1, 31) === "2028-02-29", "T3 bissexto");
  assert(addMonthsClamped("2024-02-29", 12, 29) === "2025-02-28", "T4 yearly nao bissexto");

  const today = "2026-08-24";
  assert(isFinancialOverdue("pending", today, today) === false, "T5 vencimento hoje nao e atraso");
  assert(isFinancialOverdue("pending", "2026-08-23", today) === true, "T6 ontem aberto e vencido");
  assert(isFinancialOverdue("paid", "2026-08-23", today) === false, "T6 pago nao vira vencido");

  const a = splitMoneyAmount(100, 3);
  assert(nearly(a, [33.33, 33.33, 33.34]), `100/3 = ${a.join(",")}`);
  assert(addMoney(...a) === 100, "100/3 soma");

  const b = splitMoneyAmount(10, 6);
  assert(addMoney(...b) === 10, `10/6 soma ${b.join(",")}`);

  const c = splitMoneyAmount(1999.99, 12);
  assert(addMoney(...c) === 1999.99, `1999.99/12 soma ${c.join(",")}`);

  const d = splitMoney(5, 2);
  assert(nearly(d, [2, 3]) || nearly(d, [3, 2]), `0.05/2 cents ${d.join(",")}`);
  assert(d[0]! + d[1]! === 5, "0.05/2 soma");

  assert(parseBRLMoney("1500") === 1500, "1500");
  assert(parseBRLMoney("1.500") === 1500, "1.500");
  assert(parseBRLMoney("1.500,75") === 1500.75, "1.500,75");
  assert(parseBRLMoney("1500,75") === 1500.75, "1500,75");
  assert(parseBRLMoney("R$ 1.500,75") === 1500.75, "R$");
  assert(parseBRLMoney(" 1 500,50 ") === 1500.5, "espacos");
  assert(parseLooseDate("24/08/2026") === "2026-08-24", "IA BR date");
  assert(parseLooseDate("2026-02-31") === null, "IA invalida");

  console.log("datas/dinheiro: todos os testes passaram");
}

runDatesMoneyChecks();
