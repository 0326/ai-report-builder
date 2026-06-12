/** 预览 iframe + Bridge 接线（同源经 Vite 代理；token 防伪造握手） */
import { useEffect, useRef } from 'react';
import { connectPreview, type PreviewHandle } from '@daf/designtime-sdk';

const TOKEN = crypto.randomUUID();

export function PreviewPane({ onReady, onSelectFromPreview }: {
  onReady: (handle: PreviewHandle) => void;
  onSelectFromPreview?: (nodeId: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef<PreviewHandle | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handle = connectPreview(iframe, TOKEN, {
      onSelect: (ctx) => onSelectFromPreview?.(ctx.nodeId),
      onReady: () => onReady(handle),
    });
    handleRef.current = handle;
    return () => handle.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="report-preview"
      src={`/preview/?designtime=1&dtToken=${TOKEN}`}
      style={{ width: '100%', height: '100%', border: '1px solid #e5e6e8', borderRadius: 8, background: '#f5f6f7' }}
    />
  );
}
