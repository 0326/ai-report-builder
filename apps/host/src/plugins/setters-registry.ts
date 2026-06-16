/** 注册 engine-ext 内置 setter + 自研数据绑定 setter + 事件/变量绑定面板 */
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import AliLowCodeEngineExt from '@alilc/lowcode-engine-ext';
import DataBindSetter from '../setters/data-bind.ts';

const DefaultSettersRegistryPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    const { setterMap, pluginMap } = AliLowCodeEngineExt as {
      setterMap: Record<string, unknown>;
      pluginMap: Record<string, never>;
    };
    const { setters, skeleton } = ctx;
    setters.registerSetter(setterMap as never);
    setters.registerSetter('DataBindSetter', { component: DataBindSetter as never, title: '数据绑定' } as never);
    skeleton.add({
      area: 'centerArea', type: 'Widget', name: 'eventBindDialog', props: {},
      content: pluginMap.EventBindDialog,
    });
    skeleton.add({
      area: 'centerArea', type: 'Widget', name: 'variableBindDialog', props: {},
      content: pluginMap.VariableBindDialog,
    });
  },
});
DefaultSettersRegistryPlugin.pluginName = 'DefaultSettersRegistryPlugin';
export default DefaultSettersRegistryPlugin;
