import type { Presets, ProjectPayload } from './types';

export interface RuntimeHealth {
  status: string;
  runtime: string;
  architecture: string;
  voiceModel: { processAlive: boolean; modelLoaded: boolean; phase: string; pid?: number; modelDir?: string };
}

export interface RenderFragment {
  order: number; speakerName: string; sourceText: string; synthesisText: string; effectiveText: string;
  appliedPronunciations: string[]; cacheReused: boolean; forcedRegeneration: boolean; audio: string;
}

export interface RenderInfo {
  available: boolean; renderId?: string; audio?: string; package?: string; manifest?: string; fragments?: RenderFragment[];
  stale?: boolean; staleAt?: string; staleReasons?: string[];
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
  activeJob: () => request<{ available: boolean; jobId?: string; kind?: 'analyze' | 'voice' | 'render'; projectId?: string; phase?: string; fraction?: number; message?: string }>('/api/active-job'),
  projects: () => request<Array<{ label: string; value: string }>>('/api/projects'),
  createProject: (title: string, contentType: string) => request<ProjectPayload>('/api/projects', { method: 'POST', body: JSON.stringify({ title, content_type: contentType }) }),
  project: (id: string) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}`),
  save: (project: ProjectPayload) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(project.project_id)}`, {
    method: 'PUT', body: JSON.stringify(project),
  }),
  latestRender: (id: string) => request<RenderInfo>(`/api/projects/${encodeURIComponent(id)}/latest-render`),
  deleteRender: (id: string, renderId: string) => request<{ deleted: boolean; renderId: string }>(`/api/projects/${encodeURIComponent(id)}/renders/${encodeURIComponent(renderId)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  analyze: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/analyze`, emptyPost),
  render: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/render`, emptyPost),
  assemble: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/assemble`, emptyPost),
  regenerateSegment: (id: string, order: number) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/segments/${order}/regenerate`, emptyPost),
  voice: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/voices`, emptyPost),
  job: (id: string) => request<{ phase: string; fraction: number; message: string }>(`/api/jobs/${encodeURIComponent(id)}`),
};
