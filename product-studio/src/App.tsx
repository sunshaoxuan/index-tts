import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, App as AntApp, Button, Card, Empty, Flex, Input, InputNumber, Layout, Modal,
  Popconfirm, Progress, Select, Space, Switch, Table, Tabs, Tag, Typography,
} from 'antd';
import {
  AudioOutlined, CaretRightOutlined, DeleteOutlined, FolderOpenOutlined, LockOutlined, PauseOutlined, PlusOutlined, SaveOutlined, SoundOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from './api';
import type { Presets, ProjectPayload, RoleRow, SegmentRow } from './types';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

function formatAudioTime(value: number) {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

function StudioAudio({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  };
  return <div className="studio-audio">
    <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <button type="button" onClick={toggle} aria-label={playing ? '暂停音频' : '播放音频'}>{playing ? <PauseOutlined /> : <CaretRightOutlined />}</button>
    <span>{formatAudioTime(current)}</span>
    <input aria-label="音频进度" type="range" min={0} max={safeDuration} step={0.1} value={Math.min(current, safeDuration)} onInput={(event) => { const value = Number(event.currentTarget.value); setCurrent(value); if (audioRef.current) audioRef.current.currentTime = value; }} />
    <span>{formatAudioTime(safeDuration)}</span>
  </div>;
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
  return <div className={`voice-preview${failed ? ' voice-preview-failed' : ''}`}>
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
  const [render, setRender] = useState<{ available: boolean; audio?: string; package?: string; manifest?: string }>({ available: false });
  const [job, setJob] = useState<{ id: string; kind: 'analyze' | 'voice' | 'render'; phase: string; fraction: number; message: string }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContentType, setNewContentType] = useState('novel');
  const [activeTab, setActiveTab] = useState('source');
  const jobRunning = Boolean(job && !['complete', 'error'].includes(job.phase));
  const jobPercent = Math.round((job?.fraction ?? 0) * 100);
  const jobLabels = { analyze: 'AI 文本导演', voice: '角色音色生成', render: '完整音频渲染' };

  useEffect(() => {
    Promise.all([api.presets(), api.projects()]).then(([p, list]) => {
      setPresets(p); setProjects(list); if (list[0]) setProjectId(list[0].value);
    }).catch((error) => message.error(error.message));
  }, [message]);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([api.project(projectId), api.latestRender(projectId)]).then(([data, latest]) => {
      setProject(data); setRender(latest); setDirty(false);
    }).catch((error) => message.error(error.message));
  }, [projectId, message]);

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

  const setRole = (index: number, column: number, value: string | number) => {
    if (jobRunning) return;
    setProject((current) => {
      if (!current) return current;
      const roles = current.roles.map((row, i) => i === index ? row.map((cell, c) => c === column ? value : cell) as RoleRow : row);
      setDirty(true); return { ...current, roles };
    });
  };

  const setSegment = (index: number, column: number, value: string | number) => {
    if (jobRunning) return;
    setProject((current) => {
      if (!current) return current;
      const segments = current.segments.map((row, i) => {
        if (i !== index) return row;
        const updated = row.map((cell, c) => c === column ? value : cell) as SegmentRow;
        if (column === 2) {
          const role = current.roles.find((item) => item[0] === value);
          if (role) updated[3] = role[1];
        }
        return updated;
      });
      setDirty(true); return { ...current, segments };
    });
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

  const addRole = () => {
    if (!project || jobRunning) return;
    let suffix = project.roles.length + 1;
    while (project.roles.some(row => row[0] === `role-${suffix}`)) suffix += 1;
    patchProject('roles', [...project.roles, [`role-${suffix}`, '新角色', 'character', '', '中性清晰', '', '自然叙述', '是']]);
  };

  const removeRole = (roleId: string) => {
    if (!project || jobRunning) return;
    if (project.segments.some(row => row[2] === roleId)) { message.error('该角色仍被分句引用，请先调整分句归属'); return; }
    patchProject('roles', project.roles.filter(row => row[0] !== roleId));
  };

  const save = async (): Promise<boolean> => {
    if (!project || jobRunning) return false;
    setSaving(true);
    try { setProject(await api.save(project)); setDirty(false); message.success('工程已保存并通过枚举校验'); return true; }
    catch (error) { message.error((error as Error).message); return false; }
    finally { setSaving(false); }
  };

  const runJob = async (kind: 'analyze' | 'voice' | 'render') => {
    if (!project) return;
    if (dirty && !(await save())) return;
    let started: { jobId: string };
    try { started = await api[kind](project.project_id); }
    catch (error) { message.error((error as Error).message); return; }
    setJob({ id: started.jobId, kind, phase: 'queued', fraction: 0, message: '任务已进入队列' });
    const timer = window.setInterval(async () => {
      try {
        const status = await api.job(started.jobId);
        setJob({ id: started.jobId, kind, ...status });
        if (status.phase === 'complete' || status.phase === 'error') {
          window.clearInterval(timer);
          if (status.phase === 'complete') {
            setProject(await api.project(project.project_id));
            setRender(await api.latestRender(project.project_id));
            message.success(status.message);
          } else message.error(status.message);
        }
      } catch (error) { window.clearInterval(timer); message.error((error as Error).message); }
    }, 1000);
  };

  const roleOptions = project?.roles.map((row) => ({ label: `${row[1]}  ${row[0]}`, value: row[0] })) ?? [];
  const kindOptions = [
    { value: 'narrator', label: '旁白' }, { value: 'character', label: '人物' }, { value: 'anchor', label: '主播' },
    { value: 'reporter', label: '记者' }, { value: 'interviewee', label: '采访对象' },
  ];
  const roleColumns = useMemo<ColumnsType<RoleRow>>(() => {
    if (!presets) return [];
    return [
      { title: '轨道 ID', dataIndex: 0, width: 150, fixed: 'left', render: (v) => <Text code>{v}</Text> },
      { title: '角色', dataIndex: 1, width: 130, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={(e) => setRole(i, 1, e.target.value)} /> },
      { title: '类型', dataIndex: 2, width: 135, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={kindOptions.filter(item => presets.roleKinds.includes(item.value))} onChange={(x) => setRole(i, 2, x)} /> },
      { title: '角色说明', dataIndex: 3, width: 240, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={(e) => setRole(i, 3, e.target.value)} /> },
      { title: '音色预设或高级提示', dataIndex: 4, width: 300, render: (v, _r, i) => {
        const predefined = presets.voiceStyles.includes(v);
        return <Space direction="vertical" size={4} className="cell-control">
          <Select disabled={jobRunning} value={predefined ? v : '__custom__'} options={[...presets.voiceStyles.map(value => ({ value, label: value })), { value: '__custom__', label: '高级自定义提示' }]} onChange={(x) => setRole(i, 4, x === '__custom__' ? '' : x)} />
          {!predefined && <Input disabled={jobRunning} value={v} placeholder="输入 VoiceDesign 原生提示" onChange={(e) => setRole(i, 4, e.target.value)} />}
        </Space>;
      } },
      { title: '音色 ID 与试听', dataIndex: 5, width: 300, render: (v) => <VoicePreview voiceId={v} /> },
      { title: '角色节奏', dataIndex: 6, width: 160, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={presets.rhythms.map(value => ({ value, label: value }))} onChange={(x) => setRole(i, 6, x)} /> },
      { title: '重新生成', dataIndex: 7, width: 120, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={['是', '否'].map(value => ({ value, label: value }))} onChange={(x) => setRole(i, 7, x)} /> },
      { title: '操作', key: 'actions', width: 90, render: (_v, row) => <Popconfirm disabled={jobRunning} title="删除角色" description="仅可删除未被分句引用的角色" onConfirm={() => removeRole(row[0])}><Button disabled={jobRunning} type="text" danger icon={<DeleteOutlined />} aria-label={`删除角色 ${row[1]}`} /></Popconfirm> },
    ];
  }, [presets, project, jobRunning]);

  const segmentColumns = useMemo<ColumnsType<SegmentRow>>(() => {
    if (!presets) return [];
    return [
      { title: '序号', dataIndex: 0, width: 70, fixed: 'left' },
      { title: '章节', dataIndex: 1, width: 130, fixed: 'left' },
      { title: '角色', dataIndex: 2, width: 190, render: (v, _r, i) => <Select disabled={jobRunning} showSearch value={v} options={roleOptions} onChange={(x) => setSegment(i, 2, x)} /> },
      { title: '语言', dataIndex: 4, width: 100, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={presets.languages.map(value => ({ value, label: value }))} onChange={(x) => setSegment(i, 4, x)} /> },
      { title: '原文', dataIndex: 5, width: 300, render: (v) => <Text>{v}</Text> },
      { title: '合成文本', dataIndex: 6, width: 320, render: (v, _r, i) => <Input.TextArea disabled={jobRunning} autoSize={{ minRows: 1, maxRows: 4 }} value={v} onChange={(e) => setSegment(i, 6, e.target.value)} /> },
      { title: '态度', dataIndex: 7, width: 160, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={presets.attitudes.map(value => ({ value, label: value }))} onChange={(x) => setSegment(i, 7, x)} /> },
      { title: '情绪', dataIndex: 8, width: 130, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={presets.emotions.map(value => ({ value, label: value }))} onChange={(x) => setSegment(i, 8, x)} /> },
      { title: '强度', dataIndex: 9, width: 110, render: (v, _r, i) => <InputNumber disabled={jobRunning} min={0} max={1} step={0.05} value={v} onChange={(x) => setSegment(i, 9, x ?? 0.5)} /> },
      { title: '句内节奏', dataIndex: 10, width: 150, render: (v, _r, i) => <Select disabled={jobRunning} value={v} options={presets.paces.map(value => ({ value, label: value }))} onChange={(x) => setSegment(i, 10, x)} /> },
      { title: '停顿 ms', dataIndex: 11, width: 130, render: (v, _r, i) => <InputNumber disabled={jobRunning} min={0} max={3000} step={50} value={v} onChange={(x) => setSegment(i, 11, x ?? 0)} /> },
    ];
  }, [presets, roleOptions, project, jobRunning]);

  const pronunciationColumns: ColumnsType<ProjectPayload['pronunciations'][number]> = [
    { title: '固定组合', dataIndex: 'source', width: 220, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, source: e.target.value } : row))} /> },
    { title: '朗读替换', dataIndex: 'replacement', width: 260, render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, replacement: e.target.value } : row))} /> },
    { title: '说明', dataIndex: 'note', render: (v, _r, i) => <Input disabled={jobRunning} value={v} onChange={e => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, note: e.target.value } : row))} /> },
    { title: '启用', dataIndex: 'enabled', width: 90, render: (v, _r, i) => <Switch disabled={jobRunning} checked={v} onChange={checked => patchProject('pronunciations', project!.pronunciations.map((row, x) => x === i ? { ...row, enabled: checked } : row))} /> },
    { title: '操作', width: 80, render: (_v, _r, i) => <Button disabled={jobRunning} type="text" danger icon={<DeleteOutlined />} aria-label={`删除纠音规则 ${i + 1}`} onClick={() => patchProject('pronunciations', project!.pronunciations.filter((_row, x) => x !== i))} /> },
  ];

  const openWorkspace = (key: string) => {
    setActiveTab(key);
    window.requestAnimationFrame(() => document.getElementById('project')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return <Layout className="studio-shell">
    <Header className="studio-header">
      <Flex justify="space-between" align="center">
        <div className="brand-lockup"><div className="brand-mark">IV</div><div><Title level={4}>Index Voice Studio</Title><Text>Product Edition</Text></div></div>
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
      <section className="project-section" id="project">
      <div className="project-bar">
        <div className="section-label">Project Control / 工程控制</div>
        <Flex gap={16} align="end" wrap>
          <div className="project-select"><Text strong>打开声音工程</Text><Select disabled={jobRunning} showSearch value={projectId} options={projects} onChange={setProjectId} suffixIcon={<FolderOpenOutlined />} /></div>
          <Button disabled={jobRunning} icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建工程</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={jobRunning || !dirty} onClick={save}>保存当前工程</Button>
          <Button disabled={jobRunning || !project?.source_text.trim()} onClick={() => runJob('analyze')}>AI 重新分析全文</Button>
          <Button disabled={jobRunning || !project?.roles.length} icon={<SoundOutlined />} onClick={() => runJob('voice')}>生成角色音色</Button>
          <Button disabled={jobRunning || !project?.segments.length} icon={<AudioOutlined />} onClick={() => runJob('render')}>生成完整音频</Button>
          {dirty ? <span className="project-state">有未保存修改</span> : <span className="project-state">工程已同步</span>}
        </Flex>
        {job && !jobRunning && <div className={`job-result job-result-${job.phase}`}><Text>{job.message}</Text></div>}
      </div>
      {job && jobRunning && <aside className="job-progress-float" role="status" aria-live="polite" aria-label={`${jobLabels[job.kind]}进度`}>
        <div className="job-progress-head"><div><span>Processing / 处理中</span><strong>{jobLabels[job.kind]}</strong></div><b>{jobPercent}%</b></div>
        <Progress percent={Math.max(2, jobPercent)} showInfo={false} status="active" strokeLinecap="butt" />
        <div className="job-progress-detail"><Text>{job.message}</Text><Text><LockOutlined /> 当前工程版本已锁定，任务完成后恢复编辑</Text></div>
      </aside>}
      {!project || !presets ? <Card><Progress percent={60} status="active" /><Text>正在载入工程与导演预设</Text></Card> : <>
        <div><Tabs size="large" activeKey={activeTab} onChange={setActiveTab} items={[
          { key: 'source', label: '全文与体裁', children: <Card title="作品原文与 AI 导演条件"><div className="source-grid"><div><Text strong>作品体裁</Text><Select disabled={jobRunning} value={project.content_type} options={[{ value: 'novel', label: '小说' }, { value: 'news', label: '新闻' }, { value: 'story', label: '故事体' }]} onChange={value => patchProject('content_type', value)} /></div><div><Text strong>导演补充</Text><Input disabled={jobRunning} value={project.guidance} placeholder="例如：冷峻悬疑，旁白克制，人物对白保留地域差异" onChange={event => patchProject('guidance', event.target.value)} /></div></div><Text strong>完整原文</Text><Input.TextArea disabled={jobRunning} className="source-text" value={project.source_text} rows={18} placeholder="在这里粘贴整篇小说、新闻或故事。AI 将按章节、段落和句子进行分轨。" onChange={event => patchProject('source_text', event.target.value)} /><Text type="secondary">{project.source_text.length.toLocaleString()} 字符，{project.chapters?.length ?? 0} 个已保存章节索引</Text></Card> },
          { key: 'roles', label: `角色与音色 ${project.roles.length}`, children: <Card title="角色轨道" extra={<Button disabled={jobRunning} icon={<PlusOutlined />} onClick={addRole}>补充角色</Button>}><Alert type="info" showIcon message="枚举字段可直接在单元格中选择。高级音色提示仅在选择高级模式时显示。" /><Table className="studio-table" rowKey={(row) => row[0]} columns={roleColumns} dataSource={project.roles} pagination={false} scroll={{ x: 1700, y: 520 }} /></Card> },
          { key: 'segments', label: `分句导演 ${project.segments.length}`, children: <Card title="分句、分轨与态度语气"><Alert type="info" showIcon message="角色、语言、态度、情绪和节奏均为下拉选择。强度与停顿使用受限数值。" /><Table className="studio-table" rowKey={(row) => String(row[0])} columns={segmentColumns} dataSource={project.segments} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1900, y: 560 }} /></Card> },
          { key: 'pronunciation', label: `全篇纠音 ${project.pronunciations.length}`, children: <Card title="全篇固定纠音表" extra={<Button disabled={jobRunning} icon={<PlusOutlined />} onClick={() => patchProject('pronunciations', [...project.pronunciations, { source: '', replacement: '', note: '', enabled: true }])}>新增纠音</Button>}><Alert type="info" showIcon message="较长组合优先，启用后的规则会应用到整篇作品，并在导演清单中保留原文和实际朗读文本。" /><Table className="studio-table" rowKey={(_row, index) => String(index)} columns={pronunciationColumns} dataSource={project.pronunciations} pagination={false} scroll={{ x: 1000 }} /></Card> },
          { key: 'delivery', label: '完整音频与交付', children: <div><Card title="最近一次交付">{render.available ? <Space direction="vertical" size="large"><StudioAudio src={render.audio!} /><Space><Button icon={<AudioOutlined />} href={render.package}>下载分轨包</Button><Button href={render.manifest}>下载导演清单</Button></Space></Space> : <Empty description="该工程还没有交付文件" />}</Card></div> },
        ]} /></div>
      </>}
      <Modal title="新建声音工程" open={createOpen} okText="建立工程" cancelText="取消" okButtonProps={{ disabled: jobRunning || !newTitle.trim() }} onOk={createProject} onCancel={() => setCreateOpen(false)}><Space direction="vertical" size="large" className="modal-fields"><div><Text strong>工程名称</Text><Input disabled={jobRunning} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="例如：白夜行有声小说" /></div><div><Text strong>作品体裁</Text><Select disabled={jobRunning} value={newContentType} onChange={setNewContentType} options={[{ value: 'novel', label: '小说' }, { value: 'news', label: '新闻' }, { value: 'story', label: '故事体' }]} /></div></Space></Modal>
      </section>
    </Content>
  </Layout>;
}

export default function App() { return <AntApp><Studio /></AntApp>; }
