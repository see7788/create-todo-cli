import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, ElectronViteConfigFnObject } from 'electron-vite';
import fs from 'fs';
// import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
// import { codeInspectorPlugin } from 'code-inspector-plugin';//点击ui跳转到代码行
import viteWebrtc from "lib-vanilla/src/anyWebrtc/peerjs/electronRender/vite-plugin-webrtc"
// import commonjs from '@rollup/plugin-commonjs';//不行
// import commonjs from "vite-plugin-commonjs-externals"//不行
// import commonjs from "vite-plugin-commonjs"
// import devCopyTo from "lib-vanilla/src/anyShell/vite-plugin-distcopyto"
// import { createRequire } from 'module';

const preload = function () {
  const v: | "index" | "taobao" | "HTMLElement" = "HTMLElement"
  return { [v]: path.resolve(__dirname, "./src/preload", v) }
}()
const renderers = function () {
  const src = path.resolve(__dirname, "./src/renderer")
  const htmlname = "index.html"
  const entries = fs.readdirSync(src).filter(v => !v.includes(".") && fs.readdirSync(path.join(src, v)).includes(htmlname)).map(v => [v, path.join(src, v, htmlname)])
  const obj = Object.fromEntries(entries)
  return obj
}()

export default defineConfig(({ mode }) => {
  const sourcemap = true// mode === 'development'
  const terserOptions = {
    format: {
      comments: !sourcemap, // 去除所有注释
    },
  }
  return {
    main: {
      build: {
        sourcemap,
        // terserOptions,
        rollupOptions: {
          input: {
            index: path.resolve("./src/main/index.ts")// srcResolve("main", "start.ts"),
          },
          output: {
            exports: "named" //表示：“我接受用户通过命名的方式访问默认导出”
          },
          external: [
            "cpu-features",
            "electron",
            "esbuild",
            "extract-file-icon",
            "global-mouse-events",
            "node-window-manager",
            "ssh2",
            "uiohook-napi"
          ],
        },
      },
      plugins: [
        //  commonjs()
      ],
    },
    preload: {
      plugins: [
        react(),
        // vanillaExtractPlugin()
        //devCopyTo(copyTo, 5000)
      ],
      build: {
        sourcemap,
        // terserOptions,
        emptyOutDir: false,//清空输出
        rollupOptions: {
          maxParallelFileOps: 500,
          input: preload,
          output: {
            inlineDynamicImports: true,//编译成单文件
          },
        },
      },
    },
    renderer: {
      server: {
        port: 3001,
        host: '0.0.0.0',
        cors: true,
      },
      plugins: [
        react(), viteWebrtc()
      ],
      build: {
        sourcemap,
        terserOptions,
        rollupOptions: {
          input: renderers
        },
      },
    },
  };
});


// const preloads: Record<broId_t, string> = {
//   index: require.resolve("./src/preload/index.tsx"),
//   tables: require.resolve("tables/electron/preload"),
//   webrtc: require.resolve('lib-vanilla/src/anyWebrtc/peerjs/electronPreload'),
//   HTMLElement: require.resolve("lib-vanilla/src/anyDom/HTMLElement/index")
// }

// const renderers: Record<renderer_t, string> = {
//   index: require.resolve("./src/renderer/index.tsx"),
//   tables: require.resolve("tables/electron/index.html"),
//   webrtc: require.resolve('lib-vanilla/src/anyWebrtc/peerjs/electronRender/index.html'),
// }

// const renderers = Object.fromEntries(
//   readdirSync(srcResolve("renderer"))
//     .map(dirname => [dirname, srcResolve("renderer", dirname, 'index.html')])
//     .filter(([_, path]) => existsSync(path))
// )

// console.log(
//   Object.entries(preloads).map(([k, v]) => ["preload", k, v, existsSync(v)]),
//   Object.entries(renderers).map(([k, v]) => ["renderers", k, v, existsSync(v)])
// )