import s from './PathText.module.css'

export interface PathTextProps {
	path: string
	className?: string
}

/** Путь моноширинным шрифтом; не влезает — обрезается слева (важен хвост пути). */
export function PathText({ path, className }: PathTextProps) {
	// LRM по краям: в rtl-контейнере слэши остаются на своих местах
	return (
		<span className={[s.path, className].filter(Boolean).join(' ')} title={path}>
			{`‎${path}‎`}
		</span>
	)
}
