import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('src/components/Setup/SetupRoot')) return 'views-setup'
          if (id.includes('src/components/HorseFarm/HorseFarm')) return 'views-farm'
          if (id.includes('src/components/Workflow/')) return 'views-workflow'
          if (id.includes('src/components/Eco/')) return 'views-eco'
          if (id.includes('src/components/System/')) return 'views-system'
          if (id.includes('src/components/Identity/') || id.includes('src/components/Productivity/')) return 'views-identity'
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT) || 29347,
    strictPort: true
  }
})
