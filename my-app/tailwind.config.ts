export default {
  content: [
    './index.html',
    './src/**/*.{vue,ts,js,tsx}',
    './src/generated/**/*.vue',
  ],
  safelist: [
    // w/h/left/top/right/bottom: 정수/소수 px 허용
    { pattern: /^(w|h|left|top|right|bottom)-\[-?\d+(?:\.\d+)?px\]$/ },

    // 여백/간격/보더폭 계열
    { pattern: /^(m|mx|my|mt|mr|mb|ml|p|px|py|pt|pr|pb|pl|gap|space-[xy])-\[-?\d+(?:\.\d+)?px\]$/ },

    // line-height/letter-spacing/text-size(임의 px)
    { pattern: /^(text|leading|tracking)-\[-?\d+(?:\.\d+)?px\]$/ },

    // 보더 폭도 임의값으로 씀: border-[1px]
    { pattern: /^border-\[\d+(?:\.\d+)?px\]$/ },

    // 색상: #RRGGBB 또는 #RRGGBBAA
    { pattern: /^(bg|text|border)-\[#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\]$/ },

    // 반지름
    { pattern: /^rounded-\[\d+(?:\.\d+)?px\]$/ },
    { pattern: /^rounded-(tl|tr|br|bl)-\[\d+(?:\.\d+)?px\]$/ },
  ],

}
