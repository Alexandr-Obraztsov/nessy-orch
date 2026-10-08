// ВРЕМЕННЫЙ стенд для проверки ленты и чата (удаляется до сдачи)
import '@fontsource/onest/400.css'
import '@fontsource/onest/500.css'
import '@fontsource/onest/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '../src/app/styles/tokens.css'
import '../src/app/styles/base.css'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from '@/shared/lib/theme'
import { activeTab, connect, openAgent, openFeed, useStore, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { AgentChat } from '@/widgets/agent-chat'
import { Feed } from '@/widgets/feed'

function H() {
	useEffect(connect, [])
	const tab = useView(v => activeTab(v))
	const agents = useStore(s => s.agents)
	const narrow = window.innerWidth < 900
	return (
		<div style={{ display: 'flex', height: '100%' }}>
			{!narrow && (
				<div style={{ width: 308, flex: 'none', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)', padding: 8, fontSize: 13 }}>
					<div style={{ cursor: 'pointer', padding: 4 }} onClick={openFeed}>Лента</div>
					{agents.map(a => <div key={a.id} style={{ cursor: 'pointer', padding: 4, color: a.archived ? 'var(--text-faint)' : undefined }} onClick={() => openAgent(a.id)}>{a.name}</div>)}
				</div>
			)}
			<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
				<div style={{ height: narrow ? 48 : 38, flex: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg-alt)' }} />
				{tab.kind === 'agent' ? <AgentChat agentId={tab.id} /> : <Feed />}
			</div>
			<Toaster />
		</div>
	)
}
initTheme()
const el = document.getElementById('root')
if (el) createRoot(el).render(<H />)
