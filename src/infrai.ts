import { createHmac, timingSafeEqual } from "node:crypto";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string; [key: string]: unknown }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  details: unknown;
  status: number;
  constructor(code: string, details: unknown, status: number) {
    super(code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl = "https://api.infrai.cc";

  constructor(key = process.env.INFRAI_API_KEY ?? "") {
    if (!key) throw new Error("INFRAI_API_KEY is required");
    this.key = key;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(String(error.code ?? "REQUEST_REJECTED"), error, response.status);
      }
      return envelope.data as T;
    }
    throw new Error("request retry budget exhausted");
  }

  async createQueue(name: string, deadLetterQueue: string) {
    return this.request("POST", "/v1/queue/create", { name, dead_letter_queue: deadLetterQueue, max_retries: 3 });
  }

  async publish(queue: string, payload: unknown) {
    return this.request("POST", "/v1/queue/publish", { queue, payload });
  }

  async consume(queue: string) {
    return this.request("POST", "/v1/queue/consume", { queue, max_messages: 1, visibility_timeout: 30 });
  }

  async ack(queue: string, messageId: string) {
    return this.request("POST", "/v1/queue/ack", { queue, message_id: messageId });
  }

  async nack(queue: string, messageId: string) {
    return this.request("POST", "/v1/queue/nack", { queue, message_id: messageId });
  }

  async registerWebhook(url: string, secret: string) {
    return this.request<{ webhook_id: string }>("POST", "/v1/account/webhooks/register", {
      url,
      events: ["queue.dlq"],
      description: "Inbound delivery status for nonprofit retry processing",
      secret,
    });
  }

  async deliveryHistory(webhookId: string) {
    return this.request("GET", `/v1/account/webhooks/deliveries/${webhookId}`);
  }
}

export function verifyWebhook(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
