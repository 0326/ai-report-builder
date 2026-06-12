/**
 * Bridge：postMessage 之上的 JSON-RPC（握手带版本 + token，防嵌套页面伪造）。
 * 传输抽象为 MessageEndpoint —— 浏览器用 windowEndpoint，测试/原生承载可注入任意实现。
 */

export interface WireMessage {
  __dafBridge: true;
  token: string;
  kind: 'req' | 'res' | 'notify' | 'ready';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  version?: string;
}

export interface MessageEndpoint {
  post(msg: WireMessage): void;
  /** 返回 unlisten */
  listen(cb: (msg: WireMessage) => void): () => void;
}

/** 浏览器端点：self 收、peer 发（host: peer=iframe.contentWindow；SDK: peer=window.parent） */
export function windowEndpoint(self: Window, peer: { postMessage(msg: unknown, origin: string): void }): MessageEndpoint {
  return {
    post: (msg) => peer.postMessage(msg, '*'),
    listen: (cb) => {
      const h = (e: MessageEvent) => {
        const d = e.data as WireMessage | undefined;
        if (d && typeof d === 'object' && d.__dafBridge) cb(d);
      };
      self.addEventListener('message', h);
      return () => self.removeEventListener('message', h);
    },
  };
}

export type BridgeHandler = (params: unknown) => unknown | Promise<unknown>;

export interface BridgeOptions {
  /** 对端 ready（版本握手）回调；iframe 整页刷新会再次触发 */
  onReady?: (info: { version: string }) => void;
  /** call 默认超时 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 8000;

export class Bridge {
  private handlers = new Map<string, BridgeHandler>();
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private unlisten: () => void;
  private readyResolve!: (info: { version: string }) => void;
  /** 首次握手完成 */
  readonly whenReady: Promise<{ version: string }>;
  peerVersion: string | null = null;

  private endpoint: MessageEndpoint;
  private token: string;
  private opts: BridgeOptions;

  constructor(endpoint: MessageEndpoint, token: string, opts: BridgeOptions = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this.opts = opts;
    this.whenReady = new Promise((res) => { this.readyResolve = res; });
    this.unlisten = endpoint.listen((msg) => this.onMessage(msg));
  }

  private onMessage(msg: WireMessage): void {
    if (msg.token !== this.token) return; // token 不符直接丢弃
    if (msg.kind === 'ready') {
      this.peerVersion = msg.version ?? '0';
      this.readyResolve({ version: this.peerVersion });
      this.opts.onReady?.({ version: this.peerVersion });
      return;
    }
    if (msg.kind === 'req') {
      const fn = this.handlers.get(msg.method ?? '');
      const reply = (patch: Partial<WireMessage>) =>
        this.endpoint.post({ __dafBridge: true, token: this.token, kind: 'res', id: msg.id, ...patch });
      if (!fn) return reply({ error: `no handler: ${msg.method}` });
      Promise.resolve()
        .then(() => fn(msg.params))
        .then((result) => reply({ result }))
        .catch((e: Error) => reply({ error: e.message ?? String(e) }));
      return;
    }
    if (msg.kind === 'res') {
      const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!p) return;
      this.pending.delete(msg.id!);
      clearTimeout(p.timer);
      msg.error !== undefined ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
      return;
    }
    if (msg.kind === 'notify') {
      const fn = this.handlers.get(msg.method ?? '');
      if (fn) void Promise.resolve().then(() => fn(msg.params)).catch(() => {});
    }
  }

  /** 注册方法（req 与 notify 共用注册表） */
  handle(method: string, fn: BridgeHandler): this {
    this.handlers.set(method, fn);
    return this;
  }

  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[bridge] call timeout: ${method}`));
      }, timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.endpoint.post({ __dafBridge: true, token: this.token, kind: 'req', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.endpoint.post({ __dafBridge: true, token: this.token, kind: 'notify', method, params });
  }

  /** SDK 侧装载完成后宣告（版本握手） */
  announceReady(version: string): void {
    this.endpoint.post({ __dafBridge: true, token: this.token, kind: 'ready', version });
  }

  dispose(): void {
    this.unlisten();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('[bridge] disposed'));
    }
    this.pending.clear();
    this.handlers.clear();
  }
}
