import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Alert, App as AntApp, AutoComplete, Button, Card, Empty, Flex, Input, InputNumber, Layout, Modal,
  Popconfirm, Progress, Select, Slider, Space, Switch, Table, Tabs, Tag, Typography,
} from 'antd';
import {
  AudioOutlined, CaretDownOutlined, CaretLeftOutlined, CaretRightOutlined, CaretUpOutlined, DeleteOutlined, DragOutlined, EditOutlined, FolderOpenOutlined, LockOutlined, PauseOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, SettingOutlined, SoundOutlined, UserOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api, type RenderCaption, type RenderInfo, type RuntimeHealth } from './api';
import { countMatchingFragments, findMatchingFragment } from './fragmentState';
import { activeCaptionIndex, buildCaptionTimeline } from './subtitleTimeline';
import { ageVoiceConstraint, normalizeCharacterAsset, recommendPitchRange, updateAssetDemographics } from './characterVoiceProfile';
import { applyVoiceGenerationPreset, voiceTraitsInstruction } from './voiceControls';
import { PORTRAIT_STYLE_PRESETS, portraitStylePreset } from './portraitStyles';
import { clampProjectActionDockPlacement, nearestProjectActionDockEdge, normalizeProjectActionDockPlacement, projectActionDockOffset, type ProjectActionDockEdge, type ProjectActionDockPlacement } from './projectActionDock';
import { isProjectWorkspaceVisible, nextProjectActionsExpanded } from './projectActionVisibility';
import { deleteProjectRole, stopRoleDeleteCardActivation } from './roleDeletion';
import { normalizeActiveRoleId, roleRowClassName } from './roleFocusState';
import { dominantWheelAxis, shouldPreventScrollChain } from './scrollContainment';
import { mergeAdjacentSegments, splitSegmentAtOffset, suggestSplitOffset, updateSegmentByOrder } from './segmentState';
import { SEGMENT_PAGE_SIZE_OPTIONS, clampSegmentPage } from './segmentPagination';
import type { AiMediaSettings, CharacterAsset, CharacterGender, Presets, ProjectPayload, RoleRow, SegmentRow, VoiceGenerationPreset, VoiceTraits } from './types';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const PROJECT_ACTION_IDLE_COLLAPSE_MS = 10_000;
const PROJECT_ACTION_DOCK_STORAGE_KEY = 'index-voice-project-action-dock-v1';

const VOICE_TRAIT_CONTROLS: Array<{ key: Exclude<keyof VoiceTraits, 'accent'>; label: string; low: string; high: string }> = [
  { key: 'weight', label: '声音重量', low: '轻薄', high: '厚重' },
  { key: 'brightness', label: '音色亮度', low: '暗沉', high: '明亮' },
  { key: 'resonance', label: '共鸣位置', low: '胸腔', high: '头腔' },
  { key: 'tension', label: '声带状态', low: '松弛', high: '紧致' },
  { key: 'roughness', label: '粗糙度', low: '纯净', high: '粗粝' },
  { key: 'breathiness', label: '气息量', low: '紧实', high: '气声' },
  { key: 'nasality', label: '鼻音程度', low: '无鼻音', high: '强鼻音' },
  { key: 'articulation', label: '吐字锐度', low: '柔和', high: '锋利' },
  { key: 'pace', label: '语速', low: '缓慢', high: '快速' },
  { key: 'pause_density', label: '停顿密度', low: '稀少', high: '密集' },
  { key: 'pitch_variation', label: '音高起伏', low: '平直', high: '丰富' },
  { key: 'expressiveness', label: '情绪外放', low: '克制', high: '外放' },
];

function formatAudioTime(value: number) {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

function trimSentence(value: string) {
  return value.trim().replace(/[。！？!?；;]+$/u, '');
}

function isPublicHttpEndpoint(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname.toLowerCase());
  } catch { return false; }
}

function StudioAudio({ src, captions = [] }: { src: string; captions?: RenderCaption[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const captionRefs = useRef(new Map<number, HTMLDivElement>());
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const timeline = useMemo(() => buildCaptionTimeline(captions), [captions]);
  const activeIndex = activeCaptionIndex(timeline, current);
  useEffect(() => {
    if (activeIndex < 0) return;
    captionRefs.current.get(activeIndex)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);
  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  };
  return <div className="studio-audio-block">
    <div className="studio-audio">
      <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button type="button" onClick={toggle} aria-label={playing ? '暂停音频' : '播放音频'}>{playing ? <PauseOutlined /> : <CaretRightOutlined />}</button>
      <span>{formatAudioTime(current)}</span>
      <input aria-label="音频进度" type="range" min={0} max={safeDuration} step={0.1} value={Math.min(current, safeDuration)} onInput={(event) => { const value = Number(event.currentTarget.value); setCurrent(value); if (audioRef.current) audioRef.current.currentTime = value; }} />
      <span>{formatAudioTime(safeDuration)}</span>
    </div>
    {timeline.length > 0 && <section className="delivery-captions" aria-label="随播放滚动的角色字幕" aria-live="polite">
      <header><span>Playback Script / 播放字幕</span><strong>{activeIndex >= 0 ? `${activeIndex + 1} / ${timeline.length}` : timeline.length}</strong></header>
      <div className="delivery-caption-scroll">
        {timeline.map((caption, index) => <div key={`${caption.order}-${index}`} ref={(node) => { if (node) captionRefs.current.set(index, node); else captionRefs.current.delete(index); }} className={`delivery-caption${index === activeIndex ? ' delivery-caption-active' : ''}`} aria-current={index === activeIndex ? 'true' : undefined}>
          <span>{caption.speakerName || '角色待定'}</span><p>{caption.text}</p>
        </div>)}
      </div>
    </section>}
  </div>;
}

function ArtifactLink({ label, href }: { label: string; href: string }) {
  const absoluteHref = new URL(href, window.location.origin).href;
  return <Space direction="vertical" size={2}>
    <Space size="small"><Text strong>{label}</Text><Typography.Link href={href} target="_blank" rel="noreferrer">打开链接</Typography.Link></Space>
    <Text code copyable={{ text: absoluteHref }}>{absoluteHref}</Text>
  </Space>;
}

function VoicePreview({ voiceId }: { voiceId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (!voiceId) return <span className="voice-unassigned">未分配音色</span>;
  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    try { if (audio.paused) await audio.play(); else audio.pause(); }
    catch { setFailed(true); }
  };
  return <div className={`voice-preview${failed ? ' voice-preview-failed' : ''}`} onClick={event => event.stopPropagation()}>
    <audio ref={audioRef} src={`/api/voices/${encodeURIComponent(voiceId)}/audio`} preload="metadata" onLoadedMetadata={(event) => { setFailed(false); setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); }} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrent(0); }} onError={() => { setPlaying(false); setFailed(true); }} />
    <button type="button" disabled={failed} onClick={toggle} aria-label={failed ? `音色 ${voiceId} 不可用` : playing ? `暂停音色 ${voiceId}` : `播放音色 ${voiceId}`}>{playing ? <PauseOutlined /> : <CaretRightOutlined />}</button>
    <div className="voice-preview-body"><strong title={voiceId}>{voiceId}</strong><input aria-label={`音色 ${voiceId} 进度`} disabled={failed || !safeDuration} type="range" min={0} max={safeDuration} step={0.05} value={Math.min(current, safeDuration)} onInput={(event) => { const value = Number(event.currentTarget.value); setCurrent(value); if (audioRef.current) audioRef.current.currentTime = value; }} /></div>
    <span>{failed ? '不可用' : `${formatAudioTime(current)} / ${formatAudioTime(safeDuration)}`}</span>
  </div>;
}

