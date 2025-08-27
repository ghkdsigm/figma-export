// src/services/codegen.ts
// Figma 노드 → Vue SFC 변환기 (Tailwind 매핑 확장판)
// 핵심:
// - 오토레이아웃은 flex로, 아니면 절대배치. 단, 오토레이아웃이 아니어도 스택이면 flex로 추론.
// - 절대 컨테이너 내부: 자식 컨테이너에만 absolute(left/top, w/h), 내부는 일반 렌더러로 재귀.
// - absolute 클래스 중복 방지.
// - 텍스트는 block + whitespace-pre-wrap 기본.
// - clipsContent → overflow-hidden.
// - 임의값 px 클래스를 적극 사용(fmtPx). 음수 letter-spacing은 -tracking-[..] 형식.
// - 겹침 판정에 ε 적용.

import fs from 'fs'
import path from 'path'
import type { NodeLike } from './figma-adapter'

type RGBA = { r: number; g: number; b: number; a?: number }
type Paint = {
	type:
		| 'SOLID'
		| 'GRADIENT_LINEAR'
		| 'GRADIENT_RADIAL'
		| 'GRADIENT_ANGULAR'
		| 'GRADIENT_DIAMOND'
		| 'IMAGE'
		| 'EMOJI'
		| 'VIDEO'
	visible?: boolean
	opacity?: number
	color?: RGBA
}
type StrokeAlign = 'INSIDE' | 'OUTSIDE' | 'CENTER'
type TextStyle = {
	fontFamily?: string
	fontPostScriptName?: string
	fontWeight?: number
	fontSize?: number
	textAutoResize?: string
	textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
	textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
	lineHeightPx?: number
	letterSpacing?: number
}

// ---------- utils ----------
function sanitizeName(name: string) {
	return name.replace(/[^\w\-]/g, '').replace(/\s+/g, '')
}

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n))
}

function toHex(n: number) {
	const v = clamp(Math.round(n * 255), 0, 255)
	return v.toString(16).padStart(2, '0')
}

function rgbaToHex(rgba: RGBA, opacity?: number) {
	const a = opacity != null ? opacity : rgba.a != null ? rgba.a : 1
	const hex = `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`
	if (a >= 1) return hex
	const alpha = clamp(Math.round(a * 255), 0, 255)
		.toString(16)
		.padStart(2, '0')
	return `${hex}${alpha}`
}

function firstSolid(paints?: Paint[]) {
	if (!paints || !paints.length) return null
	const p = paints.find(x => x.visible !== false && x.type === 'SOLID' && x.color)
	return p || null
}

function fmtPx(n?: number | null) {
	if (n == null || !isFinite(n)) return null
	const s = Math.round(n * 10) / 10
	return Number.isInteger(s) ? `${s}px` : `${s}px`
}

// ---------- tailwind builders ----------
function twGap(n?: number) {
	const px = fmtPx(n)
	return px ? ` gap-[${px}]` : ''
}

function twPadding(n: NodeLike) {
	const l = fmtPx(n.paddingLeft)
	const r = fmtPx(n.paddingRight)
	const t = fmtPx(n.paddingTop)
	const b = fmtPx(n.paddingBottom)
	const parts: string[] = []
	if (l && r && l === r) parts.push(`px-[${l}]`)
	else {
		if (l) parts.push(`pl-[${l}]`)
		if (r) parts.push(`pr-[${r}]`)
	}
	if (t && b && t === b) parts.push(`py-[${t}]`)
	else {
		if (t) parts.push(`pt-[${t}]`)
		if (b) parts.push(`pb-[${b}]`)
	}
	return parts.length ? ' ' + parts.join(' ') : ''
}

function twAlign(n: NodeLike) {
	const parts: string[] = []
	switch (n.primaryAxisAlignItems) {
		case 'CENTER':
			parts.push('justify-center')
			break
		case 'MAX':
			parts.push('justify-end')
			break
		case 'SPACE_BETWEEN':
			parts.push('justify-between')
			break
		default:
			parts.push('justify-start')
	}
	switch (n.counterAxisAlignItems) {
		case 'CENTER':
			parts.push('items-center')
			break
		case 'MAX':
			parts.push('items-end')
			break
		case 'STRETCH':
			parts.push('items-stretch')
			break
		default:
			parts.push('items-start')
	}
	return parts.length ? ' ' + parts.join(' ') : ''
}

