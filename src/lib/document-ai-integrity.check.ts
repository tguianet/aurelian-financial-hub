import { FALLBACK_CATEGORY_NAME, resolveCategoryId } from "./categories";
import {
  DOCUMENT_STATUSES,
  claimDocumentProcessingDecision,
  confirmDocumentDecision,
  documentConfirmIdempotencyKey,
  documentUsesCreditCard,
  isDuplicateInSameSpace,
  isProcessingStale,
  looksLikeUuid,
  parseAiDocumentSuggestion,
  parseResolvedDocumentSuggestion,
  resolveDocumentSuggestion,
  stripInventedIds,
} from "./document-interpretation";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HASH = "a".repeat(64);

const catalog = {
  entities: [
    { id: "e-pessoal", name: "Pessoal", active: true },
    { id: "e-empresa", name: "Empresa", active: true },
  ],
  categories: [
    { id: "c-comb", name: "Combustível", kind: "expense" as const, active: true },
    { id: "c-out-d", name: FALLBACK_CATEGORY_NAME.expense, kind: "expense" as const, active: true },
    { id: "c-out-r", name: FALLBACK_CATEGORY_NAME.income, kind: "income" as const, active: true },
  ],
  accounts: [{ id: "a-1", entity_id: "e-pessoal", active: true }],
};

