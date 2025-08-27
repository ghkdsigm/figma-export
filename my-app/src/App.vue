<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Generator from './views/Generator.vue'

// generated 폴더 내 모든 SFC를 동적 로드 (앱 시작 시 자동 미리보기용)
const generatedModules = import.meta.glob('./generated/**/*.vue') // App.vue 기준 상대경로
const allGenerated = ref<Array<{ name: string; comp: any }>>([])

onMounted(async () => {
  const entries = Object.entries(generatedModules)
  const loaded: Array<{ name: string; comp: any }> = []
  for (const [path, loader] of entries) {
    try {
      const mod = await import(/* @vite-ignore */ `${path}?v=${Date.now()}`)
      const name = path.split('/').pop()?.replace('.vue', '') || path
      loaded.push({ name, comp: mod.default })
    } catch (e) {
      console.warn('auto-load generated component failed:', path, e)
    }
  }
  allGenerated.value = loaded
})
</script>

<template>
  <div class="space-y-10 p-6">
    <!-- 자동 렌더링된 모든 생성 컴포넌트 (앱 로드시 src/generated에 이미 존재하는 파일들) -->
    <section v-if="allGenerated.length" class="space-y-4">
      <h2 class="text-lg font-semibold">자동 컴포넌트 생성 (기존 파일)</h2>
      <div class="grid gap-6">
        <component v-for="g in allGenerated" :key="g.name" :is="g.comp" />
      </div>
    </section>

    <!-- 생성 트리거/프리뷰 -->
    <section>
      <Generator />
    </section>
  </div>
</template>

<style>
/* 전역 스타일 필요시 */
</style>
