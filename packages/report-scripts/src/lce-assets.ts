/**
 * LCE assets 派生：materialMetas（我们的物料 meta + x-ai）→ LCE 资产协议
 * （packages: UMD 库地址；components: componentMeta + setters + snippets）。
 * 单一事实源是 materialMetas —— LCE componentMeta 不手写，避免双写漂移。
 */
import type { MaterialMeta } from '@daf-materials/kit/meta';

interface LceSetterProp {
  name: string;
  title: string;
  setter: unknown;
  defaultValue?: unknown;
}

export interface LceAssets {
  version: string;
  packages: Array<{ package: string; version?: string; library: string; urls: string[] }>;
  components: Array<Record<string, unknown>>;
  sort: { groupList: string[]; categoryList: string[] };
}

const CATEGORY_LABEL: Record<MaterialMeta['category'], string> = {
  chart: '图表',
  table: '表格',
  display: '展示',
};

function setterOf(p: MaterialMeta['configurableProps'][number]): unknown {
  switch (p.type) {
    case 'boolean': return 'BoolSetter';
    case 'number': return 'NumberSetter';
    case 'enum': return {
      componentName: 'SelectSetter',
      props: { options: (p.options ?? []).map((o) => ({ label: o, value: o })) },
    };
    default: return 'StringSetter';
  }
}

function componentMetaOf(m: MaterialMeta): Record<string, unknown> {
  // 字段映射 prop（xField/yField/categoryField/valueField/seriesField/field）折进数据绑定 setter
  const isFieldMap = (name: string) => /field$/i.test(name) || name === 'field';
  const fieldMapProps = m.dataProp ? m.configurableProps.filter((p) => isFieldMap(p.name)) : [];
  const fieldMapNames = new Set(fieldMapProps.map((p) => p.name));

  const props: LceSetterProp[] = [
    // 数据绑定：DataBindSetter 写 plain `dataset` prop（避开 LCE 变量绑定模式），
    // 保存时服务端归一化成 dataProp 的 JSExpression。真实 data prop 不在面板暴露。
    ...(m.dataProp ? [{
      name: 'dataset',
      title: '数据绑定',
      setter: {
        componentName: 'DataBindSetter',
        props: { fieldProps: fieldMapProps.map((p) => ({ name: p.name, title: p.title })) },
      },
    }] : []),
    // 其余可配置 props（排除字段映射 prop 与真实 data prop —— 均由数据绑定接管）
    ...m.configurableProps
      .filter((p) => !fieldMapNames.has(p.name) && p.name !== m.dataProp)
      .map((p) => ({
        name: p.name,
        title: p.title,
        setter: setterOf(p),
        defaultValue: m.defaultProps[p.name],
      })),
  ];

  return {
    componentName: m.componentName,
    title: m.title,
    category: CATEGORY_LABEL[m.category],
    group: 'DAF 物料',
    npm: { package: m.package, exportName: m.exportName, destructuring: true, version: '0.1.0' },
    description: m['x-ai'].summary,
    props,
    configure: {
      supports: { style: false, loop: false, condition: true },
      component: { isContainer: false },
    },
    snippets: [{
      title: m.title,
      screenshot: '',
      schema: {
        componentName: m.componentName,
        props: { ...m.defaultProps },
        // 平台扩展默认值：拖入即带块语义（x-position 由布局轮接管）
        'x-consumes': [],
        'x-emits': [],
      },
    }],
  };
}

/** AIBlock：自定义代码块容器（设计画布渲染占位，真实渲染在运行态预览） */
function aiBlockMeta(): Record<string, unknown> {
  return {
    componentName: 'AIBlock',
    title: 'AI 代码块',
    category: '代码块',
    group: 'DAF 物料',
    npm: { package: '@daf/report-runtime', exportName: 'AIBlock', destructuring: true, version: '0.1.0' },
    description: 'AI 生成的自定义代码块容器（bundle 模块按 entry 挂载）',
    props: [
      { name: 'entry', title: '模块入口', setter: 'StringSetter' },
    ],
    configure: {
      supports: { style: false, condition: true },
      component: { isContainer: false },
    },
    snippets: [],
  };
}

export interface LceAssetsOptions {
  /** 物料 UMD 地址（mock-server 静态服务） */
  materialsUrl: string;
  /** AIBlock 设计态占位 UMD 地址 */
  runtimeDesignUrl: string;
  /**
   * 设计器 vendor 基址（host Vite 中间件服务）。
   * 模拟器画布 iframe 经 assets packages 注入运行库：react-simulator-renderer
   * externalize 了 @alifd/next（依赖 window.Next），moment/lodash 是 Next 的运行依赖。
   */
  vendorBase?: string;
}

export function deriveLceAssets(metas: MaterialMeta[], opts: LceAssetsOptions): LceAssets {
  const vb = opts.vendorBase ?? '/lce-vendor';
  return {
    version: '1.0.0',
    packages: [
      { package: 'moment', version: '2.29.0', library: 'moment', urls: [`${vb}/moment.js`] },
      { package: 'lodash', version: '4.17.21', library: '_', urls: [`${vb}/lodash.js`] },
      { package: '@alifd/next', version: '1.27.0', library: 'Next', urls: [`${vb}/next.js`] },
      { package: '@daf-materials/kit', version: '0.1.0', library: 'DafMaterials', urls: [opts.materialsUrl] },
      { package: '@daf/report-runtime', version: '0.1.0', library: 'DafRuntimeDesign', urls: [opts.runtimeDesignUrl] },
    ],
    components: [...metas.map(componentMetaOf), aiBlockMeta()],
    sort: { groupList: ['DAF 物料'], categoryList: ['图表', '表格', '展示', '代码块'] },
  };
}
