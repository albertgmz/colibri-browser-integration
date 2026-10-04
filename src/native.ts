import type { HostReply } from './types';

export const HOST_NAME = 'com.colibri.host';
export const CAPABILITIES = ['capture-confirmation', 'request-context', 'bulk-add', 'settings-push', 'capture-policy-v1', 'automatic-capture-v1'];
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}
type Pending = { finish(reply: HostReply): void };
const compatible = (reply: HostReply): boolean => reply.protocolVersion === 2 &&
  Array.isArray(reply.capabilities) && reply.capabilities.includes('capture-confirmation');
const launchRequests = new Set(['add', 'bulk-add', 'open']);

/** One host process per background lifetime. Credential payloads are never stored or logged. */
export class NativeClient {
  private port?: NativePort;
  private handshake?: Promise<HostReply>;
  private readonly pending = new Map<string, Pending>();
  onSettings: (reply: HostReply) => void = () => {};
  constructor(private readonly connect: () => NativePort, private readonly nativeError: () => string = () => '') {}

  private ensurePort(): NativePort {
    if (this.port) return this.port;
    const port = this.connect();
    this.port = port;
    port.onMessage.addListener(value => {
      if (!value || typeof value !== 'object') return;
      const reply = value as HostReply;
      if (reply.type === 'settings') this.onSettings(reply);
      if (typeof reply.requestId === 'string') this.pending.get(reply.requestId)?.finish(reply);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = undefined;
      this.handshake = undefined;
      const nativeError = this.nativeError();
      for (const pending of [...this.pending.values()]) pending.finish({ ok: false, error: 'native', nativeError });
    });
    return port;
  }

  private raw(message: Record<string, unknown>, timeoutMs: number): Promise<HostReply> {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      let settled = false;
      const finish = (reply: HostReply) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.pending.delete(requestId); resolve(reply);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
      this.pending.set(requestId, { finish });
      try {
        const envelope = { ...message, requestId, protocolVersion: 2 };
        if (new TextEncoder().encode(JSON.stringify(envelope)).length > 1024 * 1024) {
          finish({ ok: false, error: 'message-too-large' }); return;
        }
        this.ensurePort().postMessage(envelope);
      }
      catch { finish({ ok: false, error: 'native', nativeError: this.nativeError() }); }
    });
  }

  async hello(): Promise<HostReply> {
    this.handshake ??= this.raw({ type: 'hello', extensionVersion: '0.5.0', capabilities: CAPABILITIES }, 5000)
      .then(reply => {
        if (reply.ok !== true || !compatible(reply)) {
          this.handshake = undefined;
          // Preserve a closed-app launch signal only when the original reply is explicit and compatible.
          const closed = reply.ok === false && reply.error === 'app-not-running' && compatible(reply);
          return { ...reply, ok: false, error: closed ? 'app-not-running' :
            reply.error === 'app-not-running' ? 'protocol-mismatch' : reply.error ?? 'protocol-mismatch' };
        }
        this.onSettings(reply);
        return reply;
      });
    return this.handshake;
  }

  async send(message: Record<string, unknown>, timeoutMs = 20_000, valid?: () => boolean): Promise<HostReply> {
    const hello = await this.hello();
    if (valid?.() === false) return { ok: false, error: 'preparation-expired' };
    if (message.captureAction === 'capture' && !hello.capabilities?.includes('automatic-capture-v1'))
      message = { ...message, captureAction: 'ask' };
    // A compatible native host can answer hello while the desktop app is closed.
    // Only explicit launch actions may proceed; a legacy/malformed reply never permits payloads.
    if (!hello.ok && !(hello.ok === false && hello.error === 'app-not-running' && compatible(hello) &&
      typeof message.type === 'string' && launchRequests.has(message.type))) return hello;
    return this.raw(message, timeoutMs);
  }
}
