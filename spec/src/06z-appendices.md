## Appendix A. Left for later, and why

| Not in 0.1 | Why |
|---|---|
| Claims a person carries between servers as signed credentials, and proving "has not met this before" across servers | No second server reads them yet, and the formats are still drafts. 0.1 keeps a person's history on one server and gives them their receipts. |
| A full shared vocabulary of claims | A vocabulary is a project of its own; five core keys and namespaced keys cover 0.1. |
| Talking live with a person (`talk`, the level `live`) | It needs its own consent, recording and safety rules. |
| Tasks away from the screen (`go`) | They need safeguards for the person and for others that 0.1 does not define. |
| Settlement by funds an agent holds, and payment on the wire | The payment rails for agents are previews with their own terms; 0.1 settles from a principal's balance outside the protocol. |
| Events pushed to the agent of a call (webhooks; an ask's answer reaches its service by one, section 27.2) | Polling with `wait_seconds` and `next_check_after_seconds` works in every client; events can be added without changing a call. |
| An asker marking an answer as not counted | Under the fair-call profile it could not change pay, and nothing in 0.1 needs it. |
| Disputes and appeals as operations | The process belongs to each server's terms until there is a second server to agree with. |
| A joint with another protocol by which an agent asks its own human to approve a spend | In 0.1 the whole of it is the `approve_url` an `over_key_cap` error carries (MONEY-5): a page where the principal's human approves. Appendix B shows how another protocol could carry it. |
| Minors | Nothing is built for them, and no call may be aimed at them. |
| An interface for adding pools to a router | It is a property of an implementation, not of the call; the reference software documents its own. |
| A person client that runs a call's experience itself, through the seat's own routes | In 0.1 a client opens the server's page for the seat (section 26.7); the routes a page uses are each server's until a second runner needs them. |
| Signed answers: the shape of a device key's attestation and of the signature over an approval | Platforms attest keys in different formats; 0.1 marks every approval with whether a device signed it (section 26.6). |
| Push to browsers and to devices other than Apple's | 0.1 defines one registration (section 26.7); a client without push looks again by itself. |
| Which statements every server must ask of a person who joins | Every person is an adult; other statements, such as where a person lives, are each server's to name (section 26.9). |

## Appendix B (informative). Composing with other protocols

- **Long-running tasks of the Model Context Protocol.** Where both sides declare tasks, `{{tool}}` may return a task whose
  result is the results of section 13. Most clients do not declare tasks yet, so the plain tools remain the binding.
- **An agent reaching its own human.** A protocol that lets an agent ask its own principal to approve something can carry
  the `approve_url` of an `over_key_cap` error. {{standard}} never defines anything about the agent's own principal.
- **Agent payments.** When agents hold budgets, a server can accept a payment credential in place of a balance; 0.2 will
  name the field.

## Appendix C (informative). Reasons for the main choices

- **One kind of server.** A router and a pool speak the same interface, so a router is a client of other call servers
  and nothing else needs defining.
- **A required simulated pool.** A server whose people answer at unknown times cannot be tested from outside without
  scripted people; an agent cannot try it free without them either.
- **A flat call with defaults echoed back.** The customer is an agent making its first call. Every required field is a
  chance to fail, and every default it did not know about is shown to it.
- **Evidence decided by the server, by rules in the text.** If each server set its own thresholds, `attended` would
  mean different things on different servers.
- **The people's rules as a profile.** A panel that pays on approval can implement the call today, listing its
  `pay_terms` (MONEY-8), and the protections when it chooses; anyone can see which it has done.
- **Receipts as signed JSON in a common format.** Every language has a library to check one; the person needs no key of
  their own.

