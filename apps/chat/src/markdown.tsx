/** 助手正文 Markdown 渲染：marked 解析 + DOMPurify 消毒（禁内联 HTML 风险）。 */
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return (
    <div
      className="daf-md"
      style={{ fontSize: 13, lineHeight: 1.75, wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 注入一次的 markdown 元素样式（代码块/列表/表格） */
export function injectMdStyles(): void {
  if (document.getElementById('daf-md-style')) return;
  const style = document.createElement('style');
  style.id = 'daf-md-style';
  style.textContent = `
.daf-md p { margin: 0 0 8px; } .daf-md p:last-child { margin-bottom: 0; }
.daf-md ul, .daf-md ol { margin: 4px 0 8px; padding-left: 20px; }
.daf-md li { margin: 2px 0; }
.daf-md code { background: #f0f2f5; border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
.daf-md pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.daf-md pre code { background: none; color: inherit; padding: 0; }
.daf-md h1, .daf-md h2, .daf-md h3, .daf-md h4 { margin: 10px 0 6px; font-size: 14px; }
.daf-md table { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.daf-md th, .daf-md td { border: 1px solid #e5e6eb; padding: 4px 8px; }
.daf-md blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #d6e2ff; color: #646a73; }
.daf-md a { color: #3370ff; }
`;
  document.head.appendChild(style);
}
