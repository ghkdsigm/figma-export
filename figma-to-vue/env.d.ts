// env.d.ts
declare namespace NodeJS {
	interface ProcessEnv {
		FIGMA_TOKEN: string
		FIGMA_FILE_KEY: string
		OUT_DIR?: string
		PORT?: string
	}
}
