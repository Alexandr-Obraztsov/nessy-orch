import { useState } from 'react'
import { IconButton, Popover, Switch } from '@/shared/ui'
import { setGraphSettings, useGraphSettings } from '../model/settings'
import s from './GraphView.module.css'

export interface GraphControlsProps {
	archived: number
	onFit: () => void
	onZoom: (f: number) => void
}

/** Маленькая панель в углу: вписать, масштаб, настройки (архив, подписи). */
export function GraphControls({ archived, onFit, onZoom }: GraphControlsProps) {
	const settings = useGraphSettings()
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
	const [open, setOpen] = useState(false)
	return (
		<div className={s.controls}>
			<IconButton icon="zoomIn" label="Приблизить" size="sm" onClick={() => onZoom(1.3)} />
			<IconButton icon="zoomOut" label="Отдалить" size="sm" onClick={() => onZoom(1 / 1.3)} />
			<IconButton icon="maximize" label="Вписать граф" size="sm" onClick={onFit} />
			<IconButton ref={setAnchor} icon="settings" label="Настройки графа" size="sm" aria-expanded={open} onClick={() => setOpen(v => !v)} />
			<Popover open={open} anchor={anchor} onClose={() => setOpen(false)} align="end" label="Настройки графа" className={s.pop}>
				<Switch
					checked={settings.showArchived}
					onChange={v => setGraphSettings({ showArchived: v })}
					label="Показать архив"
					hint={archived ? `в архиве: ${archived}` : 'архив пуст'}
				/>
				<Switch checked={settings.labels} onChange={v => setGraphSettings({ labels: v })} label="Подписи всегда" />
			</Popover>
		</div>
	)
}
