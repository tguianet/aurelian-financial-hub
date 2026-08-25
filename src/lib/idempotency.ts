/** Chave de idempotência para retries/clique duplo. Não é segredo. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
