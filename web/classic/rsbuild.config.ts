import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const semiUiDir = path.resolve(
  path.dirname(require.resolve('@douyinfe/semi-ui')),
  '../..',
)

// VChart ships its own nested copies of the vrender packages, and so does
// react-vchart. vrender-core exports a module-level singleton env manager
// (vglobal); when two physical copies exist, registerBrowserEnv() binds the
// browser env onto one copy's vglobal while the render path reads the other,
// leaving env undefined -> "Cannot read properties of undefined (reading
// 'createCanvas')". Force every import of these packages to resolve to the
// single copy that vchart itself uses for drawing.
const visactorNested = (name: string) =>
  path.resolve(
    __dirname,
    'node_modules/@visactor/vchart/node_modules/@visactor',
    name,
  )

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  const clientServerUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    ''
  const proxyServerUrl =
    clientServerUrl ||
    'http://localhost:3000'
  const isProd = envMode === 'production'
  const devProxy = Object.fromEntries(
    (['/api', '/mj', '/pg'] as const).map((key) => [
      key,
      { target: proxyServerUrl, changeOrigin: true },
    ]),
  ) as Record<string, { target: string; changeOrigin: boolean }>

  return {
    plugins: [pluginReact()],
    source: {
      entry: {
        index: './src/index.jsx',
      },
      define: {
        'import.meta.env.VITE_REACT_APP_SERVER_URL': JSON.stringify(
          clientServerUrl,
        ),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@douyinfe/semi-ui/dist/css/semi.css': path.resolve(
          semiUiDir,
          'dist/css/semi.css',
        ),
        '@visactor/vrender-core': visactorNested('vrender-core'),
        '@visactor/vrender-kits': visactorNested('vrender-kits'),
        '@visactor/vutils': visactorNested('vutils'),
      },
    },
    html: {
      template: './index.html',
      // Rsbuild otherwise auto-detects public/favicon.ico (the old new-api icon)
      // and injects a <link rel="icon" href="/favicon.ico"> after our branded
      // one, so the browser shows the stale icon. Pin it to the Blitzball logo.
      favicon: './public/logo.png',
    },
    server: {
      host: '0.0.0.0',
      strictPort: true,
      proxy: devProxy,
    },
    output: {
      minify: isProd,
      target: 'web',
      distPath: {
        root: 'dist',
      },
    },
    performance: {
      removeConsole: isProd ? ['log'] : false,
      buildCache: {
        cacheDigest: [process.env.VITE_REACT_APP_VERSION],
      },
    },
    tools: {
      rspack: {
        module: {
          rules: [
            {
              test: /node_modules[\\/]@visactor[\\/]/,
              sideEffects: true,
            },
            {
              test: /src[\\/].*\.js$/,
              type: 'javascript/auto',
              use: [
                {
                  loader: 'builtin:swc-loader',
                  options: {
                    jsc: {
                      parser: {
                        syntax: 'ecmascript',
                        jsx: true,
                      },
                      transform: {
                        react: {
                          runtime: 'automatic',
                          development: !isProd,
                          refresh: !isProd,
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  }
})