function twSize(n: NodeLike) {
	const w = fmtPx(n.width ?? n.absoluteBoundingBox?.width)
	const h = fmtPx(n.height ?? n.absoluteBoundingBox?.height)
	const parts: string[] = []
	if (w) parts.push(`w-[${w}]`)
	if (h) parts.push(`h-[${h}]`)
	return parts.length ? ' ' + parts.join(' ') : ''
}

function twBg(n: NodeLike) {
	const p = firstSolid(n.fills)
	if (!p || !p.color) return ''
	const hx = rgbaToHex(p.color, p.opacity)
	return ` bg-[${hx}]`
}

function twBorder(n: NodeLike) {
	const p = firstSolid(n.strokes)
	const w = n.strokeWeight
	if (!p || !p.color || !w || w <= 0) return ''
	const hx = rgbaToHex(p.color, p.opacity)
	return ' ' + ['border', `border-[${Math.round(w)}px]`, `border-[${hx}]`].join(' ')
}

function twRadius(n: NodeLike) {
	const r = n.cornerRadius
	const radii = n.rectangleCornerRadii
	if (typeof r === 'number' && isFinite(r)) return ` rounded-[${Math.round(r)}px]`
	if (radii && radii.length === 4) {
		const [tl, tr, br, bl] = radii.map(x => Math.round(x))
		return ` rounded-tl-[${tl}px] rounded-tr-[${tr}px] rounded-br-[${br}px] rounded-bl-[${bl}px]`
	}
	return ''
}

function twClip(n: any) {
	return n?.clipsContent ? ' overflow-hidden' : ''
}

function containerClass(n: NodeLike) {
	let cls = 'flex'
	if (n.layoutMode === 'VERTICAL') cls += ' flex-col'
	cls += twGap(n.itemSpacing)
	cls += twPadding(n)
	cls += twAlign(n)
	cls += twSize(n)
	cls += twBg(n)
	cls += twBorder(n)
	cls += twRadius(n)
	cls += twClip(n)
	return cls
}

// ---------- text ----------
function textAlignClass(style?: TextStyle) {
	if (!style) return ''
	const parts: string[] = []
	switch (style.textAlignHorizontal) {
		case 'CENTER':
			parts.push('text-center')
			break
		case 'RIGHT':
			parts.push('text-right')
			break
		case 'JUSTIFIED':
			parts.push('text-justify')
			break
		default:
			parts.push('text-left')
	}
	switch (style.textAlignVertical) {
		case 'CENTER':
			parts.push('align-middle')
			break
		case 'BOTTOM':
			parts.push('align-bottom')
			break
		default:
			parts.push('align-top')
	}
	return parts.length ? ' ' + parts.join(' ') : ''
}

function fontWeightClass(w?: number) {
	if (w == null) return ''
	if (w >= 900) return ' font-black'
	if (w >= 800) return ' font-extrabold'
	if (w >= 700) return ' font-bold'
	if (w >= 600) return ' font-semibold'
	if (w >= 500) return ' font-medium'
	if (w >= 400) return ' font-normal'
	if (w >= 300) return ' font-light'
	if (w >= 200) return ' font-extralight'
	return ' font-thin'
}

function lineHeightClass(px?: number) {
	if (px == null) return ''
	const v = fmtPx(px)
	return v ? ` leading-[${v}]` : ''
}

function letterSpacingClass(px?: number) {
	if (px == null) return ''
	const v = Math.round(Math.abs(px))
	return px < 0 ? ` -tracking-[${v}px]` : ` tracking-[${v}px]`
}

function fontSizeClass(px?: number) {
	if (px == null) return ''
	const v = fmtPx(px)
	return v ? ` text-[${v}]` : ''
}

function textColorClass(fills?: Paint[]) {
	const p = firstSolid(fills)
	if (!p || !p.color) return ''
	const hx = rgbaToHex(p.color, p.opacity)
	return ` text-[${hx}]`
}

