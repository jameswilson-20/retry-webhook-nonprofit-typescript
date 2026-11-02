import { z } from "zod";
import { InfraiClient, verifyWebhook } from "./infrai.ts";

const eventSchema = z.object({
  event_id: z.string().min(1),
  kind: z.enum(["donor_receipt", "volunteer_reminder", "campaign_report"]),
  recipient: z.string().min(1),
  message: z.string().min(1),
});
export type NonprofitEvent = z.infer<typeof eventSchema>;

export function parseEvent(input: unknown): NonprofitEvent {
  return eventSchema.parse(input);
}

export type DeliveryDecision = "ack" | "retry";

export function decideDelivery(status: number): DeliveryDecision {
  return status >= 200 && status < 300 ? "ack" : "retry";
}

export async function publishNonprofitEvent(client: InfraiClient, input: unknown) {
  const event = parseEvent(input);
  return client.publish("nonprofit-events", event);
}

export async function processOne(client: InfraiClient, deliver: (event: NonprofitEvent) => Promise<number>) {
  const result = (await client.consume("nonprofit-events")) as { message_id: string; payload: unknown };
  const event = parseEvent(result.payload);
  const status = await deliver(event);
  if (decideDelivery(status) === "ack") return client.ack("nonprofit-events", result.message_id);
  return client.nack("nonprofit-events", result.message_id);
}

export async function registerAndInspect(client: InfraiClient, inboundUrl: string, secret: string) {
  const registration = await client.registerWebhook(inboundUrl, secret);
  if (!registration.webhook_id) throw new Error("webhook registration returned no webhook_id");
  const deliveries = await client.deliveryHistory(registration.webhook_id);
  return { webhookId: registration.webhook_id, deliveries };
}

export { verifyWebhook };

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new InfraiClient();
  const recipient = process.env.INFRAI_DEMO_RECIPIENT;
  if (!recipient) throw new Error("INFRAI_DEMO_RECIPIENT is required");
  const event = { event_id: `receipt-${Date.now()}`, kind: "donor_receipt", recipient, message: "Thank you for supporting the food bank." };
  await publishNonprofitEvent(client, event);
  console.log("published", event.event_id);
}
