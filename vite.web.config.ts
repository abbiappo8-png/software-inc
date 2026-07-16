import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * La CSP del index.html (default-src 'self') bloquearía las llamadas fetch a
 * Supabase. Para el build web se elimina la meta-CSP: la política la define el
 * hosting (cabeceras del servidor). La app Electron conserva su CSP.
 */
function stripCsp(): Plugin {
  return {
    name: 'strip-csp-web',
    transformIndexHtml(html) {
      return html.replace(/<meta[^>]*Content-Security-Policy[^>]*>\s*/i, '')
    }
  }
}

/**
 * Build de solo-renderer para el MODO WEB (navegador + Supabase).
 * Requiere VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY y VITE_SUPABASE_EMAIL en el
 * entorno del build (ver src/renderer/lib/supabaseRest.ts).
 *
 *   VITE_SUPABASE_URL=... vite build --config vite.web.config.ts  -> dist-web/
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  define: {
    // Bandera explícita del build web: api.ts SOLO activa supabaseApi con ella.
    // (Evita que un .env con VITE_SUPABASE_URL desvíe el escritorio/demo a Supabase.)
    'import.meta.env.VITE_TARGET': JSON.stringify('web')
  },
  resolve: {
    alias: {
      '@shared': resolve('shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  plugins: [react(), stripCsp()],
  server: { port: 5175, open: true },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
  }
})
