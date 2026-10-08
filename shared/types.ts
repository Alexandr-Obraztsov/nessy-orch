/**
 * Общие типы сервера, CLI и UI. Только типы — никакого рантайм-кода
 * (UI импортирует их через `import type`, поэтому в браузер они не попадают).
 */

/** Идентификатор узла графа: `you` либо id агента. */
export type NodeId = string;

export type AgentStatus = 'starting' | 'idle' | 'working' | 'error' | 'dead' | 'sleeping';
export type SpaceStatus = 'stopped' | 'starting' | 'ready' | 'failed';
export type MessageKind = 'msg' | 'reply' | 'event';

export interface SpaceView {
  name: string;
  path: string;
  /** hue 0..360 */
  color: number;
  mode: 'managed' | 'external';
  url: string | null;
  status: SpaceStatus;
  error: string | null;
}

export interface ToolBrief {
  name: string;
  title: string;
}

export interface PermissionBrief {
  requestId: string;
  title: string;
}

export interface AgentView {
  id: string;
  name: string;
  space: string;
  parent: NodeId;
  status: AgentStatus;
  error: string | null;
  displayName: string | null;
  createdAt: string;
  lastActivityAt: string;
  queued: number;
  turnStartedAt: string | null;
  lastTool: ToolBrief | null;
  preview: string;
  pendingPermissions: PermissionBrief[];
}

/** Единица общей ленты («группчат»). */
export interface Message {
  /** монотонный номер для курсоров */
  seq: number;
  id: string;
  ts: number;
  from: NodeId;
  to: NodeId;
  kind: MessageKind;
  text: string;
  /** длина цепочки агент→агент (защита от зацикливания) */
  hops: number;
  /** id сообщения, на которое это ответ */
  replyTo?: string;
  /** отправитель ждёт ответ синхронно (--wait): ответ не дублируется ему промптом */
  wait?: boolean;
  /** сообщение не доставлено (причина) */
  failed?: string;
}

// ---------- события агента (чат с конкретным агентом) ----------
interface EventBase {
  seq: number;
  ts: number;
}
export interface UserEvent extends EventBase {
  kind: 'user';
  from: NodeId;
  msgId: string;
  text: string;
}
export interface TextEvent extends EventBase {
  kind: 'text' | 'thought';
  text: string;
}
export interface ToolEvent extends EventBase {
  kind: 'tool';
  toolId: string;
  name: string;
  title: string;
  input: Record<string, unknown>;
  status: string;
  output?: string;
}
export interface PermissionEvent extends EventBase {
  kind: 'permission';
  requestId: string;
  title: string;
  resolved: boolean;
  approved?: boolean;
  auto?: boolean;
}
export interface SystemEvent extends EventBase {
  kind: 'system';
  level: 'info' | 'error';
  text: string;
}
export type AgentEvent = UserEvent | TextEvent | ToolEvent | PermissionEvent | SystemEvent;

export interface ChunkEvent {
  seq: number;
  ts: number;
  kind: 'text' | 'thought';
  delta: string;
  len: number;
}

// ---------- потоки ----------
/** Событие общего потока `/stream`. */
export type StreamEvent =
  | { t: 'snapshot'; rev: number; spaces: SpaceView[]; agents: AgentView[]; messages: Message[] }
  | { t: 'message'; rev: number; message: Message }
  | { t: 'agent'; rev: number; agent: AgentView }
  | { t: 'agent_removed'; rev: number; id: string }
  | { t: 'space'; rev: number; space: SpaceView }
  | { t: 'space_removed'; rev: number; name: string };

/** Всё, что ходит по внутренней шине (включая события агентов). */
export type HubEvent =
  | Exclude<StreamEvent, { t: 'snapshot' }>
  | { t: 'event'; rev: number; agentId: string; event: AgentEvent }
  | { t: 'chunk'; rev: number; agentId: string; chunk: ChunkEvent };

/** Входные данные publish (rev выставляет шина). */
export type HubInput =
  | { t: 'message'; message: Message }
  | { t: 'agent'; agent: AgentView }
  | { t: 'agent_removed'; id: string }
  | { t: 'space'; space: SpaceView }
  | { t: 'space_removed'; name: string }
  | { t: 'event'; agentId: string; event: AgentEvent }
  | { t: 'chunk'; agentId: string; chunk: ChunkEvent };

/** Событие потока одного агента `/agents/:id/stream`. */
export type AgentStreamEvent =
  | { t: 'event'; event: AgentEvent }
  | { t: 'chunk'; chunk: ChunkEvent }
  | { t: 'agent'; agent: AgentView }
  | { t: 'replay_done' };

// ---------- REST ----------
export interface GraphView {
  rev: number;
  spaces: SpaceView[];
  agents: AgentView[];
}

export interface SpawnRequest {
  /** имя пространства или путь к воркспейсу */
  space?: string;
  name?: string;
  prompt?: string;
  parent?: NodeId;
  from?: NodeId;
  wait?: boolean;
  waitTimeoutSec?: number;
}

export interface SendRequest {
  from?: NodeId;
  text: string;
  wait?: boolean;
  waitTimeoutSec?: number;
}

export interface SendResponse {
  message: Message;
  /** при wait=true: ответ агента */
  reply?: Message;
  timedOut?: boolean;
}

export interface SpawnResponse extends SendResponse {
  agent: AgentView;
}

export interface SpaceRequest {
  /** абсолютный путь воркспейса */
  path: string;
  name?: string;
  /** URL уже запущенного nessy serve (иначе оркестратор запустит свой) */
  url?: string;
}

export interface InboxResponse {
  messages: Message[];
  cursor: number;
}

export interface StatusResponse {
  version: string;
  pid: number;
  uptimeSec: number;
  rev: number;
  home: string;
  autoApprove: boolean;
  spaces: number;
  agents: number;
  working: number;
}

export interface ApiError {
  error: string;
  code: string;
}
