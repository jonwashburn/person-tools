# Conformance suite, version 0.1.0-draft.1

Checks a call server against the standard's text, version 0.1 (draft), from outside, with a test key, through the
simulated pool. It was written from `spec/src/` alone; it has never read a server's code.

    code/conformance/run https://api.example.com
    code/conformance/run https://api.example.com --key-file ./my_test_key.env --profile fair-call --json report.json

- `--key-file` reads `TEST_KEY=...` from a file and never prints it. Without a key it makes test keys through discovery's `test_keys` (two: the second checks that another principal's
  calls read as `not_found`).
- `--no-mcp` skips the tool binding; `--only Q01,C05` runs some checks; `--list` lists them; `--trace` prints every
  requirement no check tests, with the reason; `--write-trace traceability.md` regenerates the table.
- It sends at most one request a second and stops itself after 900 seconds (`--budget`); a server with every feature takes about twelve minutes.
- Each line is `PASS|FAIL|SKIP <check> <requirements> <what it saw>`. The exit status is 0 only when nothing failed.

A server with no FAIL may say exactly: "passes suite 0.1.0-draft.1 against the standard 0.1 core", and for each profile it
declares and passed (`--profile fair-call`), the profile's name. Nothing more (section 25). A pass by an implementation
written to test this text is a test of the text, not adoption.

`traceability.md` maps every requirement id in the text (and the FAIR rules of section 23) to its checks or the reason it has none.
`NOTES.md` lists the places the text was ambiguous while the suite was written.

Sections 26 (the person's side) and 27 (asks from a service, their brands and cards) run when the server lists
`person_client` and `branded_asks`. They need a test member (26.13): the suite makes one through discovery's
`test_members` with its test key, or takes one with `--member-file FILE` (a file holding `MEMBER_TOKEN=...`, never printed)
from a server that documents another setup step. Every ask they place is withdrawn and every AI they connect removed at the
end; a member the run made leaves. The answer's webhook, its retries and one alert per group reach a receiver or a device
the suite does not have; `traceability.md` says so for each.
