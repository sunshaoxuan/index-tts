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
  stressWord?: string; stressLevel?: string; selectedCandidateId?: string;
  candidates?: Array<{
    candidateId: string; audio: string; rank: number; selected: boolean; score: number; stressDb: number;
    audioQualityPassed: boolean; qualityPassed: boolean; stressVerified: boolean; alignmentMethod: string;
    speakerSimilarity: number | null; speakerSimilarityThreshold: number; speakerVerified: boolean; speakerValidationMethod: string;
    directorVerified: boolean; directorValidationMethod: string;
    manualOverride: boolean; manualSelectedAt: string;
  }>;
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
    engine?: 'voice'; processAlive: boolean; pid: number; phase: string; modelLoaded: boolean; startedAt?: string;
    readBytes?: number; rssBytes?: number; modelBytes?: number;
  };
  modelRuntime?: {
    engine: 'voice' | 'render'; processAlive: boolean; pid: number; phase: string; modelLoaded: boolean; startedAt?: string;
    readBytes?: number; rssBytes?: number; modelBytes?: number;
  };
}

export interface JobStatus {
  phase: string; fraction: number; message: string; telemetry?: JobTelemetry;
}

export interface JobCancellation {
  jobId: string; phase: string; message: string; runtimeTerminated: boolean;
}

