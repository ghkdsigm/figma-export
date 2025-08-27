// src/services/llm/ollama.ts
// Node 18 이상이면 fetch 내장. 18 미만은 undici/register 사용.
// import 'undici/register'

// 코드 주석에 이모티콘은 사용하지 마세요.
export type GenParams = { system: string; user: string }

export interface Provider {
	name: string
	generate(p: GenParams): Promise<string>
}

export const OLLAMA_ENDPOINT = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
export const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'

export const OllamaProvider: Provider = {
	name: 'ollama',
	async generate({ system, user }: GenParams): Promise<string> {
		const ctrl = new AbortController()
		const timer = setTimeout(() => ctrl.abort(), 60000)

		try {
			const res = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: ctrl.signal,
				body: JSON.stringify({
					model: MODEL,
					// chat 대신 generate: system+user 합친 단일 프롬프트
					prompt: `${system}\n\n${user}`,
					stream: false,
					format: 'json', // 반드시 최상위
					options: {
						temperature: 0,
						num_ctx: 2048,
						num_predict: 192, // 96→192 : JSON 본문이 끊기지 않도록 여유
						num_thread: 10,
					},
				}),
			})

			if (!res.ok) {
				const txt = await res.text().catch(() => '')
				throw new Error(`HTTP ${res.status} :: ${txt}`)
			}
			const j: any = await res.json()
			const content = j?.response?.trim()
			if (!content) throw new Error('empty content')
			return content
		} finally {
			clearTimeout(timer)
		}
	},
}