function Studio() {
  const { message } = AntApp.useApp();
  const [presets, setPresets] = useState<Presets>();
  const [projects, setProjects] = useState<Array<{ label: string; value: string }>>([]);
  const [projectId, setProjectId] = useState<string>();
  const [project, setProject] = useState<ProjectPayload>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [projectActionsExpanded, setProjectActionsExpanded] = useState(false);
  const [projectActionDragging, setProjectActionDragging] = useState(false);
  const [projectActionFreePosition, setProjectActionFreePosition] = useState<{ left: number; top: number }>();
  const [projectActionDock, setProjectActionDock] = useState<ProjectActionDockPlacement>(() => {
    try { return normalizeProjectActionDockPlacement(JSON.parse(localStorage.getItem(PROJECT_ACTION_DOCK_STORAGE_KEY) || 'null'), window.innerWidth, window.innerHeight); }
    catch { return normalizeProjectActionDockPlacement(undefined, window.innerWidth, window.innerHeight); }
  });
  const projectWorkspaceVisibleRef = useRef(false);
  const projectActionDockRef = useRef<HTMLDivElement>(null);
  const projectActionDragRef = useRef<{ pointerId: number; startX: number; startY: number; originLeft: number; originTop: number; width: number; height: number } | null>(null);
  const projectActionDragAbortRef = useRef<AbortController | null>(null);
  const projectActionDragMovedRef = useRef(false);
  const [render, setRender] = useState<RenderInfo>({ available: false });
  const [job, setJob] = useState<{ id: string; kind: 'analyze' | 'voice' | 'render'; projectId: string; phase: string; fraction: number; message: string }>();
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth>();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContentType, setNewContentType] = useState('novel');
  const [activeTab, setActiveTab] = useState('source');
  const [roleEditorIndex, setRoleEditorIndex] = useState<number>();
  const [roleDraft, setRoleDraft] = useState<RoleRow>();
  const [roleAssetDraft, setRoleAssetDraft] = useState<CharacterAsset>();
  const [profileGenerating, setProfileGenerating] = useState(false);
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiMediaSettings, setAiMediaSettings] = useState<AiMediaSettings>();
  const [settingsDraft, setSettingsDraft] = useState({ endpoint: '', apiKey: '', textModel: 'gemini-2.5-pro', directorProvider: 'ollama' as 'ollama' | 'compatible', directorModel: 'qwen3:8b', ollamaEndpoint: 'http://127.0.0.1:11434', directorMaxChunkChars: 1400, imageModel: 'gpt-image-1', instanceId: '', textApi: 'chat_completions' as 'responses' | 'chat_completions', allowInsecureHttp: false, clearApiKey: false });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [directorTesting, setDirectorTesting] = useState(false);
  const [availableAiModels, setAvailableAiModels] = useState<string[]>([]);
  const [availableDirectorModels, setAvailableDirectorModels] = useState<string[]>([]);
  const [activeRoleId, setActiveRoleId] = useState<string>();
  const [selectedSegmentOrders, setSelectedSegmentOrders] = useState<number[]>([]);
  const [segmentPage, setSegmentPage] = useState(1);
  const [segmentPageSize, setSegmentPageSize] = useState(20);
  const [splitEditor, setSplitEditor] = useState<{ order: number; offset: number }>();
  const splitSourceRef = useRef<HTMLTextAreaElement>(null);
  const jobRunning = Boolean(job && !['complete', 'error'].includes(job.phase));
  const jobPercent = Math.round((job?.fraction ?? 0) * 100);
  const jobLabels = { analyze: 'AI 文本导演', voice: '角色音色生成', render: '完整音频渲染' };

  useEffect(() => {
    Promise.all([api.presets(), api.projects(), api.activeJob(), api.health(), api.aiMediaSettings()]).then(([p, list, active, health, mediaSettings]) => {
      setPresets(p); setProjects(list); setRuntimeHealth(health); setAiMediaSettings(mediaSettings);
      setSettingsDraft({ endpoint: mediaSettings.endpoint, apiKey: '', textModel: mediaSettings.textModel, directorProvider: mediaSettings.directorProvider, directorModel: mediaSettings.directorModel, ollamaEndpoint: mediaSettings.ollamaEndpoint, directorMaxChunkChars: mediaSettings.directorMaxChunkChars, imageModel: mediaSettings.imageModel, instanceId: mediaSettings.instanceId, textApi: mediaSettings.textApi, allowInsecureHttp: mediaSettings.allowInsecureHttp, clearApiKey: false });
      if (active.available && active.jobId && active.kind && active.projectId) {
        setProjectId(active.projectId);
        setJob({ id: active.jobId, kind: active.kind, projectId: active.projectId, phase: active.phase || 'queued', fraction: active.fraction || 0, message: active.message || '正在恢复任务状态' });
      } else if (list[0]) setProjectId(list[0].value);
    }).catch((error) => message.error(error.message));
  }, [message]);

  useEffect(() => {
    if (!projectId) return;
    setSelectedSegmentOrders([]);
    setSegmentPage(1);
    setSplitEditor(undefined);
    Promise.all([api.project(projectId), api.latestRender(projectId)]).then(([data, latest]) => {
      setProject(data); setRender(latest); setDirty(false);
    }).catch((error) => message.error(error.message));
  }, [projectId, message]);

  useEffect(() => {
    if (!dirty) return;
    const warnUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnUnsavedChanges);
  }, [dirty]);

  useEffect(() => {
    if (!splitEditor) return;
    window.requestAnimationFrame(() => {
      splitSourceRef.current?.focus();
      splitSourceRef.current?.setSelectionRange(splitEditor.offset, splitEditor.offset);
    });
  }, [splitEditor?.order, splitEditor?.offset]);

  useEffect(() => {
    setActiveRoleId(current => normalizeActiveRoleId(project?.roles ?? [], current));
  }, [project?.project_id, project?.roles]);

  useEffect(() => {
    setSegmentPage(current => clampSegmentPage(current, project?.segments.length ?? 0, segmentPageSize));
  }, [project?.segments.length, segmentPageSize]);

  useEffect(() => {
    if (!job || ['complete', 'error'].includes(job.phase)) return;
    let cancelled = false;
    let timer: number | undefined;
    const stopPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const poll = async () => {
      try {
        const status = await api.job(job.id);
        if (cancelled) return;
        setJob(current => current?.id === job.id ? { ...current, ...status } : current);
        if (status.phase === 'complete' || status.phase === 'error') {
          stopPolling();
          if (status.phase === 'complete') {
            const [updated, latest, health] = await Promise.all([api.project(job.projectId), api.latestRender(job.projectId), api.health()]);
            if (!cancelled) {
              setProject(updated); setRender(latest); setRuntimeHealth(health); setDirty(false); message.success(status.message);
              setSelectedSegmentOrders([]); setSplitEditor(undefined);
            }
          } else message.error(status.message);
        }
      } catch (error) {
        if (!cancelled) {
          stopPolling();
          setJob(current => current?.id === job.id ? { ...current, phase: 'error', fraction: 1, message: (error as Error).message } : current);
          message.error((error as Error).message);
        }
      }
    };
    void poll();
    timer = window.setInterval(poll, 1000);
    return () => { cancelled = true; stopPolling(); };
  }, [job?.id, message]);

  useEffect(() => {
    let frame = 0;
    const updateHeroDepth = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const hero = document.querySelector<HTMLElement>('.hero-section');
        if (!hero) return;
        const progress = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight * 0.82)));
        hero.style.setProperty('--hero-blur', `${(progress * 20).toFixed(2)}px`);
        hero.style.setProperty('--hero-content-blur', `${(progress * 5).toFixed(2)}px`);
        hero.style.setProperty('--hero-content-opacity', String(1 - progress * 0.72));
        hero.style.setProperty('--hero-brightness', String(1 - progress * 0.38));
        hero.style.setProperty('--hero-scale', String(1.02 + progress * 0.055));
        hero.dataset.depth = progress.toFixed(3);
        document.body.classList.toggle('workbench-active', progress > 0.9);
      });
    };
    updateHeroDepth();
    window.addEventListener('scroll', updateHeroDepth, { passive: true });
    window.addEventListener('resize', updateHeroDepth);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateHeroDepth);
      window.removeEventListener('resize', updateHeroDepth);
      document.body.classList.remove('workbench-active');
    };
  }, []);

  useEffect(() => {
    const section = document.getElementById('project');
    if (!section) return;
    const updateVisibility = (revealFromScroll = false) => {
      const workspaceVisible = isProjectWorkspaceVisible(section.getBoundingClientRect(), window.innerHeight);
      const wasWorkspaceVisible = projectWorkspaceVisibleRef.current;
      projectWorkspaceVisibleRef.current = workspaceVisible;
      setProjectActionsExpanded(expanded => revealFromScroll && workspaceVisible ? true : nextProjectActionsExpanded(wasWorkspaceVisible, workspaceVisible, expanded));
    };
    updateVisibility();
    const revealOnScroll = () => updateVisibility(true);
    const updateOnResize = () => updateVisibility(false);
    window.addEventListener('scroll', revealOnScroll, { passive: true });
    window.addEventListener('resize', updateOnResize);
    return () => {
      window.removeEventListener('scroll', revealOnScroll);
      window.removeEventListener('resize', updateOnResize);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PROJECT_ACTION_DOCK_STORAGE_KEY, JSON.stringify(projectActionDock)); }
    catch { /* Local persistence is optional. */ }
  }, [projectActionDock]);

  useEffect(() => () => projectActionDragAbortRef.current?.abort(), []);

  useEffect(() => {
    let frame = 0;
    const clampToViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const dock = projectActionDockRef.current;
        if (!dock || projectActionDragging) return;
        const rect = dock.getBoundingClientRect();
        setProjectActionDock(current => clampProjectActionDockPlacement(current, window.innerWidth, window.innerHeight, rect.width, rect.height));
      });
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', clampToViewport);
    };
  }, [project, projectActionsExpanded, projectActionDragging]);

  useEffect(() => {
    if (!project || !projectActionsExpanded || projectActionDragging) return;
    let timer = window.setTimeout(() => setProjectActionsExpanded(false), PROJECT_ACTION_IDLE_COLLAPSE_MS);
    const restartTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setProjectActionsExpanded(false), PROJECT_ACTION_IDLE_COLLAPSE_MS);
    };
    window.addEventListener('pointerdown', restartTimer, { passive: true });
    window.addEventListener('keydown', restartTimer);
    window.addEventListener('scroll', restartTimer, { passive: true });
    window.addEventListener('resize', restartTimer);
    document.addEventListener('visibilitychange', restartTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', restartTimer);
      window.removeEventListener('keydown', restartTimer);
      window.removeEventListener('scroll', restartTimer);
      window.removeEventListener('resize', restartTimer);
      document.removeEventListener('visibilitychange', restartTimer);
    };
  }, [project, projectActionsExpanded, projectActionDragging, activeTab]);

  useEffect(() => {
    const containSelectWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const dropdown = target?.closest('.ant-select-dropdown');
      if (!dropdown) return;
      const holder = dropdown.querySelector<HTMLElement>('.ant-select-dropdown-list-holder, .rc-virtual-list-holder');
      if (!holder) return;
      const atTop = holder.scrollTop <= 0;
      const atBottom = holder.scrollTop >= holder.scrollHeight - holder.clientHeight - 1;
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault();
      event.stopPropagation();
    };
    const syncSelectPageLock = () => {
      const open = Boolean(document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'));
      document.documentElement.classList.toggle('select-popup-open', open);
    };
    const observer = new MutationObserver(syncSelectPageLock);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('wheel', containSelectWheel, { passive: false });
    syncSelectPageLock();
    return () => {
      document.removeEventListener('wheel', containSelectWheel);
      observer.disconnect();
      document.documentElement.classList.remove('select-popup-open');
    };
  }, []);

  useEffect(() => {
    const containSegmentTableWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const scroller = target?.closest<HTMLElement>('.segment-table .ant-table-body');
      if (!scroller) return;
      const axis = dominantWheelAxis(event.deltaX, event.deltaY);
      const delta = axis === 'horizontal' ? event.deltaX : event.deltaY;
      const position = axis === 'horizontal' ? scroller.scrollLeft : scroller.scrollTop;
      const maximum = axis === 'horizontal'
        ? scroller.scrollWidth - scroller.clientWidth
        : scroller.scrollHeight - scroller.clientHeight;
      if (shouldPreventScrollChain(delta, position, maximum)) event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('wheel', containSegmentTableWheel, { passive: false });
    return () => document.removeEventListener('wheel', containSegmentTableWheel);
  }, []);

  const setSegment = (order: number, column: number, value: string | number) => {
    if (jobRunning) return;
    setDirty(true);
    setProject((current) => {
      if (!current) return current;
      const segments = updateSegmentByOrder(current.segments, current.roles, order, column, value);
      if (segments === current.segments) return current;
      return { ...current, segments };
    });
  };

  const mergeSelected = () => {
    if (!project || jobRunning) return;
    try {
      const segments = mergeAdjacentSegments(project.segments, selectedSegmentOrders);
      setProject({ ...project, segments });
      setSelectedSegmentOrders([]);
      setDirty(true);
      message.success('所选相邻分句已合并，请检查角色与导演参数后保存');
    } catch (error) { message.error((error as Error).message); }
  };

  const openSplitEditor = () => {
    if (!project || selectedSegmentOrders.length !== 1 || jobRunning) return;
    const row = project.segments.find(item => item[0] === selectedSegmentOrders[0]);
    if (!row) { message.error('所选分句已变化，请重新选择'); return; }
    setSplitEditor({ order: row[0], offset: suggestSplitOffset(String(row[5])) });
  };

  const applySplit = () => {
    if (!project || !splitEditor || jobRunning) return;
    try {
      const segments = splitSegmentAtOffset(project.segments, splitEditor.order, splitEditor.offset);
      setProject({ ...project, segments });
      setSelectedSegmentOrders([]);
      setSplitEditor(undefined);
      setDirty(true);
      message.success('分句已拆成两条，合成文本可继续逐条调整');
    } catch (error) { message.error((error as Error).message); }
  };

  const patchProject = <K extends keyof ProjectPayload>(key: K, value: ProjectPayload[K]) => {
    if (jobRunning) return;
    setProject(current => current ? { ...current, [key]: value } : current);
    setDirty(true);
  };

  const createProject = async () => {
    if (jobRunning) return;
    try {
      const created = await api.createProject(newTitle, newContentType);
      const list = await api.projects();
      setProjects(list); setProjectId(created.project_id); setCreateOpen(false); setNewTitle('');
      message.success('新工程已经建立，请粘贴全文并保存');
    } catch (error) { message.error((error as Error).message); }
  };

  const deleteProject = async () => {
    if (!project || jobRunning) return;
    setDeletingProject(true);
    try {
      const deletedId = project.project_id;
      await api.deleteProject(deletedId);
      const list = await api.projects();
      const nextProjectId = list[0]?.value;
      setProjects(list);
      setProjectId(nextProjectId);
      setDirty(false);
      setSelectedSegmentOrders([]);
      setSplitEditor(undefined);
      if (!nextProjectId) {
        setProject(undefined);
        setRender({ available: false });
      }
      message.success(`工程“${project.title}”已删除`);
    } catch (error) { message.error((error as Error).message); }
    finally { setDeletingProject(false); }
  };

  const addRole = () => {
    if (!project || jobRunning) return;
    let suffix = project.roles.length + 1;
    while (project.roles.some(row => row[0] === `role-${suffix}`)) suffix += 1;
    const newRole: RoleRow = [`role-${suffix}`, '新角色', 'character', '新补充的独立说话人物。请根据原文补充身份、年龄阶段、人物关系、性格、经历和叙事作用。', '中性清晰', '', '自然叙述', '是'];
    const newAsset = normalizeCharacterAsset(newRole);
    setProject({ ...project, roles: [...project.roles, newRole], character_assets: { ...project.character_assets, [newRole[0]]: newAsset } });
    setDirty(true);
    setActiveRoleId(newRole[0]);
    setRoleEditorIndex(project.roles.length);
    setRoleDraft([...newRole]);
    setRoleAssetDraft(newAsset);
  };

  const openRoleEditor = (index: number) => {
    if (!project) return;
    setActiveRoleId(project.roles[index][0]);
    setRoleEditorIndex(index);
    setRoleDraft([...project.roles[index]]);
    setRoleAssetDraft(normalizeCharacterAsset(project.roles[index], project.character_assets?.[project.roles[index][0]]));
  };

  const updateRoleDraft = (column: number, value: string) => setRoleDraft(current => current?.map((cell, index) => index === column ? value : ([1, 2, 3, 4, 6].includes(column) && index === 7 ? '是' : cell)) as RoleRow);

  const updateRoleDemographics = (gender: CharacterGender, age: number) => {
    setRoleAssetDraft(current => current ? updateAssetDemographics(current, gender, age) : current);
    updateRoleDraft(7, '是');
  };

  const updateVoiceTrait = (key: Exclude<keyof VoiceTraits, 'accent'>, value: number) => {
    setRoleAssetDraft(current => current ? { ...current, voice_traits: { ...current.voice_traits, [key]: value } } : current);
    updateRoleDraft(7, '是');
  };

  const updateVoiceGenerationPreset = (preset: VoiceGenerationPreset) => {
    setRoleAssetDraft(current => current ? { ...current, voice_generation: applyVoiceGenerationPreset(current.voice_generation, preset) } : current);
    updateRoleDraft(7, '是');
  };

  const updateVoiceGeneration = (patch: Partial<CharacterAsset['voice_generation']>) => {
    setRoleAssetDraft(current => current ? { ...current, voice_generation: { ...current.voice_generation, ...patch, preset: 'custom' } } : current);
    updateRoleDraft(7, '是');
  };

  const selectVoiceCandidate = (voiceId: string) => {
    updateRoleDraft(5, voiceId);
    updateRoleDraft(7, '否');
    setRoleAssetDraft(current => current ? { ...current, voice_candidates: current.voice_candidates?.map(candidate => ({ ...candidate, selected: candidate.voice_id === voiceId })) } : current);
  };

  const expandCharacterProfile = async () => {
    if (!project || !roleDraft || !roleAssetDraft || jobRunning) return;
    setProfileGenerating(true);
    try {
      const result = await api.expandCharacterProfile(project.project_id, roleDraft[0], { name: roleDraft[1], profile: roleDraft[3], gender: roleAssetDraft.gender, age: roleAssetDraft.age });
      updateRoleDraft(3, result.profile);
      setRoleAssetDraft(current => current ? { ...current, profile_updated_by: result.model } : current);
      message.success(`人物小传已由 ${result.model} 扩写，请核对后应用角色设置`);
    } catch (error) { message.error((error as Error).message); }
    finally { setProfileGenerating(false); }
  };

  const generateCharacterPortrait = async () => {
    if (!project || !roleDraft || !roleAssetDraft || jobRunning) return;
    setPortraitGenerating(true);
    try {
      const result = await api.generateCharacterPortrait(project.project_id, roleDraft[0], { name: roleDraft[1], profile: roleDraft[3], gender: roleAssetDraft.gender, age: roleAssetDraft.age, portraitStyle: roleAssetDraft.portrait_style, portraitPrompt: roleAssetDraft.portrait_notes });
      setRoleAssetDraft(current => current ? { ...current, portrait_url: result.portraitUrl, portrait_prompt: result.portraitPrompt, portrait_style: result.portraitStyle } : current);
      message.success(`角色形象已由 ${result.model} 生成，请应用角色设置并保存工程`);
    } catch (error) { message.error((error as Error).message); }
    finally { setPortraitGenerating(false); }
  };

  const saveAiMediaSettings = async () => {
    setSettingsSaving(true);
    try {
      const saved = await api.saveAiMediaSettings(settingsDraft);
      setAiMediaSettings(saved);
      setSettingsDraft({ endpoint: saved.endpoint, apiKey: '', textModel: saved.textModel, directorProvider: saved.directorProvider, directorModel: saved.directorModel, ollamaEndpoint: saved.ollamaEndpoint, directorMaxChunkChars: saved.directorMaxChunkChars, imageModel: saved.imageModel, instanceId: saved.instanceId, textApi: saved.textApi, allowInsecureHttp: saved.allowInsecureHttp, clearApiKey: false });
      setSettingsOpen(false);
      message.success('全局 AI 设置已保存在本机运行目录');
    } catch (error) { message.error((error as Error).message); }
    finally { setSettingsSaving(false); }
  };

  const testAiMediaSettings = async () => {
    setSettingsTesting(true);
    try {
      const result = await api.testAiMediaSettings({ endpoint: settingsDraft.endpoint, apiKey: settingsDraft.apiKey || undefined, instanceId: settingsDraft.instanceId, allowInsecureHttp: settingsDraft.allowInsecureHttp });
      setAvailableAiModels(result.models);
      const missing = [settingsDraft.textModel, settingsDraft.imageModel].filter(model => model && !result.models.includes(model));
      if (missing.length) message.warning(`连接成功，已加载 ${result.modelCount} 个模型。当前选择不在可用列表：${missing.join('、')}`);
      else message.success(`连接成功，已加载 ${result.modelCount} 个可用模型`);
    } catch (error) { setAvailableAiModels([]); message.error((error as Error).message); }
    finally { setSettingsTesting(false); }
  };

  const testDirectorSettings = async () => {
    setDirectorTesting(true);
    try {
      const result = await api.testDirectorSettings({ directorProvider: settingsDraft.directorProvider, ollamaEndpoint: settingsDraft.ollamaEndpoint, endpoint: settingsDraft.endpoint, apiKey: settingsDraft.apiKey || undefined, instanceId: settingsDraft.instanceId, allowInsecureHttp: settingsDraft.allowInsecureHttp });
      setAvailableDirectorModels(result.models);
      if (settingsDraft.directorModel && !result.models.includes(settingsDraft.directorModel)) message.warning(`全文分析服务已连接。当前模型 ${settingsDraft.directorModel} 不在可用列表中`);
      else message.success(`全文分析服务已连接，加载了 ${result.modelCount} 个模型`);
    } catch (error) { setAvailableDirectorModels([]); message.error((error as Error).message); }
    finally { setDirectorTesting(false); }
  };

  const applyRoleDraft = () => {
    if (!project || roleEditorIndex === undefined || !roleDraft || !roleAssetDraft || jobRunning) return;
    if (!roleDraft[1].trim()) { message.error('请填写角色名称'); return; }
    if (roleDraft[3].trim().length < 20) { message.error('人物小传至少填写 20 个字符，并说明身份、关系或性格'); return; }
    if (!roleDraft[4].trim()) { message.error('请选择音色预设或填写声音导演提示'); return; }
    const roles = project.roles.map((row, index) => index === roleEditorIndex ? roleDraft : row);
    setProject({ ...project, roles, character_assets: { ...project.character_assets, [roleDraft[0]]: roleAssetDraft } });
    setDirty(true);
    setRoleEditorIndex(undefined); setRoleDraft(undefined); setRoleAssetDraft(undefined);
    message.success('角色资产与声音方案已应用，请保存工程后生成音色');
  };

  const removeRole = (roleId: string) => {
    if (!project || jobRunning) return;
    try {
      const result = deleteProjectRole(project, roleId);
      setProject(result.project);
      setDirty(true);
      setActiveRoleId(current => normalizeActiveRoleId(result.project.roles, current));
      message.success(result.reassignedSegments ? `已删除角色“${result.removedRoleName}”，${result.reassignedSegments} 条分句已重分配到旁白，请保存工程` : `已删除角色“${result.removedRoleName}”，请保存工程`);
    } catch (error) { message.error((error as Error).message); }
  };

  const updateScene = (sceneId: string, field: string, value: string | string[]) => {
    if (!project || jobRunning) return;
    const document = { ...(project.document ?? {}) };
    const scenes = (Array.isArray(document.scenes) ? document.scenes : []).map(item => {
      const scene = item as Record<string, unknown>;
      return String(scene.id || '') === sceneId ? { ...scene, [field]: value } : item;
    });
    setProject({ ...project, document: { ...document, scenes } });
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!project || jobRunning) return false;
    setSaving(true);
    try { setProject(await api.save(project)); setDirty(false); message.success('全部修改已保存到工程文件'); return true; }
    catch (error) { message.error((error as Error).message); return false; }
    finally { setSaving(false); }
  };

  const runJob = async (kind: 'analyze' | 'voice' | 'render') => {
    if (!project) return;
    if (dirty && !(await save())) return;
    let started: { jobId: string };
    try { started = await api[kind](project.project_id); }
    catch (error) { message.error((error as Error).message); return; }
    setJob({ id: started.jobId, kind, projectId: project.project_id, phase: 'queued', fraction: 0, message: '任务已进入队列' });
  };

  const runSpecialRender = async (request: () => Promise<{ jobId: string }>, queuedMessage: string) => {
    if (!project) return;
    if (dirty && !(await save())) return;
    try {
      const started = await request();
      setJob({ id: started.jobId, kind: 'render', projectId: project.project_id, phase: 'queued', fraction: 0, message: queuedMessage });
    } catch (error) { message.error((error as Error).message); }
  };

  const regenerateSegment = (order: number) => {
    if (!project) return;
    void runSpecialRender(() => api.regenerateSegment(project.project_id, order), `分句 ${order} 已进入重新生成队列，纠音表与当前合成文字将一并应用`);
  };

  const assembleExistingFragments = () => {
    if (!project) return;
    void runSpecialRender(() => api.assemble(project.project_id), '正在校验全部片断缓存并串接完整音频');
  };

  const deleteLatestRender = async () => {
    if (!project || !render.renderId || jobRunning) return;
    try {
      await api.deleteRender(project.project_id, render.renderId);
      setRender(await api.latestRender(project.project_id));
      message.success('所选完整音频与交付文件已删除');
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const roleOptions = project?.roles.map((row) => ({ label: `${row[1]}  ${row[0]}`, value: row[0] })) ?? [];
  const activeRole = project?.roles.find(row => row[0] === activeRoleId);
  const matchingFragmentCount = countMatchingFragments(render.fragments, project?.segments ?? []);
  const aiModelOptions = useMemo(() => [...new Set([...availableAiModels, settingsDraft.textModel, settingsDraft.imageModel].filter(Boolean))].map(value => ({ value })), [availableAiModels, settingsDraft.textModel, settingsDraft.imageModel]);
  const directorModelOptions = useMemo(() => [...new Set([...availableDirectorModels, settingsDraft.directorModel].filter(Boolean))].map(value => ({ value })), [availableDirectorModels, settingsDraft.directorModel]);
  const textModelUnavailable = Boolean(availableAiModels.length && settingsDraft.textModel && !availableAiModels.includes(settingsDraft.textModel));
  const imageModelUnavailable = Boolean(availableAiModels.length && settingsDraft.imageModel && !availableAiModels.includes(settingsDraft.imageModel));
  const directorModelUnavailable = Boolean(availableDirectorModels.length && settingsDraft.directorModel && !availableDirectorModels.includes(settingsDraft.directorModel));
  const insecurePublicEndpoint = isPublicHttpEndpoint(settingsDraft.endpoint);
  const sceneRows = (Array.isArray(project?.document?.scenes) ? project.document.scenes : []) as Array<Record<string, unknown>>;
  const lowConfidenceSegments = (Array.isArray(project?.document?.segments) ? project.document.segments : []).filter(item => Number((item as Record<string, unknown>).speaker_confidence ?? 1) < 0.7) as Array<Record<string, unknown>>;
  const kindOptions = [
    { value: 'narrator', label: '旁白' }, { value: 'character', label: '人物' }, { value: 'anchor', label: '主播' },
    { value: 'reporter', label: '记者' }, { value: 'interviewee', label: '采访对象' },
  ];
  const roleVoiceMode = roleDraft && presets?.voiceStyles.includes(roleDraft[4]) ? 'preset' : 'custom';
  const voiceConditionPrompt = roleDraft && presets ? (presets.voiceStylePrompts[roleDraft[4]] || roleDraft[4] || '尚未填写声音导演提示') : '';
  const rhythmPrompt = roleDraft && presets ? (presets.rhythmPrompts[roleDraft[6]] || roleDraft[6]) : '';
  const roleKindLabel = roleDraft && presets ? (presets.roleKindLabels[roleDraft[2]] || roleDraft[2]) : '';
  const roleVoiceTitle = roleDraft ? (roleKindLabel === roleDraft[1] ? roleDraft[1] : `${roleKindLabel}${roleDraft[1]}`) : '';
  const guidanceRouting = (project?.document?.guidance_routing ?? {}) as { guidance?: string; model?: string; assignments?: Array<{ clause_index: number; source_text: string; target_role_ids: string[]; target_role_names: string[]; instruction: string; reason: string }> };
  const routingCurrent = Boolean(project && trimSentence(guidanceRouting.guidance || '') === trimSentence(project.guidance));
  const roleGuidanceAssignments = roleDraft && routingCurrent ? (guidanceRouting.assignments || []).filter(item => item.target_role_ids.includes(roleDraft[0])) : [];
  const effectiveGuidance = roleGuidanceAssignments.map(item => trimSentence(item.instruction)).filter(Boolean).join('；');
  const expectedGender = roleAssetDraft?.gender || 'unspecified';
  const genderLabel = expectedGender === 'female' ? '女性' : expectedGender === 'male' ? '男性' : '未指定';
  const genderConstraint = expectedGender === 'female' ? `首要声音身份：必须由约 ${roleAssetDraft?.age} 岁女性自然发声。保持明确女性声线、女性声带质感和女性共鸣。男性声线、中性偏男性声线、男性假声或厚重男性胸腔共鸣均不合格。` : expectedGender === 'male' ? `首要声音身份：必须由约 ${roleAssetDraft?.age} 岁男性自然发声。保持明确男性声线、男性声带质感和男性共鸣。女性声线、中性偏女性声线、女性假声或轻薄女性头腔共鸣均不合格。` : '';
  const genderConfirmation = expectedGender === 'female' ? '最终确认：输出必须保持自然、明确、可听辨的女性声音。' : expectedGender === 'male' ? '最终确认：输出必须保持自然、明确、可听辨的男性声音。' : '';
  const pitchConstraint = roleAssetDraft ? `角色年龄设定：约 ${roleAssetDraft.age} 岁。建议基频区间：${roleAssetDraft.pitch_min_hz} 至 ${roleAssetDraft.pitch_max_hz} Hz；目标基频中位数约 ${roleAssetDraft.pitch_target_hz} Hz，请通过自然的声带厚度、共鸣和发声位置接近目标，不使用电子变调。${ageVoiceConstraint(roleAssetDraft.age)}` : '';
  const finalVoiceInstruction = roleDraft && roleAssetDraft && project && presets ? `${genderConstraint}为${roleVoiceTitle}设计可长期复用的独特声音。作品体裁：${presets.contentTypeLabels[project.content_type] || project.content_type}。本角色有效导演上下文：${effectiveGuidance || '遵循作品体裁并保持角色跨章节一致'}。人物小传：${trimSentence(roleDraft[3]) || '原文身份信息不足，使用自然可信的角色声音'}。声音导演：${trimSentence(voiceConditionPrompt) || '采用与人物身份和作品体裁相符的自然声线'}。${pitchConstraint}${voiceTraitsInstruction(roleAssetDraft.voice_traits)}表达节奏：${trimSentence(rhythmPrompt) || '自然表达，按语义停连'}。吐字清晰，干声，无背景音乐，无环境噪声。${genderConfirmation}` : '';

  const segmentColumns = useMemo<ColumnsType<SegmentRow>>(() => {
    if (!presets) return [];
    return [
      { title: '分句内容与导演参数', key: 'director-row', render: (_v, row) => {
        const fragment = findMatchingFragment(render.fragments, row);
        return <div className="segment-row-layout">
          <div className="segment-row-primary">
            <div className="segment-field segment-order-field"><span>序号</span><strong>{row[0]}</strong></div>
            <div className="segment-field"><span>章节</span><strong>{row[1]}</strong></div>
            <label className="segment-field"><span>角色</span><Select disabled={jobRunning} showSearch value={row[2]} options={roleOptions} onChange={(value) => setSegment(row[0], 2, value)} /></label>
            <label className="segment-field"><span>语言</span><Select disabled={jobRunning} value={row[4]} options={presets.languages.map(value => ({ value, label: value }))} onChange={(value) => setSegment(row[0], 4, value)} /></label>
            <label className="segment-field"><span>态度</span><Select disabled={jobRunning} value={row[7]} options={presets.attitudes.map(value => ({ value, label: value }))} onChange={(value) => setSegment(row[0], 7, value)} /></label>
            <label className="segment-field"><span>情绪</span><Select disabled={jobRunning} value={row[8]} options={presets.emotions.map(value => ({ value, label: value }))} onChange={(value) => setSegment(row[0], 8, value)} /></label>
          </div>
          <div className="segment-row-secondary">
            <div className="segment-field segment-source-field"><span>原文</span><Text>{row[5]}</Text></div>
            <label className="segment-field segment-synthesis-field"><span>合成文本</span><Input.TextArea disabled={jobRunning} autoSize={{ minRows: 1, maxRows: 4 }} value={row[6]} onChange={(event) => setSegment(row[0], 6, event.target.value)} /></label>
            <label className="segment-field"><span>强度</span><InputNumber disabled={jobRunning} min={0} max={1} step={0.05} value={row[9]} onChange={(value) => setSegment(row[0], 9, value ?? 0.5)} /></label>
            <label className="segment-field"><span>句内节奏</span><Select disabled={jobRunning} value={row[10]} options={presets.paces.map(value => ({ value, label: value }))} onChange={(value) => setSegment(row[0], 10, value)} /></label>
            <label className="segment-field"><span>停顿 ms</span><InputNumber disabled={jobRunning} min={0} max={3000} step={50} value={row[11]} onChange={(value) => setSegment(row[0], 11, value ?? 0)} /></label>
            <div className="segment-field segment-fragment-field"><span>已生成片断</span><div className="segment-fragment-cell">{fragment ? <><audio controls preload="metadata" src={fragment.audio} /><Text title={fragment.effectiveText}>{fragment.appliedPronunciations.length ? `已应用纠音：${fragment.appliedPronunciations.join('、')}` : '当前片断未命中纠音规则'}</Text></> : <Text type="secondary">尚无与当前序号对应的片断</Text>}<Button disabled={jobRunning} onClick={() => regenerateSegment(row[0])}>重新生成本分句</Button></div></div>
          </div>
        </div>;
      } },
    ];
  }, [presets, roleOptions, project, jobRunning, render.fragments]);

  const splitRow = splitEditor ? project?.segments.find(row => row[0] === splitEditor.order) : undefined;
  const splitSource = String(splitRow?.[5] ?? '');
  const splitBefore = splitSource.slice(0, splitEditor?.offset ?? 0);
  const splitAfter = splitSource.slice(splitEditor?.offset ?? 0);
  const splitValid = Boolean(splitEditor && splitEditor.offset > 0 && splitEditor.offset < splitSource.length
    && [splitBefore, splitAfter].every(value => /[\p{L}\p{N}]/u.test(value)));

  const pronunciationColumns: ColumnsType<ProjectPayload['pronunciations'][number]> = [
    { title: '固定组合', dataIndex: 'source', width: 220, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, source: e.target.value } : row))} /> },
    { title: '朗读替换', dataIndex: 'replacement', width: 260, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, replacement: e.target.value } : row))} /> },
    { title: '说明', dataIndex: 'note', render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, note: e.target.value } : row))} /> },
    { title: '启用', dataIndex: 'enabled', width: 90, render: (v, _r, i) => <Switch disabled={jobRunning} checked={v} onChange={checked => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, enabled: checked } : row))} /> },
    { title: '操作', width: 80, render: (_v, _r, i) => <Button disabled={jobRunning} type="text" danger icon={<DeleteOutlined />} aria-label={`删除纠音规则 ${i + 1}`} onClick={() => patchProject('pronunciations', project!.pronunciations.filter((_row, x) => x !== i))} /> },
  ];

  const openWorkspace = (key: string) => {
    setActiveTab(key);
    setProjectActionsExpanded(true);
    window.requestAnimationFrame(() => document.getElementById('project')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const beginProjectActionDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('.project-actions-collapse'))) return;
    const dock = projectActionDockRef.current;
    if (!dock) return;
    const rect = dock.getBoundingClientRect();
    const drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originLeft: rect.left, originTop: rect.top, width: rect.width, height: rect.height };
    projectActionDragAbortRef.current?.abort();
    const controller = new AbortController();
    projectActionDragAbortRef.current = controller;
    projectActionDragRef.current = drag;
    projectActionDragMovedRef.current = false;
    setProjectActionFreePosition({ left: rect.left, top: rect.top });
    setProjectActionDragging(true);
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== drag.pointerId) return;
      const deltaX = pointer.clientX - drag.startX;
      const deltaY = pointer.clientY - drag.startY;
      if (Math.hypot(deltaX, deltaY) > 4) projectActionDragMovedRef.current = true;
      const gap = 8;
      setProjectActionFreePosition({
        left: Math.min(window.innerWidth - drag.width - gap, Math.max(gap, drag.originLeft + deltaX)),
        top: Math.min(window.innerHeight - drag.height - gap, Math.max(gap, drag.originTop + deltaY)),
      });
    };
    const finish = (pointer: PointerEvent, commit: boolean) => {
      if (pointer.pointerId !== drag.pointerId) return;
      if (commit) {
        const edge = nearestProjectActionDockEdge(pointer.clientX, pointer.clientY, window.innerWidth, window.innerHeight);
        setProjectActionDock(clampProjectActionDockPlacement(
          { edge, offset: projectActionDockOffset(edge, pointer.clientX, pointer.clientY) },
          window.innerWidth,
          window.innerHeight,
          drag.width,
          drag.height,
        ));
      }
      controller.abort();
      projectActionDragAbortRef.current = null;
      projectActionDragRef.current = null;
      setProjectActionDragging(false);
      setProjectActionFreePosition(undefined);
      window.setTimeout(() => { projectActionDragMovedRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move, { signal: controller.signal });
    window.addEventListener('pointerup', pointer => finish(pointer, true), { signal: controller.signal });
    window.addEventListener('pointercancel', pointer => finish(pointer, false), { signal: controller.signal });
  };

  const projectActionDockStyle: CSSProperties = projectActionDragging && projectActionFreePosition
    ? { left: projectActionFreePosition.left, top: projectActionFreePosition.top, transform: 'none' }
    : projectActionDock.edge === 'left'
      ? { left: 8, top: projectActionDock.offset, transform: 'translateY(-50%)' }
      : projectActionDock.edge === 'right'
        ? { right: 8, top: projectActionDock.offset, transform: 'translateY(-50%)' }
        : projectActionDock.edge === 'top'
          ? { top: 8, left: projectActionDock.offset, transform: 'translateX(-50%)' }
          : { bottom: 8, left: projectActionDock.offset, transform: 'translateX(-50%)' };
  const projectActionDockLabels: Record<ProjectActionDockEdge, string> = { top: '上', right: '右', bottom: '下', left: '左' };
  const projectActionCollapseIcon = projectActionDock.edge === 'left' ? <CaretLeftOutlined /> : projectActionDock.edge === 'right' ? <CaretRightOutlined /> : projectActionDock.edge === 'top' ? <CaretUpOutlined /> : <CaretDownOutlined />;
  const projectActionExpandIcon = projectActionDock.edge === 'left' ? <CaretRightOutlined /> : projectActionDock.edge === 'right' ? <CaretLeftOutlined /> : projectActionDock.edge === 'top' ? <CaretDownOutlined /> : <CaretUpOutlined />;

  return <Layout className="studio-shell">
    <Header className="studio-header">
      <Flex justify="space-between" align="center">
        <div className="brand-lockup"><div className="brand-mark">IV</div><div><Title level={4}>Index Voice Studio</Title><Text>Product Edition {runtimeHealth?.productVersion ?? '1.0.0'}</Text></div></div>
        <nav className="studio-nav" aria-label="工作台功能导航"><button type="button" onClick={() => openWorkspace('source')}>Workspace</button><button type="button" onClick={() => openWorkspace('roles')}>Voices</button><button type="button" onClick={() => openWorkspace('segments')}>Director</button><button type="button" onClick={() => openWorkspace('delivery')}>Delivery</button></nav>
      </Flex>
    </Header>
    <Content className="studio-content">
      <section className="hero-section" id="intro">
        <div className="hero-credit"><span>Built by</span> IndexTTS 2.5 Product Studio</div>
        <div className="hero-grid">
          <div className="hero-heading"><Text className="eyebrow">AI Directed. Built For Stories.</Text><Title>Index<br />Voice</Title><Text className="hero-cn-title">长篇声音作品工程台</Text></div>
          <div className="hero-product-anchor" aria-hidden="true" />
          <div className="hero-copy"><Paragraph>角色音色、分句导演、全篇纠音与交付文件，共同保存在一个可持续制作的声音工程里。</Paragraph><div className="hero-stat"><span>Current Segments</span><strong>{project?.segments.length ?? 0}</strong><small>句</small></div></div>
        </div>
        <div className="hero-info-card"><strong>Designed For<br />Long-Form<br />Voice Production.</strong><div /><p>从文字导演到分角色声音交付，让每一部作品保持连续、一致、可复用。</p></div>
        <div className="hero-serial">Index Voice 01 / 2026</div>
        <a className="scroll-cue" href="#project">Scroll To Continue</a>
      </section>
      {project && <div ref={projectActionDockRef} className={`project-actions-dock project-actions-dock-${projectActionDock.edge} ${projectActionsExpanded ? 'is-expanded' : 'is-collapsed'}${projectActionDragging ? ' is-dragging' : ''}`} style={projectActionDockStyle} data-dock-edge={projectActionDock.edge}>
        {projectActionsExpanded ? <aside className="project-actions-float" aria-label={`项目生成操作，停靠在${projectActionDockLabels[projectActionDock.edge]}侧`}>
          <div className="project-actions-head" title="拖动到任意边缘停靠" onPointerDown={beginProjectActionDrag}>
            <span><DragOutlined /> Project Actions / 项目操作</span>
            <button type="button" className="project-actions-collapse" aria-label="收缩项目操作" title={`收缩到${projectActionDockLabels[projectActionDock.edge]}侧边缘`} onPointerDown={event => event.stopPropagation()} onClick={() => setProjectActionsExpanded(false)}>{projectActionCollapseIcon}</button>
          </div>
          <small className="project-actions-hint">拖动标题停靠四边 · 10 秒闲置收缩</small>
          <Button disabled={jobRunning || !project.source_text.trim()} onClick={() => runJob('analyze')}>AI 重新分析全文</Button>
          <Button disabled={jobRunning || !project.roles.length} icon={<SoundOutlined />} onClick={() => runJob('voice')}>生成角色音色</Button>
          <Button disabled={jobRunning || !project.segments.length} icon={<AudioOutlined />} onClick={() => runJob('render')}>生成完整音频</Button>
        </aside> : <button type="button" className="project-actions-trigger" aria-label="展开项目操作" title="拖动可停靠，点击展开" onPointerDown={beginProjectActionDrag} onClick={() => { if (!projectActionDragMovedRef.current) setProjectActionsExpanded(true); }}>{projectActionExpandIcon}<SoundOutlined /></button>}
      </div>}
      <section className="project-section" id="project">
      <div className="project-bar">
        <div className="section-label">Project Control / 工程控制</div>
        <Flex gap={16} align="end" wrap>
          <div className="project-select"><Text strong>打开声音工程</Text><Select disabled={jobRunning} showSearch value={projectId} options={projects} onChange={setProjectId} suffixIcon={<FolderOpenOutlined />} /></div>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>全局 AI 设置</Button>
          <Button disabled={jobRunning} icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建工程</Button>
          <Popconfirm disabled={jobRunning || !project} title={`删除工程“${project?.title || ''}”`} description="将永久删除该工程的原文、分析记录、片断缓存、渲染版本和角色形象。永久音色库继续保留。" okText="确认删除工程" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={deleteProject}>
            <Button disabled={jobRunning || !project} loading={deletingProject} danger icon={<DeleteOutlined />}>删除工程</Button>
          </Popconfirm>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={jobRunning || !dirty} onClick={save}>保存当前工程</Button>
          {dirty ? <span className="project-state">有未保存修改，请点击保存</span> : <span className="project-state">所有修改已保存</span>}
          <span className={`model-state${runtimeHealth?.voiceModel.modelLoaded ? ' model-state-hot' : ''}`} title={runtimeHealth?.voiceModel.pid ? `VoiceDesign Runtime PID ${runtimeHealth.voiceModel.pid}` : '首次生成音色时按需加载'}>{runtimeHealth?.voiceModel.modelLoaded ? 'Voice Model Hot / 音色模型已驻留' : 'Voice Model Cold / 首次使用时加载'}</span>
        </Flex>
        {job && !jobRunning && <div className={`job-result job-result-${job.phase}`}><Text>{job.message}</Text></div>}
      </div>
      {job && jobRunning && <aside className="job-progress-float" role="status" aria-live="polite" aria-label={`${jobLabels[job.kind]}进度`}>
        <div className="job-progress-head"><div><span>Processing / 处理中</span><strong>{jobLabels[job.kind]}</strong></div><b>{jobPercent}%</b></div>
        <Progress percent={Math.max(2, jobPercent)} showInfo={false} status="active" strokeLinecap="butt" />
        <div className="job-progress-detail"><Text>{job.message}</Text><Text><LockOutlined /> 当前工程版本已锁定，任务完成后恢复编辑</Text></div>
      </aside>}
      {!project || !presets ? <Card><Progress percent={60} status="active" /><Text>正在载入工程与导演预设</Text></Card> : <>
        <div><Tabs className="workspace-tabs" size="large" activeKey={activeTab} onChange={key => { setActiveTab(key); setProjectActionsExpanded(true); }} items={[
          { key: 'source', label: '全文与体裁', children: <Card title="作品原文与 AI 导演条件"><div className="source-grid"><div><Text strong>作品体裁</Text><Select disabled={jobRunning} value={project.content_type} options={[{ value: 'novel', label: '小说' }, { value: 'news', label: '新闻' }, { value: 'story', label: '故事体' }]} onChange={value => patchProject('content_type', value)} /></div><div><Text strong>导演补充</Text><Input disabled={jobRunning} value={project.guidance} placeholder="例如：冷峻悬疑，旁白克制，人物对白保留地域差异" onChange={event => patchProject('guidance', event.target.value)} /></div></div><Text strong>完整原文</Text><Input.TextArea disabled={jobRunning} className="source-text" value={project.source_text} rows={18} placeholder="在这里粘贴整篇小说、新闻或故事。AI 将按章节、段落和句子进行分轨。" onChange={event => patchProject('source_text', event.target.value)} /><Text type="secondary">{project.source_text.length.toLocaleString()} 字符，{project.chapters?.length ?? 0} 个已保存章节索引</Text></Card> },
          { key: 'scenes', label: `场景分析 ${sceneRows.length}`, children: <Card title="场景连续性与低置信度复核"><Alert type={lowConfidenceSegments.length ? 'warning' : 'success'} showIcon message={lowConfidenceSegments.length ? `${lowConfidenceSegments.length} 条说话人归属需要复核` : '当前没有低于 0.7 的说话人归属'} description="场景数据来自最近一次 AI 全文分析。可在这里修订地点、时间、参与人物、叙事视角和基调；说话人归属请在分句导演表中修改。" />{sceneRows.length ? <div className="scene-card-grid">{sceneRows.map((scene, index) => { const sceneId = String(scene.id || `scene_${index + 1}`); return <Card key={sceneId} size="small" title={`${sceneId} · ${String(scene.location || '未说明')}`}><Space direction="vertical" size="middle" className="scene-fields"><div className="editor-two-column"><label><Text strong>地点</Text><Input disabled={jobRunning} value={String(scene.location || '')} onChange={event => updateScene(sceneId, 'location', event.target.value)} /></label><label><Text strong>时间</Text><Input disabled={jobRunning} value={String(scene.time || '')} onChange={event => updateScene(sceneId, 'time', event.target.value)} /></label></div><label><Text strong>参与人物 ID</Text><Input disabled={jobRunning} value={Array.isArray(scene.participants) ? scene.participants.join('、') : ''} onChange={event => updateScene(sceneId, 'participants', event.target.value.split(/[、,，]/u).map(value => value.trim()).filter(Boolean))} /></label><div className="editor-two-column"><label><Text strong>叙事视角</Text><Input disabled={jobRunning} value={String(scene.narrative_perspective || '')} onChange={event => updateScene(sceneId, 'narrative_perspective', event.target.value)} /></label><label><Text strong>场景基调</Text><Input disabled={jobRunning} value={String(scene.mood || '')} onChange={event => updateScene(sceneId, 'mood', event.target.value)} /></label></div><Text type="secondary">判断证据：{String(scene.evidence || '未记录')}</Text></Space></Card>; })}</div> : <Empty description="当前工程没有场景结构。使用全局 AI 设置选择模型后重新分析全文即可生成。" />}{lowConfidenceSegments.length > 0 && <Card size="small" title="待复核说话人" className="low-confidence-card"><Space wrap>{lowConfidenceSegments.slice(0, 30).map(segment => <Tag key={String(segment.order)} color="orange">第 {String(segment.order)} 句 · {String(segment.speaker_name || '未知')} · {Math.round(Number(segment.speaker_confidence) * 100)}%</Tag>)}</Space></Card>}</Card> },
          { key: 'roles', label: `角色资产 ${project.roles.length}`, children: <Card title="角色资产卡片" extra={<Button disabled={jobRunning} icon={<PlusOutlined />} onClick={addRole}>补充角色</Button>}>
            <Alert type="info" showIcon message="每个人物使用一张独立卡片。打开卡片即可编辑身份、性别、年龄、详细小传、声音特征、目标频率和角色形象。音色仍是可试听、可重新生成的声音样本。" />
            <div className="role-focus-summary" aria-live="polite"><span>Current Character / 当前人物</span><strong>{activeRole ? `${activeRole[1]} · ${activeRole[0]}` : '打开任意角色卡片'}</strong><Text>{activeRole ? '角色卡片集中保存人物设定、视觉资产和声音样本' : '选择后会保持卡片高亮，便于在人物较多时定位'}</Text></div>
            <div className="character-card-grid">
              {project.roles.map((row, index) => {
                const asset = normalizeCharacterAsset(row, project.character_assets?.[row[0]]);
                const referencedSegments = project.segments.filter(segment => segment[2] === row[0]).length;
                const incomplete = String(row[3]).trim().length < 80 || /请.*补充|证据尚不足/.test(String(row[3]));
                const gender = asset.gender === 'female' ? '女性' : asset.gender === 'male' ? '男性' : '性别待定';
                return <Card key={row[0]} hoverable className={`character-card ${roleRowClassName(row[0], activeRoleId)}`} tabIndex={0} aria-selected={row[0] === activeRoleId} onClick={() => { setActiveRoleId(row[0]); openRoleEditor(index); }} onFocus={() => setActiveRoleId(row[0])} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRoleEditor(index); } }}>
                  <div className="character-portrait">{asset.portrait_url ? <img src={asset.portrait_url} alt={`${row[1]}角色形象`} /> : <div className="character-portrait-placeholder"><UserOutlined /><span>尚未生成形象</span></div>}<Tag className="character-id">{row[0]}</Tag></div>
                  <div className="character-card-body"><div className="character-card-title"><div><strong>{row[1]}</strong><Text>{presets.roleKindLabels[row[2]] || row[2]}</Text></div><Tag>{incomplete ? '小传待完善' : '详细小传已建立'}</Tag></div>
                    <Space wrap><Tag>{gender}</Tag><Tag>{asset.age} 岁</Tag><Tag>{asset.pitch_target_hz} Hz 目标</Tag></Space>
                    <Paragraph ellipsis={{ rows: 4 }} title={row[3]}>{row[3]}</Paragraph>
                    <div className="pitch-summary"><span>建议基频</span><strong>{asset.pitch_min_hz} 至 {asset.pitch_max_hz} Hz</strong></div>
                    <VoicePreview voiceId={row[5]} />
                    <div className="character-card-actions"><Button disabled={jobRunning} type="primary" icon={<EditOutlined />} onClick={event => { event.stopPropagation(); openRoleEditor(index); }}>打开角色卡片</Button><span onClick={stopRoleDeleteCardActivation} onKeyDown={stopRoleDeleteCardActivation}><Popconfirm disabled={jobRunning || row[0] === 'narrator'} title={`删除角色“${row[1]}”`} description={referencedSegments ? `该角色当前引用 ${referencedSegments} 条分句。确认后这些分句会重分配到旁白，角色设置和工程内关联会移除。` : '该角色没有分句引用。确认后角色设置和工程内关联会移除。'} okText="确认删除角色" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeRole(row[0])}><Button disabled={jobRunning || row[0] === 'narrator'} type="text" danger icon={<DeleteOutlined />} aria-label={`删除角色 ${row[1]}`} /></Popconfirm></span></div>
                  </div>
                </Card>;
              })}
            </div>
          </Card> },
          { key: 'segments', label: `分句导演 ${project.segments.length}`, children: <Card title="分句、分轨与态度语气"><Alert type="info" showIcon message={`最近交付保存了 ${render.fragments?.length ?? 0} 个片断，其中 ${matchingFragmentCount} 个与当前原文和合成文字一致，已加载到对应分句。编辑后可只重新生成该分句；全篇纠音会在生成时应用。`} /><Alert className="segment-save-state" type={dirty ? 'warning' : 'success'} showIcon message={dirty ? '当前有未保存修改，顶部保存按钮已启用' : '当前分句修改已经保存到工程文件'} /><div className="director-memory-summary"><span>导演操作记忆</span><strong>{project.director_history?.length ?? 0} 次已保存操作</strong><Text>{(project.document?.director_memory_reapply as { applied?: boolean; restored_segments?: number })?.applied ? `最近一次 AI 分析恢复了 ${(project.document?.director_memory_reapply as { restored_segments?: number }).restored_segments ?? 0} 条历史分句` : '再次分析全文时会对齐新旧稿件，恢复可识别的断句、角色和导演参数'}</Text></div><div className="segment-editor-toolbar"><Text>{selectedSegmentOrders.length ? `已选择 ${selectedSegmentOrders.length} 条` : '先勾选需要调整的分句'}</Text><Space wrap><Button disabled={jobRunning || selectedSegmentOrders.length < 2} onClick={mergeSelected}>合并所选</Button><Button disabled={jobRunning || selectedSegmentOrders.length !== 1} onClick={openSplitEditor}>拆分所选</Button><Button type="text" disabled={!selectedSegmentOrders.length} onClick={() => setSelectedSegmentOrders([])}>清除选择</Button></Space></div><Table className="studio-table segment-table" rowKey={(row) => row[0]} rowSelection={{ selectedRowKeys: selectedSegmentOrders, preserveSelectedRowKeys: true, onChange: keys => setSelectedSegmentOrders(keys.map(Number)), getCheckboxProps: () => ({ disabled: jobRunning }) }} columns={segmentColumns} dataSource={project.segments} pagination={{ current: segmentPage, pageSize: segmentPageSize, pageSizeOptions: [...SEGMENT_PAGE_SIZE_OPTIONS], showSizeChanger: { showSearch: false }, showTotal: (total, range) => `第 ${range[0]} 至 ${range[1]} 条，共 ${total} 条`, onChange: (page, pageSize) => { setSegmentPageSize(pageSize); setSegmentPage(clampSegmentPage(page, project.segments.length, pageSize)); } }} scroll={{ y: 560 }} /></Card> },
          { key: 'pronunciation', label: `全篇纠音 ${project.pronunciations.length}`, children: <Card title="全篇固定纠音表" extra={<Button disabled={jobRunning} icon={<PlusOutlined />} onClick={() => patchProject('pronunciations', [...project.pronunciations, { source: '', replacement: '', note: '', enabled: true }])}>新增纠音</Button>}><Alert type="info" showIcon message="较长组合优先，启用后的规则会应用到整篇作品，并在导演清单中保留原文和实际朗读文本。" /><Table className="studio-table" rowKey={(_row, index) => String(index)} columns={pronunciationColumns} dataSource={project.pronunciations} pagination={false} scroll={{ x: 1000 }} /></Card> },
          { key: 'delivery', label: '完整音频与交付', children: <div><Card title="最近一次交付" extra={<Space wrap><Button disabled={jobRunning || !project.segments.length} onClick={assembleExistingFragments}>串接全部已生成片断</Button>{render.available && render.renderId ? <Popconfirm disabled={jobRunning} title="删除这次完整交付" description="将删除本次完整音频、分轨包、章节、角色轨道和导演清单。工程、音色与其他交付记录会保留。" okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={deleteLatestRender}><Button disabled={jobRunning} danger icon={<DeleteOutlined />}>删除本次交付</Button></Popconfirm> : undefined}</Space>}>{render.available ? <Space direction="vertical" size="large">{render.stale ? <Alert type="warning" showIcon message="该完整交付已过期" description={`工程在 ${render.staleAt ? new Date(render.staleAt).toLocaleString() : '生成后'} 发生了${render.staleReasons?.join('、') || '分句导演调整'}。文件继续保留，可试听或下载；是否删除由你决定。`} /> : <Alert type="info" showIcon message={`当前交付包含 ${render.fragments?.length ?? 0} 个可复用片断。串接时只读取与当前文字、纠音、音色和导演参数完全匹配的缓存。`} />}<StudioAudio src={render.audio!} captions={render.captions} /><Text type="secondary">交付记录 {render.renderId}{render.stale ? ' · 已过期' : ''}</Text><Space wrap><Button icon={<AudioOutlined />} href={render.audio} download>下载 WAV</Button><Button icon={<AudioOutlined />} href={render.mp3} download>下载 MP3</Button><Button href={render.package} download>下载分轨包</Button><Button href={render.manifest} download>下载导演清单</Button></Space><Text type="secondary">MP3 会在下载时由当前 WAV 实时编码为 160 kbps，不额外占用交付存储。</Text><Card size="small" title="成果物链接"><Space direction="vertical" size="middle"><ArtifactLink label="完整音频 WAV" href={render.audio!} /><ArtifactLink label="完整音频 MP3（实时编码）" href={render.mp3!} /><ArtifactLink label="分轨交付包 ZIP" href={render.package!} /><ArtifactLink label="导演清单 JSON" href={render.manifest!} /></Space></Card></Space> : <Empty description="该工程还没有交付文件。可先生成单个分句，片断齐全后再串接。" />}</Card></div> },
        ]} /></div>
      </>}
      <Modal width={760} title="全局 AI 设置" open={settingsOpen} okText="保存全局设置" cancelText="取消" confirmLoading={settingsSaving} onOk={saveAiMediaSettings} onCancel={() => setSettingsOpen(false)}>
        <Space direction="vertical" size="large" className="modal-fields ai-media-settings">
          <Alert type="warning" showIcon message="全局作用范围与外部传输" description="这里统一控制全文分析、人物小传和角色图像。全文分析选择兼容 Endpoint 时会发送当前工程原文；人物小传只发送角色附近证据；角色图像只发送人物设定。API Key 只保存在本机 runtime-output，不写入工程、Git 或浏览器回读内容。" />
          <div className="editor-section-heading"><span>01 / Director</span><strong>全文分句导演</strong><Text>选择本地 Ollama 或已配置的兼容 Endpoint。所有工程共用该选择。</Text></div>
          <div className="editor-two-column"><label><Text strong>全文分析 Provider</Text><Select value={settingsDraft.directorProvider} options={[{ value: 'ollama', label: '本地 Ollama' }, { value: 'compatible', label: 'OpenAI 兼容 Endpoint' }]} onChange={value => { setSettingsDraft(current => ({ ...current, directorProvider: value })); setAvailableDirectorModels([]); }} /></label><label><Text strong>Ollama Endpoint</Text><Input disabled={settingsDraft.directorProvider !== 'ollama'} value={settingsDraft.ollamaEndpoint} onChange={event => setSettingsDraft(current => ({ ...current, ollamaEndpoint: event.target.value }))} /></label></div>
          <div className="editor-two-column"><label><Text strong>全文分析模型</Text><AutoComplete status={directorModelUnavailable ? 'warning' : undefined} value={settingsDraft.directorModel} options={directorModelOptions} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} onChange={value => setSettingsDraft(current => ({ ...current, directorModel: value }))} placeholder="测试服务后选择模型" /></label><label><Text strong>分析块长度</Text><InputNumber min={320} max={12000} step={100} value={settingsDraft.directorMaxChunkChars} onChange={value => setSettingsDraft(current => ({ ...current, directorMaxChunkChars: value ?? 1400 }))} addonAfter="字符" /></label></div>
          <Button icon={<ReloadOutlined />} loading={directorTesting} onClick={testDirectorSettings}>测试全文分析服务并加载模型</Button>
          {availableDirectorModels.length > 0 && <Alert type={directorModelUnavailable ? 'warning' : 'success'} showIcon message={`全文分析服务返回 ${availableDirectorModels.length} 个模型`} description={directorModelUnavailable ? '当前全文分析模型不在服务返回列表中，请重新选择。' : `当前使用 ${settingsDraft.directorModel}`} />}
          <div className="editor-section-heading"><span>02 / Compatible Endpoint</span><strong>人物小传与角色图像</strong><Text>兼容 Endpoint 也可供全文分析使用。模型列表与调用能力来自当前服务。</Text></div>
          <label><Text strong>OpenAI 兼容 Endpoint</Text><Input value={settingsDraft.endpoint} onChange={event => setSettingsDraft(current => ({ ...current, endpoint: event.target.value, allowInsecureHttp: isPublicHttpEndpoint(event.target.value) ? current.allowInsecureHttp : false }))} placeholder="例如：http://127.0.0.1:39452/v1" /></label>
          {insecurePublicEndpoint && <Alert type="error" showIcon message="公网 HTTP 会明文传输 Bearer Key" description="推荐先为远端节点配置有效 TLS。启用下方风险开关后才允许测试连接、扩写人物小传或生成图像。" />}
          <label><Text strong>API Key</Text><Input.Password value={settingsDraft.apiKey} onChange={event => setSettingsDraft(current => ({ ...current, apiKey: event.target.value, clearApiKey: false }))} placeholder={aiMediaSettings?.hasApiKey ? '已保存，留空表示继续使用当前 Key' : '填写兼容服务 API Key'} /></label>
          {aiMediaSettings?.hasApiKey && <label className="clear-key-control"><Switch checked={settingsDraft.clearApiKey} onChange={checked => setSettingsDraft(current => ({ ...current, clearApiKey: checked, apiKey: '' }))} /><Text>清除当前保存的 API Key</Text></label>}
          {insecurePublicEndpoint && <label className="clear-key-control"><Switch checked={settingsDraft.allowInsecureHttp} onChange={checked => setSettingsDraft(current => ({ ...current, allowInsecureHttp: checked }))} /><Text>我了解风险，允许通过公网 HTTP 发送当前 API Key</Text></label>}
          <div className="editor-two-column"><label><Text strong>Cockpit Instance ID（可选）</Text><Input value={settingsDraft.instanceId} onChange={event => setSettingsDraft(current => ({ ...current, instanceId: event.target.value }))} placeholder="例如：.codex-gemini-agent" /></label><label><Text strong>兼容文本接口</Text><Select value={settingsDraft.textApi} onChange={value => setSettingsDraft(current => ({ ...current, textApi: value }))} options={[{ value: 'responses', label: 'Responses API · /v1/responses' }, { value: 'chat_completions', label: 'Chat Completions · /v1/chat/completions' }]} /></label></div>
          <Text type="secondary">全文分析选择兼容 Endpoint 时与人物小传共用该文本接口；本地 Ollama 全文分析不受此项影响。</Text>
          <Button icon={<ReloadOutlined />} loading={settingsTesting} onClick={testAiMediaSettings}>测试兼容 Endpoint 并加载模型</Button>
          {availableAiModels.length > 0 && <Alert type={textModelUnavailable || imageModelUnavailable ? 'warning' : 'success'} showIcon message={`已从兼容服务加载 ${availableAiModels.length} 个模型`} description={textModelUnavailable || imageModelUnavailable ? '带警告的当前模型不在服务返回的列表中，请从下拉列表重新选择。' : '人物小传模型和角色图像模型都在当前可用列表中。'} />}
          <div className="editor-two-column"><label><Text strong>人物小传模型</Text><AutoComplete status={textModelUnavailable ? 'warning' : undefined} value={settingsDraft.textModel} options={aiModelOptions} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} onChange={value => setSettingsDraft(current => ({ ...current, textModel: value }))} placeholder="先测试连接，再选择或输入模型" /></label><label><Text strong>角色图像模型</Text><AutoComplete status={imageModelUnavailable ? 'warning' : undefined} value={settingsDraft.imageModel} options={aiModelOptions} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} onChange={value => setSettingsDraft(current => ({ ...current, imageModel: value }))} placeholder="先测试连接，再选择或输入模型" /></label></div>
        </Space>
      </Modal>
      <Modal title="新建声音工程" open={createOpen} okText="建立工程" cancelText="取消" okButtonProps={{ disabled: jobRunning || !newTitle.trim() }} onOk={createProject} onCancel={() => setCreateOpen(false)}><Space direction="vertical" size="large" className="modal-fields"><div><Text strong>工程名称</Text><Input disabled={jobRunning} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="例如：白夜行有声小说" /></div><div><Text strong>作品体裁</Text><Select disabled={jobRunning} value={newContentType} onChange={setNewContentType} options={[{ value: 'novel', label: '小说' }, { value: 'news', label: '新闻' }, { value: 'story', label: '故事体' }]} /></div></Space></Modal>
      <Modal className="split-segment-modal" width={760} title={splitRow ? `拆分第 ${splitRow[0]} 条分句` : '拆分分句'} open={Boolean(splitEditor && splitRow)} okText="在光标处拆分" cancelText="取消" okButtonProps={{ disabled: jobRunning || !splitValid }} onOk={applySplit} onCancel={() => setSplitEditor(undefined)}>
        <Alert type="info" showIcon message="点击原文中的目标位置放置光标。拆分后两条继承当前角色和导演参数，前半句使用 250 ms 短停顿，后半句保留原停顿。" />
        <label className="split-source-field"><Text strong>在原文中选择拆分位置</Text><textarea ref={splitSourceRef} readOnly aria-label="选择分句拆分位置" value={splitSource} onSelect={event => setSplitEditor(current => current ? { ...current, offset: event.currentTarget.selectionStart } : current)} /></label>
        <Text className="split-position">拆分位置 {splitEditor?.offset ?? 0} / {splitSource.length}</Text>
        <div className="split-preview"><section><Text strong>前半句</Text><p>{splitBefore || '尚无可朗读文字'}</p></section><section><Text strong>后半句</Text><p>{splitAfter || '尚无可朗读文字'}</p></section></div>
      </Modal>
      <Modal className="role-editor-modal" width={1120} title={roleDraft ? `${roleDraft[1]} · 角色资产卡片` : '角色资产卡片'} open={roleEditorIndex !== undefined && Boolean(roleDraft)} okText="应用角色设置" cancelText="取消" okButtonProps={{ disabled: jobRunning }} onOk={applyRoleDraft} onCancel={() => { setRoleEditorIndex(undefined); setRoleDraft(undefined); setRoleAssetDraft(undefined); }}>
        {roleDraft && roleAssetDraft && presets && project && <div className="role-editor-grid">
          <section className="role-editor-fields">
            <div className="editor-section-heading"><span>01 / Character</span><strong>人物身份与小传</strong><Text>人物小传来自 AI 全文分析，也是音色选择的主要人物依据。信息必须来自原文，未知内容可以明确标注。</Text></div>
            <div className="editor-two-column"><label><Text strong>角色名称</Text><Input disabled={jobRunning} value={roleDraft[1]} onChange={event => updateRoleDraft(1, event.target.value)} /></label><label><Text strong>角色类型</Text><Select disabled={jobRunning} value={roleDraft[2]} options={kindOptions.filter(item => presets.roleKinds.includes(item.value))} onChange={value => updateRoleDraft(2, value)} /></label></div>
            <div className="editor-two-column"><label><Text strong>性别</Text><Select disabled={jobRunning} value={roleAssetDraft.gender} options={[{ value: 'female', label: '女性' }, { value: 'male', label: '男性' }, { value: 'unspecified', label: '未指定' }]} onChange={(value: CharacterGender) => updateRoleDemographics(value, roleAssetDraft.age)} /></label><label><Text strong>年龄</Text><InputNumber disabled={jobRunning} min={5} max={100} value={roleAssetDraft.age} addonAfter="岁" onChange={value => updateRoleDemographics(roleAssetDraft.gender, value ?? 35)} /></label></div>
            <label><Flex justify="space-between" align="center"><Text strong>详细人物小传</Text><Button disabled={jobRunning} loading={profileGenerating} icon={<UserOutlined />} onClick={expandCharacterProfile}>AI 扩写详细小传</Button></Flex><Input.TextArea disabled={jobRunning} rows={9} value={roleDraft[3]} onChange={event => updateRoleDraft(3, event.target.value)} placeholder="建议覆盖身份、人物关系、外貌线索、经历、欲望与矛盾、性格、行为习惯、说话方式和叙事作用。未知信息应明确标注。" /><small>{roleDraft[3].length} 字符。调用外部模型前会发送该角色附近的稿件证据，请先确认系统配置和数据边界。</small></label>

            <div className="editor-section-heading"><span>02 / Portrait</span><strong>角色形象</strong><Text>角色形象以详细人物小传为主要依据，用于后续插图和视频关键帧中的稳定人物设计。</Text></div>
            <div className="portrait-editor"><div className="portrait-editor-preview">{roleAssetDraft.portrait_url ? <img src={roleAssetDraft.portrait_url} alt={`${roleDraft[1]}角色形象预览`} /> : <div className="character-portrait-placeholder"><PictureOutlined /><span>尚未生成角色形象</span></div>}</div><div className="portrait-editor-controls"><label><Text strong>形象风格</Text><Select disabled={jobRunning} value={roleAssetDraft.portrait_style} options={[{ label: '漫画风格', options: PORTRAIT_STYLE_PRESETS.filter(item => item.kind === 'comic').map(item => ({ value: item.id, label: item.label })) }, { label: '真人效果', options: PORTRAIT_STYLE_PRESETS.filter(item => item.kind === 'realistic').map(item => ({ value: item.id, label: item.label })) }]} onChange={value => setRoleAssetDraft(current => current ? { ...current, portrait_style: value } : current)} /><small>{portraitStylePreset(roleAssetDraft.portrait_style).description} 默认使用漫画风格，选择“真人写实摄影”时才生成真人效果。</small></label><label><Text strong>补充视觉要求（可选）</Text><Input.TextArea disabled={jobRunning} rows={3} value={roleAssetDraft.portrait_notes || ''} onChange={event => setRoleAssetDraft(current => current ? { ...current, portrait_notes: event.target.value } : current)} placeholder="例如：保留旧式礼帽，深灰风衣，眼神克制，背景不要出现建筑。" /></label><Button type="primary" disabled={jobRunning || roleDraft[3].trim().length < 20} loading={portraitGenerating} icon={<PictureOutlined />} onClick={generateCharacterPortrait}>{roleAssetDraft.portrait_url ? '按当前风格重新生成' : '按当前风格生成形象'}</Button><Text>图像请求会使用当前名称、性别、年龄、人物小传、风格特征和补充视觉要求。生成结果先进入当前卡片，应用设置并保存工程后完成关联。</Text>{roleAssetDraft.portrait_prompt && <Paragraph ellipsis={{ rows: 4 }} title={roleAssetDraft.portrait_prompt}>最近图像提示：{roleAssetDraft.portrait_prompt}</Paragraph>}</div></div>

            <div className="editor-section-heading"><span>03 / Voice</span><strong>声音特征与频率目标</strong><Text>性别和年龄会产生建议基频区间。滑块设置目标基频中位数；系统会按当前角色设置生成一至六个候选，并选择最接近目标且通过年龄与性别校验的自然声音。年龄约束同时控制共鸣、声带厚度和明亮度。</Text></div>
            <label><Text strong>音色生成方式</Text><Select disabled={jobRunning} value={roleVoiceMode} options={[{ value: 'preset', label: '使用可靠音色预设' }, { value: 'custom', label: '高级自定义声音导演' }]} onChange={value => updateRoleDraft(4, value === 'preset' ? '中性清晰' : '')} /></label>
            {roleVoiceMode === 'preset' ? <label><Text strong>音色预设</Text><Select disabled={jobRunning} value={roleDraft[4]} options={presets.voiceStyles.map(value => ({ value, label: `${value} · ${presets.voiceStylePrompts[value]}` }))} onChange={value => updateRoleDraft(4, value)} /></label> : <label><Text strong>高级声音导演提示</Text><Input.TextArea disabled={jobRunning} rows={4} value={roleDraft[4]} onChange={event => updateRoleDraft(4, event.target.value)} placeholder="例如：四十岁男性的中低音，胸腔共鸣明显，气息稳定，吐字略慢且边界清楚，基础情绪冷静克制。" /><small>这里写声音特征，人物经历放在上方人物小传中。</small></label>}
            <label className="pitch-control"><Flex justify="space-between"><Text strong>目标基频中位数</Text><Text>{roleAssetDraft.pitch_target_hz} Hz</Text></Flex><Slider disabled={jobRunning} min={roleAssetDraft.pitch_min_hz} max={roleAssetDraft.pitch_max_hz} value={roleAssetDraft.pitch_target_hz} tooltip={{ formatter: value => `${value} Hz` }} onChange={value => { setRoleAssetDraft(current => current ? { ...current, pitch_target_hz: value } : current); updateRoleDraft(7, '是'); }} /><small>{recommendPitchRange(roleAssetDraft.gender, roleAssetDraft.age).label}。靠近下限更低沉，靠近上限更高亮。此值是自然发声目标，最终实测值会随模型生成结果变化。</small></label>
            <div className="voice-trait-panel"><Flex justify="space-between" align="center"><Text strong>结构化声音特征</Text><Tag>转换为 VoiceDesign 指令</Tag></Flex><Text>这些滑块按角色独立保存。年龄变化会载入对应年龄段的建议组合，之后可以逐项微调。</Text><div className="voice-trait-grid">{VOICE_TRAIT_CONTROLS.map(item => <label key={item.key}><Flex justify="space-between"><Text strong>{item.label}</Text><Text>{roleAssetDraft.voice_traits[item.key]}</Text></Flex><Slider disabled={jobRunning} min={0} max={100} value={roleAssetDraft.voice_traits[item.key]} onChange={value => updateVoiceTrait(item.key, value)} /><small>{item.low} 到 {item.high}</small></label>)}</div><label><Text strong>地域或口音要求（可选）</Text><Input disabled={jobRunning} value={roleAssetDraft.voice_traits.accent} maxLength={120} onChange={event => { setRoleAssetDraft(current => current ? { ...current, voice_traits: { ...current.voice_traits, accent: event.target.value } } : current); updateRoleDraft(7, '是'); }} placeholder="例如：轻微关西口音。留空时不添加口音约束。" /></label></div>
            <details className="voice-generation-panel"><summary>生成策略与模型原生高级参数</summary><div className="voice-generation-content"><Alert type="info" showIcon message="原生采样参数逐角色生效" description="稳定、平衡和探索会载入推荐组合。手动修改任一数值后进入高级自定义。Subtalker 参数适用于当前 12Hz tokenizer 配置。" /><label><Text strong>生成策略</Text><Select disabled={jobRunning} value={roleAssetDraft.voice_generation.preset} options={[{ value: 'stable', label: '稳定' }, { value: 'balanced', label: '平衡' }, { value: 'explore', label: '探索' }, { value: 'custom', label: '高级自定义' }]} onChange={updateVoiceGenerationPreset} /></label><div className="generation-number-grid"><label><Text strong>候选数量</Text><InputNumber disabled={jobRunning} min={1} max={6} value={roleAssetDraft.voice_generation.candidate_count} onChange={value => updateVoiceGeneration({ candidate_count: value ?? 3 })} /></label><label><Text strong>随机种子</Text><InputNumber disabled={jobRunning} min={0} max={2147483647} value={roleAssetDraft.voice_generation.seed} onChange={value => updateVoiceGeneration({ seed: value ?? 42 })} /></label><label><Text strong>Temperature</Text><InputNumber disabled={jobRunning} min={0.1} max={2} step={0.05} value={roleAssetDraft.voice_generation.temperature} onChange={value => updateVoiceGeneration({ temperature: value ?? 0.85 })} /></label><label><Text strong>Top K</Text><InputNumber disabled={jobRunning} min={1} max={200} value={roleAssetDraft.voice_generation.top_k} onChange={value => updateVoiceGeneration({ top_k: value ?? 50 })} /></label><label><Text strong>Top P</Text><InputNumber disabled={jobRunning} min={0.05} max={1} step={0.05} value={roleAssetDraft.voice_generation.top_p} onChange={value => updateVoiceGeneration({ top_p: value ?? 0.95 })} /></label><label><Text strong>重复抑制</Text><InputNumber disabled={jobRunning} min={1} max={2} step={0.01} value={roleAssetDraft.voice_generation.repetition_penalty} onChange={value => updateVoiceGeneration({ repetition_penalty: value ?? 1.05 })} /></label><label><Text strong>最大生成 Tokens</Text><InputNumber disabled={jobRunning} min={256} max={8192} step={256} value={roleAssetDraft.voice_generation.max_new_tokens} onChange={value => updateVoiceGeneration({ max_new_tokens: value ?? 2048 })} /></label><label className="switch-field"><Text strong>主采样</Text><Switch disabled={jobRunning} checked={roleAssetDraft.voice_generation.do_sample} onChange={checked => updateVoiceGeneration({ do_sample: checked })} /></label></div><Text strong>Subtalker 采样</Text><div className="generation-number-grid"><label><Text strong>Temperature</Text><InputNumber disabled={jobRunning} min={0.1} max={2} step={0.05} value={roleAssetDraft.voice_generation.subtalker_temperature} onChange={value => updateVoiceGeneration({ subtalker_temperature: value ?? 0.85 })} /></label><label><Text strong>Top K</Text><InputNumber disabled={jobRunning} min={1} max={200} value={roleAssetDraft.voice_generation.subtalker_top_k} onChange={value => updateVoiceGeneration({ subtalker_top_k: value ?? 50 })} /></label><label><Text strong>Top P</Text><InputNumber disabled={jobRunning} min={0.05} max={1} step={0.05} value={roleAssetDraft.voice_generation.subtalker_top_p} onChange={value => updateVoiceGeneration({ subtalker_top_p: value ?? 0.95 })} /></label><label className="switch-field"><Text strong>Subtalker 采样</Text><Switch disabled={jobRunning} checked={roleAssetDraft.voice_generation.subtalker_dosample} onChange={checked => updateVoiceGeneration({ subtalker_dosample: checked })} /></label></div><label><Text strong>角色专属试听文本</Text><Input.TextArea disabled={jobRunning} rows={3} maxLength={500} value={roleAssetDraft.audition_text} onChange={event => { setRoleAssetDraft(current => current ? { ...current, audition_text: event.target.value } : current); updateRoleDraft(7, '是'); }} /><small>建议使用符合角色身份和年龄的自然台词。每个角色可以使用不同文本。</small></label></div></details>
            {Boolean(roleAssetDraft.voice_candidates?.length) && <div className="voice-candidate-panel"><Text strong>最近保留的声音候选</Text><Text>可以逐个试听并采用。采用候选只切换该角色的稳定音色。</Text>{roleAssetDraft.voice_candidates?.map((candidate, index) => <div className="voice-candidate-row" key={candidate.voice_id}><div><Text>候选 {index + 1} · Seed {candidate.seed}{candidate.median_pitch_hz ? ` · ${candidate.median_pitch_hz.toFixed(1)} Hz` : ''} · {candidate.gender_verified ? `${genderLabel}校验通过` : '历史候选待重新校验'}</Text><VoicePreview voiceId={candidate.voice_id} /></div><Button disabled={jobRunning} type={candidate.voice_id === roleDraft[5] ? 'primary' : 'default'} onClick={() => selectVoiceCandidate(candidate.voice_id)}>{candidate.voice_id === roleDraft[5] ? '当前采用' : '采用此候选'}</Button></div>)}</div>}
            <div className="editor-voice-controls"><label><Text strong>角色表达节奏</Text><Select disabled={jobRunning} value={roleDraft[6]} options={presets.rhythms.map(value => ({ value, label: `${value} · ${presets.rhythmPrompts[value]}` }))} onChange={value => updateRoleDraft(6, value)} /></label><label className="regenerate-control"><Text strong>下次生成处理</Text><div><Switch disabled={jobRunning} checked={roleDraft[7] === '是'} onChange={checked => updateRoleDraft(7, checked ? '是' : '否')} /><Text>{roleDraft[7] === '是' ? '重新生成并建立新签名' : '保持当前稳定音色'}</Text></div></label></div>
          </section>
          <aside className="voice-instruction-preview">
            <div className="editor-section-heading"><span>04 / Preview</span><strong>AI 会参考什么</strong><Text>下列内容会组合成声音生成指令。修改人物小传、年龄、性别、目标频率、声音导演或节奏后，请打开重新生成。</Text></div>
            <dl><div><dt>作品体裁</dt><dd>{presets.contentTypeLabels[project.content_type] || project.content_type}</dd></div><div><dt>原始导演补充</dt><dd>{project.guidance || '未填写'}</dd></div><div><dt>AI 语义分配</dt><dd>{routingCurrent ? `${guidanceRouting.model || '本地 AI'} 已把补充分配到明确角色` : project.guidance ? '等待 AI 语义分配；未分配内容不会进入任何音色指令' : '没有需要分配的导演补充'}</dd></div><div><dt>本角色有效补充</dt><dd>{effectiveGuidance || '遵循作品体裁并保持角色跨章节一致'}{roleGuidanceAssignments.map(item => <small key={item.clause_index}><br />“{item.source_text}” → {item.target_role_names.join('、')}：{item.reason}</small>)}</dd></div><div><dt>角色类型</dt><dd>{roleKindLabel}</dd></div><div><dt>人物小传</dt><dd>{roleDraft[3]}</dd></div><div><dt>年龄与性别</dt><dd>{roleAssetDraft.age} 岁 · {genderLabel}</dd></div><div><dt>建议与目标频率</dt><dd>{roleAssetDraft.pitch_min_hz} 至 {roleAssetDraft.pitch_max_hz} Hz · 目标 {roleAssetDraft.pitch_target_hz} Hz</dd></div><div><dt>声音导演</dt><dd>{voiceConditionPrompt}</dd></div><div><dt>表达节奏</dt><dd>{rhythmPrompt}</dd></div></dl>
            <Text strong>最终 VoiceDesign 指令预览</Text><p className="instruction-copy">{finalVoiceInstruction}</p>
            <div className="preview-current-voice"><Text strong>当前稳定音色</Text><VoicePreview voiceId={roleDraft[5]} /></div>
          </aside>
        </div>}
      </Modal>
      </section>
    </Content>
  </Layout>;
}

export default function App() { return <AntApp><Studio /></AntApp>; }
