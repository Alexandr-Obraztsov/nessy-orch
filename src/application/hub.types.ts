import type { HubEvent } from '../../shared/types'

export type HubListener = (evt: HubEvent) => void
