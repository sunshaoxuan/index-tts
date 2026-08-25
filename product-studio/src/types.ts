export type RoleRow = [string, string, string, string, string, string, string, string];
export type SegmentRow = [number, string, string, string, string, string, string, string, string, number, string, number];

export interface ProjectPayload {
  project_id: string;
  title: string;
  content_type: string;
  source_text: string;
  guidance: string;
  roles: RoleRow[];
  segments: SegmentRow[];
  pronunciations: Array<{ source: string; replacement: string; note: string; enabled: boolean }>;
  chapters?: Array<{ index: number; title: string; start: number; end: number }>;
  document?: Record<string, unknown>;
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
