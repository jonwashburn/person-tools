// Screening, version 1 (rules only). Policy: policy/POLICY.md. Cases: ./cases.json (run ./check.mjs).
//
// screen(call, ctx) reads a call body before anyone is rung and returns { decision: "ALLOW" | "REFUSE" | "HOLD", ... }.
// It never throws: any error becomes HOLD. Anything it cannot decide is HOLD. It reads both call shapes the router
// accepts (ROUND0 nested: experience/respond/who/pay; flat: kind/content/people/answer_fields/age/can).
//
// ctx (all optional; the defaults are the cautious ones):
//   pool_real:          true when a real person could be rung (not the simulated pool, not team-test). Default true.
//   principal_is_ours:  true for the team's and owner's own principals. Default false.
//   principal_new:      true when the principal has no completed paid call in an earlier 30-day window. Default true.
//   accepts_content_url: true when the router copies a material URL into our storage before ringing. Default true.

import { withModelRead } from "./model_read.js";
import { withMaterialRead } from "./material_read.js";
export const SCREENING_VERSION = "1.5.0-rules";
export const VERSION = SCREENING_VERSION;

const KINDS = ["listen", "watch", "view", "play", "compare", "answer"];
const STOP = "Stop and tell your user: this call cannot be made through this service, and rewording it will not change that.";
const REVIEW_PROMISE = "reviewed by the operator within three days";

