// A scripted stand-in for Claude, used by the tests and by `--sim` runs.
// It calls the same tools in the same loop as the real model, so the whole
// pipeline (tools -> verifier -> report) can be tested without an API key.
// With { mistakeFirst: true } its first submission is deliberately wrong, to
// show the verifier catching it and the agent correcting itself.

const usd = (n) => `$${n.toLocaleString('en-US')}`;

export function makeSimClient({ mistakeFirst = false } = {}) {
  let submitted = 0;
  let id = 0;
  const call = (name, input = {}) => ({ type: 'tool_use', id: `tu_${++id}`, name, input });
  const reply = (content) => ({ content, stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 } });

  const resultsSoFar = (messages) => {
    const out = {};
    const calls = new Map();
    for (const m of messages) {
      if (m.role === 'assistant') for (const b of m.content) if (b.type === 'tool_use') calls.set(b.id, b);
      if (m.role === 'user' && Array.isArray(m.content)) {
        for (const r of m.content) {
          const c = calls.get(r.tool_use_id);
          if (c && !r.is_error) out[`${c.name}:${c.input.view ?? c.input.check ?? ''}`] = JSON.parse(r.content);
        }
      }
    }
    return out;
  };

  return {
    messages: {
      async create({ messages }) {
        const step = messages.filter((m) => m.role === 'assistant').length;
        if (step === 0) {
          return reply([call('run_checks'), call('get_arr_by_channel', { view: 'reported' }), call('get_arr_by_channel', { view: 'after_fixes' })]);
        }
        const r = resultsSoFar(messages);
        const summary = r['run_checks:'];
        const problems = summary.checks.filter((c) => c.status === 'issue');
        if (step === 1 && problems.length) {
          return reply(problems.map((c) => call('get_check_details', { check: c.check })));
        }

        const channels = [...new Set([...r['get_arr_by_channel:reported'].rows, ...r['get_arr_by_channel:after_fixes'].rows].map((x) => x.channel))];
        const affected = summary.affected_channels;
        const issues = problems.map((c) => ({
          check: c.check,
          title: c.name,
          what_happened: c.check === 'C1' && c.sudden_change
            ? `Empty utm_source rose from ${c.sudden_change.empty_rate_before} to ${c.sudden_change.empty_rate_after} of new contacts starting ${c.sudden_change.start_date}.`
            : `${c.name}: ${c.deals_affected} won deals affected.`,
          impact: `${usd(c.arr_affected)} of ARR is ${c.check === 'C5' ? 'recorded on deals above what Stripe bills' : 'reported under the wrong channel or Unknown'}.`,
          recommended_action: 'Review the proposed fix file and apply it in HubSpot.',
          needs_human_review: ['C1', 'C4', 'C5'].includes(c.check),
        }));
        const channel_trust = channels.map((ch) => ({ channel: ch, trusted: !affected[ch], reason: affected[ch] ? `affected by ${affected[ch].join(', ')}` : 'no open issues' }));
        submitted += 1;
        if (mistakeFirst && submitted === 1) {
          const firstAffected = channel_trust.find((t) => !t.trusted);
          if (firstAffected) firstAffected.trusted = true;
          issues[0] && (issues[0].impact += ' Roughly $1,234,567 in total.');
        }
        const headline = problems.length
          ? `ARR by channel cannot be fully trusted: ${problems.length} checks found problems.`
          : 'No problems found; ARR by channel can be trusted.';
        return reply([call('submit_findings', { headline, issues, channel_trust })]);
      },
    },
  };
}
