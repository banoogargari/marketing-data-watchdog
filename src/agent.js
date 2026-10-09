// The agent: Claude investigates the checks' findings through tools, explains
// them, decides which channels can be trusted, and submits findings that the
// verifier must accept before a report is published.

import { runChecks } from './checks/index.js';
import { TOOL_DEFINITIONS, makeToolHandlers } from './tools/index.js';
import { verifyFindings } from './verify.js';

export const SYSTEM_PROMPT = `You are the marketing data watchdog for a B2B company.

Your job: answer "How much ARR did marketing source this period, by channel, and can we trust that number?"
Marketing-sourced ARR by channel = ARR of deals won in the period, grouped by the utm_source of the contact each deal is linked to.
The chain is: contact (has a source) -> deal -> closed won -> ARR -> billed in Stripe. Your job is to find where that chain is broken.

How to work:
1. Call run_checks first, then get_arr_by_channel for both views.
2. For every check that found a problem, investigate before you explain it: use get_check_details, get_records and
   empty_source_by_week to find what is broken, since when, how many deals and how much ARR, and the likely cause.
3. Submit with submit_findings: one issue per check that found a problem (more than one is fine if they are different
   problems), and a trust status for EVERY row of both ARR views.

Rules you must follow:
- Never do arithmetic. Every number you write must be copied exactly from a tool result. If you want a total the tools
  don't give you, describe it in words instead.
- A channel is trusted only if no problem affects it. run_checks lists affected_channels; respect it. Being cautious
  is better than being confidently wrong: an agent reporting confidently on bad data is worse than no agent.
- Fixes are proposals for a person to approve. Never say a fix was applied.
- Missing sources cannot be recovered by guessing, and suggested contact matches for unlinked deals need review.
- Write for a marketing operations lead: short, concrete, no jargon. Name the channel, the number and the action.`;

const PRICES = { // USD per million tokens: [input, output]
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};

export async function runAgent({ client, model, data, period, maxTurns = 25, maxSubmitAttempts = 3, onEvent = () => {} }) {
  const results = { ...runChecks({ ...data, period }), period };
  const tools = makeToolHandlers({ data, results });
  const usage = { input_tokens: 0, output_tokens: 0 };
  const messages = [{
    role: 'user',
    content: `Run the marketing-sourced ARR check for ${period.label} (${period.start} to ${period.end}) and submit your findings.`,
  }];

  let findings = null;
  let verification = null;
  let submitAttempts = 0;
  let turns = 0;

  while (turns < maxTurns) {
    turns += 1;
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) {
      messages.push({ role: 'user', content: 'Please finish by calling submit_findings.' });
      continue;
    }

    const toolResults = [];
    let done = false;
    for (const block of toolUses) {
      onEvent({ type: 'tool', name: block.name, input: block.input });
      if (block.name === 'submit_findings') {
        submitAttempts += 1;
        findings = block.input;
        verification = verifyFindings({ findings, ...results, seenNumbers: tools.seenNumbers });
        onEvent({ type: 'verification', attempt: submitAttempts, ...verification });
        if (verification.passed || submitAttempts >= maxSubmitAttempts) {
          done = true;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: verification.passed ? 'Accepted.' : 'Rejected; no more attempts.' });
        } else {
          toolResults.push({
            type: 'tool_result', tool_use_id: block.id, is_error: true,
            content: `Not accepted. Fix these and call submit_findings again:\n${verification.errors.map((e) => `- [${e.rule}] ${e.message}`).join('\n')}`,
          });
        }
        continue;
      }
      try {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(tools.call(block.name, block.input)) });
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: String(err.message ?? err) });
      }
    }
    if (done) break;
    messages.push({ role: 'user', content: toolResults });
  }

  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  return {
    model,
    period,
    findings,
    verification: verification ?? { passed: false, errors: [{ rule: 'V0', message: 'The agent never submitted findings.' }] },
    submitAttempts,
    turns,
    usage: { ...usage, cost_usd: Number(((usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6).toFixed(4)) },
    results,
  };
}
