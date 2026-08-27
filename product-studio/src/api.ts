import type { AiMediaModelDiscovery, AiMediaSettings, CharacterAsset, Presets, ProjectPayload } from './types';

export interface RuntimeHealth {
  status: string;
  productVersion: string;
  runtime: string;
  architecture: string;
  voiceModel: { processAlive: boolean; modelLoaded: boolean; phase: string; pid?: number; modelDir?: string };
}

export interface RenderFragment {
  order: number; speakerName: string; sourceText: string; synthesisText: string; effectiveText: string;
  appliedPronunciations: string[]; cacheReused: boolean; forcedRegeneration: boolean; audio: string;
}

export interface RenderCaption {
  order: number; speakerName: string; text: string; durationSeconds: number; pauseAfterMs: number;
}

export interface RenderInfo {
  available: boolean; renderId?: string; audio?: string; mp3?: string; package?: string; manifest?: string; fragments?: RenderFragment[];
  captions?: RenderCaption[];
  stale?: boolean; staleAt?: string; staleReasons?: string[];
}

export interface JobTelemetry {
  observedAt: string;
  startedAt: string;
  statusUpdatedAt: string;
  workerAlive: boolean;
  voiceRuntime?: {
    processAlive: boolean; pid: number; phase: string; modelLoaded: boolean; startedAt?: string;
    readBytes?: number; rssBytes?: number; modelBytes?: number;
  };
}

export interface JobStatus {
  phase: string; fraction: number; message: string; telemetry?: JobTelemetry;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `请求失败 ${response.status}`);
  return body as T;
}

const emptyPost: RequestInit = { method: 'POST', body: JSON.stringify({}) };

export const api = {
  health: () => request<RuntimeHealth>('/api/health'),
  presets: () => request<Presets>('/api/presets'),
  aiMediaSettings: () => request<AiMediaSettings>('/api/settings/ai-media'),
  testAiMediaSettings: (settings: { endpoint: string; apiKey?: string; instanceId: string; allowInsecureHttp: boolean }) => request<AiMediaModelDiscovery>('/api/settings/ai-media/test', { method: 'POST', body: JSON.stringify(settings) }),
  testDirectorSettings: (settings: { directorProvider: 'ollama' | 'compatible'; ollamaEndpoint: string; endpoint: string; apiKey?: string; instanceId: string; allowInsecureHttp: boolean }) => request<AiMediaModelDiscovery>('/api/settings/ai-media/director-test', { method: 'POST', body: JSON.stringify(settings) }),
  saveAiMediaSettings: (settings: { endpoint: string; apiKey?: string; clearApiKey?: boolean; textModel: string; directorProvider: 'ollama' | 'compatible'; directorModel: string; ollamaEndpoint: string; directorMaxChunkChars: number; imageModel: string; instanceId: string; textApi: 'responses' | 'chat_completions'; allowInsecureHttp: boolean }) => request<AiMediaSettings>('/api/settings/ai-media', { method: 'PUT', body: JSON.stringify(settings) }),
  activeJob: () => request<{ available: boolean; jobId?: string; kind?: 'analyze' | 'voice' | 'render'; projectId?: string; phase?: string; fraction?: number; message?: string }>('/api/active-job'),
  projects: () => request<Array<{ label: string; value: string }>>('/api/projects'),
  createProject: (title: string, contentType: string) => request<ProjectPayload>('/api/projects', { method: 'POST', body: JSON.stringify({ title, content_type: contentType }) }),
  project: (id: string) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}`),
  save: (project: ProjectPayload) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(project.project_id)}`, {
    method: 'PUT', body: JSON.stringify(project),
  }),
  deleteProject: (id: string) => request<{ deleted: boolean; projectId: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  latestRender: (id: string) => request<RenderInfo>(`/api/projects/${encodeURIComponent(id)}/latest-render`),
  deleteRender: (id: string, renderId: string) => request<{ deleted: boolean; renderId: string }>(`/api/projects/${encodeURIComponent(id)}/renders/${encodeURIComponent(renderId)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  analyze: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/analyze`, emptyPost),
  render: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/render`, emptyPost),
  assemble: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/assemble`, emptyPost),
  regenerateSegment: (id: string, order: number) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/segments/${order}/regenerate`, emptyPost),
  voice: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/voices`, emptyPost),
  expandCharacterProfile: (id: string, roleId: string, draft: { name: string; profile: string; gender: string; age: number }) => request<{ profile: string; model: string }>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/expand-profile`, { method: 'POST', body: JSON.stringify(draft) }),
  generateCharacterPortrait: (id: string, roleId: string, draft: { name: string; profile: string; gender: string; age: number; portraitStyle: string; portraitPrompt?: string }) => request<{ portraitUrl: string; portraitPrompt: string; portraitStyle: string; model: string }>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/portrait`, { method: 'POST', body: JSON.stringify(draft) }),
  job: (id: string) => request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}`),
};