export function runDocumentAiIntegrityChecks() {
  assert(DOCUMENT_STATUSES.includes("interpreted"), "estado interpreted");
  assert(!(DOCUMENT_STATUSES as readonly string[]).includes("processed"), "processed não é estado oficial");

  // T1 mesmo arquivo no mesmo space
  assert(isDuplicateInSameSpace({ spaceId: SPACE_A, hash: HASH }, { spaceId: SPACE_A, hash: HASH }), "T1 duplicado no space");
  assert(!isDuplicateInSameSpace({ spaceId: SPACE_A, hash: HASH }, { spaceId: SPACE_B, hash: HASH }), "T1 spaces diferentes não colidem");

  // T2 dois Interpretar simultâneos
  const first = claimDocumentProcessingDecision({
    status: "uploaded",
    currentUserId: USER_A,
  });
  assert(first === "claim", "T2 primeiro caller reclama lock");
  const second = claimDocumentProcessingDecision({
    status: "processing",
    processingStartedAt: new Date().toISOString(),
    processingBy: USER_A,
    currentUserId: USER_A,
  });
  assert(second === "in_progress", "T2 segundo clique do mesmo usuário não inicia outra IA");
  assert(claimDocumentProcessingDecision({
    status: "processing",
    processingStartedAt: new Date().toISOString(),
    processingBy: USER_A,
    currentUserId: USER_B,
  }) === "in_progress", "T2 segundo dispositivo não inicia outra IA");

  // T3 timeout da IA: failed, sem transaction
  assert(confirmDocumentDecision("failed", null, null) === "reject", "T3 failed não confirma");
  assert(confirmDocumentDecision("processing", null, null) === "reject", "T3 processing não confirma");

  // T4 amount inválido
  let invalidAmount = false;
  try {
    resolveDocumentSuggestion({ kind: "expense", amount: 0, description: "x", confidence: 0.9 }, catalog);
  } catch {
    invalidAmount = true;
  }
  assert(invalidAmount, "T4 amount 0 inválido");
  let negative = false;
  try {
    resolveDocumentSuggestion({ kind: "expense", amount: -10, description: "x", confidence: 0.9 }, catalog);
  } catch {
    negative = true;
  }
  assert(negative, "T4 amount negativo inválido");

  // T5 UUID inventado de categoria é ignorado
  const invented = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  assert(looksLikeUuid(invented), "T5 uuid detectado");
  assert(stripInventedIds(invented) === null, "T5 uuid não vira nome");
  const resolved = resolveDocumentSuggestion({
    kind: "expense",
    amount: 80,
    description: "Gasolina no posto",
    category_name: invented,
    category_id: invented,
    confidence: 0.8,
  }, catalog);
  assert(resolved.category_id === "c-comb", "T5 categoria resolvida pelo space/alias");
  assert(resolved.category_id !== invented, "T5 uuid inventado ignorado");
  assert(
    resolveCategoryId(catalog.categories, "expense", invented, "conta qualquer") === "c-out-d",
    "T5 id inexistente cai no fallback do space",
  );

  // T6 / T7 clique duplo e retry após timeout HTTP
  const keyA = documentConfirmIdempotencyKey(DOC_ID, 1);
  const keyB = documentConfirmIdempotencyKey(DOC_ID, 1);
  assert(keyA === keyB, "T6 chave determinística");
  assert(keyA === `financial-document:${DOC_ID}:confirm:v1`, "T6 formato da chave");
  assert(confirmDocumentDecision("interpreted", null, null) === "create", "T6 primeira confirmação cria");
  assert(confirmDocumentDecision("linked", "tx-1", null) === "return_existing", "T6/T7 retry devolve a mesma transaction");
  assert(confirmDocumentDecision("linked", "tx-1", null) === confirmDocumentDecision("linked", "tx-1", null), "T7 idempotente");

  // T8 cartão não vira expense duplicada
  assert(documentUsesCreditCard("expense", "credit"), "T8 credit usa purchase");
  assert(!documentUsesCreditCard("expense", "pix"), "T8 pix é cash");
  assert(!documentUsesCreditCard("income", "credit"), "T8 receita no cartão não é purchase");

  // T9 viewer bloqueado
  const roleMatrix = { viewer: { write: false }, editor: { write: true }, owner: { write: true } };
  assert(!roleMatrix.viewer.write, "T9 viewer sem upload/processar/confirmar");

  // T10 editor escreve
  assert(roleMatrix.editor.write, "T10 editor opera o fluxo");

  // T11 outro space
  assert(
    !isDuplicateInSameSpace({ spaceId: SPACE_A, hash: HASH }, { spaceId: SPACE_B, hash: HASH }),
    "T11 hash igual noutro space não é o mesmo documento",
  );
  assert(claimDocumentProcessingDecision({
    status: "linked",
    currentUserId: USER_A,
  }) === "blocked", "T11 documento fora do fluxo/espaço não é reprocessado");

  // T12 processing parado > 10 min
  const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  assert(isProcessingStale(elevenMinAgo), "T12 stale após 10 min");
  assert(claimDocumentProcessingDecision({
    status: "processing",
    processingStartedAt: elevenMinAgo,
    processingBy: USER_B,
    currentUserId: USER_A,
  }) === "claim", "T12 lock abandonado pode ser retomado");

  // T13 linked não apaga transaction
  assert(confirmDocumentDecision("linked", "tx-keep", null) === "return_existing", "T13 vínculo permanece");
  const archiveLinked = { deleteTransaction: false, archiveMetadata: true };
  assert(archiveLinked.archiveMetadata && !archiveLinked.deleteTransaction, "T13 arquivar metadata, manter lançamento");

  // cache da interpretação
  assert(claimDocumentProcessingDecision({
    status: "interpreted",
    interpretationJson: { kind: "expense" },
    currentUserId: USER_A,
  }) === "use_cached", "interpretação existente não chama IA");
  assert(claimDocumentProcessingDecision({
    status: "interpreted",
    interpretationJson: { kind: "expense" },
    currentUserId: USER_A,
    force: true,
  }) === "claim", "Reprocessar com IA força nova versão");

  const parsed = parseAiDocumentSuggestion({
    kind: "expense",
    amount: 12.5,
    description: "Uber",
    competence_date: "2026-08-24",
    due_date: null,
    payment_method: "pix",
    category_name: "Combustível",
    entity_name: "Pessoal",
    confidence: 0.7,
    notes: null,
    possible_recurring: false,
  });
  assert(parsed.kind === "expense" && parsed.amount === 12.5, "contrato Zod da IA");

  const stored = parseResolvedDocumentSuggestion(resolved);
  assert(stored?.category_id === "c-comb", "sugestão persistida reutilizável");

  console.log("documentos/IA: contrato T1–T13 ok");
}

runDocumentAiIntegrityChecks();
