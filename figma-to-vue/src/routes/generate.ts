// src/routes/generate.ts
import { Router } from 'express'
import { fetchNodes } from '../services/figma'
import { figmaToNodeLike } from '../services/figma-adapter'
import { generateVueSFC, writeComponent } from '../services/codegen'

const router = Router()

// 하이픈 → 콜론 정규화
const toApiId = (id: string) => (id && id.includes('-') && !id.includes(':') ? id.replace(/-/g, ':') : id)
const toFileSafe = (id: string) => id.replace(/[:]/g, '-')

router.post('/', async (req, res) => {
	try {
		const fileKey = process.env.FIGMA_FILE_KEY
		const nodeIds: string[] = req.body?.nodeIds
		if (!fileKey || !Array.isArray(nodeIds) || nodeIds.length === 0) {
			return res.status(400).json({ message: 'FIGMA_FILE_KEY or nodeIds[] missing' })
		}

		// API용 아이디로 변환
		const apiIds = nodeIds.map(toApiId)
		console.log('[generate] fileKey:', fileKey, 'nodeIds:', nodeIds, 'apiIds:', apiIds)

		const apiJson = await fetchNodes(fileKey, apiIds)
		const outDir = process.env.OUT_DIR || './generated'

		const results: Array<{ nodeId: string; filename: string; code: string }> = []

		// 원본 입력과 apiId를 매칭
		for (let i = 0; i < nodeIds.length; i++) {
			const inputId = nodeIds[i]
			const apiId = apiIds[i] // 콜론 버전
			const docNode = apiJson?.nodes?.[apiId]?.document
			if (!docNode) {
				// 디버그용으로 응답에 어떤 키가 왔는지 보여줌
				const gotKeys = Object.keys(apiJson?.nodes || {})
				console.warn('[generate] missing document for nodeId:', inputId, 'apiId:', apiId, 'got:', gotKeys)
				results.push({ nodeId: inputId, filename: '', code: '' })
				continue
			}
			const root = figmaToNodeLike(docNode)
			const baseName = `Figma_${toFileSafe(apiId)}`
			const sfc = generateVueSFC(baseName, root)
			const file = writeComponent(outDir, baseName, sfc)
			results.push({ nodeId: inputId, filename: file, code: sfc })
		}

		return res.json({ count: results.length, results })
	} catch (e: any) {
		console.error('[generate] error:', e?.message)
		return res.status(500).json({ message: 'Internal error', error: e?.message })
	}
})

export default router
