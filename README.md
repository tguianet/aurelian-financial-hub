# Aurelian Financial Hub

Crie um novo aplicativo chamado Aurelian Finance. Ele será um sistema financeiro pessoal e multiempresa de uso privado do proprietário, não um CRM de clientes. Stack padrão Lovable full-stack TypeScript + Tailwind + shadcn/ui.

Objetivo central: controlar exatamente o que entra, o que sai, o que está comprometido e quanto dinheiro realmente está livre, separado por Pessoal e por empresa, com visão consolidada geral.

Estrutura inicial de organizações financeiras: Pessoal, TGuiaNet, Softworks, Restaurante, Buffet, Energia, Joias e suporte para adicionar outras empresas depois.

Regra fundamental: todo lançamento financeiro deve pertencer a uma entidade financeira (Pessoal ou empresa), ter conta, categoria, tipo, valor e data. Transferências entre contas/empresas próprias devem ser tratadas como transferências internas e não podem inflar receitas/despesas no consolidado.

Implemente o MVP funcional com:
1. Autenticação simples para uso privado.
2. Dashboard executivo com seletor global de entidade: Todas / Pessoal / cada empresa.
3. KPIs: saldo atual, dinheiro livre, entradas do mês, saídas do mês, contas a receber, contas a pagar, saldo projetado.
4. Card principal Dinheiro Livre usando lógica: saldo disponível + recebimentos confirmados - contas a pagar - faturas de cartão - reservas - compromissos programados.
5. Empresas/entidades financeiras com saldo, receitas, despesas, resultado e participação no consolidado.
6. Lançamentos com entrada, saída e transferência; descrição, valor, categoria, conta, forma de pagamento, data, vencimento, status, recorrência, parcelamento, origem e observações.
7. Contas bancárias/carteiras.
8. Cartões de crédito, limite, fatura atual, vencimento e compras parceladas.
9. Contas a pagar e receber com status pendente, pago/recebido, vencido e cancelado.
10. Orçamento mensal por categoria com orçado, realizado, diferença e percentual utilizado.
11. Reservas financeiras.
12. Projeção de caixa para 7, 15, 30, 60 e 90 dias.
13. Relatórios básicos por período, empresa e categoria.
14. Estrutura preparada para futura integração com WhatsApp e IA, mas não implemente integração externa nesta etapa.

Banco de dados sugerido: users/profiles, companies ou financial_entities, accounts, credit_cards, categories, transactions, payables, receivables, credit_card_purchases, credit_card_installments, budgets, reserves, internal_transfers, recurring_transactions, financial_snapshots, whatsapp_commands e ai_insights. Ajuste o modelo se houver forma melhor, mantendo integridade financeira.

Regras críticas de consistência:
- valores monetários com precisão adequada;
- não duplicar saldo em transferências internas;
- lançamentos pagos devem impactar conta correta;
- pendências futuras entram na projeção, não no saldo realizado;
- filtros por entidade devem afetar todo o dashboard;
- visão Todas consolida sem dupla contagem de transferências internas;
- exclusões financeiras importantes devem preferir cancelamento/soft delete ou trilha de auditoria.

Design: dark premium, fundo preto/grafite, cards cinza escuro, amarelo/dourado como cor principal de destaque, branco para texto, verde para positivo, vermelho para alertas. Desktop com sidebar fixa e mobile com navegação adequada. Aparência de fintech moderna, densa mas limpa.

Crie dados de demonstração realistas para validar o fluxo visual e cálculos, mas deixe claro quais são dados de exemplo. Priorize primeiro consistência funcional e arquitetura, depois refinamento visual.

Ao finalizar, valide build e principais fluxos do MVP.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bd7cb012-66f5-48fe-a621-5231b58880e1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
