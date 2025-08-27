// src/services/aiRefine.ts
import { z } from 'zod'
import type { Provider } from './llm/ollama' // 경로는 프로젝트에 맞게

const OutputSchema = z.object({
	componentName: z.string().min(1),
	refined: z.string().min(1),
	changes: z.array(z.string()).default([]),
	notes: z.array(z.string()).default([]),
})

const systemPrompt = [
	'You are a senior Vue 3 + TailwindCSS code refiner.',
	'Rules:',
	'- Input is a single-file component (SFC) string.',
	'- Output strictly JSON: {componentName, refined, changes[], notes[]}.',
	'- Keep behavior identical; improve structure, semantics, a11y and Tailwind usage.',
	'- Remove redundant wrappers, deduplicate classes, add alt to img and reasonable aria- attributes.',
	'- Do not invent data. Keep template minimal and deterministic.',
].join('\n')

// JSON 블록만 안전 추출
function extractFirstJsonBlock(s: string): string {
	let start = -1,
		depth = 0
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (start < 0) {
			if (c === '{' || c === '[') {
				start = i
				depth = 1
			}
		} else {
			if (c === '{' || c === '[') depth++
			else if (c === '}' || c === ']') {
				if (--depth === 0) return s.slice(start, i + 1)
			}
		}
	}
	throw new Error('No JSON block found')
}

export async function refineSFC(provider: Provider, sfcText: string, desiredName?: string) {
	// 코드펜스 제거, 명확한 경계자 사용
	const user = [
		'Refine this Vue SFC. Keep same visuals and text.',
		desiredName ? `Desired componentName: ${desiredName}` : '',
		'[SFC_BEGIN]',
		sfcText,
		'[SFC_END]',
	]
		.filter(Boolean)
		.join('\n')

	const raw = await provider.generate({ system: systemPrompt, user })

	// JSON 이외 문자가 섞여도 첫 JSON만 파싱
	const jsonStr = extractFirstJsonBlock(raw)
	const parsed = OutputSchema.parse(JSON.parse(jsonStr))
	const name = desiredName || parsed.componentName || 'AutoComponentRefined'
	return { ...parsed, componentName: name }
}
