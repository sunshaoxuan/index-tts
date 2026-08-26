export type RoleRow = [string, string, string, string, string, string, string, string];
export type SegmentRow = [number, string, string, string, string, string, string, string, string, number, string, number];

export type CharacterGender = 'female' | 'male' | 'unspecified';

export interface CharacterAsset {
  gender: CharacterGender;
  age: number;
  pitch_min_hz: number;
  pitch_max_hz: number;
  pitch_target_hz: number;
  portrait_url?: string;
  portrait_prompt?: string;
  portrait_style: string;
  portrait_notes?: string;
  profile_updated_by?: string;
}

export interface ProjectPayload {
  project_id: string;
  title: string;
  content_type: string;
  source_text: string;
  guidance: string;
  roles: RoleRow[];
  character_assets: Record<string, CharacterAsset>;
  segments: SegmentRow[];
  pronunciations: Array<{ source: string; replacement: string; note: string; enabled: boolean }>;
  chapters?: Array<{ index: number; title: string; start: number; end: number }>;
  document?: Record<string, unknown>;
  director_history?: Array<{ operation_id: string; recorded_at: string; actor: string; changes: string[]; memory_report?: Record<string, unknown> }>;
  director_memory?: { source_text: string; roles: RoleRow[]; character_assets?: Record<string, CharacterAsset>; segments: SegmentRow[]; pronunciations: ProjectPayload['pronunciations'] };
}

export interface AiMediaSettings {
  endpoint: string;
  textModel: string;
  imageModel: string;
  instanceId: string;
  textApi: 'responses' | 'chat_completions';
  allowInsecureHttp: boolean;
  transportRisk: boolean;
  hasApiKey: boolean;
}

export interface AiMediaModelDiscovery {
  ok: boolean;
  endpoint: string;
  instanceId: string;
  models: string[];
  modelCount: number;
}

export interface Presets {
  voiceStyles: string[];
  voiceStylePrompts: Record<string, string>;
  rhythms: string[];
  rhythmPrompts: Record<string, string>;
  attitudes: string[];
  emotions: string[];
  paces: string[];
  roleKinds: string[];
  roleKindLabels: Record<string, string>;
  contentTypeLabels: Record<string, string>;
  languages: string[];
}
