export interface SseFrame {
	id: string | null
	event: string
	data: string
}
