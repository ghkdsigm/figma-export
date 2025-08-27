// src/services/figma-adapter.ts
// Figma /files/:key/nodes 응답의 document 노드를 내부 공통 NodeLike로 변환

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

export type NodeLike = {
	id: string
	name: string
	type: string
	children?: NodeLike[]
	characters?: string
	style?: TextStyle

	layoutMode?: 'HORIZONTAL' | 'VERTICAL' // Auto layout이면 채워짐
	itemSpacing?: number
	paddingLeft?: number
	paddingRight?: number
	paddingTop?: number
	paddingBottom?: number
	primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
	counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' | 'SPACE_BETWEEN' | 'STRETCH'

	absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
	width?: number
	height?: number
	fills?: Paint[]
	strokes?: Paint[]
	strokeWeight?: number
	strokeAlign?: StrokeAlign
	cornerRadius?: number
	rectangleCornerRadii?: [number, number, number, number]

	clipsContent?: boolean // Frame의 Clip content
	rotation?: number // 회전값(현재는 미보정, 참고용)
}

// Figma node -> NodeLike
export function figmaToNodeLike(docNode: any): NodeLike {
	const n: NodeLike = {
		id: docNode.id,
		name: docNode.name,
		type: docNode.type,

		children: Array.isArray(docNode.children) ? docNode.children.map(figmaToNodeLike) : undefined,
		characters: docNode.characters,
		style: docNode.style,

		layoutMode: docNode.layoutMode,
		itemSpacing: docNode.itemSpacing,
		paddingLeft: docNode.paddingLeft,
		paddingRight: docNode.paddingRight,
		paddingTop: docNode.paddingTop,
		paddingBottom: docNode.paddingBottom,
		primaryAxisAlignItems: docNode.primaryAxisAlignItems,
		counterAxisAlignItems: docNode.counterAxisAlignItems,

		absoluteBoundingBox: docNode.absoluteBoundingBox,
		width: docNode.width,
		height: docNode.height,
		fills: docNode.fills,
		strokes: docNode.strokes,
		strokeWeight: docNode.strokeWeight,
		strokeAlign: docNode.strokeAlign,
		cornerRadius: docNode.cornerRadius,
		rectangleCornerRadii: docNode.rectangleCornerRadii,

		clipsContent: docNode.clipsContent === true,
		rotation: typeof docNode.rotation === 'number' ? docNode.rotation : undefined,
	}
	return n
}
