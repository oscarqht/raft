interface Snapshot { messageId: string; content: string; steps: Map<string, string>; order: string[] }

// Per-connection bases prevent reconnects or tab switches from applying stale deltas.
export class StreamDelivery {
  private clients = new WeakMap<object, Map<string, Snapshot | null>>();
  enable(client: object): void {
    if (!this.clients.has(client)) this.clients.set(client, new Map());
  }
  subscribe(client: object, sessionId: string): void {
    let sessions = this.clients.get(client);
    if (!sessions) this.clients.set(client, sessions = new Map());
    sessions.set(sessionId, null);
  }
  unsubscribe(client: object, sessionId: string): void { this.clients.get(client)?.delete(sessionId); }
  encode(client: object, data: any): any | null {
    const sessions = this.clients.get(client);
    if (!sessions) return data; // Compatibility with already-open, older clients.
    if (!sessions.has(data.sessionId)) return null;
    const previous = sessions.get(data.sessionId);
    const steps: any[] = data.steps || [];
    const current: Snapshot = {
      messageId: data.messageId, content: data.fullContent || '',
      steps: new Map(steps.map((step) => [step.id, JSON.stringify(step)])),
      order: steps.map((step) => step.id),
    };
    sessions.set(data.sessionId, current);
    // Streaming events can themselves contain the entire accumulated tool output.
    const { event: _event, ...snapshot } = data;
    if (!previous || previous.messageId !== current.messageId) return snapshot;
    let prefixLength = 0;
    const max = Math.min(previous.content.length, current.content.length);
    while (prefixLength < max && previous.content[prefixLength] === current.content[prefixLength]) prefixLength++;
    const { fullContent: _content, steps: _steps, ...rest } = snapshot;
    return {
      ...rest,
      contentPatch: { prefixLength, text: current.content.slice(prefixLength) },
      stepsPatch: steps.filter((step) => previous.steps.get(step.id) !== current.steps.get(step.id)),
      ...(JSON.stringify(previous.order) !== JSON.stringify(current.order) ? { stepOrder: current.order } : {}),
    };
  }
}
