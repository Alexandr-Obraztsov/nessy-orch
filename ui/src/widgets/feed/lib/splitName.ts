/** Разбивает текст события по первому вхождению имени агента (чтобы сделать имя ссылкой). */
export function splitName(text: string, name: string | undefined): [string, string, string] | null {
	if (!name) return null
	const i = text.indexOf(name)
	if (i === -1) return null
	return [text.slice(0, i), name, text.slice(i + name.length)]
}
