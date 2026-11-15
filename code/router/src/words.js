// The words an agent reads. Market owns them: bin/golive copies canon/out/tools.json (generated from the canon) into
// src/canon_words.json at build time. The defaults below are only the fallback when that file is absent.
// No praise, no instructions to the model.
import CANON from './canon_words.json';
import { BUILD } from './build_info.js';
const T = (BUILD.names && BUILD.names.tool) || 'ask_people';
const SUF = (n) => n.replace(/^ask_people/, '');

const DEFAULT = {
  server_instructions:
    'Sends a short task to several people and returns each person\'s answer with a record of what they did. Use it when work needs a human reaction a model cannot give. Not for asking your own user. Preview: test keys reach simulated people only, free, and every simulated answer is marked simulated.',
  tools: [
    { name: 'ask_people', title: 'Ask people', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      description: 'Sends one short task to several people and returns each person\'s answer with a record of what they did. Returns a call_id at once; fetch answers with ask_people_results.' },
    { name: 'ask_people_quote', title: 'Price a call to people', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: 'Prices a call without opening it or spending anything. Takes the same fields as ask_people.' },
    { name: 'ask_people_results', title: 'Get answers from a call to people', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: 'Returns the answers so far: a tally first, then one short line per person, the money for the call, and whether it is complete. Waits up to wait_seconds (at most 25).' },
    { name: 'ask_people_cancel', title: 'Stop a call to people', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: 'Stops a call: nobody new is rung; people already inside finish and are paid for their time.' },
    { name: 'ask_people_send_outcome', title: 'Tell the people what their answers changed', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description: 'Sends one line (at most 280 characters) to the people who answered a call, saying what you did with their answers. It is screened, then shown beside each person\'s receipt. At most three lines per call.' },
    { name: 'ask_people_panel', title: 'Make a panel of invited people', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description: 'Lists, makes, or gives the join link of a panel of people your principal invited. Making panels needs a key the operator issued.' },
  ],
};

// spec section 20, MCP-5 as ruled in D32 (01:42 CT): annotations describe the worst case. These win over every other source.
const SPEC_ANNOTATIONS = {
  _quote: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _results: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  '': { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  _cancel: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  _send_outcome: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  _panel: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

const src = CANON && Array.isArray(CANON.tools) && CANON.tools.length ? CANON : DEFAULT;
export const WORDS = {
  server_instructions: src.server_instructions || DEFAULT.server_instructions,
  tools: Object.fromEntries(DEFAULT.tools.map(d => {
    const suf = SUF(d.name);
    const c = (src.tools || []).find(t => t.name === T + suf) || {};
    return [suf, { ...d, ...c, name: T + suf, annotations: { ...(c.annotations || {}), ...SPEC_ANNOTATIONS[suf] }, field_words: c.field_words || {} }];
  })),
  example_call: src.example_call || null,
  generated_from: src.generated_from || 'router defaults (canon/out/tools.json was not present at build)',
};
