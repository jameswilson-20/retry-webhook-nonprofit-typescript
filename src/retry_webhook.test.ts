import assert from "node:assert/strict";
import { decideDelivery, parseEvent } from "./retry_webhook.ts";

const event = parseEvent({ event_id: "r-17", kind: "donor_receipt", recipient: "donor@example.org", message: "Thank you" });
assert.equal(event.kind, "donor_receipt");
assert.equal(decideDelivery(202), "ack");
assert.equal(decideDelivery(503), "retry");
console.log("retry decision test passed");
