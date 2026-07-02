import { defineConfig } from 'vite'

// base './' so relative asset paths survive all three delivery targets (spec §9)
export default defineConfig({
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
})