function buildTextClass(style?: TextStyle, fills?: Paint[]) {
	let cls = ''
	if (style) {
		cls += fontSizeClass(style.fontSize)
		cls += fontWeightClass(style.fontWeight)
		cls += lineHeightClass(style.lineHeightPx)
		cls += letterSpacingClass(style.letterSpacing)
		cls += textAlignClass(style)
	}
	cls += textColorClass(fills)
	return cls.trim()
}

function escapeHtml(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- geometry & inference ----------
type BBox = { x: number; y: number; width: number; height: number }

function bbox(n: NodeLike): BBox | null {
	const b = n.absoluteBoundingBox
	if (!b) return null
	return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function isOverlapping(a: BBox, b: BBox, eps = 0.75) {
	return !(
		a.x + a.width <= b.x - eps ||
		b.x + b.width <= a.x - eps ||
		a.y + a.height <= b.y - eps ||
		b.y + b.height <= a.y - eps
	)
}

function childrenOverlap(children: NodeLike[] | undefined): boolean {
	if (!children || children.length < 2) return false
	const boxes = children.map(bbox).filter(Boolean) as BBox[]
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			if (isOverlapping(boxes[i], boxes[j], 0.75)) return true
		}
	}
	return false
}

function vGap(a: BBox, b: BBox) {
	return b.y - (a.y + a.height)
}

function hGap(a: BBox, b: BBox) {
	return b.x - (a.x + a.width)
}

function inferVerticalStack(children: NodeLike[]): { gap?: number } | null {
	const boxes = children.map(bbox).filter(Boolean) as BBox[]
	if (boxes.length < 2) return null
	const xs = boxes.map(b => b.x)
	const sameX = Math.max(...xs) - Math.min(...xs) <= 1.0
	const ordered = boxes.slice().sort((a, b) => a.y - b.y)
	for (let i = 0; i < ordered.length - 1; i++) {
		if (ordered[i].y > ordered[i + 1].y) return null
		if (isOverlapping(ordered[i], ordered[i + 1], 0.75)) return null
	}
	if (!sameX) return null
	const gaps: number[] = []
	for (let i = 0; i < ordered.length - 1; i++) {
		const g = vGap(ordered[i], ordered[i + 1])
		if (g < -0.75) return null
		gaps.push(Math.max(0, Math.round(g * 10) / 10))
	}
	const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
	return { gap: Math.max(0, Math.round(avgGap * 10) / 10) }
}

function inferHorizontalStack(children: NodeLike[]): { gap?: number } | null {
	const boxes = children.map(bbox).filter(Boolean) as BBox[]
	if (boxes.length < 2) return null
	const ys = boxes.map(b => b.y)
	const sameY = Math.max(...ys) - Math.min(...ys) <= 1.0
	const ordered = boxes.slice().sort((a, b) => a.x - b.x)
	for (let i = 0; i < ordered.length - 1; i++) {
		if (ordered[i].x > ordered[i + 1].x) return null
		if (isOverlapping(ordered[i], ordered[i + 1], 0.75)) return null
	}
	if (!sameY) return null
	const gaps: number[] = []
	for (let i = 0; i < ordered.length - 1; i++) {
		const g = hGap(ordered[i], ordered[i + 1])
		if (g < -0.75) return null
		gaps.push(Math.max(0, Math.round(g * 10) / 10))
	}
	const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
	return { gap: Math.max(0, Math.round(avgGap * 10) / 10) }
}

function absoluteChildStyle(parent: NodeLike, child: NodeLike) {
	const pb = bbox(parent),
		cb = bbox(child)
	if (!pb || !cb) return ''
	const left = fmtPx(cb.x - pb.x)
	const top = fmtPx(cb.y - pb.y)
	return left && top ? ` left-[${left}] top-[${top}]` : ''
}

