import type { SpaceView } from '@contract'
import { SPACE_STATUS } from '@/entities/agent'
import { Icon } from '@/shared/ui'
import { OTHER_PATH } from '../lib/validate'
import { cssVars } from '@/shared/lib/style'
import s from './SpawnAgentDialog.module.css'

export interface SpacePickerProps {
	value: string
	options: { value: string; space: SpaceView }[]
	onChange: (v: string) => void
}

/** Выбор пространства «чипами» (видно цвет и статус) + «Другой путь…». */
export function SpacePicker({ value, options, onChange }: SpacePickerProps) {
	return (
		<div className={s.chips} role="radiogroup" aria-label="Пространство">
			{options.map(({ value: v, space }) => {
				const st = SPACE_STATUS[space.status]
				return (
					<label key={v} className={s.chip} style={cssVars({ '--hue': space.color })} title={space.path}>
						<input type="radio" name="spawn-space" value={v} checked={value === v} onChange={() => onChange(v)} />
						<span className={s.hue} />
						<span className={s.chipName}>{space.name}</span>
						{space.status !== 'ready' && (
							<span className={s.chipStatus} style={{ color: st.color }}>
								{st.label}
							</span>
						)}
					</label>
				)
			})}
			<label className={`${s.chip} ${s.other}`}>
				<input type="radio" name="spawn-space" value={OTHER_PATH} checked={value === OTHER_PATH} onChange={() => onChange(OTHER_PATH)} />
				<Icon name="folder" size={15} />
				<span className={s.chipName}>Другой путь…</span>
			</label>
		</div>
	)
}
