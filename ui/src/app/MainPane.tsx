/**
 * Содержимое активной вкладки. Ключ по вкладке — у каждой своё состояние (черновики, прокрутка).
 */
import { RoleEditor } from '@/features/role-editor'
import { activeTab, useView } from '@/shared/model'
import { AgentChat } from '@/widgets/agent-chat'
import { Feed } from '@/widgets/feed'
import { GraphView } from '@/widgets/graph'
import { tabKey } from '@/widgets/tabs'
import s from './App.module.css'

export function MainPane() {
	const tab = useView(v => activeTab(v))
	let body
	switch (tab.kind) {
		case 'feed':
			body = <Feed />
			break
		case 'graph':
			body = <GraphView />
			break
		case 'agent':
			body = <AgentChat agentId={tab.id} />
			break
		case 'role':
			body = <RoleEditor id={tab.id} />
			break
	}
	return (
		<div key={tabKey(tab)} className={s.pane} role="tabpanel" aria-label={tab.kind === 'agent' ? 'Чат агента' : undefined}>
			{body}
		</div>
	)
}
