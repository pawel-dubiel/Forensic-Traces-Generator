import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The 3D lab is loaded on demand (see App.tsx), which puts three.js in a chunk of its own.
    // That chunk is about 1 MB minified, nearly all of it three.js.
    chunkSizeWarningLimit: 1100,
  },
})
