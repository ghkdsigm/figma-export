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
export const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b' // 설치한 태그와 정확히 일치

export const OllamaProvider: Provider = {
	name: 'ollama',
	async generate({ system, user }: GenParams): Promise<string> {
		const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: MODEL,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				stream: false, // 비스트리밍 파서면 필수
				format: 'json', // 최상위에 둔다
				options: {
					temperature: 0.2,
					num_ctx: 2048, // 8192 → 2048로 내려 속도 개선
					num_predict: 256,
					num_thread: 10, // 로그에 cores=10
				},
			}),
		})
		if (!res.ok) {
			const t = await res.text().catch(() => '')
			throw new Error(`Ollama error: ${res.status} ${res.statusText} :: ${t}`)
		}
		const j: any = await res.json()
		const content = j?.message?.content
		if (typeof content !== 'string' || content.trim().length === 0) {
			throw new Error('Ollama empty content')
		}
		return content
	},
}
