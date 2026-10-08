import type { StatusMeta } from '@/entities/agent'
import type { IconName } from '@/shared/ui'

/** Как показывать вкладку: заголовок, иконка или статус-точка агента. */
export interface TabMeta {
	key: string
	title: string
	icon: IconName
	/** статус агента (вместо иконки) */
	status: StatusMeta | null
	/** цвет роли (для вкладки роли) */
	roleHue: number | null
	closable: boolean
}
