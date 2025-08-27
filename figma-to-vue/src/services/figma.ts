// src/services/figma.ts
import fs from 'fs'
import path from 'path'

// Node 18+ 에서는 글로벌 fetch 사용 가능. 필요시 undici를 써도 됨.
const FIGMA_API = 'https://api.figma.com/v1'

// 환경 변수 유틸
function getToken() {
	const t = process.env.FIGMA_TOKEN
	if (!t) throw new Error('FIGMA_TOKEN missing')
	return t
}
function getDefaultFileKey() {
	const k = process.env.FIGMA_FILE_KEY || process.env.FIGMA_FILE_ID
	if (!k) throw new Error('FIGMA_FILE_KEY missing. Set it in .env')
	return k
}

// 공통 fetch 래퍼: 429/5xx 재시도, 타임아웃
async function httpGet(url: string, init: RequestInit = {}, retries = 3, timeoutMs = 15000) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			const r = await fetch(url, {
				...init,
				headers: {
					...(init.headers || {}),
					'X-Figma-Token': getToken(),
				},
				signal: controller.signal,
			})
			clearTimeout(timer)

			if (r.ok) return r
			// 429 또는 5xx는 재시도
			if ((r.status === 429 || r.status >= 500) && attempt < retries) {
				const retryAfter = Number(r.headers.get('retry-after') || 0)
				const backoff = retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1)
				await new Promise(res => setTimeout(res, backoff))
				continue
			}

			// 나머지는 바로 에러
			const text = await r.text().catch(() => '')
			throw new Error(`HTTP ${r.status} ${r.statusText} :: ${text}`)
		} catch (e: any) {
			clearTimeout(timer)
			if (e?.name === 'AbortError' && attempt < retries) {
				await new Promise(res => setTimeout(res, 300 * (attempt + 1)))
				continue
			}
			if (attempt < retries) {
				await new Promise(res => setTimeout(res, 300 * (attempt + 1)))
				continue
			}
			throw e
		}
	}
	throw new Error('Unreachable')
}

// 긴 ids를 분할하기 위한 헬퍼
function chunk<T>(arr: T[], size: number) {
	const out: T[][] = []
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
	return out
}

// URL 길이 제한을 감안하여 ids 청크 크기를 추정
function chooseIdsChunkSize(ids: string[], baseUrl: string) {
	// 보수적으로 1000자 근처를 타겟팅
	// 평균 id 길이를 기준으로 대강 나눔
	const avg = ids.join(',').length / Math.max(1, ids.length)
	if (avg === 0) return 1
	const budget = 900 // 쿼리스트링 영역 여유
	return Math.max(1, Math.floor(budget / avg))
}

// Figma nodes 조회
export async function fetchNodes(fileKeyOrEmpty: string | undefined, nodeIds: string[]) {
	const fileKey = fileKeyOrEmpty && fileKeyOrEmpty.length > 0 ? fileKeyOrEmpty : getDefaultFileKey()

	if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
		throw new Error('nodeIds is required')
	}

	// ids가 길면 분할해서 합친다
	const base = `${FIGMA_API}/files/${fileKey}/nodes`
	const chunkSize = chooseIdsChunkSize(nodeIds, base)
	const results: any[] = []

	for (const idsChunk of chunk(nodeIds, chunkSize)) {
		const ids = encodeURIComponent(idsChunk.join(','))
		const url = `${base}?ids=${ids}`
		const r = await httpGet(url)
		const j = await r.json()
		results.push(j)
	}

	// Figma 응답 합치기
	const merged = { nodes: {} as Record<string, any> }
	for (const part of results) {
		Object.assign(merged.nodes, part.nodes || {})
	}
	return merged
}

// 이미지 URL 얻기
export async function getImageUrls(
	fileKeyOrEmpty: string | undefined,
	ids: string[],
	format: 'png' | 'svg' = 'png',
	scale = 2,
) {
	const fileKey = fileKeyOrEmpty && fileKeyOrEmpty.length > 0 ? fileKeyOrEmpty : getDefaultFileKey()
	if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids is required')
	if (format === 'svg' && scale !== undefined) {
		// Figma는 svg에 scale을 사용하지 않음
		scale = undefined as any
	}

	const base = `${FIGMA_API}/images/${fileKey}`
	const params = new URLSearchParams()
	params.set('ids', ids.join(','))
	params.set('format', format)
	if (format === 'png' && typeof scale === 'number') params.set('scale', String(scale))

	const r = await httpGet(`${base}?${params.toString()}`)
	const j = (await r.json()) as { images: Record<string, string> }
	return j.images
}

// CDN URL을 파일로 저장
export async function downloadTo(url: string, outFile: string) {
	const r = await httpGet(url, {}, 2, 20000)
	if (!r.ok || !r.body) throw new Error(`Download failed: ${r.status} ${r.statusText}`)

	fs.mkdirSync(path.dirname(outFile), { recursive: true })

	// Node 18 fetch Response.body는 ReadableStream. 간단히 버퍼로 받거나 스트림으로 저장.
	const arrayBuf = await r.arrayBuffer()
	const buf = Buffer.from(arrayBuf)
	fs.writeFileSync(outFile, buf)
}
