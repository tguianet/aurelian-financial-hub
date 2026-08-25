/** Mensagens amigáveis a partir de erros das RPCs financeiras. */
export function rpcErrorMessage(error: { message?: string } | null | undefined, fallback: string) {
  const raw = (error?.message ?? "").trim();
  if (!raw) return fallback;
  if (/somente leitura|sem permissao|permission denied|not allowed|viewer/i.test(raw)) {
    return "Seu acesso é somente leitura.";
  }
  if (/sessao invalida/i.test(raw)) return "Sessão expirada.";
  if (/espaco financeiro nao encontrado/i.test(raw)) return "Espaço financeiro não encontrado.";
  if (/audit_log imutavel/i.test(raw)) return "A trilha de auditoria não pode ser alterada.";
  if (/nao e permitido alterar o tipo de categoria/i.test(raw)) {
    return "Não é permitido alterar o tipo de uma categoria já utilizada.";
  }
  if (/pagamento de fatura nao pode ser cancelado/i.test(raw)) {
    return "Pagamento de fatura não pode ser cancelado por este fluxo.";
  }
  if (/duplicate key|unique|ja existe|duplicate_hash/i.test(raw)) {
    return "Este registro já existe. Nada foi duplicado.";
  }
  if (/ja esta sendo lido|processing_in_progress|em processamento/i.test(raw)) {
    return "Este documento já está sendo lido. Aguarde e tente de novo.";
  }
  if (/ja vinculado|documento ja vinculado/i.test(raw)) {
    return "Este documento já está vinculado a um lançamento.";
  }
  if (/selecione o cartao|cartao invalido|cartão/i.test(raw)) {
    return "Selecione um cartão válido para esta compra.";
  }
  if (/confirme apenas apos/i.test(raw)) {
    return "Revise a interpretação da IA antes de confirmar o lançamento.";
  }
  return raw;
}
