## Appendix D (informative). The core in a day

The smallest server that conforms has only the simulated pool, the kinds `listen`, `view` (with `{text}`) and `answer`,
and no optional features. It is what a developer runs to test an agent, and it is the first step of a server with real
people. Two test builds were written from this text alone by builders who had not seen it before, each about 2,000 lines of
Python, each in under an hour; the first conformance run against one of them passed 53 of its 65 checks. (They test the
text and are not counted as adoption, section 25.) This appendix gives an order for that work, with the requirements
each step must meet.

| Step | What to build | Requirements |
|---|---|---|
| 1 | Discovery at `/.well-known/{{wire_prefix}}`, the version header, JSON everywhere | DISC-1, DISC-2, DISC-4, DISC-5, VER-1, VER-2, HTTP-2, HTTP-4 |
| 2 | Test keys (`POST /v1/keys`), bearer keys, the two key classes; keyless calls if you list `keyless` | AUTH-1 to AUTH-5, SIM-6 |
| 3 | The error object and its codes; strict bodies with `ext`; the order of errors | ERR-1 to ERR-3, CONV-1 to CONV-4, CALL-1 |
| 4 | The call: validation, defaults echoed, money in either form, field short forms | CALL-2, CALL-3, CALL-4, CALL-6 |
| 5 | The quote: lines that sum, `test_money`, an honest estimate, screening at the quote | MONEY-1 to MONEY-4, SCREEN-1 |
| 6 | Opening, holding and settling; idempotency | MONEY-5 to MONEY-9, IDEM-1 to IDEM-4, STATE-1 to STATE-5 |
| 7 | The simulated pool: scripts, defaults, virtual time, labels, a different person for each seat | SIM-1 to SIM-5, SIM-7, PEOPLE-8 |
| 8 | What is recorded for listen, view and answer, and the evidence rules in decimal | KIND-1, KIND-4 to KIND-6, EVID-1 to EVID-4 |
| 9 | Results: summary and tally, compact and full responses, waiting, the cursor | RES-1 to RES-9 |
| 10 | Receipts as compact JWS with Ed25519, the JWKS, verification | RCPT-1 to RCPT-4 |
| 11 | Screening: a policy page, the fixtures refused or held, holds on the simulated pool | SCREEN-2 to SCREEN-7, PEOPLE-1 |
| 12 | The tool binding: handshake, six tools (or four, without `outcome` and `panels`), annotations | MCP-1 to MCP-6 |
| 13 | Samples, rate limits, security and privacy | HTTP-1, HTTP-3, HTTP-5, SEC-1 to SEC-3, PRIV-1, PRIV-2, RES-7 |

Not needed for the core: panels (PEOPLE-3, PEOPLE-4, MONEY-12), selectors beyond refusing unknown ones (PEOPLE-5 to
PEOPLE-7), fetching addresses (CALL-5), voice, the outcome line (OUT-1 to OUT-3) and the fair-call profile.

Run the conformance suite against it (section 25) after step 6 and after every step from then on: each step adds
passing checks without breaking earlier ones.
