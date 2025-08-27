import dotenv from 'dotenv'
dotenv.config() // 반드시 최상단에서 환경변수 로드

import express from 'express'

import cors from 'cors'

// 라우터는 env 로드 이후 import
import generateRouter from './routes/generate'

// 코드 주석에 이모티콘은 사용하지 마세요.

const app = express()

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    methods: ['POST', 'OPTIONS', 'GET'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
)
// 전역 프리플라이트 허용
app.options('/generate', cors())

// JSON 파서 (큰 SFC 대비)
app.use(express.json({ limit: '5mb' }))

// 라우터
app.use('/generate', generateRouter)

// 간단 헬스체크
app.get('/health', (_req, res) => res.status(200).send('ok'))

// 디버그 라우트: 특정 노드 단건 조회 결과 확인
app.get('/debug/figma-node', async (req, res) => {
  try {
    const fileKey = process.env.FIGMA_FILE_KEY
    const token = process.env.FIGMA_TOKEN
    if (!fileKey || !token) return res.status(400).json({ error: 'FIGMA_FILE_KEY or FIGMA_TOKEN missing' })

    const raw = String(req.query.id || '')
    const id = raw.includes('-') && !raw.includes(':') ? raw.replace(/-/g, ':') : raw

    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}`
    const r = await fetch(url, { headers: { 'X-Figma-Token': token } })
    const j = await r.json()
    return res.json({ id, keys: Object.keys(j?.nodes || {}), entry: j?.nodes?.[id] })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
})

// AI 상태 확인: 모델 목록, 간단 ping
app.get('/ai/status', async (_req, res) => {
  try {
    const base = process.env.OLLAMA_URL || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434'
    const r = await fetch(`${base}/api/tags`)
    const j = await r.json().catch(() => ({}))
    res.json({ base, models: j?.models || [] })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) })
  }
})

const port = Number(process.env.PORT ?? 8787)

// 유틸: 타임아웃이 있는 fetch
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

app.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`)

  if (process.env.AUTO_CALL === 'true') {
    try {
      if (!process.env.FIGMA_FILE_KEY || !process.env.FIGMA_TOKEN) {
        console.warn('[boot] FIGMA env missing. Skip auto call.')
        return
      }
      const ollamaUrl = process.env.OLLAMA_URL || process.env.OLLAMA_BASE
      if (ollamaUrl) {
        try {
          const ping = await fetchWithTimeout(`${ollamaUrl}/api/tags`, {}, 5000)
          if (!ping.ok) {
            console.warn(`[boot] Ollama not ready (${ping.status}). Skip auto call.`)
            return
          }
        } catch (e: any) {
          console.warn('[boot] Ollama ping failed. Skip auto call.', e?.message)
          return
        }
      }
      const body = {
        nodeIds: (process.env.AUTO_CALL_NODEIDS?.split(',') ?? ['1588-91759']).map(s => s.trim()),
        useAI: (process.env.AUTO_CALL_USE_AI ?? 'false') === 'true',
        componentName: process.env.AUTO_CALL_COMPONENT ?? undefined,
      }
      const res = await fetchWithTimeout(
        `http://localhost:${port}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        60000,
      )
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.warn(`[boot] auto call failed ${res.status}: ${txt}`)
        return
      }
      const data = await res.json().catch(() => ({}))
      console.log('자동 생성 결과:', data)
    } catch (err: any) {
      console.warn('auto call error:', err?.message || String(err))
    }
  }
})
