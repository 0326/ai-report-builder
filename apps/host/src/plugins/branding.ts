/** 品牌区（topArea 左侧）：产品标识 + 当前工程名。 */
import { createElement as h } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';

function Brand() {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' } },
    h('span', {
      style: {
        width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
        background: 'linear-gradient(135deg,#3370ff,#7c3aed)', color: '#fff',
        fontWeight: 700, fontSize: 14, fontFamily: 'ui-sans-serif, system-ui',
      },
    }, 'D'),
    h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.2 } },
      h('span', { style: { fontWeight: 600, fontSize: 14, color: '#1f2329', letterSpacing: 0.2 } }, 'DAF 智能报告'),
      h('span', { style: { fontSize: 11, color: '#8f959e' } }, 'AI Native 搭建 · 设计 / 预览 / 标注一体'),
    ),
  );
}

const BrandingPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      name: 'daf-brand', area: 'topArea', type: 'Widget', props: { align: 'left' },
      content: h(Brand),
    });
  },
});
BrandingPlugin.pluginName = 'BrandingPlugin';
export default BrandingPlugin;
