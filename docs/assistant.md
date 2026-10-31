# Dashboard assistant

A chat panel inside the dashboard where Diego asks questions in Portuguese and gets answers grounded in the database. For example: "quais leads A ainda não responderam?", "por que essa clínica ficou com fit 82?", "resuma a conversa de WhatsApp com a Ótica X", or "como foi a taxa de resposta por nicho este mês?". It can also **propose** actions, and Diego confirms each one with a button.

It is a different bot from the WhatsApp qualifier, which talks to leads. This one talks only to the operator, behind the dashboard's auth.

## Rules

- **Read-only by default.** Tools that change something (stage, note, regenerate a draft) only return a *proposal*. The dashboard shows it as a confirm button, a normal POST with CSRF that goes through the same service code and audit log as a manual click.
- **It never sends outbound** or approves drafts. That stays a human action in the Approval queue, per the spec's human-in-the-loop rule.
- **Tools, not SQL.** The model calls typed tools with Zod-validated arguments. There is no free-form query tool, and results are capped (for example, 50 rows).
- Lead text inside tool results (site HTML, reviews, WhatsApp messages) is passed as quoted data. Answers are rendered escaped. See the prompt-injection row in [security.md](security.md).
- Model from config (`models.assistant`, default Sonnet). The system prompt lives in `prompts/dashboard-assistant.md` and uses prompt caching. Tokens and cost go to the same usage log, with a daily cap.
- Chats are stored 90 days, then pruned. Deleting a lead also removes it from stored chats.

## Development steps

| Step | What ships | Milestone |
| --- | --- | --- |
| 0. Groundwork | Already planned: LLM client with cost logging, Zod output validation, audit log | M3 |
| 1. Read-only assistant | `/assistant` page and a side panel on the lead page. Tools: `search_leads(filters)`, `get_lead(id)` (findings, scores, timeline), `list_drafts(status)`, `get_pipeline_counts()`. The answer renders on the server after a plain form POST (no JS needed). Fixture tests for each tool, plus an eval set of 15 typical questions | M3 (after the Approval queue) |
| 2. Proposals and conversations | Tools `propose_stage_change`, `propose_note`, `propose_regenerate_draft(note)` returning confirm buttons. `summarize_conversation(lead_id)` for WhatsApp threads. Answers stream over SSE through `app.js` | M4 |
| 3. Insights | `get_metrics(range, group_by)` and `get_costs(range)`. A "what should I do today?" answer built from the Today data. Optional: the same assistant in the Telegram bot, allowed only for Diego's chat id, read-only | M5 |
| 4. Gamification hooks | The assistant can explain progress and suggest the next action that earns points (see [dashboard.md](dashboard.md#gamification-placeholder)) | M6 |

## Definition of done per step

- Every tool has a unit test with recorded fixtures, plus a test that write tools return only proposals.
- The eval set (question → expected facts) runs in CI against fixtures with a mocked model, and manually against the real model before merge.
- Run the `security-review` skill on the diff.

## Sources

- Anthropic tool use: https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview
- Anthropic prompt caching: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- OWASP Top 10 for LLM Applications (LLM01 prompt injection, LLM06 excessive agency): https://genai.owasp.org/llm-top-10/
