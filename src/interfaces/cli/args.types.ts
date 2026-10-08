export interface Parsed {
	positionals: string[]
	flags: Map<string, string | true>
}

export interface FlagSpec {
	/** флаги со значением */
	value?: readonly string[]
	/** булевы флаги */
	bool?: readonly string[]
	/** короткие алиасы: { w: 'wait' } */
	short?: Readonly<Record<string, string>>
}
