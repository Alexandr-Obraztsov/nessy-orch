import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/highlight.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initDesktop } from '@/shared/lib/desktop'
import { initTheme } from '@/shared/lib/theme'

// режим оболочки (окно со стеклом / поповер) и тема — до первого кадра, чтобы не мигало
initDesktop()
initTheme()
const root = document.getElementById('root')
if (root)
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