// ---------- the rule registry (one record: POLICY.md, the refusal text and the spec's registry read from here) -------
export const RULES = {
  // Refused, not fixable (POLICY.md section 1)
  accounts:                { outcome: "REFUSE", fixable: false, section: "1", what: "Making or verifying accounts (sign-ups, account checks, solving a CAPTCHA) is not allowed." },
  credentials:             { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not involve one-time codes, passwords, PINs, keys, government ID numbers, or card or bank account numbers." },
  paid_engagement:         { outcome: "REFUSE", fixable: false, section: "1", what: "Paid follows, likes, reviews, posts or testimonials are not allowed." },
  impersonation:           { outcome: "REFUSE", fixable: false, section: "1", what: "A person may not be asked to pose as someone else." },
  third_party_contact:     { outcome: "REFUSE", fixable: false, section: "1", what: "A person may not be asked to contact anyone else (call, text, email, message, ask)." },
  personal_data_of_others: { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not collect personal data about named or pictured people." },
  off_platform:            { outcome: "REFUSE", fixable: false, section: "1", what: "A person may not be moved to another platform (join, download, install, follow, message elsewhere)." },
  sexual_or_minors:        { outcome: "REFUSE", fixable: false, section: "1", what: "Nothing sexual, and nothing involving minors." },
  ban_evasion:             { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not help anyone get round a ban, a block, a limit or a bot check." },
  scam_or_deception:       { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not test or carry a scam or a deception, or move money for anyone." },
  physical_world:          { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not send a person to do anything in the physical world." },
  minor_target:            { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not reach anyone under 18. This service reaches adults only; a call whose selectors reach adults only (age 18 or over) is allowed if your user agrees to that." },
  voice_misuse:            { outcome: "REFUSE", fixable: false, section: "1", what: "Nobody may clone a voice, identify a speaker, or train speech models on a recording." },
  harassment:              { outcome: "REFUSE", fixable: false, section: "1", what: "Calls may not threaten, harass or demean anyone." },
  // Not allowed in the first version (POLICY.md section 3)
  v1_violent:              { outcome: "REFUSE", fixable: false, section: "3", what: "Violent material is not allowed in this version, warned or not." },
  v1_sexual:               { outcome: "REFUSE", fixable: false, section: "3", what: "Sexual material is not allowed in this version, warned or not." },
  v1_medical:              { outcome: "REFUSE", fixable: false, section: "3", what: "Medical material (surgery, wounds, injuries, medical images) is not allowed in this version, warned or not." },
  v1_grief:                { outcome: "REFUSE", fixable: false, section: "3", what: "Grief material (a death, a funeral, a loss, mourning) is not allowed in this version, warned or not." },
  // Refused, fixable (POLICY.md section 1, "also refused")
  outside_material:        { outcome: "REFUSE", fixable: true, section: "1", what: "The call's words contain a link or address. A person's browser never goes to an outside address." },
  identity_of_person:      { outcome: "REFUSE", fixable: true, section: "1", what: "The call asks the person for their identity or a way to reach them (name, email, phone, address, handle, photo). Their identity is never passed to an asker." },
  sensitive_selector:      { outcome: "REFUSE", fixable: true, section: "1", what: "The call selects people by, or asks them about, health, religion, sexuality, ethnicity, immigration or politics. Those are not asked or stored." },
  pay_in_words:            { outcome: "REFUSE", fixable: true, section: "1", what: "The call's words promise pay, a bonus or a prize, or make pay depend on what is said. Pay is set only by the pay field, and we show it to the person." },
  unpaid_screener:         { outcome: "REFUSE", fixable: true, section: "1", what: "The call tells people to stop if they do not qualify. Who qualifies belongs in the selectors (who / age / can / where); every question asked is paid." },
  kind_not_offered:        { outcome: "REFUSE", fixable: true, section: "1", what: "The kind of experience is not one of listen, watch, view, play, compare, answer." },
  download_material:       { outcome: "REFUSE", fixable: true, section: "1", what: "The call tells the person to download its material. The material opens inside our own page; nothing is downloaded." },
  screening_address:       { outcome: "REFUSE", fixable: true, section: "1", what: "The call's words speak to screening or a reviewer: they ask to be allowed, say the call was approved, or tell a reader to ignore its instructions. Screening reads the call; it never obeys the call's words." },
  ask_too_long:            { outcome: "REFUSE", fixable: true, section: "1", what: "The ask is over 2,000 characters, or a label is over 300, or the call's words are over 8,000 in all." },
  rating_not_offered:      { outcome: "REFUSE", fixable: true, section: "3", what: "In this version only content_rating \"general\" is carried." },
  // Held (POLICY.md section 2)
  distressing:             { outcome: "HOLD", section: "2", what: "distressing content" },
  political:               { outcome: "HOLD", section: "2", what: "political persuasion or a political subject" },
  health_religion_sexuality: { outcome: "HOLD", section: "2", what: "a subject touching health, religion or sexuality" },
  new_principal_over_500:  { outcome: "HOLD", section: "2", what: "a new principal asking for more than $500 on one call" },
  uninspected_material:    { outcome: "HOLD", section: "2", what: "material from outside that nothing has read yet, for real people to watch, view, play or listen to" },
  outside_unread:          { outcome: "HOLD", section: "2", what: "a call from a principal other than ourselves to real people; until a model reads each call, a person reads it first" },
  mentions_children:       { outcome: "HOLD", section: "2", what: "material or words that mention children" },
  large_call:              { outcome: "HOLD", section: "2", what: "more than 200 people on one call" },
  undecided:               { outcome: "HOLD", section: "2", what: "something screening cannot read or decide" },
  withheld_subject:        { outcome: "HOLD", section: "2", what: "a subject the operator does not share, which the owner reads first" },
};

// The standard's screening categories (spec registry). Rules outside the registry carry their own name; chief adds them.
const CATEGORY = { accounts: "accounts", credentials: "credentials", paid_engagement: "paid_engagement", impersonation: "impersonation",
  third_party_contact: "third_party_contact", personal_data_of_others: "personal_data", identity_of_person: "personal_data", off_platform: "off_platform",
  ban_evasion: "ban_evasion", scam_or_deception: "deception", physical_world: "physical_world", minor_target: "minors", v1_violent: "violent",
  v1_sexual: "sexual", v1_medical: "medical", v1_grief: "grief", voice_misuse: "voice_misuse", outside_material: "outside_material",
  sensitive_selector: "sensitive_data", pay_in_words: "call_terms", unpaid_screener: "unpaid_screener", kind_not_offered: "call_terms", screening_address: "deception", download_material: "call_terms",
  ask_too_long: "call_terms", rating_not_offered: "call_terms", harassment: "harassment" };
function categoryOf(f, fired) {
  if (f.rule === "sexual_or_minors") return fired.some((x) => x.rule === "v1_sexual") ? "sexual" : "minors";
  return CATEGORY[f.rule] || f.rule;
}

// ---------- text helpers ----------
const HOMOGLYPHS = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
  "ԁ": "d", "ɡ": "g", "һ": "h", "ӏ": "l", "ո": "n", "ν": "v", "ο": "o", "α": "a", "ε": "e", "ρ": "p", "τ": "t", "ι": "i",
  "κ": "k", "μ": "u", "ѡ": "w", "ԛ": "q", "ᴀ": "a", "ʀ": "r", "ꜱ": "s" };
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "9": "g", "@": "a", "$": "s", "!": "i", "|": "l" };
const HIDDEN = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/;
const NON_LATIN_LETTER = /[Ͱ-ϿЀ-ԯ԰-֏֐-׿؀-ۿऀ-෿฀-໿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/g;

// For checks on short names (OWN_PANELS rule 12; ATTACK_7: "Bаnk" with a Cyrillic a, "Acc0unt Services" passed): the
// screen's own folding (homoglyphs, accents, case) plus digits and symbols read as letters. Exported for the router.
export function foldForNames(s) {
  return fold(String(s || "")).replace(/[0]/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s").replace(/7/g, "t").replace(/8/g, "b").replace(/[^a-z0-9.\s-]/g, " ").replace(/\s+/g, " ").trim();
}
// A web address in a short name: letters, a dot, letters ("maple.example", "maple . games" spaced too).
export const NAME_ADDRESS_RX = /[a-z0-9-]\s*\.\s*[a-z]{2,}/;
function fold(s) {
  let t = String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.toLowerCase().replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"').replace(/[‐-―]/g, "-");
  t = t.replace(/[^\u0000-\u007F]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  t = t.replace(/\b(?:u|ya)\b/g, "you").replace(/\b(?:ur|yr)\b/g, "your").replace(/\bwud\b/g, "would").replace(/\bcud\b/g, "could").replace(/\bshud\b/g, "should")
    .replace(/\btxt\b/g, "text").replace(/\bmsg\b/g, "message").replace(/\b(?:pls|plz)\b/g, "please").replace(/\bppl\b/g, "people").replace(/\b(?:cuz|coz)\b/g, "because")
    .replace(/\bb4\b/g, "before").replace(/(?<=[a-z]) n (?=[a-z])/g, " and ");
  return t.replace(/\s+/g, " ").trim();
}
function deleet(t) {
  return t.split(" ").map((w) => (/[a-z]/.test(w) && /[0134579@$!|]/.test(w.replace(/^[0-9$]+[.,]?[0-9]*$/, "")) ? w.replace(/[0134579@$!|]/g, (c) => LEET[c]) : w)).join(" ");
}
const wb = (alts) => new RegExp(`\\b(?:${alts.join("|")})\\b`, "i");
// The operator's own rule: subjects that are never shared. The list is not in this source: it lives in the service's database
// (read at run time) and comes in as ctx.withheld_terms (patterns). With no list, a call to real people
// is held (the check fails closed). Exported for task_bounds.js.
const WITHHELD_CACHE = { key: null, rx: [] };
export function withheldRegexps(terms) {
  const list = Array.isArray(terms) ? terms.filter((x) => typeof x === "string" && x) : [];
  const key = list.join("\u0001");
  if (WITHHELD_CACHE.key !== key) WITHHELD_CACHE.rx = list.map((x) => { try { return new RegExp(`\\b(?:${x})\\b`, "i"); } catch { return null; } }).filter(Boolean), WITHHELD_CACHE.key = key;
  return WITHHELD_CACHE.rx;
}

// Clause starts, for verbs that are only a problem when they are an instruction ("download the app"),
// not when they are a question ("would you download this app?"). FILLER strips what may come before the verb.
const FILLER = /^(?:(?:\(\d{1,2}\)|\([a-z]\)|\(|before (?:then|that|you answer)|later(?: on)?|tonight|tomorrow|today|as you go|along the way|while you (?:go|play|listen|watch|read|scroll)|please|kindly|then|and|so|first|next|now|also|just|after that|afterwards|finally|lastly|go ahead and|make sure (?:to|you)|be sure to|remember to|try to|you(?:'ll| will| would| must| should| need to| have to| will need to| can|'ll need to| are to| are asked to)|i'd like you to|we'd like you to|i'd love (?:it )?if you(?: could)?|could you|can you|would you please|will you|we need you to|i need you to|i want you to|we want you to|i'd like you to|we'd like you to|your (?:task|job) is to|the task is to|the next step is to|task|step \d+|\d+[.)]|[-*•])[\s,:]+)+/;
// A period inside a web address ("person.tools") or a number ("3.5") does not end a sentence (owner, 14 Nov 2026).
const INNER_DOT = /(?<=[a-z0-9-])\.(?=(?:com|org|net|io|ai|tools|app|dev|co|us|uk|tv|fm|gg|xyz|info|site|page|link)\b(?![.-]?[a-z]))|(?<=\d)\.(?=\d)/g;
function clauses(t) {
  return t.replace(INNER_DOT, "\u00b7").split(/[.!?;:\n]+|,\s*(?:then|and then|and)\s+|\s+(?:and then|then)\s+/).map((c) => c.trim().replace(/^\((?![a-z0-9]{1,2}\))/, "").replace(FILLER, "").trim()).filter((c) => /[a-z0-9]/.test(c));
}

// ---------- the word rules ----------
// Each rule is [rule, regex, scope, mode]. scope: "all" | "who" (selectors) | "ask" (everything but selectors).
// mode: "any" matches anywhere; "imp" matches only at the start of a clause, i.e. as an instruction to the person
// ("download the app"), never as a question about them ("would you download this app?").
const R = [];
const add = (rule, re, scope = "all", mode = "any") => R.push([rule, mode === "imp" ? new RegExp(`^(?:${re.source})`, "i") : re, scope, mode]);
const imp = (rule, alts, scope = "all") => add(rule, new RegExp(alts.join("|"), "i"), scope, "imp");
const PEOPLE = "(?:your|this|that|the|an?|my|our|their|his|her)?\\s*(?:(?:best|close|old|good|oldest|closest|work|school|new|other|two|three|some|few|couple of|favou?rite)\\s+){0,2}(?:friends?|mates?|pals?|buddies|family|mom|mum|mother|dad|father|parents?|boss|manager|colleagues?|co-?workers?|neighbou?rs?|partner|spouse|wife|husband|landlord|doctor|dentist|office|clinic|store|shop|company|business|restaurant|hotel|bank|school|teacher|police|number|someone|somebody|people you know|contacts|customer service|support line|hotline|representative|owner|roommates?|relatives?|grandparents?|others|another person)\\b";

// credentials. Asking for one, or a person's own, is refused; a credential merely mentioned (an explanation of one-time
// codes, a password-strength meter) is held for a human (the standard's fixtures, spec/screening_fixtures.json).
const CRED_NOUN = "(?:pass ?words?|passcodes?|pass ?phrases?|pins?|pin (?:code|number)s?|one[- ]?time (?:codes?|passwords?|pins?|passcodes?|links?)|otps?(?: codes?)?|2fa(?: codes?)?|two[- ]?(?:factor|step) codes?|(?:verification|security|auth(?:entication)?|login|log-in|sign[- ]?in|confirmation|sms|text(?:ed)?|access|reset|recovery|backup|authenticator) codes?|\\d[- ]?digit (?:codes?|numbers?|pins?)|seed (?:phrase|words)|recovery (?:phrase|words)|mnemonic phrase|private keys?|secret keys?|api[- ]?keys?|access tokens?|session (?:tokens?|cookies?)|auth tokens?|credentials|cvv|cvc|card numbers?|credit card (?:numbers?|details|info\\w*)|social security (?:numbers?|no)|ssn|bank (?:account|routing) (?:numbers?|details)|routing numbers?|(?:login|log-in|sign[- ]?in|account) (?:details|info\\w*)|magic links?|confirmation numbers?)";
const NOT_REAL = "(?<!(?:made[- ]up|fake|dummy|test|sample|example|pretend|random|imaginary|any|a real-looking|not a real|not your real|not an actual|not your actual) )";
const NOT_NEG = "(?<!(?:don'?t|do not|never|no need to|without|not|nothing to|please don'?t) )";
add("credentials", new RegExp(`${NOT_NEG}\\b(?:type|enter|send|give|tell|read|share|paste|forward|text|write|provide|submit|show|say|reveal|copy|post|upload|note down|write down|let us (?:have|know)|need|want|ask(?:ing)? for|collect|confirm)\\b(?:(?!\\b(?:a |an )?(?:made[- ]up|fake|dummy|test|sample|example|pretend|random|imaginary)\\b)[^.!?]){0,40}\\b${NOT_REAL}${CRED_NOUN}\\b`, "i"));
add("credentials", new RegExp(`\\b(?:your|my|their|his|her|the person'?s|someone'?s|people'?s|ur)\\s+(?:\\w+\\s+)?(?:${CRED_NOUN}|logins?|log-ins?)\\b`, "i"));
add("credentials", new RegExp(`\\b${CRED_NOUN}\\b[^.!?;]{0,40}\\b(?:you(?:'ll| will)? (?:receive|get|got)(?! stuck| lost| confused| to| there)|we (?:just )?sen[dt]|arrives?|on your (?:phone|screen|card|device))`, "i"));
add("credentials", new RegExp(`\\b(?:you(?:'ll| will)? (?:get|receive)|we(?:'ll| will)? send you)\\b[^.!?]{0,25}\\b${CRED_NOUN}`, "i"));
add("credentials", wb(["password (?:is|was|to)", "(?:read|send|tell|give|forward|share|text) (?:me |us )?(?:the |that |this |your )?code"]));
add("undecided", new RegExp(`\\b${CRED_NOUN}\\b`, "i"));
// accounts
imp("accounts", ["(?:create|make|open|set ?up|register|sign ?up for|verify|confirm|validate|activate|warm ?up)\\b[^.!?]{0,40}\\b(?:accounts?|gmail|email address(?:es)?|e-mail address(?:es)?|usernames?|logins?|profiles?)\\b"]);
add("accounts", wb(["captchas?", "recaptchas?", "hcaptchas?", "(?:account|phone|identity|id) verification", "phone[- ]verified", "pvas?",
  "aged accounts?", "(?:buy|sell|rent|trade) (?:an? |the |your |my )?accounts?", "verify (?:your|my|their|an?|the) (?:identity|phone|number|account)",
  "accounts? (?:creation|farm\\w*|for sale)", "(?:new|fresh|bulk) accounts"]));
// red-team set 12 (14 Nov 2026): who lives somewhere and their numbers; a scam's working part asked as a question
add("personal_data_of_others", wb(["who (?:lives|is living|stays) at", "lives at \\d+", "(?:phone|mobile|cell) numbers? (?:you'?ve|you have|you'?d) (?:seen|got|found|heard) for (?:them|him|her|the)", "(?:home )?address(?:es)? (?:you'?ve|you have) (?:seen|got|found) for (?:them|him|her)"]));
add("scam_or_deception", wb(["(?:believe|think|trust) (?:it'?s|its|it is|that it'?s|that it is) (?:really|actually|genuinely|truly) (?:your|my|the|from|a)", "(?:line|part|bit|moment|thing|sentence|word)s? (?:that )?(?:nearly|almost|would have|that) (?:got|fooled|convinced|hooked|had|tricked) you"]));
add("off_platform", wb(["continue in (?:the |our )?(?:app|application)", "(?:reach|play|finish|continue|carry on)\\b[^.!?]{0,30}\\bin the (?:app|application)\\b"]));
add("paid_engagement", wb(["leave it (?:up|posted|pinned|live|on (?:your|the) (?:story|feed|page|profile))", "(?<!would you )(?:add|post|put|share|upload) (?:it|this|them) (?:to|on|in) (?:your|their) (?:story|stories|feed|timeline|wall|status|profile|page)"]));
add("third_party_contact", wb(["(?<!would you |would |you'd |could you )ask (?:a|an|your|one of your|some) (?:[a-z]+ )?(?:friends?|flatmates?|roommates?|room-mates?|partner|housemates?|coworkers?|co-workers?|colleagues?|neighbou?rs?|family|relatives?|parents?|siblings?|brother|sister|mum|mom|dad|boss|someone|people)\\b"]));
add("paid_engagement", wb(["rate (?:it|this|us|the (?:game|app|song|track|book|product|place))\\b[^.!?]{0,25}\\b(?:in|on) (?:the )?(?:app store|play store|google play|store|steam|amazon|yelp|google)", "(?:do|leave|give) (?:that|it|one) with (?:5|five) stars"]));
add("impersonation", wb(["(?:answer|reply|respond|sign|write)(?: it| back)? as (?:her|him|them|she|he|ms\\.?|mr\\.?|mrs\\.?|dr\\.?)\\b(?! (?:you|yourself)\\b)"]));
// paid engagement
add("paid_engagement", wb(["upvot\\w*", "downvot\\w*", "karma farm\\w*", "tap (?:the |a )?heart", "double[- ]tap", "help (?:our|my|the) (?:page|account|channel|profile|post|brand) grow", "(?:boost|grow) (?:our|my) (?:followers|following|engagement|views|likes)", "testimonials?", "fake reviews?", "paid reviews?", "review swap\\w*",
  "(?<!would you |would |you'd )(?:give|leave|drop|hit|smash) (?:it |us |me |them |the video |the post )?(?:a )?(?:like|thumbs up)", "like and (?:subscribe|share|follow|comment)",
  "(?:leave|give|post|write) (?:us |me |them )?(?:an? )?(?:5|five)[- ]star", "(?:5|five)[- ]star (?:reviews?|ratings?) (?:on|at|in|for)",
  "(?:leave|write|post|give|submit|publish|add) (?:us |me |them )?(?:a |an |your )?(?:honest |positive |good |short )?(?:review|rating)s? (?:on|at|in|to|for us on) (?:the )?(?:app store|play store|google|yelp|amazon|trustpilot|tripadvisor|g2|capterra|glassdoor|steam|our (?:website|site|page|store|listing)|the (?:website|site|store|listing))"]));
add("paid_engagement", /\b(?:quote|publish|post|feature|use|share)\b[^.!?]{0,30}\b(?:your|the|these) (?:answers?|words|responses?|feedback|reviews?|comments?)\b[^.!?]{0,30}\b(?:on|in) (?:our|the|a) (?:website|site|page|ads?|advert\w*|marketing|social|store|listing|campaign)/i);
imp("paid_engagement", ["(?:like|follow|subscribe to|retweet|repost|share|star|upvote|comment on|react to)\\b[^.!?]{0,30}\\b(?:our|my|the|this|their|his|her)\\b[^.!?]{0,20}\\b(?:account|page|channel|profile|post|tweet|video|repo|repository|reel|tiktok|instagram|youtube|twitter|facebook|reddit|thread|listing|podcast|playlist)\\b",
  "follow (?:us|me|them|him|her|our|my|their|the account|this account|@\\w+)", "subscribe to (?:our|my|their|the|this)",
  "(?:post|tweet|publish|share|upload|comment)\\b[^.!?]{0,25}\\b(?:on|to) (?:twitter|x|instagram|tiktok|facebook|reddit|linkedin|youtube|threads|bluesky|your (?:feed|story|timeline|profile|account|socials?|social media|wall))\\b",
  "(?:tweet|retweet|repost)\\b"]);
// impersonation
add("impersonation", wb(["impersonat\\w*", "pose as", "posing as", "pass yourself off", "identity proxy", "fake (?:names?|identit\\w*|personas?|profiles?)",
  "(?:in|under|using) (?:his|her|their|my|our|a fake|a different|another person'?s|someone else'?s) name",
  "pretend(?:ing)? (?:to be|you are|you're) (?:someone|somebody) else", "pretend(?:ing)? to be (?:from|with) (?:the|a|an|our|my|their)",
  "pretend(?:ing)? (?:to be|you are|you're) (?:the|a|an|my|our) (?:bank|police|officer|official|representative|agent|support|irs|government|account holder|owner|employee)",
  "as if you (?:are|were) (?:him|her|them|me|my \\w+|the (?:account holder|candidate|applicant|owner))", "on (?:my|his|her|their|our) behalf"]));
add("impersonation", /\b(?:interview|call|meeting|exam|chat|zoom|video call|phone call|test)\b[^.!?]{0,30}\bas\s+(?!a\b|an\b|the\b|if\b|well\b|you\b|yourself\b|usual\b|normal\b|much\b|long\b|soon\b)[a-z]+\s*(?:[.!?,]|$|and\b|to\b|for\b)/i);
// third-party contact
imp("third_party_contact", [`(?:call|phone|ring|text|sms|email|e-mail|message|dm|contact|reach out to|write to|ask|tell|invite|refer|forward (?:it|this) to|show (?:it|this) to)\\s+${PEOPLE}`,
  "(?:call|phone|text|email|e-mail|message|contact|dm)\\s+(?:me|us|him|her|them)\\b", "ask (?:around|people around you|others)"]);
add("third_party_contact", /\b(?:call|phone|text|dial|ring|sms|whatsapp)\b[^.!?]{0,20}(?:\+?\d[\d\s().-]{6,}\d|\b(?:this|the|that) number\b)/i);
// personal data about others
add("personal_data_of_others", /\b(?:who is|who's|identify|recogni[sz]e|name)\b[^.!?]{0,20}\b(?:this|the|that|these)\s+(?:person|man|woman|guy|girl|boy|people|faces?|individuals?|kid|child|stranger)\b/i);
add("personal_data_of_others", /\b(?:find|look ?up|search for|dig up|get|collect|gather|scrape|compile|tell me|what is|what's)\b[^.!?]{0,40}\b(?:home address|address|phone number|email address|e-mail address|date of birth|birthday|instagram|facebook|linkedin|workplace|employer|real name|full name|licen[cs]e plate|ssn)\b[^.!?]{0,30}\b(?:of|for|belonging to)\b/i);
add("personal_data_of_others", /\bwhere (?:does|do|did) (?!you\b)\w+(?: \w+)? (?:live|work|stay|go to school)\b/i);
add("personal_data_of_others", /\bwhere (?:he|she|they|this (?:person|woman|man|guy|girl|boy)|that (?:person|woman|man)) (?:lives?|works?|stays?|is staying|goes to school)\b/i);
add("personal_data_of_others", /\bwho (?:this|that|the) (?:person|man|woman|guy|girl|boy|individual|stranger) (?:is|was)\b/i);
add("personal_data_of_others", wb(["dox+(?:ing|ed)?", "people search", "background check on", "track (?:him|her|them|someone|this person) down"]));
// off platform
imp("off_platform", ["(?:join|add (?:me|us)|follow)\\b[^.!?]{0,20}\\b(?:our|my|the|this)?\\s*(?:discord|telegram|whatsapp|signal group|slack|wechat|kik|snapchat|group chat|server|community|mailing list|newsletter|subreddit)\\b",
  "(?:message|contact|reach|email|text|dm|find|add|talk to|chat with)\\s+(?:me|us)\\b[^.!?]{0,20}\\b(?:on|at|via|through|outside|over)\\b",
  "download\\b(?! (?:the |our |this |that )?(?:demo|build|game|file|track|song|video|level|clip|recording)\\b(?![^.!?;]{0,40}\\b(?:from|on|at|via|onto|to your|app|store)\\b))", "(?:install|sideload)\\b", "sign ?up (?:for|on|at|with)\\b", "register (?:for|on|at|with)\\b", "subscribe\\b", "join (?:our|my|the|this)\\b"]);
add("off_platform", wb(["off[- ]platform", "outside (?:of )?(?:this|the) (?:app|site|platform|service|page)", "(?:sideload|jailbreak)\\w*", "apks?"]));
// sexual (the refused rule and the first-version rule both fire)
const SEXUAL = ["sex", "sexual\\w*", "sexy", "sexting", "porn\\w*", "nudes?", "nudity", "erotic\\w*", "nsfw", "fetish\\w*", "kink\\w*", "onlyfans",
  "xxx", "hentai", "lingerie", "strip(?:per|pers|tease)", "escort (?:service|agency|girls?)", "cam ?girls?", "adult (?:content|videos?|sites?|films?|material|entertainment)",
  "orgasm\\w*", "genital\\w*", "penis\\w*", "vagina\\w*", "intercourse", "masturbat\\w*", "horny", "seductive", "sensual\\w*", "bdsm",
  "explicit (?:content|material|images?|photos?|videos?|scenes?)", "topless"];
add("sexual_or_minors", wb(SEXUAL));
add("v1_sexual", wb(SEXUAL));
// minors: a child drawn into the task
imp("sexual_or_minors", ["(?:ask|have|let|get|show (?:it |this |them )?to|play (?:it |this )?with|give (?:it|this) to|read (?:it|this) to)\\s+(?:your|a|the|my)?\\s*(?:kids?|child(?:ren)?|sons?|daughters?|toddlers?|babies|baby|students?|pupils?|grandchild(?:ren)?|nieces?|nephews?|little ones?)\\b"]);
// ban evasion
add("ban_evasion", wb(["ban evasion", "evad(?:e|ing) (?:a |the |my |our |their )?(?:ban|block|filter|detection|limit|moderation)",
  "get(?:ting)? (?:around|round|past) (?:a |the |my |our |their |an? )?(?:ban|block|filter|limit|restriction|captcha|bot check|verification|paywall|detection|moderation)",
  "bypass\\w*", "circumvent\\w*", "unban\\w*", "banned (?:accounts?|users?|from)", "shadow ?ban\\w*", "blocked (?:accounts?|from)",
  "work ?around (?:the |a )?(?:ban|block|limit)", "avoid (?:being )?(?:detected|detection|banned|flagged|caught)", "geo[- ]?block\\w*", "vpns?",
  "(?:residential|rotating) (?:ips?|proxies|proxy)", "proxy (?:ips?|address\\w*|servers?)", "multi[- ]?accounting", "ban appeal"]));
// scam or deception, and moving money
add("scam_or_deception", wb(["phish\\w*", "social engineering", "pig butchering", "deep ?fakes?",
  "fake (?:logins?|log-ins?|sign[- ]?ins?|websites?|sites?|pages?|invoices?|bills?|receipts?|emails?|texts?|messages?|banks?|charit\\w+|giveaways?|prizes?|lotter\\w+|job offers?|ids?|documents?|checks?|cheques?|news|alerts?|notices?|support)",
  "trick (?:someone|people|them|users|victims|customers|him|her|my \\w+)", "deceiv\\w* (?:someone|people|them|users|victims|customers|him|her|my \\w+)",
  "mislead\\w* (?:someone|people|them|users|customers|him|her)", "fool (?:someone|people|them|users|customers|him|her|my \\w+)",
  "(?:look|seem|sound)s? (?:legit|legitimate|real|authentic|official|genuine) enough", "would you fall for",
  "would you (?:enter|type|give|send|share) (?:your|my|the) (?:password|details|login|card|information|info|code|pin|bank)",
  "convincing enough to (?:get|make|trick) (?:someone|people|them|him|her)", "wire (?:money|transfers?|funds|the money)", "western union", "moneygram",
  "bitcoin atm", "money mule", "launder\\w*", "scam (?:script|message|text|email|call)s?", "test (?:a|our|my|this) scam"]));
imp("scam_or_deception", ["send (?:money|bitcoin|btc|crypto\\w*|funds|usdt|eth|a payment|payment|cash)", "(?:transfer|move) (?:money|funds)",
  "(?:buy|purchase|get) (?:a |some |\\d+ )?gift ?cards?"]);
// fixable: "download the demo and play": the material runs on our own page, so the instruction is a slip, not a purpose
const DOWNLOAD_MAT_RE = /\b(?:download|save) (?:the |our |this |that )?(?:demo|build|game|file|track|song|video|level|clip|recording)\b\s*(?:(?:and|then|,)\s*)?/i;
imp("download_material", ["(?:download|save) (?:the |our |this |that )?(?:demo|build|game|file|track|song|video|level|clip|recording)\\b(?![^.!?;]{0,40}\\b(?:from|on|at|via|onto|to your|app|store)\\b)"]);
// physical world
imp("physical_world", ["(?:go|drive|walk|travel|head|run|bike|cycle|commute)\\s+(?:over |down |out )?to\\s+(?:the|a|an|your|this|that|my|our|their|any|some)?\\s*(?:\\w+\\s+)?(?:stores?|shops?|supermarkets?|grocery|groceries|mall|restaurants?|cafes?|coffee shops?|bars?|offices?|buildings?|address|house|home|park|station|locations?|places?|events?|venues?|streets?|corners?|banks?|atms?|post office|pharmacy|pharmacies|schools?|churches|clinics?|hospitals?|gyms?|library|libraries|nearest \\w+)\\b",
  "go (?:outside|out and)", "take (?:a |some |two |three |\\d+ )?(?:photos?|pictures?|pics?|selfies?|videos?|snapshots?)\\b", "snap (?:a )?(?:photo|picture|pic)",
  "photograph (?:the|a|your|this|that|some|any)\\b", "film (?:yourself|your|a|the|it|this|someone)\\b", "deliver\\b", "pick (?:it |this |them |something )?up\\b(?! cold\\b| again\\b| and (?:play|start|try|go)\\b| where you left)",
  "drop (?:it |this |them |something )?off\\b", "(?:buy|purchase) (?:a |an |the |one |some |\\d+ )?\\w+ (?:at|from|in) ", "place an order", "order (?:a |an |one |some |food|online|from)",
  "meet (?:me|us|him|her|them|someone|up|at|in person)", "visit (?:a |an |the |your |this |that |our |my )?(?:local |nearest )?(?:store|shop|restaurant|office|location|place|venue|branch|address|house)",
  "follow (?:him|her|them|this person|someone|that car)"]);
add("physical_world", wb(["pick (?:it |this |them |something )?up from", "stand in line", "wait in line", "knock on (?:the|a|their|his|her|my) doors?", "ring the (?:door ?)?bell",
  "hand out (?:flyers|leaflets)", "put up (?:flyers|posters)", "leave (?:a|the) (?:note|flyer|package|parcel) (?:at|on|for)", "mail (?:a|the|this|it) (?:letter|package|parcel)",
  "(?:check|count|measure|photograph|film|record) (?:the )?(?:shelf|shelves|prices? (?:at|in)|queue|line at|traffic)", "secret shopper", "mystery shop\\w*"]));
// voice misuse
add("voice_misuse", wb(["(?:clon(?:e|es|ed|ing)|synthesi[sz](?:e|es|ed|ing)|replicat(?:e|es|ed|ing)) (?:\\w+ ){0,2}(?:voices?|speech)", "voice ?(?:clon\\w*|prints?|models?|datasets?|biometric\\w*)",
  "(?:train|training|fine[- ]?tun\\w*)\\b[^.!?]{0,30}\\b(?:voice|speech|tts|text[- ]to[- ]speech|asr|speech recognition) (?:models?|systems?|ai)",
  "identify (?:the )?speakers?", "speaker (?:identification|recognition|verification|id)"]));
// first-version material: the plain cases are refused; the words with an ordinary second sense are HOLD (undecided)
add("v1_violent", wb(["murder\\w*", "gore", "gory", "gruesome", "tortur\\w*", "massacre\\w*", "behead\\w*", "decapitat\\w*", "mutilat\\w*", "corpses?",
  "dead bod(?:y|ies)", "public executions?", "execution (?:videos?|footage)", "lynching\\w*", "terroris\\w*", "terror attacks?", "war footage", "battlefields?",
  "combat footage", "fight scenes?", "violen(?:ce|t|tly)", "knife attacks?", "rape", "raped", "rapes", "rapist\\w*", "brutality", "blood and gore",
  "graphic (?:content|images?|videos?|footage|scenes?|violence|injur\\w*)", "self[- ]?harm\\w*", "suicid\\w*", "cutting (?:myself|herself|himself|themselves)",
  "snuff", "gunshot wounds?", "mass shootings?", "school shootings?", "killing (?:people|someone|animals?|him|her|them)"]));
add("v1_medical", wb(["surger(?:y|ies)", "surgical", "x-?rays?", "mri scans?", "ct scans?", "ultrasound (?:images?|scans?|photos?)", "biops(?:y|ies)", "autops(?:y|ies)",
  "lesions?", "open wounds?", "(?:surgical|infected|bleeding|deep|gaping) wounds?", "medical (?:images?|photos?|videos?|procedures?|footage|scans?|records?)",
  "operation (?:videos?|footage)", "(?:knee|hip|heart|brain|eye|dental|back|spine|spinal) (?:surgery|operation|procedure)", "sutures?", "amputat\\w*",
  "injections? (?:videos?|footage)", "needles? (?:videos?|footage|close-?ups?)", "childbirth (?:videos?|footage)"]));
add("v1_grief", wb(["grief", "grieving", "grieve", "grieves", "grieved", "mourn", "mourning", "mourned", "mourners?", "bereave\\w*", "funerals?", "eulog\\w*",
  "obituar\\w*", "memorial service", "condolences?", "passed away", "death of (?:my|our|his|her|their|a)", "deceased",
  "late (?:husband|wife|father|mother|son|daughter|partner|friend|grandmother|grandfather|brother|sister|dad|mom|mum)", "rest in peace",
  "lost (?:my|our|his|her|their) (?:wife|husband|mother|mom|mum|father|dad|son|daughter|child|baby|brother|sister|friend|partner|grandmother|grandfather|grandma|grandpa|dog|cat|pet)",
  "loss of (?:a|my|our|his|her|their) (?:loved one|child|baby|parent|wife|husband|mother|father|pet|friend|son|daughter)",
  "(?:he|she|mom|mum|dad|mother|father|wife|husband|son|daughter|grandma|grandpa|grandmother|grandfather) (?:died|passed)"]));
// fixable: the identity of the person called
add("identity_of_person", /\b(?:your|ur)\s+(?:full |real |first |last |legal |given |family )?(?:name|email|e-mail|email address|phone number|mobile number|cell number|(?:home |street |mailing )?address|zip(?: code)?|postal code|social media|instagram|twitter|tiktok|facebook|linkedin|snapchat|discord|telegram|whatsapp|handle|username|user name|selfie|date of birth|ssn|social security|id number|id card|photo id|driver'?s licen[cs]e|passport|ip address|contact (?:info\w*|details)|bank details)\b/i, "ask");
add("identity_of_person", wb(["(?:send|upload|attach|share) (?:a |your )?(?:selfie|photo of (?:yourself|you)|picture of (?:yourself|you))", "what is your name", "what's your name"]), "ask");
// fixable: pay in words
add("pay_in_words", wb(["bonus (?:pay|payment|money|cash|of)", "(?:win|get|earn|receive|claim) (?:a |an |the |your )?(?:prize|reward|bonus|cash)", "an? \\$\\d+ bonus",
  "extra pay", "paid (?:extra|more|less|only|if|when|double)", "(?:only|not) (?:be )?paid if", "compensat\\w*", "earn (?:\\$|\\d|money|cash|extra)",
  "(?:you will|you'll|you'd|we will|we'll) (?:be )?(?:get|receive|earn|be paid|paid|rewarded|given) (?:\\$|\\d|a bonus|extra|money|cash|a gift)",
  "\\$\\s?\\d+(?:\\.\\d+)? (?:for (?:you|each|every|your)|bonus|reward|if you)", "reward (?:you|for you|if you)", "rewarded", "raffle", "giveaway", "sweepstakes"]), "ask");
// fixable: unpaid screener
add("unpaid_screener", /\b(?:if (?:you are not|you're not|you aren't|you do not|you don't|you have not|you haven't|you never|you did not|you didn't|not)|only (?:continue|proceed|answer|participate|take part|do this|go on) if|unless you)\b[^.!?]{0,80}\b(?:stop|exit|close|leave|quit|return|go back|end|do not continue|don't continue|skip|not eligible|ineligible|disqualif\w*|you can't|you cannot)\b/i, "ask");
add("unpaid_screener", wb(["screener questions?", "screening questions?", "qualif(?:y|ying|ication) (?:questions?|tests?|quiz)", "disqualif\\w*"]), "ask");
add("unpaid_screener", wb(["only (?:continue|proceed|answer|participate|take part|do this|go on|carry on|keep going|answer this) if", "this (?:call|study|survey) is only for (?:people|those) who"]), "ask");
// fixable: words addressed to screening (a call never instructs its own screener, rules or model). Kept narrow: ordinary
// asks say "skip the review step", "mark this email as safe", "approved by the ethics board", "tap Allow".
const SCREENER = "(?:screen(?:ing|er|ers)(?: model)?|moderat(?:or|ors|ion)|classifier|safety (?:team|check|checker|system|model)|content check(?:er)?|llm|ai checker)";
const SCREENER_RE = wb(["(?:ignore|disregard|override) (?:all |any |the |your |these )?(?:previous|prior|above|earlier|preceding|system|safety|screening) (?:instructions?|rules?|prompts?|messages?|guidelines?|policy|policies)",
  `(?:note|message|instructions?|memo) (?:to|for) (?:the |any |our )?${SCREENER}`,
  `(?:dear |hey |hi )?(?:${SCREENER}|reviewers?|the model)\\s*[:,]\\s*(?:please |kindly )?(?:allow|approve|pass|ignore|skip|mark|let)`,
  "(?:this|the) (?:call|ask) (?:is|was|has been|has already been) (?:already )?(?:pre-?)?(?:approved|cleared|allowed|whitelisted|vetted|authori[sz]ed)",
  `pre-?(?:approved|cleared|vetted) by (?:the |our )?(?:service|operator|${SCREENER})`,
  `(?:the )?${SCREENER} (?:must|should|will|is to|needs to) (?:answer allow|allow|approve|pass|mark|let)`,
  "mark (?:this|the) (?:call|ask) (?:as )?(?:safe|allowed|approved|benign|harmless|ok)",
  `(?:no need|do not need|don't need|not necessary) to (?:hold|screen|moderate) (?:this|it)`, `(?:skip|bypass|override) (?:the )?${SCREENER}`]);
add("screening_address", SCREENER_RE);
// fixable: sensitive selectors (who / age / can / where) and questions about the person's own sensitive traits
const SENSITIVE = ["health\\w*", "medical", "diagnos\\w*", "disabilit\\w*", "disabled", "pregnan\\w*", "illness\\w*", "medical conditions?", "mental", "depress\\w*",
  "anxiety", "adhd", "autis\\w*", "diabet\\w*", "relig\\w*", "christian\\w*", "catholic\\w*", "muslim\\w*", "islam\\w*", "jew", "jews", "jewish", "hindu\\w*",
  "buddhis\\w*", "sikh\\w*", "atheis\\w*", "church\\w*", "faith\\w*", "gay", "lesbian\\w*", "bisexual\\w*", "lgbt\\w*", "queer", "trans", "transgender", "nonbinary",
  "non-binary", "sexual\\w*", "straight", "ethnic\\w*", "races?", "racial", "black", "white", "asian", "hispanic", "latin[oax]s?", "african american",
  "caucasian", "native american", "indigenous", "arab", "immigra\\w*", "citizen\\w*", "visas?", "green card", "undocumented", "refugees?", "asylum",
  "nationalit\\w*", "national origin", "politic\\w*", "political part(?:y|ies)", "party (?:members?|affiliation)", "democrats?", "republicans?", "voters?",
  "liberals?", "conservatives?", "union members?"];
add("sensitive_selector", wb(SENSITIVE), "who");
add("sensitive_selector", /\b(?:your|ur)\s+(?:religion|religious (?:views|beliefs)|faith|ethnicity|race|sexual orientation|sexuality|gender identity|political (?:views|party|affiliation|leanings?)|immigration status|citizenship|health (?:conditions?|status|history)|diagnos\w*|disabilit\w*|medications?|mental health)\b/i, "ask");
add("sensitive_selector", /\bare you (?:gay|lesbian|bisexual|straight|trans\w*|christian|muslim|jewish|hindu|buddhist|atheist|religious|a (?:democrat|republican|citizen|christian|muslim|immigrant)|disabled|pregnant|an immigrant|undocumented)\b/i, "ask");
// held: subjects (PLAN.md section 6)
add("distressing", wb(["abus(?:e|ed|es|ing|ive)", "addict\\w*", "overdos\\w*", "relapse\\w*", "trauma\\w*", "ptsd", "disturbing", "upsetting", "distressing", "scary",
  "frightening", "terrifying", "creepy", "nightmares?", "cruel\\w*", "harass\\w*", "bully\\w*", "racis\\w*", "hate speech", "slurs?", "homeless\\w*", "starv\\w*",
  "famine", "refugees?", "disasters?", "death", "deaths", "dead", "die", "(?<!you )died", "dying", "war", "wars", "warfare", "genocide", "holocaust", "slavery",
  "domestic violence", "eating disorders?", "anorexi\\w*", "bulimi\\w*", "hostage\\w*", "kidnap\\w*", "prisons?", "(?<!true[- ]|(?:show|podcast|series|documentary|book|novel|channel|genre)s? about (?:real |true )?)crimes?", "criminal\\w*", "riots?"]));
add("political", wb(["vote for (?:a |the )?(?:candidate|party|president|senator|mayor|governor|him|her|them|measure|proposition|prop)", "(?:your|their|people'?s|my|his|her) votes?",
  "running for (?:office|mayor|governor|council|congress|senate|president|re-?election)", "city council", "school board", "(?:a|the|this|our) candidate'?s?","voters?", "voting (?:rights|intentions?|booths?)",
  "elections?", "electoral", "re-?elect\\w*", "ballots?", "candidates? for", "politic\\w*", "democrats?", "republicans?", "left[- ]wing", "right[- ]wing", "maga",
  "trump", "biden", "kamala", "obama", "congress\\w*", "senat(?:e|or|ors)", "governors?", "mayors?", "presidents?", "presidential", "prime minister", "parliament\\w*",
  "legislat\\w*", "referend\\w*", "propaganda", "partisan", "gop", "dnc", "rnc", "super pac", "abortion", "gun control", "immigra\\w*", "border wall", "protests?",
  "protesters?", "activis\\w*", "petitions?", "(?:political|election|presidential|electoral) campaigns?", "campaign (?:ads?|speech|slogans?)", "liberals", "conservatives",
  "socialis\\w*", "communis\\w*", "fascis\\w*"]));
add("health_religion_sexuality", wb(["health\\w*", "medical", "medicine\\w*", "medication\\w*", "diagnos\\w*", "symptoms?", "diseases?", "illness\\w*", "doctors?",
  "nurses?", "hospitals?", "clinics?", "therap\\w*", "mental", "anxiety", "anxious", "depress\\w*", "adhd", "autis\\w*", "disabilit\\w*", "disabled", "wheelchairs?",
  "diets?", "dieting", "weight loss", "obes\\w*", "pregnan\\w*", "fertility", "ivf", "menstru\\w*", "period tracker", "vaccin\\w*", "covid\\w*", "hiv", "cancer",
  "diabet\\w*", "drugs?", "alcohol\\w*", "sobriety", "sober", "smoking", "smokers?", "cigarettes?", "vaping", "vapes?", "cannabis", "marijuana", "meditat\\w*",
  "insomnia", "supplements?", "pharma\\w*", "contracepti\\w*", "injur(?:y|ies|ed)", "wounds?", "infect(?:ed|ion|ions)", "rash(?:es)?", "relig\\w*", "church\\w*",
  "mosques?", "temples?", "synagogues?", "god", "gods", "goddess\\w*", "jesus", "christ", "christian\\w*", "catholic\\w*", "protestant\\w*", "evangelic\\w*",
  "muslims?", "islam\\w*", "jews?", "jewish", "judaism", "hindu\\w*", "buddhis\\w*", "sikh\\w*", "atheis\\w*", "agnostic\\w*", "bibles?", "biblical", "quran",
  "koran", "torah", "prayers?", "pray(?:ing|ed|s)?", "worship\\w*", "hymns?", "gospel", "spiritual\\w*", "faith\\w*", "sermons?", "ramadan", "christmas", "easter",
  "hanukkah", "diwali", "sexualit\\w*", "sexual orientation", "gay", "lesbian\\w*", "bisexual\\w*", "lgbt\\w*", "queer", "transgender", "nonbinary", "non-binary",
  "gender identity", "pronouns", "coming out", "dating", "hookups?", "tinder", "grindr", "bumble", "hinge app", "bikinis?", "swimwear", "underwear"]));
add("mentions_children", wb(["child", "children", "kids?", "minors?", "teens?", "teenagers?", "tweens?", "underage", "toddlers?", "babies", "infants?",
  "preschool\\w*", "kindergarten", "schoolchild\\w*", "schoolkids?", "boys and girls", "little ones?", "youngsters?", "juveniles?", "pupils?", "sons?",
  "daughters?", "nieces?", "nephews?", "grandchild\\w*", "parenting", "nursery", "lullab\\w*", "(?:1[0-7]|[1-9])[- ]?(?:years?|yrs?)[- ]?olds?",
  "high school(?:ers| students)?", "middle school(?:ers| students)?", "elementary school", "under[- ]?(?:18|13|eighteen|thirteen)"]), "ask");
// undecided: words barred in one sense and ordinary in another, and things that reach outside the page
add("undecided", wb(["passwords?", "pretend\\w*", "posing", "role[- ]?play\\w*", "act as", "in person", "(?:meet|meeting|met|visit|go|going|come|walk|drive|travel|pick (?:it |them )?up|deliver|bring|hand|find|photograph|record|follow)\\b[^.!?]{0,40}\\bin real life", "in real life,? (?:meet|visit|go|come|pick|deliver|bring|find|photograph|record|follow)", "irl", "on[- ]site", "physically",
  "sign ?up", "signing up", "sign-?ups?", "register\\w*", "log ?in", "logging in", "sign ?in", "signing in", "logins?", "credentials?", "codes?", "otps?", "2fa",
  "verif(?:y|ied|ication)", "locked (?:herself |himself |themselves |myself |yourself )?out", "discord", "telegram", "whatsapp", "wechat", "snapchat", "kik", "signal app", "dms?", "direct messages?",
  "take a screenshot", "(?:send|share|upload) (?:a |us |me )?screenshots?", "screen record\\w*", "upload\\w*", "attach\\w*",
  "your (?:camera|webcam|microphone|mic|location|gps|contacts)", "crypto\\w*", "bitcoin", "wallets?", "nfts?", "token sale", "airdrop", "investments?", "invest",
  "loans?", "betting", "bets?", "gambl\\w*", "casino\\w*", "lottery", "weed", "guns?", "firearms?", "rifles?", "pistols?", "explosives?", "steroids?", "weapons?",
  "shooters?", "shooting", "battle royale", "blood", "bloody", "kill", "kills", "killed", "killing", "stab", "stabs", "stabbed", "stabbing", "assault\\w*",
  "bomb", "bombs", "bombing", "brutal", "horror", "zombies?", "fight\\w*", "combat", "swords?", "knives", "knife", "scam\\w*", "fraud\\w*", "spoof\\w*", "fake",
  "gift ?cards?", "cash ?app", "zelle", "venmo", "paypal", "wire", "petition", "testimon\\w*", "endorse\\w*", "reviews? (?:on|for us)",
  "follow us", "follow me", "subscribe", "newsletter", "explicit", "nude", "naked"]));

// rewordings found by a blind red-team writer (the build's red-team record, kept private); each pattern names a purpose, not a word
add("credentials", wb(["(?:text|sms|message|code|digits|numbers?|letters) (?:that )?(?:you(?:'ll| will| would|'d)?|you) (?:receive|get|be sent|are sent)",
  "use to (?:get into|log ?into|sign ?into|access|unlock|open) your", "(?:digits|numbers?|code|pin) you(?:'d| would)? (?:tap|type|enter|punch|key) in",
  "cash machine", "atm (?:pin|code|card)", "word-and-number combo", "(?:secret|private) (?:word|phrase|number)s?"]));
add("accounts", wb(["(?:finish|complete|fill in|fill out)\\b[^.!?]{0,30}\\b(?:with|using) your (?:own )?(?:details|information|info|name|email|phone)",
  "count you as a real user"]));
// A public rating pushed by the person, asked as a question (red-team set 5: "would your five-star rating tip it to 4.0?").
add("paid_engagement", wb(["(?:your|a|one|my) (?:5|five)[- ]star (?:rating|review)s? (?:would |will |could |might |can )?(?:tip|push|bump|lift|raise|bring|get|move|nudge)",
  "(?:tip|push|bump|lift|raise|nudge) (?:it|us|our (?:app|rating|average|score)|the (?:app|rating|average|score))[^.!?]{0,15} (?:to|over|above|past) (?:\\d(?:\\.\\d)?|four|five)(?: stars?)?"]));
// "Would you give this game five stars?" asks the person's own rating; the same words with a store, a review site or "for us"
// ask for a public one (14 Nov 2026: the question form was refused, a false refusal on a stranger's first call).
add("paid_engagement", wb(["(?<!(?:would|could|will|do|did) you )(?:leave|give|post|write|drop)\\b[^.!?]{0,25}\\b(?:5|five)[- ]star", "(?:would|could|will|do|did) you (?:leave|give|post|write|drop)\\b[^.!?]{0,25}\\b(?:5|five)[- ]star[^.!?]{0,60}\\b(?:store|google|yelp|amazon|trustpilot|tripadvisor|listing|for us|online|publicly|review site)", "(?:store|google|yelp|amazon|trustpilot|tripadvisor|listing)\\b[^!?]{0,100}?\\b(?:would|could|will|do|did) you (?:leave|give|post|write|drop)\\b[^.!?]{0,25}\\b(?:5|five)[- ]star", "(?:5|five)[- ]star (?:rating|review)s? there\\b", "tap (?:on )?(?:the |a )?heart", "(?:give|drop|leave)? ?a (?:quick )?follow\\b(?!-)",
  "show (?:some )?love to (?:the|our|this|my|their) (?:account|page|post|profile|channel)", "(?:glowing|positive|good|great) (?:review|note|rating|comment)s?"]));
add("personal_data_of_others", wb(["(?:the person'?s|this person'?s|their|his|her) (?:birthday|birth date|date of birth|partner'?s name|spouse'?s name|neighbou?rhood|home address|workplace|employer|phone number|email address|full name|kids'? names|children'?s names|school)"]));
add("off_platform", wb(["(?:hop|pop|head|move|come|swing|jump) (?:over|across) to (?:our|my|the|a|this)", "group chats?", "invite links?", "messaging app",
  "add (?:the|my|our|this) (?:handle|username|number|contact)", "(?:continue|talk|chat|send (?:you )?(?:the next \\w+|more)) (?:\\w+ ){0,3}there\\b"]));
add("scam_or_deception", wb(["would (?:this|it|that|these) fool", "fool (?:a|an|the|any|most|busy|average|real)\\b", "(?:more|most) people (?:to )?(?:reply|click|pay|respond|enter|fall)",
  "without checking", "redelivery fee", "pay (?:the|a) (?:small )?(?:fee|charge) without"]));
add("physical_world", wb(["(?:pop|nip|head|run|go|swing|drop) (?:down |over |out |round |by )?to (?:your|the|a|any) (?:nearest|local|closest)",
  "(?:your|the) (?:nearest|closest|local) (?:post office|shop|store|supermarket|pharmacy|cafe|bank|branch|station|library|mall|market|gas station|petrol station)",
  "next time you(?:'re| are) out", "(?:when|while) you(?:'re| are) out", "out and about", "pick up\\b[^.!?]{0,40}\\b(?:from|at) (?:any|a|the|your|our)\\b",
  "(?:buy|purchase|grab|get) (?:a|an|some|one)\\b[^.!?]{0,40}\\b(?:from|at) (?:any|a|the|your) (?:shop|store|supermarket|pharmacy|market|cafe)",
  "check (?:whether|if) (?:they|it|the shop|the store) (?:have|has|stocks?)"]));
add("undecided", wb(["do (?:what|as) (?:it|this|that|the \\w+) says", "do this", "the following (?:task|steps?|instructions?)", "follow (?:this|these) instructions?",
  "linked (?:below|above)", "links? (?:below|above)", "the link", "as a real user", "how believable", "from ['\"]?your bank"]), "ask");

// held-out set 2 (the build's red-team record, kept private)
add("credentials", wb(["(?:we|we've|we have|we'll|we will) (?:just )?sen[dt] (?:to )?(?:you|your phone|your email|your inbox|by text|a text)", "confirmation numbers?"]));
add("paid_engagement", wb(["comment\\b[^.!?]{0,40}\\bunder (?:the|this|our|that) (?:video|post|photo|tweet|reel|clip)", "(?:real-sounding|fake|made-up|different|another) name",
  "(?:paste|post|put|publish|use) (?:it|this|that|them) on (?:the|our) (?:site|website|page|store|listing)"]));
add("impersonation", wb(["(?:message|letter|email|note) from [a-z]+ [a-z]+ to (?:his|her|their) (?:bank|employer|landlord|boss|school|doctor)", "sounds? (?:just )?like (?:him|her|them)\\b", "talk like you (?:bought|own|used|are)"]));
add("accounts", wb(["change the (?:contact )?(?:email|phone|number|address|password|details) on (?:his|her|their|the|an|my) account"]));
add("third_party_contact", wb(["report back what (?:they|he|she|people|your \\w+) (?:say|said)", "what (?:the|their|his|her)\\b[a-z' ]{0,25}(?:desk|office|staff|receptionist|manager|clerk|cashier|operator) said",
  "(?:when|after) you (?:asked|called|phoned|rang|emailed|messaged) (?:them|him|her|the)"]));
imp("third_party_contact", ["(?:ask|ping|text|message|call|email|dm|poll|survey) (?:a couple of |a few of |a few |some of |some |one of |two of |three of )?(?:your )?(?:mates|friends|pals|buddies|colleagues|co-?workers|family|relatives|neighbou?rs|followers|contacts)\\b"]);
add("personal_data_of_others", wb(["anyone you recogni[sz]e", "names and (?:workplaces|addresses|employers|jobs)", "staying under the name", "names of (?:anyone|the people|people) (?:in|you)"]));
add("scam_or_deception", wb(["release fee", "push you to pay", "guaranteed (?:\\d+% )?(?:monthly |weekly |daily )?(?:returns?|profits?|income)", "easy (?:cash|money)", "quick cash"]));
add("ban_evasion", wb(["which (?:squares|tiles|boxes|images) (?:contain|have|show)", "picture puzzles?", "i'?m not a robot", "squares puzzle", "image grid", "puzzles? on partner sites"]));
add("physical_world", wb(["near (?:a|the|your) (?:supermarket|store|shop|pharmacy|mall|market|station|cafe)", "aisle", "shelf height", "(?:pop|nip|go|head|run|step) (?:into|in to) (?:the|a|your|any)",
  "swing by", "grab (?:the|a) (?:package|parcel|bag|envelope|box)", "drop (?:it|them|the package|the parcel|this) (?:at|off)"]));
add("undecided", wb(["deposit", "scammy", "the next step is to", "shop window"]), "ask");

// restricted data: government ID numbers and card numbers are refused, not held (directory review, market/rounds/REVIEW_r0g_v10.md)
add("credentials", wb(["(?:passport|driver'?s? licen[cs]e|drivers licen[cs]e|national id|id card|state id|government id|tax id|taxpayer id|itin|ein|social insurance|medicare|medicaid|military id|green card|visa) (?:numbers?|no\\.?|#|details)",
  "(?:debit|credit|bank|payment) card (?:numbers?|details|info\\w*)", "(?:bank )?account and routing", "iban", "sort code", "card(?:'s)? (?:expiry|expiration|security code)"]));

// held-out set 3 (the build's red-team record, kept private)
add("paid_engagement", wb(["smash (?:that|the)\\b", "(?:hit|tap|press|click) (?:that|the) (?:like|subscribe|bell|follow|heart)", "button under (?:the|our|this) (?:channel|video|post)"]));
add("third_party_contact", wb(["to a (?:friend|mate|neighbou?r|colleague|relative)", "down the phone", "how (?:they|your friend|he|she|your \\w+) reacted"]));
add("scam_or_deception", wb(["parcel'?s? (?:is )?(?:stuck|held|waiting|on hold)", "slip (?:it )?past (?:them|people|the|your)", "(?:styled|made|designed|looks?) (?:like|as if) it (?:came|comes) from"]));
add("ban_evasion", wb(["(?:a |any )?way (?:past|around|round) (?:the|a|this)\\b", "(?:lock|lockout|limit|block) on (?:this|the|that) (?:site|app|account)", "too many attempts"]));
add("impersonation", wb(["as (?:our|their|his|her|the company'?s) (?:director|ceo|boss|manager|owner|accountant|lawyer|founder|chairman|president)", "so (?:they|he|she|people) (?:think|believe) it (?:came|comes|was) from"]));
add("personal_data_of_others", wb(["which street (?:they|he|she) lives?", "what car (?:they|he|she) drives?", "do you know (?:where|which street|what car|who) (?:they|he|she|this person)"]));
add("impersonation", wb(["say (?:you'?re|your|you are) (?:the|a|an|their|his|her) (?:manager|owner|boss|account holder|officer|agent|representative|doctor|lawyer|parent|landlord)", "what name to use", "(?:which|what) name to give"]));
add("undecided", wb(["trust it more", "would you pay (?:it|this|that)", "chat window"]), "ask");

// held-out set 5 (question-form): the plain ones, so the simulated pool teaches the real answer
add("credentials", wb(["(?:digits|numbers?) on the back of (?:your|the|a) (?:bank |debit |credit )?card", "back of your (?:bank |debit |credit )?card"]));
add("accounts", wb(["(?:welcome|confirmation|verification) (?:screen|email|e-mail|message)\\b[^.!?]{0,40}\\b(?:after|land|arrive|say|end)", "brand-new member", "after the registration", "registration page", "keep it on the final screen", "(?:inbox|spam folder)"]));
add("ban_evasion", wb(["wavy letters", "(?:audio|sound) clip\\b[^.!?]{0,40}\\b(?:digits|letters)", "slider puzzle", "which squares", "says? ['\"]?verified"]));
add("physical_world", wb(["(?:your|the) nearest \\w+ shop", "corner shop", "bus stop on", "out of the locker", "reach the address", "shelf tag", "in daylight"]));
add("personal_data_of_others", wb(["according to (?:her|his|their) (?:public )?profiles?", "based on (?:property|public|court|voter) records", "number plate", "licen[cs]e plate", "comes up for (?:her|his|their) face", "which town does (?:she|he|they) live", "how old is [a-z]+ [a-z]+"]));
add("third_party_contact", wb(["when they picked up", "is there still a table", "what reply would", "(?:texts?|message) (?:from|to) (?:a|an|your) (?:relative|friend|old friend)"]));
add("off_platform", wb(["companion app", "once it'?s installed", "our new app"]));
add("scam_or_deception", wb(["older recipients", "really from a relative", "new number", "feels? more real"]));
add("impersonation", wb(["took you for", "(?:former|old) manager'?s name", "signed version back", "your signature at the bottom"]));
add("paid_engagement", wb(["after it'?s pressed", "turn red for you", "on your story", "new follower'?s point of view"]));

// held-out set 6 (multi-step briefs)
add("personal_data_of_others", wb(["find out (?:which|what|where) (?:neighbou?rhood|street|town|address|school|company|employer)", "find (?:their|his|her) (?:professional|personal|home|work)", "tell us the age, current salary", "previous employers of"]));
add("scam_or_deception", wb(["even though (?:the )?stock is unlimited", "fake (?:scarcity|urgency|countdown)", "even though (?:it|they) (?:is|are) not true", "both are mock(?:ed)?[- ]?ups? of (?:real|genuine)"]));

// held-out set 7 (short, warm favours)
add("third_party_contact", wb(["give (?:\\w+ ){0,4}a (?:quick )?(?:ring|call|bell|buzz|shout)", "check with (?:a couple of |some |a few |your )?(?:people|friends|family|housemates?|roommates?|someone|partner)", "people at home", "(?:ask|check with) (?:the |your )?(?:people|person) (?:you live with|at home)"]));
add("impersonation", wb(["in the voice of", "as if it came from", "so it reads as if"]));
add("paid_engagement", wb(["on your own (?:page|profile|feed|account|story|channel)", "there'?s a bonus in it", "a nice line about it"]));
add("personal_data_of_others", wb(["anything you can find out about", "do you know [a-z]+ [a-z]+ from", "find out about [a-z]+'?s? (?:job|family|address|work)"]));
add("scam_or_deception", wb(["made to look like (?:your|a|the) (?:bank|real|official)", "type your details into"]));
add("accounts", wb(["pick a username", "member list", "become a member of our", "sign (?:yourself )?up as"]));

// held-out set 8 (the barred step put in the answer, or asked as "what happened when you did it")
add("accounts", wb(["(?:the |your )?(?:handle|username|user ?name|display name|screen name|login name)s? (?:you (?:picked|chose|used|made|set up|registered)|once you'?re (?:in|inside))", "said ['\"]?welcome aboard", "before the (?:forum|site|app|page) said"]));
add("paid_engagement", wb(["(?:star )?rating shows up under", "once your (?:star )?(?:rating|review|comment|like) (?:shows|is)", "newest review under it"]));
add("third_party_contact", wb(["what did (?:they|he|she|the \\w+(?: \\w+)?) say (?:back|when they|after you)", "when they got (?:the|your|our) (?:word|message|note|text|code)"]));
add("personal_data_of_others", wb(["what other accounts", "accounts (?:are )?under that name", "where (?:k|he|she|they) works?\\b"]));
add("off_platform", wb(["community server", "on our channel,? not here", "(?:post|posted) yours under", "once you'?re inside"]));
add("scam_or_deception", wb(["looks? more like the real (?:courier|bank|company|delivery|tax|police|irs)", "parcel[- ]fee texts?", "going out to our list"]));
add("physical_world", wb(["fitting room", "tried it on in (?:the )?store", "in store\\b", "specials board", "on the corner of [a-z]+ street", "at the (?:café|cafe|shop|store) on the corner"]));
// blind set 9 (measured before this fix: 4 of 60 passed on our own real calls; outsiders' real calls 0 of 60)
const PIC = "(?:photos?|pictures?|pics?|images?|shots?|snaps?|videos?|clips?|footage|selfies?)";
const WHO_PIC = "(?:person|people|man|men|woman|women|guy|guys|bloke|blokes|girl|lady|ladies|someone|couple|stranger|fellow|chap|he|she)";
add("personal_data_of_others", new RegExp(`\\b${WHO_PIC}\\b[^.!?]{0,40}\\bin (?:this|the|that|our|these|those) (?:[\\w'-]+ ){0,2}${PIC}\\b[^.!?]{0,120}\\b(?:lives?|living|works?|working|workplace|employer|job|name|handle|address|neighbou?rhood|school|commute)\\b`, "i"));
add("personal_data_of_others", wb(["(?:who|whom) (?:we're|we are|i'm|i am|they're) (?:trying|looking|hoping|keen|wanting) to (?:reach|find|contact|track down|locate|identify|get hold of|get in touch with)",
  "(?:name|handle|workplace|employer|company|username)s?\\b[^.!?]{0,40}\\bon (?:the|his|her|their|that) (?:lanyard|badge|name ?tag|id card|bag|uniform|jacket|shirt|cup)",
  "(?:lives?|works?|living|working|stays?|studies) (?:near|at|in|on|for) _{2,}"]));
add("ban_evasion", new RegExp(`\\b(?:benched|banned|suspended|kicked|booted|blocked|locked out|shadow ?banned|muted|restricted)\\b[^.!?]{0,120}\\b(?:fresh (?:face|account|name|profile|handle|login|identity)|(?:slip|sneak|get|come|creep) back in|new (?:account|alt|profile|identity|face)|alt (?:account|profile)|under (?:a|another|someone else'?s) (?:name|account))`, "i"));
add("ban_evasion", wb(["(?:fresh face|slip back in|sneak back in|alt account)\\b[^.!?]{0,80}\\b(?:ban|banned|benched|suspended|blocked)"]));
add("physical_world", wb(["(?:arriv\\w*|delivered|turns? up|comes?|coming|lands?|landing) (?:at|to|on) your (?:door|doorstep|house|home|address|place|flat|apartment|porch|mailbox|letterbox)",
  "(?:parcel|package|box|envelope|item|delivery)s?\\b[^.!?]{0,120}\\b(?:heads? on to|forward(?:ed|ing)? (?:it|them|on)|send (?:it |them )?on|pass (?:it |them )?on|re-?ship\\w*|post (?:it |them )?on|onward|to the address (?:inside|in the box|on the note|we send|on the label))"]));

// harassment and threats (the acceptable use policy; research/law_compliance.md document 4)
add("harassment", /\b(?:i|we)(?:'ll| will| are going to|'re going to| gonna)\s+(?:kill|hurt|find|get|ruin|destroy|expose|beat)\s+(?:you|them|him|her)\b/i);
add("harassment", wb(["we know where you live", "you(?:'ll| will) regret", "watch your back", "or else", "send (?:them|him|her) (?:abuse|threats|hate)", "harass\\w* (?:them|him|her|this person|someone)",
  "(?:bully|humiliate|intimidate|threaten) (?:them|him|her|this person|someone)"]));

// Labelled stand-ins for abusive content, as the team's tests write them ("[TEST: asks for a password]"; TEAM.md section 7).
// The label decides the rule; an unknown label is HOLD.
const STAND_INS = [[/(?:make|create|open|verify|buy|sell) (?:a |an |new )*account/, "accounts"], [/scam|phish|decei|fraud|trick/, "scam_or_deception"], [/password|credential|passcode|one[- ]?time|otp|2fa|\bcode|\bkey|login/, "credentials"], [/account/, "accounts"],
  [/review|follow|like|upvote|engagement|testimonial/, "paid_engagement"], [/impersonat|pose as|posing|pretend/, "impersonation"],
  [/third party|contact (?:someone|a person|a stranger|them)|call someone|message someone/, "third_party_contact"],
  [/personal data|dox|address of|who (?:this|someone) is|identify (?:a|the|this) person/, "personal_data_of_others"],
  [/off[- ]platform|another platform|move the person|download|install/, "off_platform"], [/child|minor|kid|under ?18|teen/, "sexual_or_minors"],
  [/sexual|nud|explicit/, "sexual_or_minors"], [/\bban\b|evad|bypass|captcha/, "ban_evasion"], [/scam|phish|decei|fraud|trick/, "scam_or_deception"],
  [/physical|go somewhere|in person|errand|deliver/, "physical_world"], [/violen|gore|blood|weapon/, "v1_violent"], [/medical|surgery|wound/, "v1_medical"],
  [/grief|funeral|death/, "v1_grief"], [/threat|harass|slur|hate|abuse/, "harassment"], [/voice clon|speaker id/, "voice_misuse"],
  [/distress|disturb|upset/, "distressing"], [/politic|election|vote/, "political"], [/health|religio|sexuality/, "health_religion_sexuality"],
  [/screening error/, null]];
const REQUEST_RULES = ["screening_address", "credentials", "accounts", "paid_engagement", "identity_of_person", "third_party_contact", "off_platform", "physical_world", "impersonation", "ban_evasion", "scam_or_deception", "personal_data_of_others", "pay_in_words", "unpaid_screener", "sensitive_selector"];
function standIns(t, path, hit, material = false) {
  const re = /\[test:\s*([^\]]{1,80})\]/g; let m;
  while ((m = re.exec(t))) {
    const label = m[1].trim();
    const found = STAND_INS.find(([r]) => r.test(label));
    if (found && found[1]) hit(material && REQUEST_RULES.includes(found[1]) ? "undecided" : found[1], path, `[TEST: ${label}]`);
    else if (!found) hit("undecided", path, `[TEST: ${label}]`);
  }
}

// minors aimed at in the selectors: a word for a child that is not about an adult who has one
const MINOR_WORDS = /\b(?:under[- ]?(?:18|eighteen|age)|underage|minors?|(?:1[0-7]|[1-9])\s?(?:-|to)\s?1[0-7]\b|teens?|teenagers?|tweens?|kids?|child(?:ren)?|high school(?:ers| students)?|middle school(?:ers| students)?|grade school(?:ers)?|elementary school(?:ers| students)?|junior high|(?:1[0-7]|[1-9])[- ]?(?:years?|yrs?)[- ]?olds?|students aged (?:1[0-7]|[1-9])|boys|girls)\b/i;
const ADULT_OF = /\b(?:parents?|moms?|mums?|mothers?|dads?|fathers?|caregivers?|carers?|guardians?|teachers?|coaches|nannies|nanny|grandparents?|has|have|having|with|of|who have|raising|adults? with)\s+(?:(?:young|small|little|their|own|two|three|\d+|school-?age|school-?aged)\s+)*$/i;
function minorInSelectors(t) {
  const re = new RegExp(MINOR_WORDS.source, "gi");
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (!ADULT_OF.test(before)) return m[0];
  }
  return null;
}

const OUTWARD = ["send", "email", "e-mail", "text", "message", "dm", "open", "download", "install", "sign", "log", "register", "subscribe", "visit", "go", "buy",
  "purchase", "order", "pay", "transfer", "post(?!-)", "tweet", "share", "upload", "attach", "forward", "call", "phone", "contact", "meet", "join", "follow",
  "photograph", "film", "record", "print", "mail", "deliver", "drive", "walk", "travel", "google", "look up", "search", "copy", "paste", "invite", "tag",
  "mention", "rate us", "review us", "screenshot", "scan (?:the |this |a )?(?:qr|code|barcode)", "verify", "confirm", "click (?:on )?(?:the |this |a )?link", "tap (?:on )?(?:the |this |a )?link"];
const OUTWARD_RE = new RegExp(`^(?:${OUTWARD.join("|")})\\b`, "i");
const OUTWARD_OK = /^(?:go (?:through|back|ahead|on|over|to the (?:next|end|last|first|second|third|start|top|bottom)|forward|slowly|quickly|with your)|pay (?:close |careful |special )?attention|share (?:your|any|what|how|a|one|the|honest)\b(?! (?:link|post|video|page|song|track) (?:with|on|to))|send (?:your|the|an?) (?:answer|feedback|reply|response|thoughts|rating|choice)|follow (?:the|these|this|any) (?:instructions?|steps?|prompts?|directions?|tutorial|on-?screen|guide|story|melody|beat|rhythm|path|arrows?|hints?)|order (?:these|them|the|each|all|from|by)|open (?:the|this|each) (?:menu|level|box|chest|door|map|inventory|settings|game|image|picture|card|tab|section|drawer|first|second|next)|text (?:on|in|of|size|is|was|that|which|reads?)|call (?:it|this|the (?:song|track|game|page|design|image|piece|thing|level|one))|record (?:how|what|whether)|search (?:the (?:level|map|room|scene|page|image)|for the (?:hidden|secret))|confirm (?:your|the) (?:answer|choice|pick))/i;

const CUES = wb(["feel\\w*", "felt", "think\\w*", "thought\\w*", "opinions?", "prefer\\w*", "which", "clear\\w*", "clarity", "confus\\w*", "fun", "enjoy\\w*",
  "like", "liked", "likes", "love\\w*", "hate", "rate", "rating", "score", "describe\\w*", "impressions?", "notic\\w*", "understand\\w*", "remember\\w*", "recall",
  "favou?rites?", "best", "worst", "improve\\w*", "change", "would you", "do you", "did you", "are you", "were you", "how", "why", "what", "stuck", "easy", "easier",
  "hard", "harder", "difficult\\w*", "interest\\w*", "catchy", "memorable", "trust\\w*", "tone", "mood", "pick", "choose", "choice", "rank\\w*", "compare\\w*",
  "react\\w*", "tell (?:me|us)", "say", "explain", "reasons?", "first glance", "keep (?:watching|reading|playing|listening)", "recommend\\w*", "expect\\w*", "surpris\\w*",
  "bor(?:ing|ed)", "annoy\\w*", "frustrat\\w*", "worth", "sounds?", "looks?", "seems?", "agree", "yes or no", "true or false", "makes? sense", "made sense", "fair", "useful", "helpful", "want", "is (?:it|this|that)", "does (?:it|this|that)", "was (?:it|this|that)", "stand out", "fall flat",
  "order", "most", "least", "better", "worse"]);
const ENGLISH = wb(["the", "a", "an", "and", "or", "of", "to", "you", "your", "it", "is", "this", "that", "what", "which", "how", "me", "us", "in", "on", "for",
  "i", "do", "would", "tell", "say", "if", "with", "are", "did", "be", "then", "once", "one", "two", "after", "about", "from", "at", "by", "as", "why", "was"]);
const FOREIGN = /\b(?:el|la|los|las|que|qué|esta|este|una|dime|escucha|mira|por|para|con|del|une|les|des|est|vous|votre|quoi|der|das|und|ist|nicht|sie|ihr|você|não|uma|isso|questo|che|della)\b/gi;

// ---------- reading the call ----------
function strings(obj, path = "", out = [], depth = 0) {
  if (depth > 8 || out.length > 400) return out;
  if (typeof obj === "string") out.push({ path, text: obj });
  else if (Array.isArray(obj)) obj.forEach((v, i) => strings(v, `${path}[${i}]`, out, depth + 1));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (SKIP_KEYS.has(k)) continue;
    if (path.endsWith("fields") || path === "answer_fields" || path === "respond.fields") out.push({ path: p, text: k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), is_key: true });
    strings(v, p, out, depth + 1);
  }
  return out;
}
const SKIP_KEYS = new Set(["idempotency_key", "media_id", "pool", "type", "kind", "max_total_usd", "per_person_usd", "pay_per_person_usd", "by_minutes",
  "deadline_minutes", "estimated_minutes", "minutes", "seconds", "count", "enough", "people", "pace", "quote_id", "call_id", "voice", "simulated", "script", "content_rating"]);
const MATERIAL_PATHS = /^(?:content|url|urls|media|media_id|media_ids|experience\.(?:url|urls|media_id|media_ids|media|items\[\d+\]\.(?:url|media_id))|content\[\d+\](?:\.(?:url|media_id|media))?|content\.(?:url|media_id|media)|items\[\d+\]\.(?:url|media_id))$/;

function scopeOf(path) {
  if (/^(?:who|age|can|where|claims|selectors?|require)\b/.test(path)) return "who";
  if (/^content\b/.test(path)) return "material";
  return "ask";
}
function kindOf(call) {
  const k = call?.experience?.kind ?? call?.kind;
  return typeof k === "string" ? k.trim().toLowerCase() : undefined;
}
// Our own samples (GET /v1/media/samples): made by the team, kept in our own storage, and seen by the team, so a call that
// uses only these is not waiting on unread outside material (REACH, 9:20 AM CT 15 Nov: m_sample_melody30 was held as outside
// audio on an own panel). Exact ids only; any other id, address or text still waits for the material read or a person.
export const OUR_SAMPLES = new Set(["m_sample_clip8", "m_sample_game_dots", "m_sample_melody30", "m_sample_melody30_aac", "m_sample_page_a", "m_sample_page_b"]);
function onlyOurSamples(call) {
  const e = call?.experience ?? {}, c = call?.content, ids = [];
  if (e.url || e.urls || call?.url) return false;
  const take = (x) => { if (typeof x === "string") ids.push(x.trim()); else if (x && typeof x === "object") { if (x.url || x.text || x.html) ids.push(""); else ids.push(String(x.media_id || x.media || "").trim()); } };
  if (Array.isArray(c)) c.forEach(take); else if (c !== undefined && c !== null) take(c);
  for (const v of [e.media_id, e.media, call?.media_id]) if (v) take(v);
  if (Array.isArray(e.items)) e.items.forEach(take);
  return ids.length > 0 && ids.every((x) => OUR_SAMPLES.has(x));
}
// audio or video: the kind, a material item's type, or an address that ends like a sound or film file
function isAudioVideo(call, ctx) {
  const k = String(call?.kind || call?.experience?.kind || "").toLowerCase();
  if (k === "listen" || k === "watch") return true;
  if (((ctx && ctx.material) || []).some((m) => /^(?:audio|video)\//i.test(String(m && m.content_type || "")))) return true;
  const c = call?.content, urls = [];
  for (const x of Array.isArray(c) ? c : [c]) if (typeof x === "string") urls.push(x); else if (x && typeof x === "object" && x.url) urls.push(String(x.url));
  return urls.some((u) => /\.(?:mp3|m4a|aac|wav|ogg|oga|flac|mp4|m4v|mov|webm|mkv)(?:[?#]|$)/i.test(u));
}
function hasMaterial(call) {
  const e = call?.experience ?? {};
  const c = call?.content;
  const isMedia = (x) => (typeof x === "string" && x.trim() !== "") || (x && typeof x === "object" && (x.url || x.media_id || x.media));
  return Boolean(e.media_id || e.url || e.urls || e.media || (Array.isArray(e.items) && e.items.some(isMedia)) || call?.media_id || call?.url ||
    isMedia(c) || (Array.isArray(c) && c.some(isMedia)));
}
function fieldsOf(call) { return call?.respond?.fields ?? call?.answer_fields ?? call?.fields ?? null; }
function fieldsPath(call) { return call?.respond?.fields ? "respond.fields" : call?.answer_fields ? "answer_fields" : "fields"; }
function warningsOf(call) {
  const w = call?.content_warnings ?? call?.warnings ?? call?.experience?.content_warnings ?? (call?.content && !Array.isArray(call.content) && typeof call.content === "object" ? call.content.warnings : undefined);
  const out = Array.isArray(w) ? w.map((x) => fold(String(x))) : typeof w === "string" ? [fold(w)] : [];
  const r = call?.content_rating ?? call?.experience?.content_rating;
  if (r !== undefined && r !== null) out.push(fold(String(r)));
  return out;
}
function ageMin(call) {
  const q = call?.require ?? {};
  const cand = [call?.who?.age_min, call?.who?.min_age, call?.who?.age?.min, call?.age?.min, call?.age_min, call?.who?.claims?.age?.min, q.age_min, q.min_age, q.age?.min];
  for (const v of [call?.who?.age, call?.age, call?.who?.claims?.age, q.age]) if (typeof v === "string") { const m = v.match(/(\d{1,3})/); if (m) cand.push(Number(m[1])); }
  for (const v of [call?.who?.age, call?.age, q.age]) if (typeof v === "number") cand.push(v);
  const nums = cand.filter((x) => x !== undefined && x !== null && x !== "").map(Number).filter((x) => Number.isFinite(x));
  return nums.length ? Math.min(...nums) : undefined;
}
function peopleOf(call) {
  const n = Number(call?.who?.count ?? call?.people ?? call?.count);
  return Number.isFinite(n) ? n : undefined;
}

function sentencesWithout(text, re) {
  const parts = String(text).split(/(?<=[.!?])\s+/);
  return parts.filter((p) => !re.test(fold(p))).join(" ").trim();
}
const FALLBACK_ASK = "Listen once. Then tell me what you felt, in your own words.";

// ---------- the decision ----------
// With ctx.modelClient (an Anthropic SDK client, made by the router only when the model key is set) and ctx.modelBudget
// (model_budget.js: the $20-a-day stop), outside principals' calls that rules held as unread or undecided are read by a
// model (model_read.js). Without the client: rules alone. A client without a budget never reads.
export async function screen(call, ctx = {}) {
  const r = screenSync(call, ctx);
  if (!ctx || !ctx.modelClient) return r;
  try {
    const m = await withModelRead(r, call, ctx.modelClient, STOP, ctx.modelBudget);
    if (!m || !["ALLOW", "REFUSE", "HOLD"].includes(m.decision)) return r;
    let out = m;
    // the material read (OWNER_all_5): only when the material hold is all that is left
    if (out.decision === "HOLD" && ctx.material) out = (await withMaterialRead(out, call, ctx, STOP)) || out;
    if (out.decision === "HOLD" && (out.model_read || out.material_read)) replyAfterRead(out, call, ctx);
    return out;
  } catch { return r; }
}

// After a model read, the held reply names what still holds (SERVICE, 6:47 PM CT 14 Nov: the rules-only reply's "no model
// reads calls yet" is untrue once the key is set). Three cases when only the read's own reasons remain: it read the call and
// did not clear it; today's reads reached the daily cap; it could not read the call. Otherwise the reply is for the first
// reason that still holds (material nothing has checked, a subject, size), built as before.
function replyAfterRead(m, call, ctx) {
  const left = new Set((m.hold?.reasons || []).map((x) => x.rule));
  const mr = m.model_read || {}, said = String(mr.reason || "");
  const later = "a person reads it within three days, and it runs now, free, on simulated people (pool \"simulated\")";
  let reply;
  if ([...left].every((x) => x === "outside_unread" || x === "undecided")) {
    if (/daily cap/.test(said)) reply = { why: "Today's model reads have reached their daily limit, so this call waits for a person before anyone real is rung.",
      what_to_change: `Nothing to change in the words: send it again after midnight in Chicago for a read, or wait: ${later}.`, fixable: false, rule: "model_read_cap", what_to_do: "send it again tomorrow, or wait" };
    else if (/^model read failed|could not be read|did not run|no daily cap/.test(said)) reply = { why: "The model read could not read this call just now, so it waits for a person before anyone real is rung.",
      what_to_change: `Nothing to change in the words: send it again in a few minutes, or wait: ${later}.`, fixable: false, rule: "model_read_unavailable", what_to_do: "send it again in a few minutes, or wait" };
    else reply = { why: `A model read this call and did not clear it${said ? ` ("${said.slice(0, 160).replace(/"/g, "'")}")` : ""}, so a person reads it before anyone real is rung.`,
      what_to_change: `If it is a plain reaction ask, make it plainer (one question about what they felt, chose, noticed or would do, and nothing else) and send it again; otherwise nothing to change: ${later}.`,
      fixable: true, field: "ask", rule: "model_read", what_to_do: "make the ask plainer and send it again, or wait" };
  } else if ([...left].every((x) => x === "uninspected_material") && isAudioVideo(call, ctx)) {
    reply = { why: "Audio and video from outside are checked by a person at person.tools before anyone hears or sees them.",
      what_to_change: "Nothing to change in the words: the call is accepted, and its people are rung once that check is done; read its status with the call's id.",
      fixable: false, rule: "uninspected_material", what_to_do: "wait for the check" };
  } else if (m.material_read && [...left].every((x) => x === "uninspected_material")) {
    const why = String(m.material_read.reason || "");
    const fixable = /pictures|address outside|encoded|run time|over 100 KB|not text/.test(why);
    reply = { why: `The call's material waits for a person before anyone real sees it: ${why.replace(/\.$/, "")}.`,
      what_to_change: fixable ? `To let a model check it now, send a page or build of text only, under 100 KB, with no pictures, sound, video, outside addresses or text built from encoded pieces; otherwise nothing to change: ${later}.`
        : `Nothing to change in the words: ${later}.`, fixable, ...(fixable ? { field: "content" } : {}), rule: "material_read", what_to_do: fixable ? "send plain text material, or wait" : "wait" };
  } else reply = holdReply((m.fired || []).filter((f) => left.has(f.rule)), call, { ...ctx, _no_reply: false }, true);
  if (!reply) return;
  m.hold = { ...m.hold, reply, fix: { why: reply.why, change: reply.what_to_change, fixable: reply.fixable, ...(reply.field ? { field: reply.field } : {}), ...(reply.corrected_example ? { example: reply.corrected_example } : {}) } };
}
// The outcome line an asker sends back (DECISIONS.md D21) is screened like a call, without the reaction-ask test.
export async function screenOutcome(text, ctx = {}) { return screenSync({ ask: typeof text === "string" ? text : "", kind: "answer" }, { ...ctx, purpose: "outcome", pool_real: true, principal_is_ours: true }); }
// In an answer field's label, typing or writing is answering and a question is a question: only steps that leave the page
// count (calling, messaging, visiting, going somewhere, buying, posting, liking, following, signing up, asking someone).
const LABEL_ACTION = /(?<!\b(?:would you|did you|do you|have you|will you|could you|would|did)\b[^.!?]{0,30})\b(?:call|calling|phone|text(?:ing)? (?:me|us|them|him|her|a|the|your)|e-?mail (?:me|us|them|him|her|a|the)|message (?:me|us|them|him|her|a|the)|contact|visit|go (?:to|and|have|check|look|like|follow|post|buy|find|see)|buy|purchase|post (?:it|this|a|on|in)|comment on|like (?:it|this|the|our|my)|follow (?:us|me|them|the|our|my|@)|subscribe|sign(?:ing)? up|register|join (?:our|the|my)|download|install|upload|photograph|deliver|pick (?:it |one |them )?up|ask (?:a|an|your|someone|people|one of))\b/;
const UI_KINDS = /^(?:play|compare|look|view)$/;
// steps inside a sign-up flow or prototype the person is trying (only where materialUI holds)
const UI_STEP = /^(?:trying it|use (?:made[- ]?up|fake|pretend|dummy|any|only|trying it)|(?:made[- ]?up|any|fake|pretend) (?:numbers?|details|answers?|data|info|names?) (?:are|is) (?:fine|ok|okay)|go (?:through|only|as far|on)|get (?:to|as far)|reach|try (?:to )?(?:reach|get|finish|complete)|stop (?:when|at|before|where|if|there)|open (?:it|them|both|each|the (?:form|forms|prototype|mock-?up|flow))|work through|fill|start (?:at|from|on|with)|continue|finish|complete (?:it|the|each)|tap through|click through|make (?:it|them|one|something) up|skip|if (?:a|any) (?:field|screen|step)|it'?s (?:only |just )?(?:a )?(?:prototype|mock-?up)|nothing you)/;
const UI_WORD = /^(?:sign ?ups?|sign-?ups?|signing up|signups?|register\w*|log ?in|logins?|logging in|sign ?in|signing in|login details|card numbers?|bank details|in real life)$/;
const UI_NAMED = /\b(?:clickable |interactive |working )?(?:prototypes?|mock-?ups?|wireframes?)\b|\b(?:sign-?ups?|sign ?up|signup|onboarding|set-?up|setup|registration|checkout|log ?in|login)\b[^.!?]{0,25}\b(?:flows?|forms?|screens?|steps?|process|pages?)\b|\bversions? of (?:a|an|the|our|this) [^.!?]{0,40}\bforms?\b|\b(?:sign-?ups?|signup) forms?\b|\b(?:this|the|our|its|[a-z]+'s)\b[^.!?]{0,40}\b(?:sign-?up|signup|onboarding|set-?up)\b(?!\s+(?:for|with|at|on|to|using)\b)/;
const UI_MADE_UP = /\b(?:made[- ]?up|fake|pretend|dummy|invented|fictional|placeholder)\b|\b(?:don'?t|do not|never|no|not)\b[^.!?]{0,40}\breal\b|\bnothing you (?:enter|type)\b|\b(?:it'?s|it is) (?:only )?(?:a |just a )?(?:prototype|mock-?up)\b/;
const UI_REAL_WITH = /\b(?:with|using|under) (?:your|their) (?:[a-z-]+ ){0,3}?(?:e-?mail|name|phone|number|password|pin|card|bank\w*|address|details|information|info|login|account|identity)\b/;
// a real service named, a code sent to the person, or something the person must bring back from it: no exemption
const UI_BLOCK = /\b(?:gmail|google|facebook|instagram|tiktok|twitter|apple id|icloud|amazon|paypal|venmo|cash ?app|zelle|microsoft|outlook|hotmail|yahoo|linkedin|snapchat|whatsapp|telegram|discord|reddit|coinbase|binance|robinhood|chase|wells fargo|bank of america|citi\w*|irs|social security|bank's)\b|\b(?:styled (?:like|after)|looks? (?:just )?like|look-?alike|copy of|clone of|imitat\w*|mimic\w*|spoof\w*|phish\w*|well[- ]known|famous|(?:a|the) real (?:brand|company|site|shop|store|bank)\b(?! (?:or|and|card|account|details|info|login|number))|(?:isn'?t|is not|aren'?t|are not|not) (?:actually |really )?(?:run|made|owned|from|by)|fool|trick|notice (?:it|that|which|isn))\b|\b(?:codes?|otps?|2fa|one[- ]?time|verif\w*|text(?:ed)? you|sms|we (?:send|email|text) you|sent to your|screenshots?|upload\w*|photo of (?:your|an?) id|selfies?|(?:your )?real face|suspen\w*|banned|bans?|appeal\w*|bypass\w*|get (?:round|around)|workarounds?|unblock\w*|new account)\b|\b(?:username|user ?name|account|password|login|handle|code) (?:you|it|they) (?:got|get|made|make|created|create|received|receive|gave|give)\b/;
const UI_REAL_ASK = /(?<!\b(?:don'?t|do not|never|no|not|without|instead of|rather than)\b[^.!?]{0,40})\b(?:enter|type|use|give|put|fill in|provide|add|submit|send)\s+(?:in\s+)?(?:us\s+)?(?:your|their)\s+(?:real |own |actual |true |personal )?(?:e-?mail|name|phone|number|password|card|bank|address|details|information|info|login|credentials|account|ssn|social security)/;
const UI_OUTSIDE = /\bhttps?:|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|app|dev|co)\b|\b(?:app store|play store|google play|download|install|the real (?:site|app|service))\b/;
const UI_IDENT = /\b(?:your|ur|their)\s+(?:[a-z-]+ ){0,3}?(?:e-?mail|name|phone|number|password|pin|card|bank\w*|address|details|information|info|login|credentials|account|identity|id)\b/g;
function identityAllNegated(t) {   // "don't enter your real name, email or phone": every mention sits after a no
  for (const m of t.matchAll(UI_IDENT)) if (!/\b(?:don'?t|do not|never|no|not|without|instead of|rather than)\b[^.!?]{0,45}$/.test(t.slice(Math.max(0, m.index - 60), m.index))) return false;
  return true;
}
function materialUI(call, askUnq) {
  const kind = String(call?.kind ?? call?.experience?.kind ?? "");
  if (UI_BLOCK.test(askUnq)) return false;
  // a play build runs sandboxed with no network, so even without "made-up details" nothing typed in it leaves the page
  return UI_KINDS.test(kind) && UI_NAMED.test(askUnq) && (kind === "play" || UI_MADE_UP.test(askUnq)) && !UI_REAL_ASK.test(askUnq) && !UI_REAL_WITH.test(askUnq)
    && !UI_OUTSIDE.test(askUnq) && identityAllNegated(askUnq);
}
// The words a material's own interface uses, blanked in a copy of the call's text (never in what is stored or shown).
const UI_MASK = /\b(?:sign ?ups?|sign-?ups?|signing up|signups?|sign ?in|signing in|log ?ins?|logins?|logging in|register(?:ing|ed)?|registration|in real life|card numbers?|bank details|login details|(?:you|they) (?:enter|type)|pretend (?:answers?|details|data|names?|info|information|numbers?|responses?)|(?:type|typing|enter|entering|fill(?:ing)? in|fill(?:ing)? out|submit(?:ting)?)(?= (?:any|anything|real|made[- ]?up|fake|pretend|personal|details|it|each|them|both|these|those|every|the (?:form|forms|fields?)|in|into|a|an|your|something|anything)\b)|click(?:ing)? through|tap(?:ping)? through|click (?:on )?(?:it|them|each|the (?:buttons?|screens?|links?|steps?)))\b/g;
function maskMaterialUI(call) {
  if (!call || typeof call !== "object" || typeof call.ask !== "string") return call;
  if (!materialUI(call, fold(call.ask))) return call;
  // materialUI already proved every "your name/email/..." here sits after a no ("don't enter your real name"): blank those too
  const blank = (t) => (typeof t === "string" ? fold(t).replace(UI_MASK, "trying it").replace(UI_IDENT, "any details").replace(/any details(?:,? (?:or |and )?(?:e-?mail(?: address)?|phone(?: number)?|address|number|card(?: number)?|password|name))+/g, "any details").replace(/\b(?:open|follow|use) the link\b/g, "open it") : t);
  const af = call.answer_fields ?? call?.respond?.fields;
  let fields = af;
  if (af && typeof af === "object") {
    fields = {};
    for (const [k, v] of Object.entries(af)) fields[k] = v && typeof v === "object" ? { ...v, label: blank(v.label) } : v;
  }
  return { ...call, ask: blank(call.ask), ...(call.answer_fields ? { answer_fields: fields } : {}), material_ui: true };
}

export function screenSync(call, ctx = {}) {
  try {
    const out = screenInner(maskMaterialUI(call), ctx || {});
    if (!out || !["ALLOW", "REFUSE", "HOLD"].includes(out.decision)) return holdOnError("screening returned no decision");
    return out;
  } catch (e) {
    return holdOnError(String(e && e.message ? e.message : e).slice(0, 200));
  }
}

function holdOnError(why) {
  return { decision: "HOLD", screening_version: SCREENING_VERSION,
    hold: { reasons: [{ rule: "undecided", why: `Screening could not run (${why}). Held, never rung.` }],
      message: `Held for a human to read before anyone real is rung: screening could not run. ${cap(REVIEW_PROMISE)}.` },
    fired: [{ rule: "undecided", where: "screening", matched: why }] };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function screenInner(call, ctx) {
  if (!call || typeof call !== "object" || Array.isArray(call)) return holdOnError("the call is not an object");
  const poolName = typeof ctx.pool === "string" ? ctx.pool : typeof call.pool === "string" ? call.pool : typeof call?.who?.pool === "string" ? call.who.pool : "";
  const fencedPool = /^(?:simulated|self|panel:team-test|panel:attack-[\w-]+)$/.test(poolName);
  const pool_real = ctx.pool_real !== undefined ? ctx.pool_real !== false
    : ctx.simulated === true || ctx.key_class === "test" || fencedPool ? false : true;
  const ours = ctx.principal_is_ours === true || ctx.team === true || ctx.principal_team === true;
  const isNew = ctx.principal_new !== false;
  const fired = [];  // {rule, where, matched}
  const hit = (rule, where, matched) => {
    const m = String(matched ?? "").slice(0, 80), old = fired.find((f) => f.rule === rule && f.where === where);
    if (!old) fired.push({ rule, where, matched: m });
    else if (m.startsWith("[TEST:")) old.matched = m;   // a labelled stand-in names its own rule first
  };

  const all0 = strings(call);
  const QUOTE = /["\u201C\u201D]([^"\u201C\u201D]{3,300})["\u201C\u201D]|(?:^|[\s(])['\u2018]([^'\u2019\n]{3,300}?)['\u2019](?=[\s.,;:!?)]|$)/g;
  const all = [];
  let askUnquoted = null;
  for (const e of all0) {
    if (e.path === "ask" || e.path === "experience.ask") {
      const quoted = [];
      const unq = e.text.replace(QUOTE, (m, a, b) => { quoted.push(a ?? b); return m.startsWith('"') || m.startsWith("\u201C") ? ' "[quoted]" ' : m[0] + "'[quoted]'"; });
      all.push({ path: e.path, text: unq });
      quoted.forEach((q, i) => all.push({ path: `${e.path}.quoted[${i}]`, text: q, quoted: true }));
      if (e.path === "ask") askUnquoted = unq;
    } else all.push(e);
  }
  let total = 0;
  const WRX = withheldRegexps(ctx.withheld_terms);
  if (!WRX.length && pool_real) hit("withheld_subject", "screening", "the operator's list could not be read");
  for (const s of all) {
    if (WRX.length) { const ft = fold(s.text), dt = deleet(ft); if (WRX.some((rx) => rx.test(s.text) || rx.test(ft) || rx.test(dt))) hit("withheld_subject", s.path, "a subject the operator does not share"); }
    if (!/^content\b/.test(s.path)) total += s.text.length;
    else if (s.text.length > 20000) hit("ask_too_long", s.path, `${s.text.length} characters of text material`);
    if (MATERIAL_PATHS.test(s.path)) continue;
    const raw = s.text;
    // disguise: hidden characters, mixed scripts, non-English
    if (HIDDEN.test(raw)) hit("undecided", s.path, "hidden characters");
    for (const w of raw.split(/\s+/)) if (/[a-zA-Z]/.test(w) && /[Ͱ-ϿЀ-ԯ]/.test(w)) { hit("undecided", s.path, `mixed letters: ${w}`); break; }
    const nonLatin = (raw.match(NON_LATIN_LETTER) || []).length, letters = (raw.match(/\p{L}/gu) || []).length;
    if (letters >= 6 && nonLatin / letters > 0.2) hit("undecided", s.path, "not English");
    if (/[A-Za-z0-9+/]{40,}={0,2}/.test(raw)) hit("undecided", s.path, "an encoded block");
    const t = fold(raw), d = deleet(t), scope = s.quoted ? "material" : s.is_key ? "ask" : scopeOf(s.path);
    const cls = clauses(t), dcls = d !== t ? clauses(d) : [];
    for (const [rule, re, rs, mode] of R) {
      if (rs !== "all" && rs !== scope) continue;
      if (scope === "material" && mode === "imp") continue;
      if (s.quoted && rule === "undecided") continue;
      let m = null;
      if (mode === "imp") { for (const c of cls.concat(dcls)) { m = c.match(re); if (m) break; } }
      else m = t.match(re) || (d !== t ? d.match(re) : null);
      if (m) hit((s.quoted || scope === "material") && REQUEST_RULES.includes(rule) ? "undecided" : rule, s.path, m[0]);
    }
    if (scope === "who") { const mw = minorInSelectors(t); if (mw) hit("minor_target", s.path, mw); }
    standIns(t, s.path, hit, s.quoted || scope === "material");
    // links, addresses, numbers in the words
    if (/(?:\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|app|co|ai|dev|gg|xyz|me|ly|link|site|online|shop|store|tv|fm|us|uk|ca|de|info|biz)\b(?:\/\S*)?)/i.test(raw) && !/\bperson\.tools\b/i.test(raw)) {
      if (/\bhttps?:\/\/|\bwww\./i.test(raw)) hit("outside_material", s.path, (raw.match(/\S*(?:https?:\/\/|www\.)\S*/i) || [""])[0]);
      else hit("undecided", s.path, "a web address");
    }
    if (/\S+@\S+\.\w{2,}/.test(raw)) hit("undecided", s.path, "an email address");
    if (/(?:\+?\d[\s().-]?){9,}/.test(raw)) hit("undecided", s.path, "a long number");
    // squashed danger words (letters spaced out or broken up)
    const sq = deleet(t).replace(/[^a-z]/g, "");
    // a danger word that is there when the letters are joined up, but not written the ordinary way, is disguised
    const SQ = { password: "pass ?words?", passcode: "pass ?codes?", onetimecode: "one[ -]?time codes?", verificationcode: "verification codes?", securitycode: "security codes?",
      seedphrase: "seed phrases?", recoveryphrase: "recovery phrases?", privatekey: "private keys?", apikey: "api[ -]?keys?", phishing: "phishing", captcha: "captchas?",
      onlyfans: "only ?fans", giftcard: "gift ?cards?", socialsecurity: "social security", creditcardnumber: "credit card numbers?" };
    const disguised = Object.keys(SQ).find((w) => sq.includes(w) && !new RegExp(`\\b${SQ[w]}\\b`).test(t));
    if (disguised && !fired.some((f) => f.where === s.path && RULES[f.rule].outcome === "REFUSE")) hit("undecided", s.path, "a disguised word");
  }

  // structure: kind, warnings, field types, selectors, size, money
  const kind = kindOf(call);
  if (ctx.purpose === "outcome") { /* an outcome line has no kind */ }
  else if (!kind) hit("kind_not_offered", call?.experience ? "experience.kind" : "kind", "missing");
  else if (!KINDS.includes(kind)) {
    if (/^(?:go|visit|errand|deliver|physical|task|world|meet)$/.test(kind)) hit("physical_world", call?.experience ? "experience.kind" : "kind", kind);
    else hit("kind_not_offered", call?.experience ? "experience.kind" : "kind", kind);
  }
  for (const w of warningsOf(call)) {
    if (/violen|gore|blood|weapon|death|kill|war/.test(w)) hit("v1_violent", "content.warnings", w);
    if (/sex|nud|explicit|adult/.test(w)) hit("v1_sexual", "content.warnings", w);
    if (/medic|surg|injur|wound|needle/.test(w)) hit("v1_medical", "content.warnings", w);
    if (/grief|loss|bereave|funeral|mourn/.test(w)) hit("v1_grief", "content.warnings", w);
    if (/distress|disturb|upset|scary|horror|abuse|self.?harm|suicid/.test(w)) hit("distressing", "content.warnings", w);
    if (w !== "general" && !/violen|gore|blood|weapon|death|kill|war|sex|nud|explicit|adult|medic|surg|injur|wound|needle|grief|loss|bereave|funeral|mourn/.test(w)) hit("rating_not_offered", "content_rating", w);
  }
  const fields = fieldsOf(call);
  if (fields && typeof fields === "object") {
    const base = fieldsPath(call);
    for (const [k, v] of Object.entries(fields)) {
      const type = fold(typeof v === "string" ? v : v?.type ?? "");
      const key = fold(k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
      if (/^password/.test(type)) hit("credentials", `${base}.${k}`, `type ${type}`);
      else if (/^(?:email|tel|phone|url)/.test(type)) hit("identity_of_person", `${base}.${k}`, `type ${type}`);
      else if (/^(?:file|image|photo|upload|camera|video|audio|recording|location|geo)/.test(type)) hit("undecided", `${base}.${k}`, `type ${type}`);
      if (/^(?:e ?mail|email address|phone|phone number|mobile|cell|tel|telephone|name|full name|first name|last name|surname|real name|address|home address|street|zip|zip code|postcode|postal code|ssn|dob|date of birth|birthday|birth date|instagram|twitter|tiktok|facebook|linkedin|snapchat|discord|telegram|whatsapp|handle|username|user name|social|socials|contact|contact info|selfie|photo of you|employer|workplace|ip|ip address|passport|license|licence)$/.test(key))
        hit("identity_of_person", `${base}.${k}`, k);
      if (/^(?:password|passcode|pin|otp|code|one time code|verification code|2fa|api key|token|secret|seed phrase|card number|cvv|credit card)$/.test(key))
        hit("credentials", `${base}.${k}`, k);
      if (/^(?:religion|ethnicity|race|sexual orientation|sexuality|politics|political party|political views|party|immigration|immigration status|citizenship|health|diagnosis|disability|medication|medications|conditions?)$/.test(key))
        hit("sensitive_selector", `${base}.${k}`, k);
    }
  }
  const amin = ageMin(call);
  if (amin !== undefined && amin < 18) hit("minor_target", call?.who ? "who" : call?.require ? "require" : "age", `age ${amin}`);
  if (call?.voice && call.voice !== "none" && call.voice !== false && pool_real) hit("undecided", "voice", "spoken answers from real people are not open yet");
  const n = peopleOf(call);
  if (n !== undefined && n > 200) hit("large_call", call?.who ? "who.count" : "people", n);
  const ask = typeof call.ask === "string" ? call.ask : typeof call?.experience?.ask === "string" ? call.experience.ask : "";
  if (ask.length > 2000) hit("ask_too_long", "ask", `${ask.length} characters`);
  if (total > 8000) hit("ask_too_long", "call", `${total} characters in all`);
  for (const s of all) if (s.path !== "ask" && !MATERIAL_PATHS.test(s.path) && /(?:label|title|question|prompt|options?)/.test(s.path) && s.text.length > 300) hit("ask_too_long", s.path, `${s.text.length} characters`);
  const maxUsd = call?.max_total_usd !== undefined ? Number(call.max_total_usd)
    : call?.max_total_cents !== undefined ? Number(call.max_total_cents) / 100
    : Number(call?.pay_per_person_cents) * Number(call?.people) * 1.25 / 100;
  if (isNew && Number.isFinite(maxUsd) && maxUsd > 500) hit("new_principal_over_500", "max_total_usd", call.max_total_usd);
  if (pool_real && !ours && !onlyOurSamples(call) && (hasMaterial(call) || ["listen", "watch", "view", "play"].includes(kind))) hit("uninspected_material", "experience", kind || "material");
  // Blind tests (the build's red-team record, set 5) showed that a barred step asked as a question gets past word rules about
  // half the time. Until a model reads each call (owner/GRANTS.md line g), an outside principal's call to real people waits.
  if (pool_real && !ours && ctx.model_read !== true) hit("outside_unread", "call", "no model has read this call");

  // the allow test: a recognisable ask of the person's own reaction, and no instruction that sends them out of the page
  const askText = fold(ask);
  const askUnq = fold(askUnquoted ?? ask);
  if (!askText) hit("undecided", "ask", "no ask");
  else {
    // cause 7 (FALSE_HOLDS_1): "Then answer two quick questions." with the questions as the answer fields' labels
    const fieldQs = fold(Object.values((call && (call.answer_fields ?? call?.respond?.fields)) || {}).map((f) => (f && typeof f === "object" ? (f.label || f.question || "") : "")).join(" . "));
    if (ctx.purpose !== "outcome" && !CUES.test(askText) && !(fieldQs && CUES.test(fieldQs))) hit("undecided", "ask", "no question about the person's own reaction");
    if ((askText.match(ENGLISH) ? 1 : 0) === 0 && askText.split(" ").length >= 4) hit("undecided", "ask", "not English");
    const foreign = (ask.match(FOREIGN) || []).length;
    if (foreign >= 2) hit("undecided", "ask", "not English");
    for (const c of clauses(askUnq)) {
      if (OUTWARD_RE.test(c) && !OUTWARD_OK.test(c) && !(call && call.material_ui && UI_STEP.test(c))) { hit("undecided", "ask", `an instruction: "${c.slice(0, 60)}"`); break; }
    }
  }
  // An outside principal's call to real people is allowed only when every step of the ask reads as the person's own
  // reaction: watching, reading, playing, choosing, rating, saying. Any other step waits for a human (fail closed).
  // The same gates for every call that would reach a real person, our own included: our own agents read untrusted pages
  // and could be steered into sending such a call (held-out set 6: 13 of 60 rewordings passed rules alone as our calls).
  if ((!ours || pool_real) && askUnq) {
    const STEP_OK = /^(?:listen|watch|view|look|read|play|try|see|hear|below|above|picture|type (?:it|them|each(?: one)?|the (?:name|names|word|words|title|titles|brand|brands)) (?:as|the way|how|exactly as)|(?:roughly|about|approximately|around) (?:when|where|how (?:long|far|many|much|often)|at what (?:point|moment|second|minute)|what (?:point|moment|second|minute))(?: (?:you|did you|would you|do you|were you|was it|it|this|the (?:song|piece|track|game|clip|video|page|ad|level|story))\b[^.!?]*)?$|wherever you|whenever you|point (?:to|out)|follow (?:the|a|an|this|that|his|her|their|its) (?:[a-z']+ ){0,3}(?:part|line|melody|beat|rhythm|bass|guitar|drums|vocals?|lyrics?|words?|story|plot|argument|thread|voice|dialogue|conversation|explanation)s?\b|note (?:the|any|each|every) (?:moments?|points?|times?|spots?|places?|parts?|seconds?|minutes?)|at (?:what|which) (?:point|moment|time|minute|second|part|spot)|as (?:a|an) [a-z' -]{1,30}$|(?:yesterday|earlier(?: today)?|last (?:time|week)|(?:a|one|two|a few) (?:days?|weeks?) ago),? you (?:listened|watched|saw|heard|read|played|looked|tried|were)|where|who|whom|whose|whether (?![^,]*\bor not\b)(?![^,]*,)|pay (?:close |careful )?attention|focus|count|compare|rate|rank|score|pick|choose|select|sort|order (?:these|them|the)|tell (?:me|us)|say|describe|explain|answer|share your|give (?:a|your|one|it|each)|note (?:what|how|which|anything|where|when|if|whether)|write (?:one|a short|a few|up to|at most|\d+|two|three|a) (?:words?|sentences?|lines?|word|sentence|line)|quote (?:the|a|any|one|two|three|up to|at most|\d+|exact) (?:exact )?(?:words?|lines?|sentences?|phrases?|parts?|passages?|bits?|spots?)|which|what|how|why|would|will|do|does|did|is|are|was|were|could|can|if|then|once|after|before|while|when|first|next|finally|imagine|think|notice|consider|spend|take (?:a|your) (?:look|minute|moment|time)|scroll|tap|click|press|swipe|replay|pause|skip|stop|keep|go through|use (?:the|your|a)|feel free|in your own words|any|anything|overall|honestly|thanks|thank you|this|these|those|that|the|our|here|it|there|you|your|we|i|a|an|no|yes|both|each|one|two|three|don'?t|do not|never|no need|nothing)\b|^["']?\[quoted\]["']?/;
    // A bare list ("the colours, the font and the layout"): short items only, so "whether you like it or not, share it on
    // your timeline" is not read as a list (found 14 Nov 2026).
    const LIST = /^[a-z0-9'-]+(?: [a-z0-9'-]+){0,2}(?:, ?[a-z0-9'-]+(?: [a-z0-9'-]+){0,2})+(?:,? (?:and|or) [a-z0-9'-]+(?: [a-z0-9'-]+){0,2})?$/;
    // "whether you would read on" is a question about the person, like "if" (customer zero, 14 Nov). "Easy to follow"
    // (understand) is not the action "follow" when nothing follows it but punctuation or a joining word.
    // Any action beyond reacting, anywhere in the ask, also waits for a human (held-out sets 3 and 4 hid the barred step
    // after "so we can..." or "then, if it asks you...").
    const EXEMPT = /\b(?:pick (?:it|this|the game) up(?: cold| again| and (?:play|start|try|go))|put (?:it|the game) down|(?:type|write|enter|put|add|give|fill in|leave) (?:your|an|the|a|one|any|short|brief) (?:answer|reply|response|reason|reasons|thoughts?|rating|score|comment|choice|pick)s?|(?:click|tap|press|hit) (?:play|pause|replay|start|the play button|next|done|submit)|share your (?:thoughts|opinion|impressions?|reaction|honest)|send (?:us )?your (?:answer|thoughts|rating|reply)|answer (?:in|below|here|with)|in the (?:answer )?box below|follow-ups?(?: questions?)?|we (?:may |will |might |'ll |can |could )?(?:send|email|text|ask) you\b|type (?:it|them|each(?: one)?|the (?:name|names|word|words|title|titles|brand|brands)) (?:as|the way|how|exactly as)|(?:can|could|did) you (?:still |easily |clearly )?follow (?:the|a|an|this|that|his|her|their|its) (?:[a-z']+ ){0,3}(?:part|line|melody|beat|rhythm|bass|guitar|drums|vocals?|lyrics?|words?|story|plot|argument|thread|voice|dialogue|conversation|explanation)s?|(?:they|visitors?|people|users?|someone|everyone|listeners?|viewers?|players?|readers?|customers?|he|she) (?:press|presses|pressed|click|clicks|clicked|tap|taps|tapped|hit|hits) (?:on )?(?:the )?(?:[a-z']+ ){0,2}[a-z']+(?= button| link|[,.;:!?]| on | in | at |$)|the (?:[a-z']+ ){1,3}(?:button|link)|(?:easy|easier|easiest|hard|harder|hardest|simple|simpler|difficult|clear|clearer|confusing|tough|tricky|impossible)(?: (?:[a-z']+ ){0,5}?(?:was|is|were|are|felt|seemed|be))? to follow(?=\s*(?:[,.;:!?)]|$)|\s+(?:and|or|but|for|in|at|if|when|while|than|throughout|overall)\b))\b/g;
    const ACTION = /(?<!(?:would you|would|you'd|you would|likely to|want to|willing to|tempted to|be able to|see yourself|did you|do you|have you|did|does) )\b(?:paste|pasting|fill(?:ing)? (?:it )?(?:in|out)|fill it|click(?:ing)?|tick(?:ing)?|type|typing|enter(?:ing)?|send(?:ing)?|post(?:ing)?|comment(?:ing)?|sign(?:ing)? (?:up|in|on)|register|join|download|install|call|calling|phone|text(?:ing)? (?:me|us|your|them|a|the)|e-?mail (?:me|us|your|them|a|the)|message|contact|visit|buy|purchase|pick (?:it |one |them )?up|grab|deliver|drop (?:it|off)|look up|search for|follow|subscribe|upload|record|photograph|solve|prove|submit|confirm|verify|reply to|respond to|forward|book (?:the|a|it|this|that|them|your)|answer (?:the|their|his|her|our) (?:\S+ ){0,3}(?:note|email|message|letter|chat)|log ?in|on behalf|under a (?:new|different) name|from your (?:connection|phone|account))\b/;
    const POLITE = /\b(?:would|could|can|will) you (?:please |kindly |maybe |perhaps |actually |really |honestly |realistically |still |ever |be able to |be willing to |mind )?([a-z]+)(?: ([a-z]+))?/g;
    const REACT = /^(?:like|love|hate|prefer|choose|pick|rate|rank|score|recommend|buy|use|pay|keep|open|click|tap|press|book|add|finish|complete|quit|read|listen|watch|play|try|describe|say|tell|explain|share|give|notice|remember|trust|expect|feel|think|consider|imagine|sign|download|subscribe|follow|install|visit|come|return|stay|switch|skip|stop|continue|go|spend|want|be|change|improve|order|look|see|hear|call|write|find|guess|agree|know|believe|enjoy|mind|expect|send)$/;
    let pm; while ((pm = POLITE.exec(askUnq))) {
      const v = pm[1], nx = pm[2] || "";
      const bad = !REACT.test(v) || (v === "be" && /^(?:one|a|an|our|the|part|willing)$/.test(nx)) || (v === "give" && /^(?:\w+)$/.test(nx) && /ring|call|bell/.test(askUnq.slice(pm.index, pm.index + 60)))
        || (v === "call" && !/^(?:it|this|that|the)$/.test(nx)) || (v === "add" && !/^(?:this|it|that|these|the)$/.test(nx)) || (v === "write" && !/^(?:one|a|two|three|\d+|up|at|your)$/.test(nx)) || (v === "send" && !/^(?:us|your)$/.test(nx)) || (v === "find" && nx === "out");
      if (bad) { hit("undecided", "ask", `a request beyond reacting: "${pm[0]}"`); break; }
    }
    const actionHit = askUnq.replace(EXEMPT, " ").match(ACTION);
    if (actionHit) hit("undecided", "ask", `an action beyond reacting: "${actionHit[0]}"`);
    for (const c of clauses(askUnq)) if (!STEP_OK.test(c) && !(call && call.material_ui && UI_STEP.test(c)) && !LIST.test(c) && !/^(?:without|instead|just|only|simply|also)\b/.test(c)) { hit("undecided", "ask", `a step that is not the person's own reaction: "${c.slice(0, 60)}"`); break; }
    // answer-field questions are read like the ask for steps that leave the page (red-team set 12: "As a local:" with the
    // barred step in the field: "go like it and put your profile name here", "go have a look and describe it")
    for (const s2 of all) if (/^(?:answer_fields|respond\.fields)\..+\.(?:label|question|description|help|hint|prompt)$/.test(s2.path)) {   // labels only: "felt": "text" is a type
      const t2 = fold(s2.text), a2 = t2.replace(EXEMPT, " ").match(LABEL_ACTION);
      if (a2) { hit("undecided", s2.path, `an action beyond reacting: "${a2[0]}"`); continue; }
      for (const c of clauses(t2)) if (OUTWARD_RE.test(c) && !OUTWARD_OK.test(c)) { hit("undecided", s2.path, `an instruction: "${c.slice(0, 60)}"`); break; }
    }
  }
  // other text fields that hold instructions are read the same way
  for (const s of all) if (s.path !== "ask" && /(?:instructions?|task|steps?)$/.test(s.path)) {
    for (const c of clauses(fold(s.text))) {
      if (OUTWARD_RE.test(c) && !OUTWARD_OK.test(c)) { hit("undecided", s.path, `an instruction: "${c.slice(0, 60)}"`); break; }
    }
  }
  // a sexual word together with a child is the refused rule, whatever else
  if (fired.some((f) => f.rule === "mentions_children" || f.rule === "minor_target") && fired.some((f) => f.rule === "v1_sexual")) hit("sexual_or_minors", "call", "sexual and children");
  return decide(call, ctx, fired, pool_real);
}

function decide(call, ctx, fired, pool_real) {
  const out = decideInner(call, ctx, fired, pool_real);
  // flat fields the router reads (router/INBOX 12:25 AM): rule, rule_text, where, found, fixable, fix, corrected_example, what_to_do, message
  if (out.error) {
    const e = out.error, f = fired.find((x) => x.rule === e.rule) || {};
    e.category = categoryOf(f.rule ? f : { rule: e.rule }, fired);
    if (e.problems) for (const p of e.problems) p.category = categoryOf({ rule: p.rule }, fired);
    Object.assign(out, { rule: e.rule, category: e.category, rule_text: RULES[e.rule].what, where: e.field ?? f.where, found: f.matched, fixable: e.fixable,
      fix: e.fixable ? e.problems?.[0]?.fix : undefined, corrected_example: e.example, what_to_do: e.fixable ? "fix the field and call again" : "stop and tell your user", message: e.message });
  } else if (out.hold) {
    const r = out.hold.reasons[0];
    Object.assign(out, { rule: r.rule, category: r.rule, held_rule: r.rule, held_reason: `Held for a human to read first: ${out.hold.reasons.map((x) => x.why).join("; ")}.`, rule_text: r.why, where: r.where, fixable: false,
      what_to_do: pool_real ? "wait: nobody is rung until a human releases it; tell your user it is held for review" : "the simulated call runs; on real people it would wait for review", message: out.hold.message });
  } else out.message = "Allowed.";
  return out;
}
function decideInner(call, ctx, fired, pool_real) {
  const base = { screening_version: SCREENING_VERSION, fired };
  const barred = fired.filter((f) => RULES[f.rule].outcome === "REFUSE" && !RULES[f.rule].fixable);
  const fixable = fired.filter((f) => RULES[f.rule].outcome === "REFUSE" && RULES[f.rule].fixable);
  const held = fired.filter((f) => RULES[f.rule].outcome === "HOLD");
  if (barred.length) {
    // one rule is named; a sexual word with a child is always reported as sexual_or_minors first
    const order = ["sexual_or_minors", "minor_target", "credentials", "accounts", "scam_or_deception", "impersonation", "third_party_contact",
      "personal_data_of_others", "harassment", "ban_evasion", "off_platform", "paid_engagement", "physical_world", "voice_misuse", "v1_sexual", "v1_violent", "v1_medical", "v1_grief"];
    barred.sort((a, b) => (b.matched.startsWith("[TEST:") - a.matched.startsWith("[TEST:")) || (order.indexOf(a.rule) - order.indexOf(b.rule)));
    const f = barred[0], r = RULES[f.rule];
    return { ...base, decision: "REFUSE", error: {
      status: 422, code: "screening_refused", rule: f.rule, policy_section: `POLICY.md section ${r.section}`, policy_url: POLICY_URL[r.section], fixable: false,
      message: `${r.what} (${where(f)}). ${f.rule === "minor_target" ? "Stop and tell your user: this service reaches adults only, and no call may reach anyone under 18." : STOP}`,
      also: barred.slice(1).map((b) => b.rule).filter((x, i, a) => a.indexOf(x) === i) } };
  }
  if (fixable.length) {
    const problems = fixable.flatMap((f) => problem(call, ctx, f));
    const p = problems[0];
    return { ...base, decision: "REFUSE", error: {
      status: 422, code: "screening_refused", rule: p.rule, policy_section: `POLICY.md section ${RULES[p.rule].section}`, policy_url: POLICY_URL[RULES[p.rule].section], fixable: true,
      field: p.field, example: p.example,
      message: `${RULES[p.rule].what} Fix: ${p.fix}${problems.length > 1 ? ` (${problems.length} problems; each is listed in problems)` : ""}`,
      problems,
      ...(heldAfter(held, fixable).length ? { after_fixing: `Once fixed, this call will be held for a human to read before anyone real is rung: ${uniq(heldAfter(held, fixable).map((h) => RULES[h.rule].what)).join("; ")}.` } : {}) } };
  }
  if (held.length) {
    const reasons = uniq(held.map((h) => h.rule)).map((rule) => ({ rule, why: RULES[rule].what, where: held.filter((h) => h.rule === rule).map(where).join(", ") }));
    // name what caused each hold, so the agent (and the person who reads it) sees the exact words
    const said = (r) => r.rule === "undecided" ? `${r.why} (${held.filter((h) => h.rule === "undecided").map((h) => h.matched).slice(0, 3).join("; ")})`
      : ["outside_unread", "uninspected_material", "new_principal_over_500", "large_call"].includes(r.rule) ? r.why
      : `${r.why} ("${held.find((h) => h.rule === r.rule).matched}")`;
    const words = reasons.map(said).join("; ");
    const reply = ctx && ctx._no_reply ? undefined : holdReply(held, call, ctx, pool_real);
    return { ...base, decision: "HOLD", hold: { reasons, policy_url: POLICY_URL["2"], ...(reply ? { reply, fix: { why: reply.why, change: reply.what_to_change, fixable: reply.fixable, ...(reply.field ? { field: reply.field } : {}), ...(reply.corrected_example ? { example: reply.corrected_example } : {}) } } : {}),
      message: pool_real
        ? `Held for a human to read before anyone real is rung: ${words}. Nobody is rung until it is released; it is ${REVIEW_PROMISE}. Nothing is charged while it waits, and a refusal is not charged.`
        : `On the simulated pool this call runs. On real people it would be held for a human to read first: ${words}.`,
      on_simulated: "runs, marked would_be_held" } };
  }
  return { ...base, decision: "ALLOW" };
}
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
// The public policy page on the site (market generates it from policy/POLICY.md). A path: the router prefixes the site's host.
const POLICY_URL = { "1": "/policy#refused", "2": "/policy#held", "3": "/policy#not-allowed", "4": "/policy#allowed" };

// What a held call's reply says to the agent (OWNER_all_4 item 2, 14 Nov 2026): one sentence why, one sentence what to
// change, fixable or not, the field, and a corrected example of the ask when one exists. The example is the agent's own
// ask with the sentence that caused the hold taken out, when that screens ALLOW; otherwise a short ask for the same kind
// that does. Waiting holds (a person reads every outside call or outside material first) say so, and that the same call
// runs free on simulated people now.
const KIND_EXAMPLE = {
  listen: "Listen once, to the end. Then say what you felt, in your own words.",
  watch: "Watch it once, all the way through. Then say what you remember, and the one thing you would change.",
  play: "Play it for five minutes. Where did you get stuck or bored, and why?",
  view: "Look at it for ten seconds. What is it about, and would you read on?",
  look: "Look at it for ten seconds. What is it about, and would you read on?",
  compare: "Look at both. Which one would you choose, and why?",
  read: "Read it once. In one sentence, what does it say, and where did you lose the thread?",
  answer: "In your own words, what do you think of it, and why?",
};
const SUBJECT_HOLDS = new Set(["distressing", "political", "health_religion_sexuality", "mentions_children", "withheld_subject"]);
function holdReply(held, call, ctx, pool_real) {
  const first = (r) => held.find((h) => h.rule === r);
  const und = first("undecided"), big = first("large_call"), money = first("new_principal_over_500");
  const subj = held.find((h) => SUBJECT_HOLDS.has(h.rule));
  const wait = held.find((h) => h.rule === "uninspected_material") || held.find((h) => h.rule === "outside_unread");
  const kind = String(call?.kind ?? call?.experience?.kind ?? "answer");
  const later = pool_real ? `a person reads it within ${REVIEW_PROMISE.replace(/^reviewed by the operator within /, "")}` : "on real people a person would read it first";
  if (und) {
    const quoted = ((String(und.matched).match(/"([^"]{3,})"?$/) || [])[1] || String(und.matched)).replace(/"$/, "");
    const ask = typeof call?.ask === "string" ? call.ask : "";
    const sentences = ask.split(/(?<=[.!?])\s+/);
    const keep = sentences.filter((x) => !fold(x).includes(fold(quoted).slice(0, 40)));
    let example = null;
    const tryAsk = (a) => { try { const r = screenInner({ ...call, ask: a }, { ...ctx, _no_reply: true }); return r && (r.decision === "ALLOW" || (r.decision === "HOLD" && (r.hold?.reasons || []).every((x) => x.rule !== "undecided"))); } catch { return false; } };
    if (keep.length && keep.length < sentences.length && tryAsk(keep.join(" "))) example = keep.join(" ");
    else if (KIND_EXAMPLE[kind] && tryAsk(KIND_EXAMPLE[kind])) example = KIND_EXAMPLE[kind];
    const special = /^no question about/.test(quoted) ? ["The ask has no question about the person's own reaction.", "Add one question about what they felt, noticed, chose or would do, in the ask or as an answer field's label."]
      : /^not english$/i.test(quoted) ? ["The ask is not in English.", "Write the ask in plain English; the people on this service read English."]
      : /^no ask$/.test(quoted) ? ["The call has no ask.", "Write what each person reads before they start, ending with a question about their own reaction."] : null;
    return { why: special ? special[0] : `One part of the ask is not the person's own reaction to what the page shows: "${quoted}".`,
      what_to_change: special ? special[1] : "Ask only for their own reaction (what they felt, chose, noticed or would do) and leave that part out; if it is a step inside your material, name the material (\"this prototype\", \"this build\") and say to use made-up details.",
      fixable: true, field: "ask", rule: "undecided", ...(example ? { corrected_example: example } : {}), what_to_do: "change the ask and send the call again" };
  }
  if (big) return { why: "The call asks for more than 200 people.", what_to_change: "Ask for 200 people or fewer.", fixable: true, field: "people", rule: "large_call", what_to_do: "change people and send the call again" };
  if (money) return { why: "A new account asks for more than $500 on one call.", what_to_change: "Set max_total_usd to 500 or less, or ask fewer people.", fixable: true, field: "max_total_usd", rule: "new_principal_over_500", what_to_do: "change it and send the call again" };
  if (subj) return { why: `It touches ${RULES[subj.rule].what} ("${subj.matched}"), which a person reads before anyone real is rung.`,
    what_to_change: `Nothing to change if that is what the call is about: ${later}${pool_real ? "" : ", and it runs now on simulated people"}.`, fixable: false, rule: subj.rule, what_to_do: "wait for the person, or tell your user it waits" };
  // Audio and video from outside are checked by a person, with no time promised (the CEO, 9:26 AM CT, OWNER_all_8 item 3);
  // pages and builds are read by the model (item 2a). An own panel nobody has joined yet: the quote reads nothing (REACH 9:20, 10:27).
  const av = isAudioVideo(call, ctx);
  const mat = held.some((h) => h.rule === "uninspected_material");
  const empty = ctx && (ctx.panel_empty === true || ctx.model_read_skipped === "empty_panel");
  if (wait && empty) return { why: `Nobody has joined this panel yet, so the quote did not read the call${mat ? " or its material" : ""}.`,
    what_to_change: av ? "Nothing to change in the words. Once people join, a model reads the call when you quote or open it (seconds); the audio or video is then checked by a person at person.tools, and the people are rung once that check is done (read the call's status with its id)."
      : mat ? "Nothing to change in the words. Once people join, a model reads the call and its page or build when you quote or open it (seconds); a person reads them only if the model does not clear them, or if the material has pictures, sound, video, outside addresses or is over 100 KB."
      : "Nothing to change in the words. Once people join, a model reads the call when you quote or open it (seconds), and a person reads it only if the model does not clear it (within three days).",
    fixable: false, rule: wait.rule, what_to_do: "send your join link to your people, then quote again" };
  if (wait && mat && av) return { why: "Audio and video from outside are checked by a person at person.tools before anyone hears or sees them.",
    what_to_change: "Nothing to change in the words: the call is accepted, and its people are rung once that check is done; read its status with the call's id. Meanwhile the same call runs now, free, on simulated people (pool \"simulated\").",
    fixable: false, rule: wait.rule, what_to_do: "wait for the check, or run it on simulated people meanwhile" };
  if (wait) return { why: wait.rule === "outside_unread" ? "Calls to real people from an account the service does not know are read before anyone is rung, and this one has not been cleared yet." : "Nothing has read the call's material yet: a model reads a page or build when the call is quoted or opened with people on the panel, and a person reads what the model cannot.",
    what_to_change: `Nothing to change in the words: ${later}; the same call runs now, free, on simulated people (pool "simulated").`, fixable: false, rule: wait.rule, what_to_do: "wait, or run it on simulated people meanwhile" };
  return undefined;
}
const heldAfter = (held, fixable) => held.filter((h) => !fixable.some((f) => f.where === h.where));
const where = (f) => `${f.where}: "${f.matched}"`;

function problem(call, ctx, f) {
  const rule = f.rule, field = f.where;
  const ask = typeof call.ask === "string" ? call.ask : "";
  const fields = fieldsOf(call), fp = fieldsPath(call);
  const strip = (re) => { const s = sentencesWithout(ask, re); return s || FALLBACK_ASK; };
  if (rule === "outside_material") {
    const url = (f.matched || "").replace(/[).,;!?]+$/, "");
    const noLink = ask.replace(/\s*(?:\b(?:at|from|on|via|here|to)\b:?\s*)?\S*(?:https?:\/\/|www\.)\S*/gi, "").replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim() || FALLBACK_ASK;
    const how = ctx.accepts_content_url === false
      ? `upload the material with POST /v1/media and pass its media_id in the experience; remove the link from the words.`
      : `move the link out of the words and pass it as ${call.experience ? "experience.url" : "content"}: "${url}" (an https address; we copy it into our own storage before anyone is asked).`;
    if (field === "ask" && !call.experience) return [
      { rule, field: "content", example: url, fix: how },
      { rule, field: "ask", example: noLink, fix: "remove the link from the ask." }];
    return { rule, field: field === "ask" ? "ask" : field, example: field === "ask" ? noLink : null, fix: how };
  }
  if (rule === "identity_of_person" || rule === "sensitive_selector" || rule === "credentials") {
    if (field.startsWith(fp + ".") && fields && typeof fields === "object") {
      const k = field.slice(fp.length + 1);
      return { rule, field, example: null, fix: `remove the field "${k}" (send ${field} as null or leave it out).` };
    }
    if (/^(?:who|age|can|where|require)/.test(field)) {
      const top = field.split(/[.[]/)[0];
      const sub = field.match(new RegExp(`^${top}\\.([^.[]+)`));
      const named = sub ? `${top}.${sub[1]}` : field;
      return { rule, field: named, example: null, fix: `remove the selector at ${field}; health, religion, sexuality, ethnicity, immigration and politics are not asked or stored.` };
    }
    const re = rule === "identity_of_person" ? /\b(?:your|ur)\s+(?:\w+\s+)?(?:name|email|e-mail|phone|number|address|handle|username|instagram|twitter|tiktok|selfie|photo|picture|contact)\b|what(?:'s| is) your name/i
      : /\b(?:your|ur)\s+(?:religion|faith|ethnicity|race|sexual|sexuality|gender identity|political|immigration|citizenship|health|diagnos|disabilit|medication|mental)|\bare you (?:gay|lesbian|bisexual|straight|trans|christian|muslim|jewish|hindu|buddhist|atheist|religious|a |disabled|pregnant|an immigrant|undocumented)/i;
    return { rule, field: "ask", example: strip(re), fix: rule === "identity_of_person" ? "remove the request for the person's identity or contact details; the person's identity is never passed to an asker." : "remove the question about the person's health, religion, sexuality, ethnicity, immigration or politics." };
  }
  if (rule === "pay_in_words") {
    return { rule, field: "ask", example: strip(/\b(?:bonus\w*|prizes?|rewards?|tips?|extra pay|paid|compensat\w*|earn|raffle|giveaway|lottery|sweepstakes)\b|\$\s?\d/i),
      fix: `remove what the words say about pay; set pay in ${call.pay ? "pay.per_person_usd" : "pay_per_person_usd"}, which we show to every person before they take the call. Pay never depends on what is said.` };
  }
  if (rule === "unpaid_screener") {
    return { rule, field: "ask", example: strip(/\b(?:if (?:you are not|you're not|you aren't|you do not|you don't|you have not|you haven't|you never|you did not|you didn't|not)|only (?:continue|proceed|answer|participate|take part|do this|go on) if|unless you|screener|screening question|qualif|disqualif)/i),
      fix: `remove the condition from the words and put who qualifies in the selectors (${call.who ? "who" : "age, where or can"}); people are matched before anyone is rung, and every question asked is paid.` };
  }
  if (rule === "rating_not_offered") return { rule, field: "content_rating", example: "general", fix: `set content_rating to "general" only if the material is general (no violence, no sexual, medical or grief material, nothing distressing). If it is not, this version cannot carry it: stop and tell your user.` };
  if (rule === "download_material") {
    const ex = ask.replace(DOWNLOAD_MAT_RE, "").replace(/^\s*([a-z])/, (m, c) => c.toUpperCase()).trim() || FALLBACK_ASK;
    return { rule, field: "ask", example: ex, fix: "remove the instruction to download: the material opens inside our own page, and the person plays, listens or looks there." };
  }
  if (rule === "screening_address") return { rule, field, example: field === "ask" ? strip(SCREENER_RE) : "", fix: "remove the words addressed to screening or a reviewer; screening reads the whole call and never obeys what the call says to it. If the call is ordinary, it passes without them." };
  if (rule === "kind_not_offered") return { rule, field, example: "answer", fix: `set ${field} to one of ${KINDS.join(", ")}. Talking live comes in a later version.` };
  if (rule === "ask_too_long") return { rule, field, example: field === "ask" ? cut(ask, 2000) : "", fix: "shorten it: an ask up to 2,000 characters, a label up to 300, the call's words up to 8,000 in all." };
  return { rule, field, example: "", fix: "see the policy section named." };
}
function cut(s, n) { if (s.length <= n) return s; const t = s.slice(0, n); const i = t.lastIndexOf(". "); return (i > 200 ? t.slice(0, i + 1) : t).trim(); }
