export const content = [
  './index.html',
  './src/**/*.{vue,ts,js,tsx}',
  '../figma-to-vue/generated/**/*.vue', // 생성된 컴포넌트 경로
]
export const safelist = [
  { pattern: /^(w|h|left|top|right|bottom)-\[\d+px\]$/ },
  { pattern: /^(text|leading|tracking)-\[\d+px\]$/ },
  { pattern: /^(bg|text|border)-\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\]$/ },
  { pattern: /^rounded-\[\d+px\]$/ },
  { pattern: /^rounded-(tl|tr|br|bl)-\[\d+px\]$/ },
]
