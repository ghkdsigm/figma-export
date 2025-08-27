import { Router } from 'express'
import { fetchNodes } from '../services/figma'
import { figmaToNodeLike } from '../services/figma-adapter'
import { generateVueSFC, writeComponent } from '../services/codegen'
import { refineSFC } from '../services/aiRefine'
import { OllamaProvider, getLastModelUsed } from '../services/llm/ollama'

const router = Router()

// 하이픈 → 콜론 정규화 (유저 입력이 1516-41900 같은 형태일 때 대응)
const toApiId = (id: string) =>
  id && id.includes('-') && !id.includes(':') ? id.replace(/-/g, ':') : id

// 파일 이름에 쓸 수 있게 콜론만 하이픈으로
const toFileSafe = (id: string) => id.replace(/[:]/g, '-')

router.post('/', async (req, res) => {
  // 프런트가 결과를 캐시하지 않게(선택)
  res.setHeader('Cache-Control', 'no-store')

  try {
    const fileKey = process.env.FIGMA_FILE_KEY
    const outDir = process.env.OUT_DIR || './generated'
    const nodeIds: string[] = req.body?.nodeIds
    const useAI: boolean = !!req.body?.useAI
    const desiredName: string | undefined = req.body?.componentName

    if (!fileKey || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return res.status(400).json({ message: 'FIGMA_FILE_KEY or nodeIds[] missing' })
    }

    const apiIds = nodeIds.map(toApiId)
    const apiJson = await fetchNodes(fileKey, apiIds)

    const results: Array<{
      nodeId: string
      filename: string
      code: string
      changes?: string[]
      error?: any
      aiUsed?: boolean
      refiner?: string
      model?: string
    }> = []

    for (let i = 0; i < nodeIds.length; i++) {
      const inputId = nodeIds[i]
      const apiId = apiIds[i]

      const entry = apiJson?.nodes?.[apiId]
      if (entry == null) {
        console.warn('[generate] missing entry/null for nodeId:', inputId, 'apiId:', apiId)
        results.push({
          nodeId: inputId,
          filename: '',
          code: '',
          changes: ['missing entry (null)'],
          aiUsed: false,
        })
        continue
      }
      if ((entry as any).error) {
        console.warn('[generate] API error for', apiId, (entry as any).error)
        results.push({
          nodeId: inputId,
          filename: '',
          code: '',
          changes: ['api error'],
          error: (entry as any).error,
          aiUsed: false,
        })
        continue
      }

      const docNode = (entry as any).document
      if (!docNode) {
        console.warn('[generate] no document for', apiId)
        results.push({
          nodeId: inputId,
          filename: '',
          code: '',
          changes: ['no document'],
          aiUsed: false,
        })
        continue
      }

      // 1) Figma → 우리 내부 노드로
      const root = figmaToNodeLike(docNode)

      // 2) 기본 SFC 생성
      const baseName = desiredName ? desiredName : `Figma_${toFileSafe(apiId)}`
      const baseSfc: string = generateVueSFC(baseName, root)

      // 3) (옵션) AI 리파인
      let finalName = baseName
	let finalCode = baseSfc
	let changes: string[] = []
	let aiUsed = false
	let refiner: string | undefined
	let model: string | undefined

	if (useAI) {
	try {
		const refinedRes: unknown = await refineSFC(OllamaProvider, baseSfc, baseName)

		// 1) 문자열 단독 반환 케이스 먼저 처리
		if (typeof refinedRes === 'string') {
		if (refinedRes.trim()) {
			finalCode = refinedRes
			aiUsed = true
		}
		}
		// 2) 객체 형태 반환 케이스 처리
		else if (refinedRes && typeof refinedRes === 'object') {
		const r = refinedRes as {
			refined?: string
			componentName?: string
			changes?: string[]
		}

		if (typeof r.refined === 'string' && r.refined.trim()) {
			finalCode = r.refined
			aiUsed = true
		}
		if (typeof r.componentName === 'string' && r.componentName.trim()) {
			finalName = r.componentName.trim()
		}
		if (Array.isArray(r.changes)) {
			changes = r.changes
		}
		}

		refiner = 'ollama'
		model = getLastModelUsed()
	} catch (e: any) {
		console.warn('[generate] refine failed, fallback to base:', e?.message || e)
	}
	}

      // 4) 파일로 저장 (항상 실행)
      const file = writeComponent(outDir, finalName, finalCode)

      // 5) 응답 결과 push
      results.push({
        nodeId: inputId,
        filename: file,
        code: finalCode,
        changes,
        aiUsed,
        refiner,
        model,
      })
    }

    return res.json({ count: results.length, results })
  } catch (e: any) {
    console.error('[generate] error:', e?.message || e)
    return res.status(500).json({ message: 'Internal error', error: e?.message || String(e) })
  }
})

export default router
