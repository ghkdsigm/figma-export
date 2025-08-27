// server.ts
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
		methods: ['POST', 'OPTIONS'],
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

	// 부팅시 자동 호출은 opt-in
	if (process.env.AUTO_CALL === 'true') {
		try {
			// 사전 체크: Figma env
			if (!process.env.FIGMA_FILE_KEY || !process.env.FIGMA_ACCESS_TOKEN) {
				console.warn('[boot] FIGMA env missing. Skip auto call.')
				return
			}

			// 사전 체크: Ollama 준비 상태 (설정된 경우에만 확인)
			const ollamaUrl = process.env.OLLAMA_URL
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

			// 가벼운 모드로 1회 실행 권장
			const body = {
				nodeIds: (process.env.AUTO_CALL_NODEIDS?.split(',') ?? ['1558:91759']).map(s => s.trim()),
				useAI: (process.env.AUTO_CALL_USE_AI ?? 'false') === 'true', // 기본 false
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
