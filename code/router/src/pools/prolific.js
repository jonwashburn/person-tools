// The Prolific adapter (N2), to the contract in code/router/ADAPTERS.md. Facts: router/PROLIFIC_NOTES.md (research/
// supply_panels.md read to the end of its check). Two modes, one code path:
//   recorded: answers from prolific_recorded.json; nobody at Prolific is contacted; every answer is a scripted stand-in;
//   live:     Prolific's REST interface with a token from the environment; off until PROLIFIC_GO_LIVE.md is done.
// Account modes for live (PLAN s3): 'own' = our account for our own calls; 'principal' = a principal's own account and key,
// only once Prolific confirms in writing that a router may hold a principal's key. Neither is switched on in this build.
import { fixable } from '../spec.js';
import RECORDED from './prolific_recorded.json';

const BASE = 'https://api.prolific.com/api/v1';
const COMPLETE = 'https://app.prolific.com/submissions/complete?cc=';

export const adapter = {
  name: 'prolific',
  pays_people: true,
  principal_accounts: true,          // a principal may connect its own Prolific account (pools/accounts.js); off live until Prolific's written yes
  fee_rate: 0.42857,                 // corporate accounts (VAT on the fee where it applies is not in test money)
  floor_cents_per_hour: 800,         // Prolific's own minimum ($8 an hour); ours is higher and wins
  kinds: ['listen', 'watch', 'view', 'answer', 'compare'],
  expected: { minutes: 240, note: 'an outside panel: its people pick studies themselves, and small studies usually fill in hours' },

  mode(env) {
    if (env.PROLIFIC_MODE === 'live' && env.PROLIFIC_TOKEN) return 'live';
    return 'recorded';
  },

  // Prolific's rules, in code (PLAN s3, supply_panels): typed answers only (a recording needs its written approval),
  // no asking for identity or contact, pay at least its floor, the person comes back with a completion code.
  check(spec) {
    if (!this.kinds.includes(spec.kind)) throw fixable('unsupported_feature', 'kind', `The pool "prolific" takes ${this.kinds.join(', ')}; "${spec.kind}" needs a pool that hosts it.`, 'listen');
    if (spec.require) throw fixable('selector_unsupported', 'require', 'Selectors for "prolific" are not wired yet; remove require.', null);
    if (spec.pay_cents === 0) throw fixable('below_pay_floor', 'pay_per_person_usd', 'People on an outside panel are paid: set pay_per_person_usd at or above the floor.', null);
    return null;
  },

  async open(ctx, call, spec) {
    // R15 (trust's final read): the completion code pays the person, so it is random (never derived from the call id, which
    // the study's address carries), kept in pool_ref, and shown only after an answered seat
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const rnd = crypto.getRandomValues(new Uint8Array(12));
    const code = 'HC' + Array.from(rnd, b => A[b % A.length]).join('');
    // the CEO 4:25 AM CT 15 Nov (money/STRANGERS_FOR_CEO.md): a person who stops early is paid, and on Prolific only a code
    // pays; this second code is reviewed, and the router approves each submission that carries it (reconcilePool)
    const rnd2 = crypto.getRandomValues(new Uint8Array(12));
    const stopCode = 'HS' + Array.from(rnd2, b => A[b % A.length]).join('');
    const study = await ctx.fetch('POST', '/studies/', {
      name: `A short task: ${spec.kind} (${spec.minutes} min)`,
      description: `<p>An AI agent is asking, for ${ctx.principalName}. ${escapeHtml(spec.ask)}</p><p>You answer in your own words on our page; nothing asks for your name or contact. Typed answers only.</p>`,
      external_study_url: ctx.arrivalUrl + '?pid={{%PROLIFIC_PID%}}&study={{%STUDY_ID%}}&session={{%SESSION_ID%}}',
      prolific_id_option: 'url_parameters',
      completion_codes: [{ code, code_type: 'COMPLETED', actions: [{ action: 'AUTOMATICALLY_APPROVE' }] },
        { code: stopCode, code_type: 'OTHER', actions: [{ action: 'MANUALLY_REVIEW' }] }],
      total_available_places: spec.people,
      estimated_completion_time: Math.max(1, Math.round(spec.minutes)),
      maximum_allowed_time: Math.ceil(2 + 2 * spec.minutes + 2 * Math.sqrt(spec.minutes)),
      reward: spec.pay_cents,
      device_compatibility: ['mobile', 'tablet', 'desktop'],
      peripheral_requirements: ['listen', 'watch'].includes(spec.kind) ? ['audio'] : [],
      metadata: call.id,
    });
    await ctx.fetch('POST', `/studies/${study.id}/transition/`, { action: 'PUBLISH' });
    return { ref: { study_id: study.id, code, stop_code: stopCode } };
  },

  // What happened since the last look. In recorded mode the recorded participants "arrive" on a schedule.
  async poll(ctx, call, ref) {
    if (ctx.mode === 'recorded') {
      // a team check of the arrival path asks the recorded stand-ins to stay away, so only its own posted arrivals come
      try { const sp = JSON.parse(call.spec_json || '{}'); if (sp.ext && sp.ext.recorded_arrivals === 'none') return { arrivals: [], submissions: [] }; } catch { }
      const since = (ctx.now() - call.created_at) / 1000;
      const arrivals = RECORDED.participants.filter(p => p.arrive_after_seconds <= since).map(p => ({ pid: p.participant_id, script: p.script, recorded: true }));
      return { arrivals, submissions: [] };
    }
    const subs = await ctx.fetch('GET', `/studies/${ref.study_id}/submissions/`);
    return { arrivals: [], submissions: (subs.results || []).map(x => ({ id: x.id, pid: x.participant_id, status: x.status, code: x.entered_code || null })) };
  },

  // The person is done: send them back to Prolific with our code. Completed jobs are approved automatically by the code's
  // action; the router never rejects (the adapter has no reject operation at all).
  async finish(ctx, call, ref, how) { return { completion_url: COMPLETE + encodeURIComponent(how === 'stopped' && ref.stop_code ? ref.stop_code : ref.code) }; },

  async close(ctx, call, ref) {
    try { await ctx.fetch('POST', `/studies/${ref.study_id}/transition/`, { action: 'STOP' }); } catch (e) { ctx.log('prolific close: ' + e.message); }
  },
};

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// The transport: recorded (a lookup in the recorded file) or live (Prolific's interface).
// token: the principal's own token on its own account (pools/accounts.js), else ours from the environment.
export function transport(env, mode, token = null) {
  if (mode === 'live') {
    return async (method, path, body) => {
      const r = await fetch(BASE + path, { method, headers: { Authorization: 'Token ' + (token || env.PROLIFIC_TOKEN), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`prolific ${method} ${path}: HTTP ${r.status}`);
      return r.json();
    };
  }
  return async (method, path) => {
    const key = method + ' ' + path.replace(/\/studies\/[^/]+\//, '/studies/{id}/').replace(/\/submissions\/[^/]+\/transition\//, '/submissions/{id}/transition/');
    const r = RECORDED.responses[key];
    if (!r) throw new Error('no recorded answer for ' + key);
    return JSON.parse(JSON.stringify(r));
  };
}

// The adapter carries its transport, so the router needs no edit for a new pool (ADAPTERS.md step 3).
adapter.transport = transport;
