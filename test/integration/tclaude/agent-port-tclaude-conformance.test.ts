/**
 * Conformance-сьют AgentPort против TclaudeAgentPort (integration, живой tclaude).
 * Запускается ТОЛЬКО при ORCH_E2E_TCLAUDE=1; по умолчанию тесты не регистрируются (skip).
 * Живой tclaude тратит бюджет (стоимость хода) и требует доступа к llm-прокси — поэтому этап P2.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TclaudeAgentPort } from '../../../src/infrastructure/tclaude/agent-port-tclaude'
import { runAgentPortConformance } from '../../support/agent-port-conformance'

const E2E = process.env.ORCH_E2E_TCLAUDE === '1'

if (E2E) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tclaude-conformance-'))
	runAgentPortConformance({
		label: 'tclaude-adapter',
		cwd,
		slowPrompt: 'Посчитай медленно от 1 до 30, по одному числу на строку.',
		makePort: () => Promise.resolve(new TclaudeAgentPort({})),
	})
}
