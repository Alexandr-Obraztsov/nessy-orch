/**
 * Подсветка синтаксиса: highlight.js (core + нужные языки, без автоопределения по всем 190 языкам).
 * Возвращает HTML с классами hljs-*; цвета — в app/styles/highlight.css.
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGS = { bash, css, diff, go, java, javascript, json, kotlin, markdown, python, shell, sql, typescript, xml, yaml }
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerAliases(['ts', 'tsx', 'mts', 'cts'], { languageName: 'typescript' })
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['kt', 'kts'], { languageName: 'kotlin' })
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerAliases(['patch'], { languageName: 'diff' })

/** Предел: длиннее — без подсветки (не тормозим на огромных выводах). */
const MAX_LEN = 60_000
const AUTO = ['typescript', 'javascript', 'json', 'bash', 'python', 'go', 'java', 'yaml', 'sql', 'diff', 'xml', 'css']

export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function knownLang(lang: string | null | undefined): string | null {
	if (!lang) return null
	const l = lang.toLowerCase().trim()
	return hljs.getLanguage(l) ? l : null
}

/** Язык по пути файла: «src/app.ts» → typescript. */
export function langFromPath(path: string): string | null {
	const base = path.split(/[\\/]/).pop() ?? ''
	if (/^dockerfile$/i.test(base) || /^makefile$/i.test(base)) return 'bash'
	const ext = /\.([a-z0-9]+)$/i.exec(base)?.[1]
	return knownLang(ext)
}

/**
 * HTML подсветки. lang — явный язык (из ```lang или по пути); 'auto' — угадать по небольшому набору;
 * null — без подсветки, только экранирование.
 */
export function highlight(code: string, lang: string | null): string {
	if (!lang || code.length > MAX_LEN) return escapeHtml(code)
	try {
		if (lang === 'auto') return hljs.highlightAuto(code, AUTO).value
		const l = knownLang(lang)
		return l ? hljs.highlight(code, { language: l, ignoreIllegals: true }).value : escapeHtml(code)
	} catch {
		return escapeHtml(code)
	}
}

/** Подпись языка в шапке блока кода. */
export function langLabel(lang: string): string {
	const l = hljs.getLanguage(lang.toLowerCase())
	return l?.name ?? lang
}
