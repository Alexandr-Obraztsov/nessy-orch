import type { ReactNode } from 'react'
import s from './Kbd.module.css'

/** Подсказка клавиши: <Kbd>N</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
	return <kbd className={s.kbd}>{children}</kbd>
}
