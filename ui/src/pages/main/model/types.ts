import type { AttentionList } from '@/entities/attention'

export interface MainPageProps {
	/** «Внимание» считается в App (заголовок вкладки, всплывашки) и передаётся сюда */
	attention: AttentionList
}
