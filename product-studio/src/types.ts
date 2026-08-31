export type RoleRow = [string, string, string, string, string, string, string, string];
export type SegmentRow = [number, string, string, string, string, string, string, string, string, number, string, number, string?, string?, string?, number?, ('none' | 'medium' | 'strong')?, ('standard' | 'advanced')?];

export type CharacterGender = 'female' | 'male' | 'unspecified';
export type VoiceGenerationPreset = 'stable' | 'balanced' | 'explore' | 'custom';

export interface VoiceTraits {
  weight: number;
  brightness: number;
  resonance: number;
  tension: number;
  roughness: number;
  breathiness: number;
  nasality: number;
  articulation: number;
  pace: number;
  pause_density: number;
  pitch_variation: number;
  expressiveness: number;
  accent: string;
}

export interface VoiceGenerationSettings {
  preset: VoiceGenerationPreset;
  do_sample: boolean;
  top_k: number;
  top_p: number;
  temperature: number;
  repetition_penalty: number;
  seed: number;
  max_new_tokens: number;
  candidate_count: number;
  subtalker_dosample: boolean;
  subtalker_top_k: number;
  subtalker_top_p: number;
  subtalker_temperature: number;
}

export interface VoiceCandidate {
  voice_id: string;
  seed: number;
  raw_median_pitch_hz?: number;
  median_pitch_hz?: number;
  pitch_delta_hz?: number;
  pitch_target_tolerance_hz?: number;
  pitch_target_matched?: boolean;
  pitch_correction_semitones?: number;
  pitch_correction_method?: 'librosa_phase_vocoder' | 'none';
  pitch_calibration_version?: number;
  pitch_verified?: boolean;
  selected: boolean;
  gender_verified?: boolean;
  age_band_verified?: boolean;
  gender_identity_verified?: boolean;
  gender_identity_method?: 'acoustic_pitch' | 'pending_human' | 'human_listening' | 'legacy';
}

export interface CharacterAsset {
  gender: CharacterGender;
  age: number;
  pitch_min_hz: number;
  pitch_max_hz: number;
  pitch_target_hz: number;
  audition_text: string;
  voice_traits: VoiceTraits;
  voice_generation: VoiceGenerationSettings;
  voice_candidates?: VoiceCandidate[];
  portrait_url?: string;
  portrait_prompt?: string;
  portrait_style: string;
  portrait_notes?: string;
  profile_updated_by?: string;
  age_source?: string;
  age_evidence?: string;
  gender_source?: string;
  gender_evidence?: string;
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
  linked_projects?: Array<{
    source_project_id: string;
    source_project_title: string;
    imported_at: string;
    roles: Array<{ source_role_id: string; target_role_id: string; name: string; voice_ids: string[]; available_voice_ids: string[]; missing_voice_ids: string[] }>;
    pronunciations: {
      imported_count: number;
      duplicate_rules: Array<{ source: string; kept_source_project_id: string }>;
      conflict_rules: Array<{ source: string; kept_source_project_id: string; kept_replacement: string; ignored_replacement: string }>;
    };
  }>;
}

export interface AiMediaSettings {
  endpoint: string;
  textModel: string;
  directorProvider: 'ollama' | 'compatible';
  directorModel: string;
  ollamaEndpoint: string;
  directorMaxChunkChars: number;
  imageModel: string;
  instanceId: string;
  textApi: 'responses' | 'chat_completions';
  allowInsecureHttp: boolean;
  transportRisk: boolean;
  hasApiKey: boolean;
}

export interface AiMediaModelDiscovery {
  ok: boolean;
  provider?: 'ollama' | 'compatible';
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
  emotionDirections: Array<{ value: string; label: string; prompt: string; defaultWeight: number }>;
  paces: string[];
  roleKinds: string[];
  roleKindLabels: Record<string, string>;
  contentTypeLabels: Record<string, string>;
  languages: string[];
}
