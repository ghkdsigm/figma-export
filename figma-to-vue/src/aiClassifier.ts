// src/aiClassifier.ts
import type { IncomingHttpHeaders } from 'http'

export type FigmaNode = {
  id?: string
  name?: string
  type?: string
  characters?: string
  opacity?: number
  fills?: any[]
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
  children?: FigmaNode[]
}

export type AiBehavior =
  | 'modal' | 'accordion' | 'button' | 'tabs' | 'navbar' | 'form' | 'none'

export type AiDecision = {
  behavior: AiBehavior
  confidence: number // 0~1
  reason?: string
  // 렌더 도움 힌트 (optional)
  titleText?: string
  items?: Array<{ title?: string; text?: string }>
  primaryAction?: string
  secondaryAction?: string
}

const MODEL = process.env.LLM_MODEL || 'llama3:instruct'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

function pickTextSamples(n: FigmaNode, out: string[] = [], limit = 8): string[] {
  if (out.length >= limit) return out
  if (n.type === 'TEXT' && n.characters) out.push(n.characters.trim())
  for (const c of n.children || []) {
    if (out.length >= limit) break
    pickTextSamples(c, out, limit)
  }
  return out
}

function featureize(root: FigmaNode) {
  const text = pickTextSamples(root)
  const childTypes: Record<string, number> = {}
  const q: FigmaNode[] = [root]
  let depth = 0, maxDepth = 0, count = 0
  while (q.length) {
    const n = q.shift()!
    count++
    childTypes[n.type || 'UNKNOWN'] = (childTypes[n.type || 'UNKNOWN'] || 0) + 1
    for (const c of n.children || []) q.push(c)
    maxDepth = Math.max(maxDepth, depth)
  }
  const bb = root.absoluteBoundingBox
  return {
    name: root.name || '',
    rootType: root.type || '',
    width: Math.round(bb?.width || 0),
    height: Math.round(bb?.height || 0),
    count,
    childTypes,
    sampleText: text,
  }
}

export async function aiClassify(root: FigmaNode, headers?: IncomingHttpHeaders): Promise<AiDecision> {
  // ollama가 없으면 안전 기본값
  const skip = process.env.AI_DISABLE === '1'
  if (skip) return { behavior: 'none', confidence: 0.0, reason: 'AI disabled' }

  const sys = [
    'You are a UI component classifier.',
    'Given high-level features of a Figma node tree, identify the likely UX behavior.',
    'Return ONLY valid JSON strictly matching the schema.',
    'Behaviors: modal, accordion, button, tabs, navbar, form, none.',
    'Confidence must be 0.0~1.0; choose none if uncertain.',
    'If accordion/tabs: provide items with title/text if possible.',
    'If modal/form/button: provide primaryAction/secondaryAction if obvious.',
  ].join('\n')

  const feat = featureize(root)
  const user = [
    'FigmaNode summary:',
    JSON.stringify(feat),
    '',
    'Return JSON with keys: behavior, confidence, reason, titleText?, items?, primaryAction?, secondaryAction?',
  ].join('\n')

  const body = {
    model: MODEL,
    prompt: `SYSTEM:\n${sys}\n\nUSER:\n${user}\n`,
    stream: false,
    options: { temperature: 0.2, top_p: 0.9 },
  }

  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!r.ok) {
    return { behavior: 'none', confidence: 0.0, reason: `ollama error ${r.status}` }
  }
  const json = await r.json() as any
  const raw = (json?.response || '').trim()

  // JSON만 골라내기 (코드블럭 방지)
  const m = raw.match(/\{[\s\S]*\}$/)
  try {
    const parsed = JSON.parse(m ? m[0] : raw)
    // 러프한 가드
    if (!parsed.behavior) return { behavior: 'none', confidence: 0.0, reason: 'no behavior' }
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)))
    return parsed as AiDecision
  } catch {
    return { behavior: 'none', confidence: 0.0, reason: 'parse failed' }
  }
}
