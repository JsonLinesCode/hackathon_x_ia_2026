# Jinko contract used by Phase 2

Discovery was run with the credentials in apps/web/.env.local before jinko.ts was written. The complete observed catalogue is [jinko-tools.json](jinko-tools.json). It contains names, input schemas and provider descriptions, without credentials. The application discovers and validates against the live input schemas again when it connects.

## Verified on 2026-09-27

- listTools(): 17 tools.
- The initial key allowed discovery but searches returned invalid_api_key. After the owner updated the key, flight_search and hotel_search succeeded.
- The final adapter was exercised against live flight_search, hotel_search and hotel_details. It parsed 6 usable fares and 135 hotel rates in that check; inventory and counts are not guarantees.
- OpenAI responded using the configured OPENAI_MODEL (gpt-6-sol in this environment). Both the actual extraction schema and ranked-option explanations were checked live.
- No trip/add_item, checkout, payment or cancellation was invoked during these read-only diagnostics. The quote/payment-link path still needs the manager's manual acceptance run after migration 0002.

## Actual MCP data

Successful searches return structuredContent = { status: "success", data: ... }. Text content is a human summary, not a JSON contract.

flight_search returns data.flights[] with outbound_departure, outbound_arrival, outbound_duration_min, outbound_segments, optional inbound_* fields, and fares[]. A fare carries trip_item_token, cabin_class, total_price as an "EUR 129.17" string, refundable and checked_bag_included. These differ from the REST response's offers[] and money objects. The adapter uses the observed MCP shape. Times without explicit offsets are excluded, not interpreted as UTC.

hotel_search returns data.hotels[].rooms[].rates[]. Each rate supplies offer_id, total_amount in major units, currency, is_refundable, optional free_cancellation_until and taxes_breakdown. Known excluded EUR taxes are added once to the estimated stay total. Unknown cancellation fees stay unknown. Budget comparisons use the exact stay total, not rounded nightly prices.

Test fixtures under apps/web/src/server/integrations/__fixtures__ are small excerpts from those real search responses. They are used only by tests; application screens never fall back to them.

## Tool mapping

| Application operation | Observed MCP tool and inputs |
| --- | --- |
| Flight search | flight_search({search:{origin, origin_type, destination, departure_date, return_date?, ...}, passengers:{adults:1}, currency:"EUR", locale}) |
| Hotel search | hotel_search({destination:{query}, checkin, checkout, occupancies:[{adults:1}], currency:"EUR", filters:{max_results}}) |
| Hotel metadata | hotel_details({hotel_id}) |
| Add selected fare/rate | trip({trip_id?, add_item:{trip_item_token}}) |
| Traveler details | trip({trip_id, upsert_travelers:{travelers, contact}}) |
| Prepare quote | checkout({trip_id}) |
| Inspect provider cart | get_trip({trip_id}) |

trip and checkout are non-idempotent in the live annotations and expose no idempotency-key input. The application records intent before each mutation, saves its returned reference, and refuses to repeat an uncertain call. An interrupted quote needs manual reconciliation. Search retries are read-only. No exactly-once guarantee across a lost remote response is claimed.

Jinko requires first/last name, passenger type and contact email/phone; flight quotes also require date of birth and gender as on the travel document. The manager enters and confirms those fields; the LLM never invents them. Quotes are grouped per traveler, keeping the flight and hotel in one cart. Optional ancillaries are explicitly declined in the confirmation form and no extras are added.

checkout provides the human payment link. The application has no callable mapping for submit_agent_payment, so it cannot complete payment. Cancellation tools exist in this catalogue but are not wired in Phase 2. Cancellation and disruption handling remain Phase 4.

The app's requested trip status booked means the quote preparation workflow finished. The booking rows remain quoted, and all screens say "Payment links ready" or "Unpaid". A provider cart reference is not a paid booking confirmation.

## References

- [Jinko MCP connection and structuredContent](https://docs.gojinko.com/connect/mcp)
- [API keys and environment separation](https://docs.gojinko.com/authentication/api-keys)
- [Trip](https://docs.gojinko.com/tools/trip)
- [Checkout](https://docs.gojinko.com/tools/checkout)
- [Money units](https://docs.gojinko.com/concepts/money)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
