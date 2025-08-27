<script setup lang="ts">
import { ref } from 'vue'

type GenItem = { nodeId: string; filename: string; code: string }
type GenResult = { count: number; results: GenItem[] }

const nodeId = ref('')
const loading = ref(false)
const result = ref<GenResult | null>(null)

// 동적으로 불러온 컴포넌트들(미리보기)
const liveComponents = ref<Array<{ key: string; comp: any }>>([])

// 복사 상태 표시용
const copiedKey = ref<string | null>(null)

// 백엔드 OUT_DIR이 ../my-app/src/generated 라는 가정
function toFrontendImportPath(absOrRelFile: string) {
  const baseName = absOrRelFile.split(/[\\/]/).pop() || absOrRelFile
  return `../generated/${baseName}`
}

// nodeId → 동적 컴포넌트 찾기
function findCompByNodeId(id: string) {
  return liveComponents.value.find((v) => v.key === id)?.comp
}

// 코드 복사
async function copyCode(item: GenItem) {
  try {
    await navigator.clipboard.writeText(item.code)
    copiedKey.value = item.nodeId
    setTimeout(() => (copiedKey.value = null), 1200)
  } catch {
    // clipboard 권한 실패 시 fallback
    const ta = document.createElement('textarea')
    ta.value = item.code
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copiedKey.value = item.nodeId
    setTimeout(() => (copiedKey.value = null), 1200)
  }
}

// 파일 다운로드 (.vue)
function downloadVue(item: GenItem) {
  const blob = new Blob([item.code], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url

  // 파일명은 서버가 알려준 filename의 마지막 조각을 최대한 재사용
  const niceName =
    item.filename?.split(/[\\/]/).pop() || `Figma_${item.nodeId.replace(/[:]/g, '-')}.vue`
  a.download = niceName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function run() {
  loading.value = true
  result.value = null
  liveComponents.value = []
  try {
    const res = await fetch('http://localhost:8787/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [nodeId.value] }),
    })
    const json: GenResult = await res.json()
    result.value = json

    // 방금 생성된 파일들 동적 import → 미리보기 등록
    for (const item of json.results) {
      const path = toFrontendImportPath(item.filename)
      const mod = await import(/* @vite-ignore */ path)
      liveComponents.value.push({ key: item.nodeId, comp: mod.default })
    }
  } catch (e: any) {
    alert(e?.message || 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-6">
    <h1 class="text-xl font-bold">Figma → Vue Generator</h1>

    <div class="flex gap-2">
      <input
        v-model="nodeId"
        placeholder="nodeId (예: 1558:91759)"
        class="border px-2 py-1 rounded"
      />
      <button
        @click="run"
        :disabled="loading || !nodeId"
        class="px-3 py-1 rounded bg-black text-white disabled:opacity-50"
      >
        {{ loading ? 'Generating...' : 'Generate' }}
      </button>
    </div>

    <div v-if="result" class="space-y-5 py-4 max-w-[50vw] overflow-x-auto">
      <!-- 요약 -->
      <div class="text-sm text-gray-600">{{ result.count }} file(s) generated</div>

      <!-- 결과별 프리뷰 + 코드 복사/다운로드 -->
      <div
        v-for="item in result.results"
        :key="item.nodeId"
        class="border rounded-lg p-4 space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-medium">
            nodeId: <span class="text-gray-700">{{ item.nodeId }}</span>
          </div>
          <div class="text-sm text-gray-600 truncate">
            {{ item.filename }}
          </div>
        </div>

        <!-- Preview -->
        <div class="rounded border p-3 bg-white">
          <div class="text-sm font-semibold mb-2">Preview</div>
          <component :is="findCompByNodeId(item.nodeId)" />
        </div>

        <!-- Code + Actions -->
        <div class="space-y-2">
          <div class="flex gap-2 py-4">
            <button @click="copyCode(item)" class="px-3 py-1 rounded border hover:bg-gray-50">
              {{ copiedKey === item.nodeId ? 'Copied!' : 'Copy .vue' }}
            </button>
            <button @click="downloadVue(item)" class="px-3 py-1 rounded border hover:bg-gray-50">
              Download .vue
            </button>
          </div>
          <pre class="border rounded p-2 text-xs overflow-auto max-h-96">{{ item.code }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
