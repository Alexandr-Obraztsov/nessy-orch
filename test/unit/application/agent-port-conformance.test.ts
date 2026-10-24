import { FakeAgentPort } from '../../support/fake-agent-port'
import { runAgentPortConformance } from '../../support/agent-port-conformance'

/**
 * Conformance-сьют AgentPort против fake-адаптера (развитие fake-nessy): доказывает, что контракт §3 выполним
 * адаптером, синтезирующим обязательные core-события из собственных действий (без живого рантайма).
 */
runAgentPortConformance({
	label: 'fake-agent-port',
	cwd: '/tmp/fake-cwd',
	slowPrompt: '#hang',
	permissionPrompt: '#perm',
	errorPrompt: '#fail',
	toolsPrompt: '#tools',
	makePort: () => Promise.resolve(new FakeAgentPort()),
})
