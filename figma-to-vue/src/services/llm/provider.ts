// Node 18 미만일 경우에만 해제해서 사용하세요.
// import 'undici/register'

// 코드 주석에 이모티콘은 사용하지 마세요.
export type GenParams = { system: string; user: string }

export interface Provider {
	name: string
	generate(p: GenParams): Promise<string>
}

export const OLLAMA_ENDPOINT = process.env.OLLAMA_URL || 'http://localhost:11434'

// 실제로 pull 한 모델명과 반드시 일치시켜야 합니다.
// 'llama3.1:8b' 를 받았으면 아래도 동일하게.
export const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b' // 또는 'llama3.1:8b-instruct'

export const OllamaProvider: Provider = {
	name: 'ollama',
	// format 최상위 + 길이 제한 + 타임아웃
	async generate({ system, user }: GenParams): Promise<string> {
		const ctrl = new AbortController()
		const timer = setTimeout(() => ctrl.abort(), 60000)

		const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: ctrl.signal,
			body: JSON.stringify({
				model: MODEL,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				stream: false,
				format: 'json', // ← 최상위
				options: { temperature: 0, num_ctx: 2048, num_predict: 128, num_thread: 10 },
			}),
		})
		clearTimeout(timer)

		if (!res.ok) throw new Error(`HTTP ${res.status} :: ${await res.text().catch(() => '')}`)
		const j: any = await res.json()
		const content = j?.message?.content?.trim()
		if (!content) throw new Error('empty content')
		return content
	},
}
