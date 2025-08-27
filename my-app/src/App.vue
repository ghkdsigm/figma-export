<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Generator from './views/Generator.vue'

// generated 폴더 내 모든 SFC를 동적 로드
const generatedModules = import.meta.glob('../generated/**/*.vue') // 상대경로는 App.vue 위치 기준
const allGenerated = ref<Array<{ name: string; comp: any }>>([])

onMounted(async () => {
  const entries = Object.entries(generatedModules)
  const loaded: Array<{ name: string; comp: any }> = []
  for (const [path, loader] of entries) {
    const mod: any = await (loader as any)()
    const name = path.split('/').pop()?.replace('.vue', '') || path
    loaded.push({ name, comp: mod.default })
  }
  allGenerated.value = loaded
})
</script>

<template>
  <div class="space-y-6 p-6">
    <!-- 자동 렌더링된 모든 생성 컴포넌트 -->
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">자동 컴포넌트 생성</h2>
      <component v-for="g in allGenerated" :key="g.name" :is="g.comp" />
    </div>

    <!-- 생성 트리거 -->
    <Generator />
  </div>
</template>
