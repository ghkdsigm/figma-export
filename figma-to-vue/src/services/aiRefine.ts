import { z } from 'zod'
import type { Provider } from './llm/ollama'

// 코드 주석에 이모티콘은 사용하지 마세요.

// —— 유틸: 코드펜스/접두사 제거 ——
function stripDecorations(s: string): string {
  return s
    .replace(/```[a-z]*|```/gi, '')
    .replace(/^\s*EXAMPLE_OUTPUT:.*$/gmi, '')
    .trim()
}

// —— 유틸: 첫 JSON 블록 추출 ——
function extractFirstJsonBlock(s: string): string {
  let start = -1, depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (start < 0) {
      if (c === '{' || c === '[') { start = i; depth = 1 }
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

// —— 스키마 ——
const AnyRecord = z.record(z.string(), z.any())
const AnyArray = z.array(z.any())

const OutputSchemaLoose = z.object({
  componentName: z.union([z.string(), z.number(), z.boolean()]).optional(),
  refined: z.union([z.string(), z.number(), z.boolean(), AnyRecord, AnyArray]).optional(),
  changes: z.array(z.union([z.string(), z.number(), z.boolean(), AnyRecord, AnyArray])).optional().default([]),
  notes: z.array(z.union([z.string(), z.number(), z.boolean(), AnyRecord, AnyArray])).optional().default([]),
})

const OutputSchemaTight = z.object({
  componentName: z.string(),
  refined: z.string().min(1),
  changes: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
})

function toStr(v: unknown): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

// —— 검사기: 최소 리팩터링 규칙 충족 여부 ——
function failsRefactorChecks(sfc: string): string[] {
  const problems: string[] = []
  if (/\bw-\[\d+px\]/.test(sfc)) problems.push('has fixed width')
  if (/\bh-\[\d+px\]/.test(sfc)) problems.push('has fixed height')
  if (/<span[^>]*\bclass="[^"]*\bblock\b/.test(sfc)) problems.push('span.block present')
  if (/\bleading-\[16px\]/.test(sfc)) problems.push('tight leading 16px')
  if (/\bleading-\[12px\]/.test(sfc)) problems.push('tight leading 12px')
  // 원시 rounded 조합을 재확인한다. 최종엔 rounded-t-none, rounded-br-2xl, rounded-bl-2xl 조합을 기대.
  // 여기서는 부적절한 0px 모서리 선언 유무만 확인한다.
  if (/\brounded-(tl|tr|br|bl)-\[0px\]/.test(sfc)) problems.push('raw pixel rounded classes')
  return problems
}

// —— 디터미니스틱 리팩터: 규칙 기반 최소 변환 ——
function deterministicRefactor(sfc: string): string {
  let out = sfc

  // 1) 최상위 컨테이너: w-[297px], h-[152px] 제거 → max-w 유지
  out = out.replace(/\bw-\[\d+px\]/g, '')
  out = out.replace(/\bh-\[\d+px\]/g, '')
  // 공백 정리
  out = out.replace(/\s{2,}/g, ' ')

  // 2) span.block → h3/p/a 추정 변환
  // 단순 휴리스틱: 첫 번째 span.block은 제목으로 h3, 색상 진한 본문은 p, 링크색(#44883d)은 a
  out = out.replace(
    /<span([^>]*)class="([^"]*)block([^"]*)"([^>]*)>([\s\S]*?)<\/span>/,
    (_m, pre1, cls1, cls2, pre2, body) => {
      const fullCls = (cls1 + ' block ' + cls2).replace(/\s+/g, ' ')
      if (/#262626/.test(fullCls) || /text-\[#262626\]/.test(fullCls) || /text-\[#[0-9a-fA-F]{6}\]/.test(fullCls) && /16px/.test(fullCls)) {
        return `<h3 class="text-base font-semibold leading-6 text-[#262626]">${body.replace(/\n\s*/g, '<br /> ')}</h3>`
      }
      return `<p class="text-xs leading-5 text-[#9e9e9e]">${body.replace(/\n\s*/g, '<br /> ')}</p>`
    }
  )

  // 링크색 span을 a로
  out = out.replace(
    /<span([^>]*)class="([^"]*text-\[#44883d\][^"]*)"([^>]*)>([\s\S]*?)<\/span>/g,
    `<a href="#" class="inline-block text-xs leading-5 text-[#44883d] hover:underline">$4</a>`
  )

  // 3) line-height 교정
  out = out.replace(/\bleading-\[16px\]/g, 'leading-6')
  out = out.replace(/\bleading-\[12px\]/g, 'leading-5')

  // 4) rounded 교정: 상단 0, 하단 16px
  // 일단 기존 rounded-* 전부 제거 후 목표 클래스 부여
  out = out.replace(/\brounded-[a-z\-]+\b/g, '')
  out = out.replace(/\brounded-(tl|tr|br|bl)-\[[^\]]+\]/g, '')
  out = out.replace(
    /class="([^"]*)"/,
    (_m, cls) => `class="${` ${cls} `.replace(/\s+/g, ' ').trim()} rounded-t-none rounded-br-2xl rounded-bl-2xl"`
  )

  // 5) 불필요한 중첩 flex/gap 최소화: 내부 단일 텍스트 그룹의 w-[...] h-[...] 제거
  out = out.replace(/\bw-\[\d+px\]/g, '')
  out = out.replace(/\bh-\[\d+px\]/g, '')

  // 6) 상위 wrapper에 padding, 배경, 그림자 통합 제안
  out = out.replace(
    /<div class="([^"]*)">/,
    (_m, cls) => {
      let newCls = cls
      newCls = newCls.replace(/\bgap-\[\d+px\]\b/g, 'gap-3')
      newCls = newCls.replace(/\bpx-\[\d+px\]\b/g, 'px-4')
      newCls = newCls.replace(/\bpy-\[\d+px\]\b/g, 'py-6')
      if (!/\bbg-white\b/.test(newCls) && /\bbg-\[#ffffff\]\b/.test(newCls)) {
        newCls = newCls.replace(/\bbg-\[#ffffff\]\b/, 'bg-white')
      }
      if (!/\bshadow-/.test(newCls)) {
        newCls += ' shadow-sm'
      }
      return `<div class="${newCls.trim()}">`
    }
  )

  // 7) 불필요한 align-top 제거
  out = out.replace(/\balign-top\b/g, '')

  return out
}

// —— 자동 래핑: JSON이 아니라 SFC만 왔을 때 스키마로 감싸기 ——
function wrapAsJson(sfc: string, desiredName?: string): string {
  const name = desiredName && desiredName.trim().length > 0 ? desiredName : 'AutoComponentRefined'
  const payload = {
    componentName: name,
    refined: sfc,
    changes: [],
    notes: [],
  }
  return JSON.stringify(payload)
}

// —— 정규화 ——
function normalize(
  parsed: z.infer<typeof OutputSchemaLoose>,
  fallbackSFC: string,
  desiredName?: string
) {
  const refinedRaw =
    parsed.refined === undefined || parsed.refined === null
      ? fallbackSFC
      : parsed.refined

  const refined = toStr(refinedRaw)
  const changes = (parsed.changes ?? []).map(toStr)
  const notes = (parsed.notes ?? []).map(toStr)

  const name =
    (desiredName && desiredName) ||
    (typeof parsed.componentName === 'string' && parsed.componentName) ||
    (typeof parsed.componentName === 'number' ? String(parsed.componentName) : '') ||
    (typeof parsed.componentName === 'boolean' ? String(parsed.componentName) : '') ||
    'AutoComponentRefined'

  const refinedSafe = refined.trim().length >= 10 ? refined : fallbackSFC
  return { componentName: name, refined: refinedSafe, changes, notes }
}

// —— 프롬프트 ——
const systemPrompt = [
  'You are a senior Vue 3 + TailwindCSS code refiner.',
  'Output STRICT JSON only. No markdown, no code fences, no explanations.',
  'Schema: {"componentName": "string", "refined": "string", "changes": "string[]", "notes": "string[]"}',
  'Return a minified one-line JSON object that starts with { and ends with }.'
].join('\n')

// 필수 변환 체크리스트를 명문화하고, 최소 5가지 변경을 요구한다.
function buildUserPrompt(sfcText: string, desiredName?: string, force: boolean = false) {
  const skeleton = '{"componentName":"%NAME%","refined":"%CODE%","changes":[],"notes":[]}'
  const example =
    'EXAMPLE_OUTPUT: {"componentName":"MyCard","refined":"<template>...</template>","changes":["removed fixed width","converted span.block to h3/p","expanded line-height","kept semantics","maintained corner style"],"notes":["visual parity kept"]}'
  const musts = [
    '- Remove fixed pixel width/height classes (w-[###px], h-[###px]); allow max-w only if needed.',
    '- Replace span.block with semantic tags (h3/p/a).',
    '- Expand line-height: 16px text -> leading-6, 12px text -> leading-5.',
    '- Keep the original corner style: rounded-t-none, rounded-br-2xl, rounded-bl-2xl.',
    '- Minimize nested flex/gap; prefer margins for spacing.',
    '- Preserve visual parity and text content exactly.',
    '- Return at least 5 concrete "changes".'
  ].join('\n')

  const stricter = force
    ? '\nIf the input already looks refined, still apply further improvements and list at least 5 verifiable changes.'
    : ''

  return [
    'Refine this Vue SFC. Keep same visuals and text. Output JSON only.',
    'Apply ALL of the following rules:',
    musts,
    stricter,
    'Always include all required fields of the schema. "refined" must contain the full .vue single-file component.',
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

// —— 메인 파이프라인 ——
// 1) 요청 → 응답 파싱
// 2) 체크리스트 실패 시 강화 프롬프트로 1회 재시도
// 3) 그래도 실패하면 디터미니스틱 리팩터 적용
export async function refineSFC(provider: Provider, sfcText: string, desiredName?: string) {
  async function oneShot(force: boolean) {
    const user = buildUserPrompt(sfcText, desiredName, force)
    const raw = await provider.generate({
      system: systemPrompt,
      user,
      // 샘플링을 보수적으로 설정해 일관된 출력 유도
      options: { temperature: 0, top_p: 1 }
    } as any)

    const cleaned = stripDecorations(raw)
    let jsonStr = ''
    let parsedJson: unknown | null = null

    try {
      jsonStr = cleaned
      parsedJson = JSON.parse(jsonStr)
    } catch {
      try {
        jsonStr = extractFirstJsonBlock(cleaned)
        parsedJson = JSON.parse(jsonStr)
      } catch {
        // 모델이 SFC만 던진 경우
        jsonStr = wrapAsJson(cleaned, desiredName)
        parsedJson = JSON.parse(jsonStr)
      }
    }

    let loose: z.infer<typeof OutputSchemaLoose>
    try {
      loose = OutputSchemaLoose.parse(parsedJson)
    } catch (e) {
      return {
        componentName: desiredName || 'AutoComponentRefined',
        refined: sfcText,
        changes: ['loose schema parse failed; kept base'],
        notes: [String(e)],
      }
    }

    const normalized = normalize(loose, sfcText, desiredName)

    try {
      const tight = OutputSchemaTight.parse(normalized)
      if (tight.refined.trim().length < 10) {
        tight.notes.push('refined too short; kept base')
        tight.refined = sfcText
      }
      return tight
    } catch (e) {
      return {
        componentName: desiredName || 'AutoComponentRefined',
        refined: sfcText,
        changes: ['tight schema failed; kept base'],
        notes: [String(e)],
      }
    }
  }

  // 1차 시도
  let result = await oneShot(false)

  // 체크리스트 확인
  const issues = failsRefactorChecks(result.refined)
  const insufficientChanges = (result.changes || []).length < 5

  // 2차 강화 재시도 조건: 문제가 있거나 변경점이 부족한 경우
  if (issues.length > 0 || insufficientChanges) {
    const retry = await oneShot(true)
    const retryIssues = failsRefactorChecks(retry.refined)
    const retryInsufficient = (retry.changes || []).length < 5

    if (retryIssues.length === 0 && !retryInsufficient) {
      return retry
    }

    // 그래도 실패하면 디터미니스틱 리팩터
    const forced = deterministicRefactor(retry.refined || sfcText)
    const finalIssues = failsRefactorChecks(forced)
    return {
      componentName: retry.componentName || desiredName || 'AutoComponentRefined',
      refined: finalIssues.length === 0 ? forced : deterministicRefactor(sfcText),
      changes: [
        ...retry.changes,
        'applied deterministic refactor: removed fixed px sizes, converted spans to semantic tags, adjusted line-height, normalized corners'
      ],
      notes: [
        ...(retry.notes || []),
        `auto-fix due to unmet checks: ${[...retryIssues, retryInsufficient ? 'too few changes' : ''].filter(Boolean).join(', ')}`
      ]
    }
  }

  return result
}
