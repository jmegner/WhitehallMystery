import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
// Host-specific base paths:
// - Cloudflare Pages and local development: '/'
// - GitHub Pages: '/WhitehallMystery/' via the build:gh CLI override
// - Custom previews: VITE_BASE or BASE
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || env.BASE || '/'

  return {
    plugins: [react()],
    base,
  }
})
