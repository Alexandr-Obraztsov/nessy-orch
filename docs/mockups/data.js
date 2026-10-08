// Демо-данные для макетов UI v3 (одинаковые для всех вариантов).
// now — «текущее время» макета; время в секундах относительно now.
window.MOCK = {
	autoApprove: false,
	roles: {
		executor: { name: 'Исполнитель', hue: 120 },
		'code-explorer': { name: 'Исследователь кода', hue: 200 },
		'code-reviewer': { name: 'Ревьюер кода', hue: 30 },
		verifier: { name: 'Верификатор', hue: 180 },
		'jira-analyst': { name: 'Аналитик Jira', hue: 225 },
		'wiki-researcher': { name: 'Исследователь Wiki', hue: 150 },
		writer: { name: 'Технический писатель', hue: 45 },
		debugger: { name: 'Отладчик', hue: 0 },
	},
	// поручения = корневой агент + потомки
	tasks: [
		{
			id: 't1', title: 'Починить падающий CI в api-gateway', space: 'api-gateway', startedAgo: 400, status: 'attention',
			agents: [
				{ id: 'a-fx01', name: 'fix-ci', role: 'executor', status: 'working', attention: 'permission', permission: 'git push origin fix/ci-timeout',
					tool: 'Bash: npm test -- --grep gateway', toolAgo: 14, steps: 14, turnAgo: 252, queued: 0, lastEventAgo: 3,
					plan: [['найти падающий шаг', 'done'], ['воспроизвести локально', 'done'], ['поправить таймаут в jest.config', 'done'], ['прогнать тесты', 'active'], ['открыть MR', 'todo']] },
				{ id: 'a-ex02', name: 'explore-ci', role: 'code-explorer', status: 'done', parent: 'a-fx01', steps: 9, turnAgo: 0, duration: 48,
					result: 'Падает `gateway.e2e.ts:118` — таймаут 5 с при холодном старте Redis. Конфиг: `jest.config.ts:12`.' },
				{ id: 'a-rv03', name: 'review-ci', role: 'code-reviewer', status: 'idle', parent: 'a-fx01', queued: 2, steps: 0 },
			],
		},
		{
			id: 't2', title: 'Отчёт по открытым багам payments за сентябрь', space: 'reports', startedAgo: 1500, status: 'done',
			agents: [
				{ id: 'a-jr04', name: 'jira-report', role: 'jira-analyst', status: 'done', steps: 22, duration: 380, unread: true,
					result: '**12 открытых багов**, из них 3 критичных: PAY-812 (двойное списание), PAY-799, PAY-777. Самый старый — 41 день.\n\n| Ключ | Приоритет | Исполнитель |\n|---|---|---|\n| PAY-812 | Critical | ivanov |\n| PAY-799 | Critical | — |\n| PAY-777 | Critical | petrova |' },
			],
		},
		{
			id: 't3', title: 'Обновить раздел Wiki про деплой shippy', space: 'docs-site', startedAgo: 125, status: 'working',
			agents: [
				{ id: 'a-wk05', name: 'wiki-deploy', role: 'wiki-researcher', status: 'working', tool: 'Wiki: поиск «shippy deploy»', toolAgo: 6, steps: 5, turnAgo: 125, lastEventAgo: 6,
					plan: [['найти текущие страницы', 'done'], ['сверить с README репозитория', 'active'], ['подготовить правки', 'todo'], ['показать дифф', 'todo']] },
				{ id: 'a-wr06', name: 'writer-deploy', role: 'writer', status: 'starting', parent: 'a-wk05', steps: 0 },
			],
		},
		{
			id: 't4', title: 'Найти причину роста 504 у shippy после 14:00', space: 'shippy', startedAgo: 900, status: 'error',
			agents: [
				{ id: 'a-db07', name: 'inc-504', role: 'debugger', status: 'error', error: 'Sage: 429 Too Many Requests', steps: 31, turnAgo: 0, duration: 610 },
			],
		},
		{
			id: 't5', title: 'Ревью MR !1234 «retry в платёжном клиенте»', space: 'shippy', startedAgo: 3600, status: 'done',
			agents: [
				{ id: 'a-mr08', name: 'mr-1234', role: 'code-reviewer', status: 'done', steps: 17, duration: 290,
					result: 'Вердикт: **нужны правки**. Блокер: ретрай не идемпотентен для POST /refund (`client.ts:88`). 2 мелочи по логам.' },
				{ id: 'a-vf09', name: 'mr-1234-verify', role: 'verifier', status: 'done', parent: 'a-mr08', steps: 8, duration: 95,
					result: 'Подтверждаю блокер: воспроизведено тестом, двойной вызов возврата.' },
			],
		},
	],
	// журнал (бывшая лента)
	log: [
		[3, 'fix-ci', 'просит разрешение: git push origin fix/ci-timeout'],
		[6, 'wiki-deploy', 'Wiki: поиск «shippy deploy»'],
		[40, 'fix-ci → review-ci', '«проверь дифф в jest.config.ts»'],
		[61, 'explore-ci → fix-ci', 'ответ: падает gateway.e2e.ts:118 …'],
		[290, 'inc-504', 'ошибка: Sage 429 Too Many Requests'],
		[1120, 'jira-report → Вы', 'ответ: 12 открытых багов …'],
	],
}
