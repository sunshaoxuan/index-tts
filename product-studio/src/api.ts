import type { Presets, ProjectPayload } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `请求失败 ${response.status}`);
  return body as T;
}

const emptyPost: RequestInit = { method: 'POST', body: JSON.stringify({}) };

export const api = {
  presets: () => request<Presets>('/api/presets'),
  activeJob: () => request<{ available: boolean; jobId?: string; kind?: 'analyze' | 'voice' | 'render'; projectId?: string; phase?: string; fraction?: number; message?: string }>('/api/active-job'),
  projects: () => request<Array<{ label: string; value: string }>>('/api/projects'),
  createProject: (title: string, contentType: string) => request<ProjectPayload>('/api/projects', { method: 'POST', body: JSON.stringify({ title, content_type: contentType }) }),
  project: (id: string) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}`),
  save: (project: ProjectPayload) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(project.project_id)}`, {
    method: 'PUT', body: JSON.stringify(project),
  }),
  latestRender: (id: string) => request<{ available: boolean; audio?: string; package?: string; manifest?: string }>(`/api/projects/${encodeURIComponent(id)}/latest-render`),
  analyze: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/analyze`, emptyPost),
  render: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/render`, emptyPost),
  voice: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/voices`, emptyPost),
  job: (id: string) => request<{ phase: string; fraction: number; message: string }>(`/api/jobs/${encodeURIComponent(id)}`),
};
