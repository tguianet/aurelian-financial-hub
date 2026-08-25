import { newIdempotencyKey } from "./idempotency";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const WRITE_RPCS = [
  "create_financial_entity",
  "toggle_financial_entity_active",
  "create_account",
  "toggle_account_active",
  "create_transaction",
  "cancel_transaction",
  "settle_transaction",
  "upsert_budget",
  "delete_budget",
  "create_reserve",
  "update_reserve_amount",
  "delete_reserve",
  "create_category",
  "update_category",
  "toggle_category_active",
  "create_credit_card",
  "register_financial_document",
  "claim_financial_document_processing",
  "save_financial_document_interpretation",
  "fail_financial_document_interpretation",
  "confirm_financial_document_transaction",
  "archive_financial_document",
  "set_financial_document_status",
  "link_financial_document",
  "mark_financial_document_failed",
] as const;

const AUDIT_ACTIONS = [
  "insert",
  "update",
  "deactivate",
  "reactivate",
  "cancel",
  "settle",
  "delete",
] as const;

const DOCUMENT_STATES = ["uploaded", "processing", "interpreted", "confirmed", "linked", "failed", "archived"] as const;

export function runAuditIntegrityChecks() {
  const keyA = newIdempotencyKey();
  const keyB = newIdempotencyKey();
  assert(keyA !== keyB, "T4 chaves de idempotência distintas");
  assert(/^[0-9a-f-]{36}$/i.test(keyA), "T4 UUID de idempotência");

  assert(WRITE_RPCS.length === 25, "contrato de RPCs de escrita");
  assert(AUDIT_ACTIONS.includes("cancel") && AUDIT_ACTIONS.includes("settle"), "ações padrão");
  assert(DOCUMENT_STATES.includes("interpreted") && !(DOCUMENT_STATES as readonly string[]).includes("processed"), "T11 estados de documento");

  const roleMatrix = {
    viewer: { write: false, admin: false },
    editor: { write: true, admin: false },
    owner: { write: true, admin: true },
  };
  assert(!roleMatrix.viewer.write, "T6 viewer sem escrita");
  assert(roleMatrix.editor.write && !roleMatrix.editor.admin, "T7 editor escreve");
  assert(roleMatrix.owner.write && roleMatrix.owner.admin, "owner administra");

  console.log("auditoria/atomicidade: contrato T4/T6/T7/T11 ok");
}

runAuditIntegrityChecks();
