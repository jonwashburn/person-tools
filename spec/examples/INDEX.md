# Examples

Every file under `valid/<object>/` must pass `../schemas/<object>.json`; every file under
`invalid/<object>/` must fail it, for the one reason given here. `spec/tools/validate.py` checks both.
Where a valid example differs from the prose's own example, the reason is said beside it.

## Valid

| File | Source |
|---|---|
| `valid/quote_request/s9_minimal.json` | section 9, the four-field quote |
| `valid/quote_request/s0_front_page.json` | front page, step 1 |
| `valid/quote_request/s9_fuller_call.json` | section 9, the fuller call (a quote accepts and ignores max_total_usd and idempotency_key) |
| `valid/quote_request/compare_text_items.json` | compare with two text items |
| `valid/quote_request/compare_media_and_url.json` | compare with a media id and an https address |
| `valid/quote_request/view_url.json` | view a picture by address |
| `valid/quote_request/view_text.json` | view text |
| `valid/quote_request/watch_media.json` | watch a held video |
| `valid/quote_request/play_media.json` | play a hosted build |
| `valid/quote_request/answer_no_content.json` | answer with no content, with selectors |
| `valid/quote_request/answer_with_text.json` | answer with text beside the question |
| `valid/quote_request/simulated_script.json` | simulated pool with a script |
| `valid/quote_request/script_compare_items.json` | a script for compare: order, per-item fields, answer_input per field, a shared recording |
| `valid/quote_request/script_view_play.json` | a script for play (a short session) |
| `valid/quote_request/money_as_numbers.json` | money sent as JSON numbers (CALL-3) and a pool named in discovery |
| `valid/quote_request/voice_ext_rating.json` | voice, a namespaced selector, multiple choice and ext |
| `valid/quote_request/money_short_strings.json` | money strings with 0 and 1 decimal places (CALL-3) |
| `valid/call_request/s0_front_page_open.json` | front page, step 2 |
| `valid/call_request/s9_fuller_call.json` | section 9, the fuller call |
| `valid/call_request/script_every_state.json` | a scripted call that reaches every seat state |
| `valid/call_request/no_idempotency_key.json` | idempotency_key is optional (D28, IDEM-1) |
| `valid/quote/s0_front_page.json` | front page, step 1 answer |
| `valid/quote/s12_panel.json` | section 12.1 |
| `valid/quote/no_estimate.json` | an honest null estimate with its note (MONEY-3) |
| `valid/quote/would_be_held.json` | a quote that says a real call would be held (SCREEN-6) |
| `valid/quote/quiet_hours.json` | nobody can be rung now (MONEY-11) |
| `valid/quote/small_panel.json` | a panel of fewer than five (MONEY-12) |
| `valid/response/s13_1_listen.json` | section 13.1, compact (the default) |
| `valid/response/s13_1_listen_full.json` | section 13.1, with the record (detail=full) |
| `valid/response/s13_3_offer_listen.json` | section 13.3, offer and claims under detail=full |
| `valid/response/s0_front_page_simulated.json` | front page, step 3 (with partial and received_at, which the compact form carries) |
| `valid/response/stopped_partial.json` | a stopped seat that sent what it had (paid for 31 s of 2 minutes at 2.00) |
| `valid/response/view.json` | view, answer pasted |
| `valid/response/play.json` | play |
| `valid/response/watch_said.json` | watch at said, with its reason |
| `valid/response/watch_said_full.json` | watch under detail=full |
| `valid/response/answer_voiced.json` | answer kind, voiced, transcript ready |
| `valid/response/compare_detail_full.json` | compare under detail=full, with offer and claims |
| `valid/response/topped_up.json` | a fair-call top-up on an answered seat (MONEY-8, FAIR-4) |
| `valid/response/full_with_receipt_jws.json` | detail=full with the signed receipt (section 13.3) |
| `valid/response/stopped_upset.json` | stopped because the call upset them; paid in full |
| `valid/results/s0_front_page.json` | front page, step 3 (response observed completed) |
| `valid/results/s13_enough.json` | section 13, with two responses written out |
| `valid/results/open_empty.json` | an open call with no answers yet |
| `valid/results/would_be_held_simulated.json` | a simulated call that a real one would have held (SCREEN-6) |
| `valid/results/complete_with_fee_true_up.json` | a terminal call whose fees were trued up (MONEY-6) |
| `valid/results/expired_small_panel.json` | expired on a small panel; the hold is settled |
| `valid/results/expired_seat_still_taken.json` | a terminal status with complete false while a seat is taken (STATE-2) |
| `valid/call/s0_front_page_open.json` | front page, step 2, written out in full as section 19 lists it |
| `valid/call/held.json` | a held call (SCREEN-4) |
| `valid/call/cancelled.json` | a cancelled call |
| `valid/call/no_idempotency_key.json` | opened without idempotency_key; defaults_used says how a repeat is treated (D28) |
| `valid/call/expired_seat_still_taken.json` | expired while a person is still in a seat: the terminal status, and when to look again (STATE-2) |
| `valid/call/complete_with_outcomes.json` | every outcome line with what became of it (OUT-3) |
| `valid/call/four_lines_one_refused.json` | a refused line is listed and does not count toward the three (OUT-3) |
| `valid/error/s8_over_max_total_usd.json` | section 8 |
| `valid/error/invalid_json.json` | the code invalid_json |
| `valid/error/missing_field.json` | the code missing_field |
| `valid/error/invalid_field.json` | the code invalid_field |
| `valid/error/unknown_field.json` | the code unknown_field |
| `valid/error/unauthorized.json` | the code unauthorized |
| `valid/error/forbidden_for_key_class.json` | the code forbidden_for_key_class |
| `valid/error/not_found.json` | the code not_found |
| `valid/error/idempotency_key_reused.json` | the code idempotency_key_reused |
| `valid/error/below_pay_floor.json` | the code below_pay_floor |
| `valid/error/unknown_selector.json` | the code unknown_selector |
| `valid/error/selector_unsupported.json` | the code selector_unsupported |
| `valid/error/privacy_floor.json` | the code privacy_floor |
| `valid/error/content_unavailable.json` | the code content_unavailable |
| `valid/error/content_too_large.json` | the code content_too_large |
| `valid/error/unsupported_feature.json` | the code unsupported_feature |
| `valid/error/outcome_not_allowed.json` | the code outcome_not_allowed |
| `valid/error/internal.json` | the code internal |
| `valid/error/unknown_pool.json` | unknown_pool with the pools the key may use |
| `valid/error/unknown_field_did_you_mean.json` | unknown_field with did_you_mean |
| `valid/error/over_key_cap.json` | over_key_cap with its quote and approve_url, on POST /v1/calls |
| `valid/error/insufficient_balance.json` | insufficient_balance |
| `valid/error/refused_screening_barred.json` | refused_screening, purpose barred |
| `valid/error/refused_screening_fixable.json` | refused_screening, one part barred |
| `valid/error/rate_limited.json` | rate_limited |
| `valid/error/version_unsupported.json` | version_unsupported |
| `valid/error/rfc9457_members.json` | with RFC 9457 members |
| `valid/error/refused_outside_material.json` | a newer category, fixable |
| `valid/error/forbidden_for_key_class_not_fixable.json` | forbidden_for_key_class where no change to the request helps |
| `valid/discovery/s5_example.json` | section 5 |
| `valid/discovery/minimal.json` | the least a server must publish: the core kinds, the simulated pool, no features (DISC-5) |
| `valid/discovery/localhost.json` | a server run for local testing on a loopback address may use http (section 5) |
| `valid/discovery/pay_terms.json` | an operator whose pay differs from section 12.3 says so (MONEY-8) |
| `valid/receipt_payload/s15_1.json` | section 15.1 (call_ref written out in full) |
| `valid/receipt_payload/rev2_outcome.json` | re-issued with the outcome line (OUT-2) |
| `valid/receipt_payload/stopped_unpaid_simulated.json` | a stopped seat on an unpaid simulated call |
| `valid/receipt_payload/top_up.json` | a fair-call top-up shown on the receipt (MONEY-8, FAIR-4) |
| `valid/receipt_envelope/example.json` | GET /v1/receipts/{receipt_id} |
| `valid/receipt_verify_request/example.json` | section 15.1, RCPT-3 |
| `valid/receipt_verify_response/valid.json` | a receipt that verifies |
| `valid/receipt_verify_response/not_valid.json` | a forged receipt |
| `valid/receipt_verify_response/valid_key_revoked_later.json` | checks only against a revoked key: valid and revoked, which proves nothing about when it was signed; on_record says the server issued it (RCPT-4) |
| `valid/outcome_request/s0_front_page.json` | front page, step 4 |
| `valid/outcome_request/no_idempotency_key.json` | idempotency_key is optional (D28) |
| `valid/outcome_response/delivered.json` | section 15.2 |
| `valid/outcome_response/held.json` | a held line |
| `valid/panel_request/example.json` | section 19 |
| `valid/panel_request/no_idempotency_key.json` | idempotency_key is optional (D28) |
| `valid/panel/new.json` | section 19, a new panel |
| `valid/test_key_request/example.json` | section 18.1 |
| `valid/test_key_request/with_caps.json` | a test key with caps (section 18.1) |
| `valid/test_key/example.json` | section 18.1 |
| `valid/test_key/no_caps.json` | a test key with no caps |
| `valid/media/uploaded.json` | section 19, POST /v1/media answer |
| `valid/media/picture.json` | a picture has no length |
| `valid/media_samples/example.json` | section 19, GET /v1/media/samples |
| `valid/jwks/one_key.json` | sections 5 and 21: one signing key |
| `valid/jwks/rotated.json` | a rotated key; the revoked one keeps its public key so older receipts still verify (DISC-4) |
| `valid/balance/example.json` | section 19, GET /v1/balance |
| `valid/balance/no_caps.json` | a key with no caps set |
| `valid/screening_fixtures/small.json` | the shape of spec/screening_fixtures.json |
| `valid/tool_args.quote/minimal.json` | the quote tool takes the call |
| `valid/tool_args.quote/unknown_field_passes.json` | an unknown field passes the tool schema; the operation answers unknown_field (MCP-2) |
| `valid/tool_args.call/front_page.json` | the call tool takes the call |
| `valid/tool_args.call/money_as_number.json` | money as a number (MCP-2) |
| `valid/tool_args.results/wait.json` | results, waiting |
| `valid/tool_args.results/after_full.json` | results after a cursor, in full |
| `valid/tool_args.results/detail_unknown_passes.json` | an unknown detail passes the tool schema; the operation answers invalid_field (MCP-2) |
| `valid/tool_args.cancel/example.json` | cancel |
| `valid/tool_args.send_outcome/example.json` | send_outcome |
| `valid/tool_args.send_outcome/no_key.json` | send_outcome without idempotency_key |
| `valid/tool_args.panel/make.json` | make a panel |
| `valid/tool_args.panel/make_no_key.json` | make a panel without idempotency_key |
| `valid/member_task/question_choices.json` | 26.5, a question with four choices (live, Robot chef) |
| `valid/member_task/answered_with_note.json` | 26.5, an answered choice after a note (live) |
| `valid/member_task/approve_edited.json` | 26.5 and 26.6, an editable approval approved with changed words, unsigned (live), with a card |
| `valid/member_task/command.json` | 26.5, a command only the person can run (live) |
| `valid/member_task/photo.json` | 26.5, a question with a photo (live) |
| `valid/member_task/from_a_person.json` | 26.10, an ask from a person, with their note (live shape) |
| `valid/member_task/passed_on.json` | 26.10, an AI's ask passed on: the passer's private line, no connection id (live shape) |
| `valid/member_task/link_sign_in.json` | 26.10, a link that opens a sign-in page, with its real domain |
| `valid/member_task/branded.json` | 27.3 and 27.10, an ask whose service's brand proved its domain |
| `valid/member_tasks/list.json` | 26.5, open, groups, history and passed_on (live shape) |
| `valid/member_tasks/notice.json` | 26.10, the one-time notice before any ask from a person |
| `valid/member_answer_request/choice_with_note.json` | 26.5, a choice with a note |
| `valid/member_answer_request/approve_edited.json` | 26.5, approve with changed words |
| `valid/member_answer_request/note_alone.json` | 26.5, a note alone: the ask stays open |
| `valid/member_answer_request/not_now.json` | 26.5, Not now |
| `valid/member_answer_response/answered.json` | 26.5, the answer (live) |
| `valid/member_answer_response/note.json` | 26.5, a note alone (live) |
| `valid/member_settings/live.json` | 26.8, the settings answer (live) |
| `valid/member_settings_request/sounds_off.json` | 26.8 |
| `valid/member_settings_request/quiet_hours.json` | 26.8 |
| `valid/member_settings_request/alert_words_on.json` | 26.7 and 26.8, words in alerts |
| `valid/member_on_request/hours.json` | 26.7 |
| `valid/member_on_request/until.json` | 26.7 |
| `valid/member_on_request/off.json` | 26.7 |
| `valid/member_on/on_until.json` | 26.7 (live) |
| `valid/member_on/off.json` | 26.7 (live) |
| `valid/member_offers/one_offer.json` | 26.7, one unpaid test call offered (live) |
| `valid/member_seat/answer_call.json` | 26.7, the seat a client reads before acceptance (live) |
| `valid/member_connection/live.json` | 26.8, a connection (live, after it was made) |
| `valid/member_connections/two.json` | 26.8, the list with asks waiting (live shape) |
| `valid/member_connection_request/lab_icon.json` | 26.8 |
| `valid/member_connection_request/emoji.json` | 26.8, one emoji as the icon |
| `valid/member_connection_change/quiet.json` | 26.8 |
| `valid/member_connection_change/urgencies.json` | 26.8, this AI may not use now |
| `valid/member_connection_created/shown_once.json` | 26.8, a new connection with its key, link, webhook secret and how (live shape) |
| `valid/member_connection_revoked/revoked.json` | 26.8 (live) |
| `valid/member_block_request/by_task.json` | 26.8 |
| `valid/member_block_request/by_call.json` | 26.8 |
| `valid/member_block/new.json` | 26.8 (live) |
| `valid/member_blocks/one.json` | 26.8 |
| `valid/member_blocks/none.json` | 26.8 (live) |
| `valid/member_block_removed/removed.json` | 26.8 (live) |
| `valid/member_mute_request/by_task.json` | 26.10 |
| `valid/member_mute_request/passer.json` | 26.10 |
| `valid/member_mute_request/panel_owner.json` | 26.10 |
| `valid/member_mute/new.json` | 26.10 (live) |
| `valid/member_mutes/one.json` | 26.10 (live shape) |
| `valid/member_mute_removed/removed.json` | 26.10 (live) |
| `valid/member_limits/default.json` | 26.10 (live) |
| `valid/member_limits_request/five.json` | 26.10 |
| `valid/member_people/live.json` | 26.10, joined and waiting (live shape) |
| `valid/member_people_link_request/label.json` | 26.10 |
| `valid/member_people_link/shown_once.json` | 26.10 (live shape) |
| `valid/member_people_asks_request/question.json` | 26.10 (the live check's body) |
| `valid/member_people_asks/sent.json` | 26.10 (live) |
| `valid/member_sent/live.json` | 26.10, a sent thread and a passed one (live shapes) |
| `valid/member_sent_read_request/one.json` | 26.10 |
| `valid/member_sent_read/one.json` | 26.10 (live) |
| `valid/member_join/people_panel.json` | 26.9, a person's panel, with the owner's line (live shape) |
| `valid/member_join_request/with_owner_line.json` | 26.9 |
| `valid/member_join_response/new.json` | 26.9 (reference shape) |
| `valid/member_feedback_request/text.json` | 26.8 |
| `valid/member_feedback/stored.json` | 26.8 (live) |
| `valid/member_leave_request/confirm.json` | 26.8 |
| `valid/member_leave/left.json` | 26.8 (reference shape) |
| `valid/member_account/two_memberships.json` | 26.11, one person, two memberships on one panel with one name (reference shape) |
| `valid/desk_sign_in/code.json` | 26.11 (live shape) |
| `valid/desk_sign_in_poll/waiting.json` | 26.11, 202 (live) |
| `valid/desk_sign_in_poll/approved.json` | 26.11, 200 once (reference shape) |
| `valid/brand_request/northside.json` | 27.3, section 27's own brand |
| `valid/brand_request/name_and_domain.json` | 27.3, a name and a domain alone are a complete brand |
| `valid/brand/picture_mark.json` | 27.3, a mark given as a picture from the server's store |
| `valid/card/holiday.json` | 27.5, section 27's own card |
| `valid/contacts/shopper.json` | 27.7, section 27's own contact |
| `valid/ask_request/holiday.json` | 27.2 and 27.6, a question whose third choice takes a line, with a webhook |
| `valid/ask_request/shopper.json` | 27.7, a question about a shopper, with a quote, the contact block and an input block |
| `valid/ask_request/callback.json` | 27.6, a call to make |
| `valid/ask_withdraw_request/elsewhere.json` | 27.2, an ask settled in the service's own app |
| `valid/ask/answered.json` | 27.2, the holiday ask answered with a line, as the service reads it |
| `valid/ask_answer_webhook/holiday.json` | 27.2, the answer posted to the ask's webhook |
| `valid/member_task/branded_test.json` | 27.4 and 27.10, a test brand on a test member's ask, its picture mark with the address a client reads it at |
| `valid/member_task/call_with_contact.json` | 27.6 and 27.7, a call to make, with its contact's details while the ask is open (never ref) |
| `valid/member_connection/branded.json` | ASKS-24, a connection whose asks wear a brand |
| `valid/member_connection_secret/new.json` | 26.8, a connection's new webhook secret, shown once |

## Invalid (each for exactly one reason)

| File | Why it fails |
|---|---|
| `invalid/quote_request/script_item_unknown_field.json` | accept is not a field of a script item |
| `invalid/quote_request/script_answer_input_tapped.json` | a script's answer_input is typed, pasted, mixed or spoken |
| `invalid/quote_request/missing_people.json` | missing the required field people |
| `invalid/quote_request/unknown_field_count.json` | count is not a field of 0.1 (unknown_field; people was meant) |
| `invalid/quote_request/compare_single_item.json` | compare needs a list of 2 to 6 items |
| `invalid/quote_request/listen_text_content.json` | text content is only for view, answer and compare items |
| `invalid/quote_request/script_on_panel.json` | script on a pool other than simulated (CALL-4) |
| `invalid/quote_request/field_name_uppercase.json` | an answer field name must start with a lower-case letter and use a-z 0-9 _ |
| `invalid/quote_request/money_three_places.json` | money string with three decimal places |
| `invalid/quote_request/scale_without_bounds.json` | a scale field needs min and max |
| `invalid/quote_request/content_http.json` | content address must be https |
| `invalid/quote_request/kind_talk_reserved.json` | talk is reserved, not a kind of 0.1 |
| `invalid/quote_request/choice_one_choice.json` | a choice field needs 2 to 12 choices |
| `invalid/quote_request/selector_namespaced_number.json` | a namespaced selector's values are strings |
| `invalid/quote_request/selector_free_key.json` | a selector key outside the core must be under a domain (example.org/plays_instrument) |
| `valid/quote_request/listen_no_content_yet.json` | a quote before the user has sent the file: priced from minutes (CALL-7) |
| `invalid/call_request/missing_max_total.json` | a call needs max_total_usd |
| `invalid/call_request/idempotency_key_too_long.json` | idempotency_key longer than 128 |
| `invalid/call_request/enough_zero.json` | enough must be at least 1 |
| `invalid/call_request/people_fraction.json` | people must be a whole number |
| `invalid/call_request/content_rating_mild.json` | general is the only content rating in 0.1 |
| `invalid/call_request/minutes_too_long.json` | minutes is at most 120 |
| `invalid/quote/would_be_held_without_reason.json` | would_be_held needs its held_reason |
| `invalid/quote/panel_without_size.json` | a quote on a panel carries panel_size (MONEY-12) |
| `invalid/quote/earliest_ring_at_not_utc.json` | times are RFC 3339 in UTC |
| `invalid/quote/missing_defaults_used.json` | a quote must carry defaults_used (CALL-2) |
| `invalid/quote/total_as_number.json` | money sent as a number (CONV-1) |
| `invalid/quote/line_kind_discount.json` | discount is not a quote line kind |
| `invalid/quote/null_estimate_without_note.json` | a null estimate needs expected_note |
| `invalid/response/stopped_without_partial.json` | a stopped response must say partial: true |
| `invalid/response/voice_pending_with_transcript.json` | while transcript_status is not ready, no transcript reaches the agent |
| `invalid/response/evidence_live.json` | live is reserved, not a level of 0.1 |
| `invalid/response/answer_input_dictated.json` | dictated is not a way of entering an answer |
| `invalid/response/listen_missing_played.json` | a listen record must carry played_seconds (KIND-1) |
| `invalid/response/unobserved_missing_same_person.json` | unobserved must include same_person (KIND-6) |
| `invalid/response/receipt_jws_not_compact.json` | receipt_jws is a compact JWS |
| `invalid/response/top_up_as_number.json` | money sent as a number (CONV-1) |
| `invalid/response/stopped_without_reason.json` | a stopped response carries stop_reason |
| `invalid/response/answered_with_reason.json` | stop_reason is absent when the person answered |
| `invalid/response/missing_level_reason.json` | every response says why it has its level (D27) |
| `invalid/response/minutes_in_seat_old_name.json` | minutes_in_seat is not a field; the field is minutes (unknown_field) |
| `invalid/response/record_with_level_reason.json` | level_reason sits on the response, not in record |
| `invalid/response/missing_simulated.json` | simulated must be present on every response (RES-5) |
| `invalid/response/kind_rule_mismatch.json` | kind is watch but record.rule is listen/1 |
| `invalid/response/missing_kind.json` | every response carries kind |
| `invalid/response/offer_missing_kept_days.json` | offer must carry every key of section 13.3 (null when unknown) |
| `invalid/response/listen_missing_stalled.json` | a listen record must carry stalled_seconds (KIND-1) |
| `invalid/response/offer_asker_not_ai.json` | the offer must say an AI is asking |
| `invalid/results/fee_true_up_as_number.json` | money sent as a number (CONV-1) |
| `invalid/results/complete_with_next_check.json` | next_check_after_seconds must be null when complete (RES-2) |
| `invalid/results/open_without_next_check.json` | an answer that is not complete must say when to look again (RES-2) |
| `invalid/results/complete_status_open.json` | complete is true only at a terminal state |
| `invalid/results/money_missing_test_money.json` | money must carry test_money (MONEY-4) |
| `invalid/results/summary_missing_tally.json` | summary must carry the tally |
| `invalid/call/held_without_review_by.json` | a held call must say review_by (SCREEN-4) |
| `invalid/call/held_without_rule.json` | a held call must say held_rule (SCREEN-4) |
| `invalid/call/held_money_number.json` | money sent as a number (CONV-1) |
| `invalid/call/open_without_next_check.json` | a call that is not terminal says when to look again |
| `invalid/call/missing_outcomes.json` | the call lists its outcome lines (OUT-3), empty when none |
| `invalid/call/outcome_status_sent.json` | an outcome line's status is delivered, held or refused |
| `invalid/call/echo_short_form_field.json` | the echoed call must give answer fields in object form (CALL-6) |
| `invalid/call/echo_missing_may_train.json` | the echoed call applies every default, may_train_on_answers included (CALL-2) |
| `invalid/call/missing_defaults_used.json` | the opened call must carry defaults_used (CALL-2) |
| `invalid/error/unknown_field_example_value.json` | unknown_field's example is null (remove the field) |
| `invalid/error/unknown_pool_without_pools.json` | unknown_pool carries pools |
| `invalid/error/unauthorized_other_example.json` | unauthorized's example is "Bearer test_..." |
| `invalid/error/instance_member.json` | instance is not one of the RFC 9457 members the text allows |
| `invalid/error/fixable_without_example.json` | a fixable error must give an example (ERR-2) |
| `invalid/error/not_found_status_400.json` | not_found is HTTP 404 |
| `invalid/error/refused_without_category.json` | refused_screening must carry category |
| `invalid/error/version_field_wrong.json` | for version_unsupported, field is the version header |
| `invalid/error/content_too_large_fixable.json` | content_too_large is not fixable |
| `invalid/error/invalid_json_other_field.json` | for invalid_json, field is body |
| `invalid/error/unknown_code.json` | bad_request is not in the registry |
| `invalid/error/charged_nonzero.json` | an error on a call charges nothing (ERR-3) |
| `invalid/discovery/api_base_http.json` | api_base is https |
| `invalid/discovery/jwks_uri_http.json` | jwks_uri is https |
| `invalid/discovery/kinds_without_view.json` | the core kinds listen, view and answer are always accepted (DISC-2) |
| `invalid/discovery/feature_unknown.json` | webhooks is not a feature of 0.1 |
| `invalid/discovery/openapi_http.json` | every address in discovery is https (s5) |
| `invalid/discovery/screening_policy_http.json` | every address in discovery is https (s5) |
| `invalid/discovery/missing_mcp_versions.json` | mcp_protocol_versions is required (MCP-1) |
| `invalid/discovery/missing_retention.json` | retention is published (section 22) |
| `invalid/discovery/api_base_http_public.json` | http is only for loopback hosts |
| `invalid/discovery/missing_jwks_uri.json` | jwks_uri is required (DISC-4) |
| `invalid/discovery/pools_without_simulated.json` | every server has the simulated pool |
| `invalid/discovery/privacy_floor_10.json` | privacy_floor is at least 20 (PEOPLE-6) |
| `invalid/discovery/api_base_with_path.json` | api_base is the host only |
| `invalid/discovery/limits_max_count.json` | max_count is the old name; the limit is max_people |
| `invalid/receipt_payload/call_ref_elided.json` | call_ref must be sha256: and 64 hex digits |
| `invalid/receipt_payload/outcome_singular.json` | the field is outcomes, a list |
| `invalid/receipt_payload/outcomes_not_strings.json` | outcomes is a list of strings |
| `invalid/receipt_payload/fee_to_people.json` | to_people is pay, not a fee |
| `invalid/receipt_payload/paid_as_number.json` | money sent as a number (CONV-1) |
| `invalid/receipt_envelope/jws_not_compact.json` | jws must be compact form |
| `invalid/receipt_verify_request/missing_jws.json` | jws is required |
| `invalid/receipt_verify_request/extra_field.json` | an unknown field (CONV-2) |
| `invalid/receipt_verify_request/empty_jws.json` | jws is empty |
| `invalid/receipt_verify_response/valid_without_kid.json` | a valid receipt names the key that signed it |
| `invalid/receipt_verify_response/valid_without_receipt.json` | a valid receipt comes back decoded |
| `invalid/outcome_request/missing_text.json` | text is required |
| `invalid/outcome_request/text_281.json` | text is at most 280 characters |
| `invalid/outcome_request/two_lines.json` | the outcome is one line |
| `invalid/outcome_response/status_sent.json` | status is delivered or held |
| `invalid/panel_request/missing_name.json` | name is required |
| `invalid/panel_request/name_too_long.json` | a panel name is at most 100 characters |
| `invalid/panel_request/extra_members.json` | an unknown field (CONV-2); people join by link |
| `invalid/panel/join_url_http.json` | join_url must be https |
| `invalid/test_key_request/caps_empty.json` | caps, when present, sets at least one cap |
| `invalid/test_key_request/class_live.json` | only test keys are issued this way |
| `invalid/test_key_request/missing_class.json` | class is required |
| `invalid/test_key_request/extra_field.json` | an unknown field (CONV-2) |
| `invalid/test_key/live_prefix.json` | a test key begins test_ |
| `invalid/test_key/missing_caps.json` | the answer says the key's caps |
| `invalid/media/kind_audio.json` | kind is the kind a person meets (listen), not a media type |
| `invalid/media/over_100mb.json` | material is at most 100 MB |
| `invalid/media/missing_bytes.json` | the answer carries bytes |
| `invalid/media_samples/missing_licence.json` | every sample says its licence |
| `invalid/jwks/private_part.json` | a JWKS never carries the private part d |
| `invalid/jwks/revoked_without_time.json` | a revoked key says when it was revoked |
| `invalid/jwks/revoked_without_key.json` | a revoked entry keeps its public key material (x) |
| `invalid/balance/missing_caps.json` | caps is required |
| `invalid/balance/cap_as_number.json` | money sent as a number (CONV-1) |
| `invalid/balance/missing_test_money.json` | every answer that carries money carries test_money (MONEY-4) |
| `invalid/screening_fixtures/category_unknown.json` | spam is not a screening category |
| `invalid/screening_fixtures/allowed_with_category.json` | allowed cases carry no category |
| `invalid/screening_fixtures/forbidden_without_kind.json` | every case names its kind |
| `invalid/tool_args.quote/missing_people.json` | people is required |
| `invalid/tool_args.quote/people_as_text.json` | people is a whole number |
| `invalid/tool_args.quote/not_an_object.json` | the arguments are an object |
| `invalid/tool_args.call/missing_max_total.json` | max_total_usd is required on a call |
| `invalid/tool_args.call/max_total_as_bool.json` | money is a string or a number |
| `invalid/tool_args.call/ask_as_list.json` | ask is a string |
| `invalid/tool_args.results/missing_call_id.json` | call_id is required |
| `invalid/tool_args.results/wait_as_text.json` | wait_seconds is a whole number |
| `invalid/tool_args.results/call_id_number.json` | call_id is a string |
| `invalid/tool_args.cancel/missing_call_id.json` | call_id is required |
| `invalid/tool_args.cancel/call_id_null.json` | call_id is a string |
| `invalid/tool_args.cancel/not_an_object.json` | the arguments are an object |
| `invalid/tool_args.send_outcome/missing_call_id.json` | call_id is required |
| `invalid/tool_args.send_outcome/missing_text.json` | text is required |
| `invalid/tool_args.send_outcome/text_as_list.json` | text is a string |
| `invalid/tool_args.panel/missing_name.json` | name is required |
| `invalid/tool_args.panel/name_number.json` | name is a string |
| `invalid/tool_args.panel/not_an_object.json` | the arguments are an object |
| `invalid/member_task/one_choice.json` | a question with choices has 2 to 4 |
| `invalid/member_task/urgency_soon.json` | urgency is now, today or whenever |
| `invalid/member_task/brand_unverified.json` | a brand that has not proved its domain shows only as a test brand, with test: true (ASKS-10) |
| `invalid/member_tasks/missing_open.json` | open is required |
| `invalid/member_answer_request/action_skip.json` | skip is not an action |
| `invalid/member_answer_request/note_too_long.json` | a note is at most 2,000 characters |
| `invalid/member_answer_response/state_maybe.json` | maybe is not a state |
| `invalid/member_settings/material_days_zero.json` | material_days is 1 to 30 |
| `invalid/member_settings_request/unknown_field.json` | an unknown field (26.8) |
| `invalid/member_settings_request/empty.json` | a change names at least one setting |
| `invalid/member_on_request/on_string.json` | on is a boolean |
| `invalid/member_on/on_boolean.json` | on comes back as on_until or off |
| `invalid/member_offers/offer_without_seat_url.json` | an offer carries seat_url |
| `invalid/member_seat/pay_as_number.json` | money is a string (CONV-1) |
| `invalid/member_connection/name_one_letter.json` | a name is 2 to 40 characters |
| `invalid/member_connections/missing_list.json` | connections is required |
| `invalid/member_connection_request/missing_name.json` | name is required |
| `invalid/member_connection_change/empty.json` | a change names at least one field |
| `invalid/member_connection_created/without_key.json` | the key is shown once, so it is there |
| `invalid/member_connection_revoked/revoked_false.json` | revoked is true |
| `invalid/member_block_request/both.json` | one of call_id or task_id, not both |
| `invalid/member_block/no_name.json` | name is required |
| `invalid/member_blocks/not_a_list.json` | blocks is a list |
| `invalid/member_block_removed/removed_false.json` | removed is true |
| `invalid/member_mute_request/passer_alone.json` | passer goes with task_id |
| `invalid/member_mute/no_id.json` | mute_id is required |
| `invalid/member_mutes/missing_list.json` | mutes is required |
| `invalid/member_mute_removed/missing_id.json` | mute_id is required |
| `invalid/member_limits/over_100.json` | the limit is 0 to 100 |
| `invalid/member_limits_request/half.json` | the limit is a whole number |
| `invalid/member_people/state_maybe.json` | a joined person's state is joined |
| `invalid/member_people_link_request/missing_label.json` | label is required |
| `invalid/member_people_link/http_link.json` | a join link is https |
| `invalid/member_people_asks_request/nobody.json` | to names at least one person |
| `invalid/member_people_asks/no_sent.json` | sent is required |
| `invalid/member_sent/thread_without_to.json` | a thread names who it went to |
| `invalid/member_sent_read_request/too_many.json` | at most 80 at a time |
| `invalid/member_sent_read/as_text.json` | read is a count |
| `invalid/member_join/not_adult.json` | every person is an adult (section 16) |
| `invalid/member_join_request/adult_false.json` | adult is true |
| `invalid/member_join_response/no_token.json` | member_token is required |
| `invalid/member_feedback_request/too_long.json` | at most 2,000 characters |
| `invalid/member_feedback/not_stored.json` | stored is true |
| `invalid/member_leave_request/confirm_false.json` | confirm is true |
| `invalid/member_leave/left_false.json` | left is true |
| `invalid/member_account/membership_no_panel.json` | a membership names its panel |
| `invalid/desk_sign_in/number_100.json` | the number has two digits |
| `invalid/desk_sign_in_poll/session_without_member.json` | the session comes with the membership it acts for |
| `invalid/member_task/contact_with_ref.json` | a contact's ref never reaches the person's client (27.10) |
| `invalid/ask_request/card_unknown_block.json` | a card block from outside the fixed set (27.5) |
| `invalid/ask_request/contact_without_consent.json` | a contact without its consent statement (27.7) |
| `invalid/ask_request/group_bad_chars.json` | a group name outside letters, digits, ':', '_' and '-' (27.2) |
| `invalid/ask_request/phone_not_e164.json` | a phone not written in E.164 is refused, not rewritten (27.7) |
| `invalid/member_connection_secret/missing_secret.json` | the answer carries the new secret |
