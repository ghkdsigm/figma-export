// Node 18 이상이면 fetch 내장. 18 미만은 undici/register 사용.
// import 'undici/register'

// 코드 주석에 이모티콘은 사용하지 마세요.
export type GenParams = { system: string; user: string }

export interface Provider {
  name: string
  generate(p: GenParams): Promise<string>
}

// 통일된 엔드포인트 환경변수 키 사용
export const OLLAMA_BASE =
  process.env.OLLAMA_URL || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434'

// 모델 태그 후보. 환경변수 > instruct > 기본
const MODEL_ENV = process.env.OLLAMA_MODEL
const MODEL_CANDIDATES = [MODEL_ENV, 'llama3:instruct', 'llama3'].filter(Boolean) as string[]

let lastModelUsed = ''  // 마지막으로 사용한 모델명 기록
export function getLastModelUsed() {
  return lastModelUsed
}

async function pickAvailableModel(): Promise<string> {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`)
    const j: any = await r.json().catch(() => ({}))
    const names = new Set<string>((j?.models || []).map((m: any) => m?.name).filter(Boolean))
    for (const m of MODEL_CANDIDATES) {
      if (names.has(m)) return m
    }
  } catch {}
  return MODEL_CANDIDATES[0]
}

// JSON 파싱 보조 유틸
function tryParseJSON(raw: string) {
  const s = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export const OllamaProvider: Provider = {
  name: 'ollama',
  async generate({ system, user }: GenParams): Promise<string> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 120000)
    try {
      const model = await pickAvailableModel()
      lastModelUsed = model

      const systemPreamble = `
${system}

아래 지시를 엄격히 따를 것:
- 출력은 반드시 유효한 JSON 한 객체만 포함한다.
- 마크다운, 코드펜스, 설명 문장을 포함하지 않는다.
`.trim()

      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          prompt: `${systemPreamble}\n\n${user}`,
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
            num_ctx: 8192,
            num_predict: 1024,
          },
        }),
      })

      if (res.status === 404) {
        const alt = await pickAvailableModel()
        if (alt && alt !== model) {
          lastModelUsed = alt
          const retry = await fetch(`${OLLAMA_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({
              model: alt,
              prompt: `${systemPreamble}\n\n${user}`,
              stream: false,
              format: 'json',
              options: { temperature: 0, num_ctx: 8192, num_predict: 1024 },
            }),
          })
          if (!retry.ok) {
            const txt = await retry.text().catch(() => '')
            throw new Error(`HTTP ${retry.status} :: ${txt}`)
          }
          const j2: any = await retry.json()
          const content2 = j2?.response?.trim()
          if (!content2) throw new Error('empty content')
          return content2
        }
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} :: ${txt}`)
      }

      const j: any = await res.json()
      const content = j?.response?.trim()
      if (!content) throw new Error('empty content')

      const obj = tryParseJSON(content)
      if (obj == null) return content
      return JSON.stringify(obj)
    } finally {
      clearTimeout(timer)
    }
  },
}