export interface SceneKeyframeResult {
  sceneId: string;
  shotId?: string;
  keyframeUrl: string;
  keyframePrompt: string;
  keyframeStyle: string;
  generatedAt: string;
  model: string;
  requestedModel: string;
  modelFallbackUsed: boolean;
  modelFallbackReason: string;
  modelPromptProfile: string;
  identityReferenceMode: 'role_portraits' | 'no_visual_characters';
  referenceCharacters: Array<{
    roleId: string;
    name: string;
    portraitUrl: string;
    portraitSha256: string;
  }>;
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let body: Record<string, unknown> | undefined;
  if (contentType.includes('application/json') || /^\s*[\[{]/.test(raw)) {
    try { body = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new Error(`接口返回的 JSON 无法解析（HTTP ${response.status}）`); }
  }
  if (!response.ok) {
    const detail = body?.message || body?.error;
    if (detail) throw new Error(String(detail));
    throw new Error(`请求链路返回了非 JSON 响应（HTTP ${response.status}），请检查反向代理和上游生成服务状态后重试`);
  }
  if (!body) throw new Error(`接口返回格式异常（HTTP ${response.status}，${contentType || '未知类型'}）`);
  return body as T;
}

export function projectSavePayload(project: ProjectPayload): ProjectPayload {
  const { director_history: _history, director_memory: _memory, ...editableProject } = project;
  return editableProject;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  return parseApiResponse<T>(response);
}

const emptyPost: RequestInit = { method: 'POST', body: JSON.stringify({}) };

export const api = {
  health: () => request<RuntimeHealth>('/api/health'),
  presets: () => request<Presets>('/api/presets'),
  aiMediaSettings: () => request<AiMediaSettings>('/api/settings/ai-media'),
  testAiMediaSettings: (settings: { endpoint: string; apiKey?: string; instanceId: string; allowInsecureHttp: boolean }, signal?: AbortSignal) => request<AiMediaModelDiscovery>('/api/settings/ai-media/test', { method: 'POST', body: JSON.stringify(settings), signal }),
  testDirectorSettings: (settings: { directorProvider: 'ollama' | 'compatible'; ollamaEndpoint: string; endpoint: string; apiKey?: string; instanceId: string; allowInsecureHttp: boolean }, signal?: AbortSignal) => request<AiMediaModelDiscovery>('/api/settings/ai-media/director-test', { method: 'POST', body: JSON.stringify(settings), signal }),
  saveAiMediaSettings: (settings: { endpoint: string; apiKey?: string; clearApiKey?: boolean; textModel: string; directorProvider: 'ollama' | 'compatible'; directorModel: string; ollamaEndpoint: string; directorMaxChunkChars: number; imageModel: string; imageFallbackModel: string; imageFallbackEnabled: boolean; instanceId: string; textApi: 'responses' | 'chat_completions'; allowInsecureHttp: boolean }) => request<AiMediaSettings>('/api/settings/ai-media', { method: 'PUT', body: JSON.stringify(settings) }),
  activeJob: () => request<{ available: boolean; jobId?: string; kind?: 'analyze' | 'storyboard' | 'voice' | 'render' | 'standardize'; projectId?: string; roleId?: string; phase?: string; fraction?: number; message?: string }>('/api/active-job'),
  projects: () => request<Array<{ label: string; value: string; roleCount: number }>>('/api/projects'),
  createProject: (title: string, contentType: string, sourceProjectIds: string[]) => request<ProjectPayload>('/api/projects', { method: 'POST', body: JSON.stringify({ title, content_type: contentType, source_project_ids: sourceProjectIds }) }),
  project: (id: string, signal?: AbortSignal) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}`, { signal }),
  save: (project: ProjectPayload) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(project.project_id)}`, {
    method: 'PUT', body: JSON.stringify(projectSavePayload(project)),
  }),
  deleteProject: (id: string) => request<{ deleted: boolean; projectId: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  latestRender: (id: string, signal?: AbortSignal) => request<RenderInfo>(`/api/projects/${encodeURIComponent(id)}/latest-render`, { signal }),
  deleteRender: (id: string, renderId: string) => request<{ deleted: boolean; renderId: string }>(`/api/projects/${encodeURIComponent(id)}/renders/${encodeURIComponent(renderId)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  analyze: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/analyze`, emptyPost),
  regenerateStoryboard: (id: string, targetShotSeconds: number) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/storyboard/regenerate`, { method: 'POST', body: JSON.stringify({ targetShotSeconds }) }),
  render: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/render`, emptyPost),
  assemble: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/assemble`, emptyPost),
  regenerateSegment: (id: string, order: number, advanced = false) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/segments/${order}/regenerate`, { method: 'POST', body: JSON.stringify({ advanced }) }),
  selectSegmentCandidate: (id: string, order: number, candidateId: string) => request<{ selected: boolean; manualOverride: boolean }>(`/api/projects/${encodeURIComponent(id)}/segments/${order}/candidates/${encodeURIComponent(candidateId)}/select`, emptyPost),
  voice: (id: string) => request<{ jobId: string }>(`/api/projects/${encodeURIComponent(id)}/voices`, emptyPost),
  expandCharacterProfile: (id: string, roleId: string, draft: { name: string; profile: string; gender: string; age: number }, signal?: AbortSignal) => request<{ profile: string; model: string }>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/expand-profile`, { method: 'POST', body: JSON.stringify(draft), signal }),
  generateCharacterPortrait: (id: string, roleId: string, draft: { name: string; profile: string; gender: string; age: number; portraitStyle: string; portraitPrompt?: string; imageModel: string; allowFallback: boolean }, signal?: AbortSignal) => request<{ portraitUrl: string; portraitPrompt: string; portraitStyle: string; model: string; requestedModel: string; modelFallbackUsed: boolean; modelFallbackReason: string; modelPromptProfile: string }>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/portrait`, { method: 'POST', body: JSON.stringify(draft), signal }),
  generateSceneKeyframe: (id: string, sceneId: string, scene: Record<string, unknown>, keyframeStyle: string, imageModel: string, allowFallback: boolean, signal?: AbortSignal) => request<SceneKeyframeResult>(`/api/projects/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneId)}/keyframe`, { method: 'POST', body: JSON.stringify({ scene, keyframeStyle, imageModel, allowFallback }), signal }),
  generateStoryboardShotKeyframe: (id: string, sceneId: string, shotId: string, shot: Record<string, unknown>, keyframeStyle: string, imageModel: string, allowFallback: boolean, signal?: AbortSignal) => request<SceneKeyframeResult>(`/api/projects/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneId)}/shots/${encodeURIComponent(shotId)}/keyframe`, { method: 'POST', body: JSON.stringify({ shot, keyframeStyle, imageModel, allowFallback }), signal }),
  preflightStoryboardShotKeyframes: (id: string, shots: Array<Record<string, unknown>>, keyframeStyle: string, imageModel: string, allowFallback: boolean, signal?: AbortSignal) => request<{ validatedCount: number; shotIds: string[]; model: string; candidateModels: string[] }>(`/api/projects/${encodeURIComponent(id)}/storyboard/keyframes`, { method: 'POST', body: JSON.stringify({ shots, keyframeStyle, imageModel, allowFallback, preflightOnly: true }), signal }),
  generateStoryboardKeyframes: (id: string, scenes: Array<Record<string, unknown>>, keyframeStyle: string, imageModel: string, allowFallback: boolean, signal?: AbortSignal) => request<{ keyframes: SceneKeyframeResult[]; generatedCount: number; model: string; candidateModels?: string[] }>(`/api/projects/${encodeURIComponent(id)}/storyboard/keyframes`, { method: 'POST', body: JSON.stringify({ scenes, keyframeStyle, imageModel, allowFallback }), signal }),
  generateStoryboardShotKeyframes: (id: string, shots: Array<Record<string, unknown>>, keyframeStyle: string, imageModel: string, allowFallback: boolean, signal?: AbortSignal) => request<{ keyframes: SceneKeyframeResult[]; generatedCount: number; model: string; candidateModels: string[] }>(`/api/projects/${encodeURIComponent(id)}/storyboard/keyframes`, { method: 'POST', body: JSON.stringify({ shots, keyframeStyle, imageModel, allowFallback }), signal }),
  uploadRoleReferenceAudio: async (id: string, roleId: string, file: File) => parseApiResponse<{
    voiceId: string; originalName: string; uploadedAt: string; sourceFormat: string; sizeBytes: number;
    sampleRateHz: number; channels: number; maximumSourceSeconds: number;
  }>(await fetch(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/reference-audio`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Audio-Filename': encodeURIComponent(file.name) },
    body: file,
  })),
  generateStandardReference: (id: string, roleId: string, pacePreset: '自然' | '舒缓' | '自定义', durationFactor: number, auditionText: string) => request<{ jobId: string; roleId: string }>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/standard-reference`, {
    method: 'POST', body: JSON.stringify({ pacePreset, durationFactor, auditionText }),
  }),
  adoptStandardReference: (id: string, roleId: string, voiceId: string) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/standard-reference/candidates/${encodeURIComponent(voiceId)}/adopt`, emptyPost),
  restoreOriginalReference: (id: string, roleId: string) => request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}/standard-reference/restore`, emptyPost),
  job: (id: string) => request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<JobCancellation>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }),
};
