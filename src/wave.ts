const ENDPOINT = "https://gql.waveapps.com/graphql/public";

export class WaveClient {
  constructor(private token: string, private timeoutMs: number, private endpoint = ENDPOINT) {}

  async request(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let body: { data?: unknown; errors?: unknown[] };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Wave returned HTTP ${res.status} with a non-JSON body`);
    }
    if (!res.ok || body.errors?.length) {
      throw new Error(`Wave error (HTTP ${res.status}): ${JSON.stringify(body.errors ?? text)}`);
    }
    return body.data;
  }
}
