/** Сводка по агентам задачи для сайдбара и заголовка колонки. */
export interface TaskStats {
	total: number
	working: number
	/** ждут вашего разрешения */
	waiting: number
	error: number
}
