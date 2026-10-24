import type { OrchSettings } from '../../application/settings.types'

/** Полная конфигурация процесса оркестратора (из переменных окружения). */
export interface Config extends OrchSettings {
	/** токен оператора (приложение и терминал главного агента); нет — проверка выключена (тесты) */
	authToken?: string
	/** корень проекта (где package.json) */
	root: string
	host: string
	port: number
	/** рантайм агентов (serve-путь удалён; зарезервировано для будущих рантаймов). */
	runtime: 'nessy-sdk'
	/** ожидаемая модель для верификации nessy-sdk (ORCH_SDK_MODEL); не задана — не проверяется */
	sdkModel?: string
	/** права nessy-sdk (ORCH_SDK_PERMISSION_MODE); по умолчанию 'default' */
	sdkPermissionMode?: 'default' | 'plan' | 'auto-edit' | 'auto'
	/** путь к бинарю tclaude (TCLAUDE_PATH); по умолчанию 'tclaude' */
	tclaudeBin?: string
	/** модель tclaude по умолчанию (ORCH_TCLAUDE_MODEL); не задана — дефолт рантайма */
	tclaudeModel?: string
	/** права tclaude (ORCH_TCLAUDE_PERMISSION_MODE); безопасный дефолт 'default' */
	tclaudePermissionMode?: 'default' | 'plan' | 'auto-edit' | 'auto'
	/** заливать пресеты ролей при первом запуске (ORCH_SEED_ROLES) */
	seedRoles: boolean
	/** каталог готовых ролей (по умолчанию <root>/roles) */
	rolesDir: string
}
