import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base relativa: l'app funziona sotto qualsiasi indirizzo (es. https://utente.github.io/Forchettata/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
