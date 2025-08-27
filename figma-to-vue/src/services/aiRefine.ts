// src/services/aiRefine.ts
import { z } from 'zod'
import type { Provider } from './llm/ollama'

// 코드 주석에 이모티콘은 사용하지 마세요.

// —— 유틸: 코드펜스/접두사 제거 ——
function stripDecorations(s: string): string {
	return s
		.replace(/```json|```/g, '')
		.replace(/^EXAMPLE_OUTPUT:.*$/gm, '')
		.trim()
}

// —— 유틸: 첫 JSON 블록 추출 ——
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
				depth--
				if (depth === 0) return s.slice(start, i + 1)
			}
		}
	}
	throw new Error('No JSON block found')
}

// —— Zod: 느슨하게 받되 문자열로 정규화 ——
const AnyRecord = z.record(z.string(), z.any())
const AnyArray = z.array(z.any())

const OutputSchemaLoose = z.object({
	componentName: z.union([z.string(), z.number()]).optional(),
	refined: z.union([z.string(), z.boolean(), AnyRecord, AnyArray]),
	changes: z
		.array(z.union([z.string(), AnyRecord, AnyArray]))
		.optional()
		.default([]),
	notes: z
		.array(z.union([z.string(), AnyRecord, AnyArray]))
		.optional()
		.default([]),
})

const OutputSchemaTight = z.object({
	componentName: z.string(),
	refined: z.string().min(1),
	changes: z.array(z.string()).default([]),
	notes: z.array(z.string()).default([]),
})

function toStr(v: unknown): string {
	return typeof v === 'string' ? v : JSON.stringify(v)
}

function normalize(parsed: z.infer<typeof OutputSchemaLoose>, fallbackSFC: string, desiredName?: string) {
	const refined = toStr(parsed.refined)
	const changes = (parsed.changes ?? []).map(toStr)
	const notes = (parsed.notes ?? []).map(toStr)

	const name =
		desiredName ||
		(typeof parsed.componentName === 'string' && parsed.componentName) ||
		(typeof parsed.componentName === 'number' ? String(parsed.componentName) : '') ||
		'AutoComponentRefined'

	const refinedSafe = refined.trim().length >= 10 ? refined : fallbackSFC
	return { componentName: name, refined: refinedSafe, changes, notes }
}

// —— 프롬프트(스켈레톤 + 예시로 타입 고정) ——
const systemPrompt = [
	'You are a senior Vue 3 + TailwindCSS code refiner.',
	'Output STRICT JSON only. No markdown, no code fences, no explanations.',
	'Schema: {"componentName": "string", "refined": "string", "changes": "string[]", "notes": "string[]"}',
	'Return a minified one-line JSON object that starts with { and ends with }.',
].join('\n')

function buildUserPrompt(sfcText: string, desiredName?: string) {
	const skeleton = '{"componentName":"%NAME%","refined":"%CODE%","changes":[],"notes":[]}'
	const example =
		'EXAMPLE_OUTPUT: {"componentName":"MyCard","refined":"<template>...</template>","changes":["dedup classes"],"notes":["kept semantics"]}'
	return [
		'Refine this Vue SFC. Keep same visuals and text. Output JSON only.',
		desiredName ? `Desired componentName: ${desiredName}` : '',
		example,
		'Always follow this skeleton (types and quotes must match):',
		skeleton,
		'[SFC_BEGIN]',
		sfcText,
		'[SFC_END]',
	]
		.filter(Boolean)
		.join('\n')
}

export async function refineSFC(provider: Provider, sfcText: string, desiredName?: string) {
	const user = buildUserPrompt(sfcText, desiredName)

	// 1) LLM 호출
	const raw = await provider.generate({ system: systemPrompt, user })

	// 2) 전처리 + JSON 추출
	const cleaned = stripDecorations(raw)
	let jsonStr = ''
	try {
		// 우선 통째로 JSON 시도
		jsonStr = cleaned
		JSON.parse(jsonStr)
	} catch {
		// 실패하면 블록 추출
		jsonStr = extractFirstJsonBlock(cleaned)
	}

	// 3) 느슨하게 파싱 → 문자열로 정규화 → 엄격 스키마로 재검증
	const loose = OutputSchemaLoose.parse(JSON.parse(jsonStr))
	const normalized = normalize(loose, sfcText, desiredName)
	const tight = OutputSchemaTight.parse(normalized) // 최종 형태 보증

	// 4) 최소 길이 보호 (정말 비정상이면 base 유지)
	if (tight.refined.trim().length < 10) {
		tight.notes.push('refined too short; kept base')
		tight.refined = sfcText
	}

	return tight
}
