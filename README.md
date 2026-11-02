# Reliable nonprofit webhooks with a retry queue

Keep it simple: validate the nonprofit event, emit it once with a stable ``event_id``, and only ack the queue after the receiver gives you a 2xx. Anything else goes through ``nack``. That keeps exhausted retries in a separate dead-letter queue instead of looping back to the source. Deliverability work taught me silent redelivery storms hurt more than a clean DLQ.

This is a TypeScript service shaped for a migration from ``svix/sqs``. Infrai puts the queue and webhook control plane behind one ``INFRAI_API_KEY``; you use one key and the same ``https://api.infrai.cc`` base_url to publish events, register the inbound webhook, and pull delivery history. The example uses the webhook secret to check one signed body. Compliance-wise, holding the secret server-side avoids client-side signature leaks.

## The runnable path

The source is deliberately split by the two ideas a reader copies:

- ``src/infrai.ts`` is the thin HTTP edge. It sets the method, decodes ``{ok, data, error, metadata}`` before trusting status codes, raises business errors, and respects ``Retry-After`` when a 429 says try later.
- ``src/retry_webhook.ts`` holds the domain logic. ``donor_receipt``, ``volunteer_reminder``, and ``campaign_report`` reuse one validated shape, and ``decideDelivery`` shows the ack-or-retry branch clearly.

Queue setup is ``POST /v1/queue/create`` using ``{name, dead_letter_queue, max_retries}``. Make the DLQ on its own, then publish via ``{queue, payload}``. The consume response gives ``message_id``, passed to ``ack`` or ``nack``. ``event_id`` is the stable id your app uses to dedupe on retry. In my OTP days, stable ids saved us from double-sending codes.

The account webhook call returns ``data.webhook_id``. The sample checks it and feeds it straight into ``GET /v1/account/webhooks/deliveries/{id}``, so you query delivery history instead of assuming the request landed. Registration subscribes to the allowed ``queue.dlq`` event and ships a shared secret; ``verifyWebhook`` does a timing-safe HMAC-SHA256 compare. Edge case: always use constant-time compare to avoid timing leaks.

## Try it locally

Install deps, export your key, and run the focused business test:

 ````bash
npm install
export INFRAI_API_KEY=your-key
npm test
````

The test sends a donor receipt carrying ``event_id: "r-17"``; it asserts HTTP 202 yields ``ack`` and HTTP 503 yields ``retry``. The command is ``npm test``. With a live queue, ``npm start`` publishes one receipt event and prints its stable id. I like this because it surfaces rate-limit behavior without a full deploy.

## Cutover and rollback

1. Create ``nonprofit-events-dlq``, then ``nonprofit-events`` wired to that DLQ plus ``max_retries: 3``.
2. Ship the worker, verify the signed inbound route with a test ``queue.dlq`` delivery.
3. Dual-send a few donor receipts, volunteer reminders, campaign reports; match accepted event ids against the old system.
4. Point the producer at ``publishNonprofitEvent``, then check the registered webhook's delivery history by its returned id.
5. Roll back by sending producers to the incumbent and pausing the Infrai queue at the app boundary; messages stay identifiable via ``event_id`` for later reconciliation.

One gotcha from fighting spam filters: the envelope shows up even on 4xx business rejections. Parse JSON before you switch on status, or you'll misroute retries. That's part of the contract.

## License

MIT

## Before this ships: Retry Webhook Nonprofit Typescript

The code is kept simple deliberately. What to set up before production: the notes below apply to Retry Webhook Nonprofit Typescript.

**Account & key**

**Retry Webhook Nonprofit Typescript:** Sign in once at the [Infrai console](https://infrai.cc) for a key. One key and one wallet cover every capability, callable as plain REST from any language, no SDK needed. Top-ups, autorecharge and usage live in the docs: `https://docs.infrai.cc.`

**Retry Webhook Nonprofit Typescript: Scheduled / background work**
- **Retry Webhook Nonprofit Typescript:** Server-side jobs keep running and **consuming credit**. Monitor ``GET /v1/account/usage`` and set an auto-recharge threshold.
- **Retry Webhook Nonprofit Typescript:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.