/** Нижние вкладки на узких экранах: Внимание / Поручения / Журнал. */
import { setMobileTab, useView, type MobileTab } from '@/shared/model'
import s from './MainPage.module.css'

const TABS: Array<{ id: MobileTab; label: string; path: string }> = [
	{ id: 'attention', label: 'Внимание', path: 'M10 3 18 16H2z M10 8v4 M10 14v.5' },
	{ id: 'tasks', label: 'Поручения', path: 'M4.5 3h11A1.5 1.5 0 0 1 17 4.5v2A1.5 1.5 0 0 1 15.5 8h-11A1.5 1.5 0 0 1 3 6.5v-2A1.5 1.5 0 0 1 4.5 3z M4.5 11h11a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-3A1.5 1.5 0 0 1 4.5 11z' },
	{ id: 'journal', label: 'Журнал', path: 'M4 5h12M4 10h12M4 15h8' },
]

export function MobileTabs({ attention }: { attention: number }) {
	const tab = useView(v => v.mobileTab)
	return (
		<nav className={s.tabbar} role="tablist" aria-label="Разделы">
			{TABS.map(t => (
				<button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setMobileTab(t.id)}>
					<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
						<path d={t.path} />
					</svg>
					{t.label}
					{t.id === 'attention' && attention > 0 && <span className={s.nb}>{attention}</span>}
				</button>
			))}
		</nav>
	)
}
