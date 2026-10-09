import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/highlight.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initTheme } from '@/shared/lib/theme'

initTheme()
const root = document.getElementById('root')
if (root)
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