// ---------- template generation ----------
function nodeToVueTemplate(node: NodeLike, depth = 0): string {
	const pad = '  '.repeat(depth)

	// 텍스트
	if (node.type === 'TEXT' && node.characters != null) {
		const cls = buildTextClass(node.style, node.fills)
		const safe = escapeHtml(node.characters)
		const base = 'block whitespace-pre-wrap'
		if (cls) return `${pad}<span class="${base} ${cls}">${safe}</span>\n`
		return `${pad}<span class="${base}">${safe}</span>\n`
	}

	const hasAutoLayout = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'
	const overlap = hasAutoLayout ? false : childrenOverlap(node.children)

	// 오토레이아웃 아님 + 겹침 없음 → 스택 추론해서 flex로 렌더
	if (!hasAutoLayout && !overlap && node.children && node.children.length > 1) {
		const v = inferVerticalStack(node.children)
		const h = v ? null : inferHorizontalStack(node.children)
		if (v || h) {
			let cls = 'flex' + (v ? ' flex-col' : '')
			if (v?.gap != null) cls += ` gap-[${fmtPx(v.gap)?.replace('px', '')}px]`
			if (h?.gap != null) cls += ` gap-[${fmtPx(h.gap)?.replace('px', '')}px]`
			cls +=
				twPadding(node) +
				twAlign(node) +
				twSize(node) +
				twBg(node) +
				twBorder(node) +
				twRadius(node) +
				twClip(node)
			let out = `${pad}<div class="${cls.trim()}">\n`
			for (const c of node.children) out += nodeToVueTemplate(c, depth + 1)
			out += `${pad}</div>\n`
			return out
		}
	}

	// 절대 배치 컨테이너: 자식 컨테이너에만 absolute 적용
	if (!hasAutoLayout || overlap) {
		const wrapperClass = (
			'relative' +
			twSize(node) +
			twBg(node) +
			twBorder(node) +
			twRadius(node) +
			twClip(node)
		).trim()
		let out = `${pad}<div class="${wrapperClass}">\n`
		if (node.children) {
			for (const c of node.children) {
				const absPos = absoluteChildStyle(node, c)
				out += nodeToVueTemplateAbsoluteChild(c, depth + 1, absPos)
			}
		}
		out += `${pad}</div>\n`
		return out
	}

	// 오토레이아웃 컨테이너
	const cls = containerClass(node)
	let out = `${pad}<div class="${cls}">\n`
	if (node.children && node.children.length) {
		for (const c of node.children) out += nodeToVueTemplate(c, depth + 1)
	}
	out += `${pad}</div>\n`
	return out
}

// 절대 배치 자식 컨테이너: 이 레벨에만 absolute, 내부는 일반 렌더러로 처리
function nodeToVueTemplateAbsoluteChild(node: NodeLike, depth = 0, absClass = ''): string {
	const pad = '  '.repeat(depth)

	// 텍스트는 absolute + 좌표로 바로 출력
	if (node.type === 'TEXT' && node.characters != null) {
		const textCls = buildTextClass(node.style, node.fills)
		const safe = escapeHtml(node.characters)
		const cls = ('absolute' + absClass + (textCls ? ' ' + textCls : '')).replace(/\s+/g, ' ').trim()
		return `${pad}<span class="${cls}">${safe}</span>\n`
	}

	const box = (twSize(node) + twBg(node) + twBorder(node) + twRadius(node)).trim()
	const cls = ('absolute' + absClass + (box ? ' ' + box : '')).replace(/\s+/g, ' ').trim()

	let out = `${pad}<div class="${cls}">\n`
	if (node.children && node.children.length) {
		for (const c of node.children) {
			out += nodeToVueTemplate(c, depth + 1)
		}
	}
	out += `${pad}</div>\n`
	return out
}

// ---------- public APIs ----------
export function generateVueSFC(componentName: string, rootNode: NodeLike) {
	const template = nodeToVueTemplate(rootNode)
	const script = `\n<script setup>\n</script>\n`
	const style = `\n<style scoped>\n</style>\n`
	return `<template>\n${template}</template>${script}${style}\n`
}

export function writeComponent(outDir: string, name: string, content: string) {
	const file = path.join(outDir, `${sanitizeName(name)}.vue`)
	fs.mkdirSync(outDir, { recursive: true })
	fs.writeFileSync(file, content, 'utf8')
	return file
}
