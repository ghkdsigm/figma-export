<script setup lang="ts">
import { ref } from 'vue'

type GenItem = { nodeId: string; filename: string; code: string; changes?: string[] }
type GenResult = { count: number; results: GenItem[] }

const nodeId = ref('')
const useAI = ref(true)
const loading = ref(false)
const result = ref<GenResult | null>(null)
const liveComponents = ref<Array<{ key: string; comp: any }>>([])
const copiedKey = ref<string | null>(null)

function toFrontendImportPath(absOrRelFile: string) {
  const baseName = absOrRelFile.split(/[\\/]/).pop() || absOrRelFile
  return `../generated/${baseName}`
}

function findCompByNodeId(id: string) {
  return liveComponents.value.find((v) => v.key === id)?.comp
}

async function copyCode(item: GenItem) {
  try {
    await navigator.clipboard.writeText(item.code)
    copiedKey.value = item.nodeId
    setTimeout(() => (copiedKey.value = null), 1200)
  } catch {
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

function downloadVue(item: GenItem) {
  const blob = new Blob([item.code], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
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
      body: JSON.stringify({ nodeIds: [nodeId.value], useAI: useAI.value }),
    })
    const json: GenResult = await res.json()
    result.value = json

    for (const item of json.results) {
      if (!item.filename) continue
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

    <div class="flex items-center gap-2">
      <input
        v-model="nodeId"
        placeholder="nodeId (예: 1558:91759)"
        class="border px-2 py-1 rounded"
      />
      <label class="flex items-center gap-1 text-sm">
        <input type="checkbox" v-model="useAI" />
        Use AI refine
      </label>
      <button
        @click="run"
        :disabled="loading || !nodeId"
        class="px-3 py-1 rounded bg-black text-white disabled:opacity-50"
      >
        {{ loading ? 'Generating...' : 'Generate' }}
      </button>
    </div>

    <div v-if="result" class="space-y-5 py-4 max-w-[50vw] overflow-x-auto">
      <div class="text-sm text-gray-600">{{ result.count }} file(s) generated</div>

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

        <div v-if="item.changes?.length" class="text-xs bg-gray-50 border rounded p-2">
          <div class="font-semibold mb-1">AI changes</div>
          <ul class="list-disc pl-5">
            <li v-for="c in item.changes" :key="c">{{ c }}</li>
          </ul>
        </div>

        <div class="rounded border p-3 bg-white">
          <div class="text-sm font-semibold mb-2">Preview</div>
          <component :is="findCompByNodeId(item.nodeId)" />
        </div>

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
