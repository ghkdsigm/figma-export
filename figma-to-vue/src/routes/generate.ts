import { Router } from 'express'
import { fetchNodes } from '../services/figma'
import { figmaToNodeLike } from '../services/figma-adapter'
import { generateVueSFC, writeComponent } from '../services/codegen'
import { refineSFC } from '../services/aiRefine'
import { OllamaProvider } from '../services/llm/ollama'

const router = Router()

const toApiId = (id: string) => (id && id.includes('-') && !id.includes(':') ? id.replace(/-/g, ':') : id)
const toFileSafe = (id: string) => id.replace(/[:]/g, '-')

router.post('/', async (req, res) => {
	try {
		const fileKey = process.env.FIGMA_FILE_KEY
		const nodeIds: string[] = req.body?.nodeIds
		const useAI: boolean = !!req.body?.useAI
		const desiredName: string | undefined = req.body?.componentName

		if (!fileKey || !Array.isArray(nodeIds) || nodeIds.length === 0) {
			return res.status(400).json({ message: 'FIGMA_FILE_KEY or nodeIds[] missing' })
		}

		const apiIds = nodeIds.map(toApiId)
		const apiJson = await fetchNodes(fileKey, apiIds)
		const outDir = process.env.OUT_DIR || './generated'

		const results: Array<{ nodeId: string; filename: string; code: string; changes?: string[] }> = []

		for (let i = 0; i < nodeIds.length; i++) {
			const inputId = nodeIds[i]
			const apiId = apiIds[i]
			const docNode = apiJson?.nodes?.[apiId]?.document
			if (!docNode) {
				const gotKeys = Object.keys(apiJson?.nodes || {})
				console.warn('[generate] missing document for nodeId:', inputId, 'apiId:', apiId, 'got:', gotKeys)
				results.push({ nodeId: inputId, filename: '', code: '' })
				continue
			}

			const root = figmaToNodeLike(docNode)
			const baseName = desiredName ? desiredName : `Figma_${toFileSafe(apiId)}`
			const baseSfc = generateVueSFC(baseName, root)

			if (useAI) {
				try {
					const refined = await refineSFC(OllamaProvider, baseSfc, baseName)
					const file = writeComponent(outDir, refined.componentName, refined.refined)
					results.push({
						nodeId: inputId,
						filename: file,
						code: refined.refined,
						changes: refined.changes,
					})
					continue
				} catch (e: any) {
					console.warn('[generate] refine failed, fallback to base:', e?.message)
					// 필요시: console.debug(raw 일부)을 남기는 것도 방법
				}
			}

			const file = writeComponent(outDir, baseName, baseSfc)
			results.push({ nodeId: inputId, filename: file, code: baseSfc })
		}

		return res.json({ count: results.length, results })
	} catch (e: any) {
		console.error('[generate] error:', e?.message)
		return res.status(500).json({ message: 'Internal error', error: e?.message })
	}
})

export default router
