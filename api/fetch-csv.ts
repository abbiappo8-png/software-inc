/**
 * Función serverless de Vercel: proxy del CSV publicado de Google Sheets.
 *
 * El navegador no puede hacer fetch directo a docs.google.com por CORS, así que
 * la página "Reservas Web" llama a /api/fetch-csv?url=<csv publicado> y esta
 * función lo descarga en el servidor y lo devuelve como texto.
 *
 * Solo se permite https hacia docs.google.com (hoja "Publicar en la web → CSV");
 * nada más, para no convertirla en un proxy abierto.
 *
 * Tipos laxos (req/res: any): @vercel/node no está en las dependencias y este
 * directorio no forma parte de ningún tsconfig del repo (Vercel lo compila solo).
 */
export default async function handler(req: any, res: any): Promise<void> {
  try {
    const raw = req.query?.url
    const url = Array.isArray(raw) ? raw[0] : raw
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Falta el parámetro url' })
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      res.status(400).json({ error: 'URL no válida' })
      return
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com') {
      res.status(400).json({ error: 'Solo se permiten hojas publicadas de docs.google.com' })
      return
    }
    const upstream = await fetch(parsed.toString(), { redirect: 'follow' })
    if (!upstream.ok) {
      res.status(502).json({ error: `Google respondió ${upstream.status}. ¿La hoja sigue publicada como CSV?` })
      return
    }
    const text = await upstream.text()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(text)
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Error inesperado' })
  }
}
