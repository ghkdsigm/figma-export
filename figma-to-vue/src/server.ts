// server.ts
import express from 'express'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import cors from 'cors'
import generateRouter from './routes/generate'
import fetch from 'node-fetch' // Node 18이면 없어도 됨. 자동호출에만 사용.

// .env
dotenv.config()

const app = express()

// 1) CORS를 가장 먼저 적용
app.use(
	cors({
		origin: 'http://localhost:5173',
		methods: ['POST', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	}),
)
app.options('/generate', cors()) // 확실하게 프리플라이트 허용

// 2) JSON 파서
app.use(bodyParser.json())

// 3) 라우터
app.use('/generate', generateRouter)

const port = 8787
app.listen(port, async () => {
	console.log(`Server listening on http://localhost:${port}`)

	// 부팅시 자동 호출(선택)
	try {
		const res = await fetch(`http://localhost:${port}/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nodeIds: ['1558:91759'] }),
		})
		const data = await res.json()
		console.log('자동 생성 결과:', data)
	} catch (err) {
		console.error('auto call error:', err)
	}
})
