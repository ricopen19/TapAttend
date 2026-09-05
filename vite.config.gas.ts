import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// GAS の HtmlService は複数の静的ファイルを配信できないため、JS/CSS を
// 1つの index.html にインラインした専用ビルドを作る。出力先は gas/ 直下。
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'gas',
    emptyOutDir: false,
    rollupOptions: {
      input: 'index.html',
    },
  },
})
