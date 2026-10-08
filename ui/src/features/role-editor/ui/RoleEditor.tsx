/**
 * Редактор роли во вкладке — как заметка в Obsidian: крупный заголовок (имя), строка описания,
 * свойства (цвет, агенты с ролью), инструкции в markdown с предпросмотром.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AgentAvatar, agentStatusMeta } from '@/entities/agent'
import { ROLE_HUES, roleColor } from '@/entities/role'
import { renderMarkdown } from '@/shared/lib/markdown'
import { cssVars } from '@/shared/lib/style'
import { closeTabsWhere, openAgent, openDialog } from '@/shared/model'
import { Button, Dialog, Icon, Kbd } from '@/shared/ui'
import type { RoleEditorProps } from '../model/types'
import { useRoleEditor } from '../model/useRoleEditor'
import s from './RoleEditor.module.css'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** Высота textarea по содержимому. */
function useAutoGrow(value: string) {
	const ref = useRef<HTMLTextAreaElement>(null)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${el.scrollHeight}px`
	}, [value])
	return ref
}

export function RoleEditor({ id }: RoleEditorProps) {
	const r = useRoleEditor(id)
	const [preview, setPreview] = useState(false)
	const area = useAutoGrow(preview ? '' : r.draft.instructions)
	const titleRef = useRef<HTMLInputElement>(null)

	// Ctrl/Cmd+S — сохранить (вкладка активна, пока смонтирована)
	const saveRef = useRef(r.save)
	saveRef.current = r.save
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'ы' || e.code === 'KeyS')) {
				e.preventDefault()
				void saveRef.current()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// новая роль — сразу в заголовок
	useEffect(() => {
		if (!id) titleRef.current?.focus()
	}, [id])

	if (r.missing)
		return (
			<div className={s.missing}>
				<Icon name="tag" size={28} />
				<p>Роль удалена</p>
				<Button size="sm" onClick={() => closeTabsWhere(t => t.kind === 'role' && t.id === id)}>
					Закрыть вкладку
				</Button>
			</div>
		)

	const status = r.busy ? 'Сохранение…' : !id ? 'Новая роль' : r.dirty ? 'Не сохранено' : 'Сохранено'

	return (
		<div className={s.root} style={cssVars({ '--role-c': roleColor(r.color) })}>
			<div className={s.toolbar}>
				<span className={s.crumbs}>
					<Icon name="tag" size={13} />
					Роли
					<Icon name="chevronRight" size={12} />
					<span className={s.crumbName}>{r.draft.name.trim() || 'Новая роль'}</span>
				</span>
				<span className={`${s.state} ${r.dirty && id ? s.stateDirty : ''}`} aria-live="polite">
					{status}
				</span>
				<div className={s.tools}>
					<Button
						size="sm"
						variant="ghost"
						icon={preview ? 'edit' : 'eye'}
						aria-pressed={preview}
						onClick={() => setPreview(v => !v)}
						title="Предпросмотр инструкций"
					>
						<span className={s.hideNarrow}>{preview ? 'Редактировать' : 'Предпросмотр'}</span>
					</Button>
					{id && (
						<Button size="sm" variant="ghost" icon="play" onClick={() => openDialog('spawn', { role: id })}>
							<span className={s.wide}>Запустить агента с этой ролью</span>
							<span className={s.narrow}>Запустить</span>
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						icon="trash"
						aria-label={id ? 'Удалить роль' : 'Отменить'}
						title={id ? 'Удалить роль' : 'Отменить'}
						className={s.del}
						onClick={() => (id ? r.setConfirmDelete(true) : void r.remove())}
					/>
					<Button
						size="sm"
						variant="primary"
						icon="save"
						loading={r.busy}
						disabled={!r.dirty}
						onClick={() => void r.save()}
						title={`Сохранить (${MAC ? '⌘' : 'Ctrl'}+S)`}
					>
						Сохранить
					</Button>
				</div>
			</div>

			<div className={s.scroll}>
				<article className={s.page}>
					<input
						ref={titleRef}
						className={s.title}
						value={r.draft.name}
						onChange={e => r.set('name', e.target.value)}
						placeholder="Название роли"
						aria-label="Название роли"
						aria-invalid={!!r.errors.name}
						spellCheck={false}
					/>
					{r.errors.name && <p className={s.err}>{r.errors.name}</p>}
					<input
						className={s.desc}
						value={r.draft.description}
						onChange={e => r.set('description', e.target.value)}
						placeholder="Одной строкой: для чего эта роль"
						aria-label="Описание роли"
						aria-invalid={!!r.errors.description}
					/>
					{r.errors.description && <p className={s.err}>{r.errors.description}</p>}

					<dl className={s.props}>
						<dt>
							<Icon name="pulse" size={13} />
							Цвет
						</dt>
						<dd>
							<div className={s.swatches} role="radiogroup" aria-label="Цвет роли">
								{ROLE_HUES.map(h => (
									<button
										key={h}
										type="button"
										role="radio"
										aria-checked={Math.round(r.color) === h}
										aria-label={`Оттенок ${h}`}
										className={s.swatch}
										style={cssVars({ '--c': roleColor(h) })}
										onClick={() => r.set('color', h)}
									/>
								))}
							</div>
						</dd>
						<dt>
							<Icon name="users" size={13} />
							Агенты
						</dt>
						<dd>
							{r.users.length ? (
								<div className={s.agents}>
									{r.users.map(a => {
										const st = agentStatusMeta(a)
										return (
											<button
												key={a.id}
												type="button"
												className={`${s.agent} ${a.archived ? s.agentArchived : ''}`}
												onClick={() => openAgent(a.id)}
												title={`${a.name} — ${st.label}`}
											>
												<AgentAvatar name={a.name} roleHue={r.color} status={a.status} archived={a.archived} size={16} />
												{a.name}
											</button>
										)
									})}
								</div>
							) : (
								<span className={s.none}>{id ? 'пока нет' : 'появятся после запуска'}</span>
							)}
						</dd>
						{id && (
							<>
								<dt>
									<Icon name="link" size={13} />
									id
								</dt>
								<dd>
									<code className={s.code}>{id}</code>
								</dd>
							</>
						)}
					</dl>

					<div className={s.sep} />

					{preview ? (
						r.draft.instructions.trim() ? (
							<div className={s.md} dangerouslySetInnerHTML={{ __html: renderMarkdown(r.draft.instructions) }} />
						) : (
							<p className={s.none}>Инструкций пока нет</p>
						)
					) : (
						<textarea
							ref={area}
							className={s.instructions}
							value={r.draft.instructions}
							onChange={e => r.set('instructions', e.target.value)}
							placeholder={'Инструкции агенту в markdown.\n\nНапример:\n# Ты — ревьюер кода\n- проверяй тесты\n- отвечай списком замечаний'}
							aria-label="Инструкции"
							aria-invalid={!!r.errors.instructions}
							spellCheck={false}
						/>
					)}
					{r.errors.instructions && <p className={s.err}>{r.errors.instructions}</p>}
					{r.errors.form && (
						<p className={s.banner} role="alert">
							<Icon name="alert" size={14} />
							{r.errors.form}
						</p>
					)}
					<p className={s.foot}>
						Инструкции добавляются во вводную агента при запуске. <Kbd>{MAC ? '⌘' : 'Ctrl'}</Kbd>
						<Kbd>S</Kbd> — сохранить.
					</p>
				</article>
			</div>

			<Dialog
				open={r.confirmDelete}
				title={`Удалить роль «${r.role?.name ?? ''}»?`}
				subtitle={
					r.users.length
						? `Её используют агентов: ${r.users.length}. Они продолжат работать с прежними инструкциями.`
						: 'Действие нельзя отменить.'
				}
				onClose={() => r.setConfirmDelete(false)}
				footer={
					<>
						<Button variant="ghost" onClick={() => r.setConfirmDelete(false)}>
							Отмена
						</Button>
						<Button variant="danger" icon="trash" loading={r.busy} onClick={() => void r.remove()} data-autofocus>
							Удалить
						</Button>
					</>
				}
			>
				<p className={s.confirm}>Роль исчезнет из списка и из диалога запуска агентов.</p>
			</Dialog>
		</div>
	)
}
