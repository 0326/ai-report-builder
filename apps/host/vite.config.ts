import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const nm = (p: string) => resolve(HERE, 'node_modules', p);

/**
 * LCE 设计器 UMD 资产本地化（零 CDN）：
 * engine-core 的 publicPath 取自其加载 URL → 模拟器 renderer 自动从 /lce-vendor/{js,css}/ 解析，
 * 画布 iframe 的 React 复用宿主 window.React（引擎默认 environment 注入 parent.React）。
 */
const VENDOR_FILES: Record<string, string> = {
  '/lce-vendor/react.js': nm('react16-umd/umd/react.production.min.js'),
  '/lce-vendor/react-dom.js': nm('react-dom16-umd/umd/react-dom.production.min.js'),
  '/lce-vendor/prop-types.js': nm('prop-types/prop-types.min.js'),
  '/lce-vendor/lodash.js': nm('lodash/lodash.min.js'),
  '/lce-vendor/moment.js': nm('moment/min/moment.min.js'),
  '/lce-vendor/next.js': nm('@alifd/next/dist/next.min.js'),
  '/lce-vendor/theme-variables.css': nm('@alifd/theme-lowcode-light/variables.css'),
  '/lce-vendor/next.var.min.css': nm('@alifd/theme-lowcode-light/dist/next.var.min.css'),
  '/lce-vendor/css/engine-core.css': nm('@alilc/lowcode-engine/dist/css/engine-core.css'),
  '/lce-vendor/js/engine-core.js': nm('@alilc/lowcode-engine/dist/js/engine-core.js'),
  '/lce-vendor/css/react-simulator-renderer.css': nm('@alilc/lowcode-engine/dist/css/react-simulator-renderer.css'),
  '/lce-vendor/js/react-simulator-renderer.js': nm('@alilc/lowcode-engine/dist/js/react-simulator-renderer.js'),
  '/lce-vendor/css/engine-ext.css': nm('@alilc/lowcode-engine-ext/dist/css/engine-ext.css'),
  '/lce-vendor/js/engine-ext.js': nm('@alilc/lowcode-engine-ext/dist/js/engine-ext.js'),
};

function lceVendor(): Plugin {
  return {
    name: 'lce-vendor-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const file = VENDOR_FILES[path];
        if (!file) return next();
        if (!existsSync(file)) {
          res.statusCode = 404;
          return res.end(`vendor file missing: ${file}`);
        }
        res.setHeader('content-type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.setHeader('cache-control', 'public, max-age=3600');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [lceVendor()],
  resolve: {
    // 精确匹配映射到 window 全局 shim（与 UMD react16/引擎同实例）；
    // 深路径（如 @alifd/next/es/icon，components-pane 内部用）回落真实 npm 包参与打包。
    alias: [
      { find: /^react$/, replacement: resolve(HERE, 'src/shims/react.ts') },
      { find: /^react-dom$/, replacement: resolve(HERE, 'src/shims/react-dom.ts') },
      { find: /^@alilc\/lowcode-engine$/, replacement: resolve(HERE, 'src/shims/engine.ts') },
      { find: /^@alilc\/lowcode-engine-ext$/, replacement: resolve(HERE, 'src/shims/engine-ext.ts') },
      { find: /^@alifd\/next$/, replacement: resolve(HERE, 'src/shims/next.ts') },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5173',
      '/preview': 'http://localhost:5173',
      '/artifacts': 'http://localhost:5173',
    },
  },
});
