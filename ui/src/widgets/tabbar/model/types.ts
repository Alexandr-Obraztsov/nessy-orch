import type { MobileTab } from '@/shared/model'
import type { IconName } from '@/shared/ui'

export interface TabDef {
	id: MobileTab
	label: string
	icon: IconName
}
