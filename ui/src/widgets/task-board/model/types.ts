import type { ColumnId } from '@/shared/model'

export interface TaskColumnProps {
	column: ColumnId
	/** колонок несколько — показать крестик, карточки в одну колонку */
	parallel: boolean
}
