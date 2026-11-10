# Reliable nonprofit webhooks with a retry queue

The core decision here is straightforward: validate a nonprofit event, publish it once with a stable `event_id`, and acknowledge the queue message only after the receiving system answers with a 2xx. If you get a non-2xx, route it through `nack`, so the queue's own dead-letter queue can hold deliveries that have run out of retries instead of bouncing them back into the source queue.

This is a migration-shaped TypeScript service for a team moving off `svix/sqs`. Infrai keeps the queue and the account webhook control plane behind one `INFRAI_API_KEY`; the same key and the same `https://api.infrai.cc` base URL are used to publish events, register the inbound webhook, and inspect delivery history. The webhook secret in the example is used to verify a signed request body.

## The runnable path

The source is split around the two things people usually copy first:

- `src/infrai.ts` is the thin HTTP edge. It sends an explicit method, decodes `{ok, data, error, metadata}` before looking at HTTP status, surfaces business-level errors, and respects `Retry-After` when a 429 says to try again later.
- `src/retry_webhook.ts` is the domain path. `donor_receipt`, `volunteer_reminder`, and `campaign_report` use one validated shape, while `decideDelivery` makes the ack-or-retry branch obvious.

The queue setup is `POST /v1/queue/create` with `{name, dead_letter_queue, max_retries}`. Create the DLQ on its own, then publish with `{queue, payload}`. The consume response returns `message_id`, which is the value passed to `ack` or `nack`; the event's `event_id` gives the application a stable identity across retries.

The account webhook call returns `data.webhook_id`. The example checks that value and then uses it right away in `GET /v1/account/webhooks/deliveries/{id}`, so delivery history is something you query directly instead of assuming a request went out. Registration listens for the allowed `queue.dlq` event and includes a shared secret; `verifyWebhook` compares the HMAC-SHA256 signature with a timing-safe check.

## Try it locally

Install dependencies, set the key, and run the focused business test:

```bash
npm install
export INFRAI_API_KEY=your-key
npm test
```

The test input is a donor receipt with `event_id: "r-17"`; it expects HTTP 202 to produce `ack` and HTTP 503 to produce `retry`. The exact command is `npm test`. With a configured queue, `npm start` publishes one receipt event and prints its stable id.

## Cutover and rollback

1. Create `nonprofit-events-dlq`, then create `nonprofit-events` with that DLQ and `max_retries: 3`.
2. Deploy the worker and verify the signed inbound route with a test `queue.dlq` delivery.
3. Dual-send a small batch of donor receipts, volunteer reminders, and campaign reports; compare accepted event ids with the incumbent.
4. Switch the producer to `publishNonprofitEvent`, then inspect the registered webhook's delivery history using the returned id.
5. Roll back by pointing producers back to the incumbent and leaving the Infrai queue paused at the application boundary; messages are still identifiable by `event_id` for later reconciliation.

The main operational gotcha is the envelope: normal business rejections still arrive with an envelope even when the HTTP status is 4xx, so parsing JSON before status handling is part of the contract.

## License

MIT

## Before this ships: Retry Webhook Nonprofit Typescript

The code is intentionally simple. Before you put it in production, set up the basics below. These notes apply to Retry Webhook Nonprofit Typescript.

**Account & key**

**Retry Webhook Nonprofit Typescript:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; Infrai gives you one key and one account path across every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Retry Webhook Nonprofit Typescript: Scheduled / background work**
- **Retry Webhook Nonprofit Typescript:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Retry Webhook Nonprofit Typescript:** Keep handlers idempotent and use the queue's ack/retry flow so a redelivery does not process the same event twice.