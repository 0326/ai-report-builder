/** POST + SSE 流读取（fetch ReadableStream；与服务端 AgentEvent 协议对齐）。 */

export type AgentEvent =
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool'; name: string; detail: string }
  | { t: 'tool_result'; name: string; ok: boolean; detail: string }
  | { t: 'round'; result: RoundResult }
  | { t: 'done' }
  | { t: 'error'; message: string };

export interface DiffLine { kind: 'ctx' | 'add' | 'del'; text: string }
export interface FileDiff { path: string; status: string; additions: number; deletions: number; lines: DiffLine[] }

export interface RoundResult {
  ok: boolean;
  intent: string;
  pipeline: 'build' | 'schema';
  buildMs: number;
  commit: { hash: string; round: number | null };
  diff: { schema: { summary: string[]; destructive: boolean; opCount: number }; code: FileDiff[] };
  previewUrl: string;
}

export async function streamChat(
  body: { sessionId: string; message: string; selection?: unknown },
  onEvent: (ev: AgentEvent) => void,
): Promise<void> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`请求失败 ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload) onEvent(JSON.parse(payload) as AgentEvent);
        }
      }
    }
  }
}
