import { defineConfig } from 'vite'

const DEV_CSP = [
  "default-src 'self'",
  "img-src 'self' https: http: asset: blob: data:",
  "style-src 'self' 'unsafe-inline' blob:",
  "font-src 'self' data:",
  "script-src 'self' http: https: 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http: https: ws: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

export default defineConfig(({ mode }) => ({
  base: './',
  resolve: {
    alias: {},
    dedupe: ['katex', '@milkdown/prose'] // 去重，避免多个版本
  },
  server: {
    host: '127.0.0.1',
    port: 5391,
    strictPort: true
  },
  // 生产构建：分包与剥离 console/debugger；开发：预打包重库
  esbuild: mode === 'production' ? {
    // 生产环境去掉 console/debugger，减小体积并避免多余日志
    drop: ['console', 'debugger'],
    legalComments: 'none' // 移除许可注释，减小体积
  } : {},
  optimizeDeps: {
    // 开发时预构建大型依赖，加快热更新（仅影响 dev，不改变生产包）
    include: [
      'markdown-it',
      'dompurify',
      'highlight.js',
      'mermaid',
      'katex',
      // 所见模式 V2 相关依赖：预构建提升 dev 首次启动和 HMR 速度
      '@milkdown/core',
      '@milkdown/kit',
      '@milkdown/plugin-automd',
      '@milkdown/plugin-math',
      '@milkdown/preset-commonmark',
      '@milkdown/preset-gfm'
    ],
    exclude: []
  },
  build: {
    target: 'es2022', // 现代浏览器目标，生成更小的代码
    cssCodeSplit: true, // CSS 代码分割
    cssMinify: true, // CSS 压缩
    reportCompressedSize: false, // 禁用 gzip 大小报告，加快构建
    chunkSizeWarningLimit: 1000, // 提高警告阈值到 1MB
    rollupOptions: {
      output: {
        // 优化的代码分割策略
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Milkdown 编辑器（只在所见模式加载）
            if (id.includes('@milkdown')) return 'milkdown'
            // 大型渲染库（按需加载）
            if (id.includes('markdown-it')) return 'markdown-it'
            if (id.includes('dompurify')) return 'dompurify'
            if (id.includes('highlight')) return 'highlightjs'
            if (id.includes('mermaid')) return 'mermaid'
            if (id.includes('katex')) return 'katex'
            if (id.includes('pdfjs-dist')) return 'pdfjs'
            // 导出相关库（按需加载）
            if (id.includes('html2pdf') || id.includes('html-docx') || id.includes('html-to-docx')) return 'docx'
            if (id.includes('canvg')) return 'pdf'
            // WebDAV 相关
            if (id.includes('webdav')) return 'wps'
            // Tauri 运行时
            if (id.includes('@tauri-apps')) return 'tauri'
            // 其他较小的第三方库打包到一起
            return 'vendor'
          }
          // 应用代码分割：将大型模块分离
          if (id.includes('/src/')) {
            // WYSIWYG 相关代码
            if (id.includes('/wysiwyg/')) return 'wysiwyg'
            // 扩展系统
            if (id.includes('/extensions/')) return 'extensions'
            // 文件树
            if (id.includes('/fileTree')) return 'filetree'
            // HTML 转 Markdown
            if (id.includes('/html2md')) return 'html2md'
          }
        },
        // 优化文件名，启用内容哈希以利用浏览器缓存
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    minify: 'esbuild', // 使用 esbuild 压缩（比 terser 快）
    sourcemap: false // 关闭 source map 以减小体积
  }
}))
