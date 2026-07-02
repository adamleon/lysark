import { defineConfig } from 'vite'
import { slidesPlugin } from './vite-plugin-slides'

// base './' so relative asset paths survive all three delivery targets (spec §9)
export default defineConfig({
  base: './',
  plugins: [slidesPlugin()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
})
