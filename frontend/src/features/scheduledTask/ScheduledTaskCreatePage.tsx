import { i18n } from '@/shared/i18n';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { Trans, useTranslation } from 'react-i18next';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { Alert, Button, Form, Input, message, Select, Upload } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs, { type Dayjs } from 'dayjs';
import { listSquads, getSquadMembers } from '@/features/squad/api';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  DOCUMENT_UPLOAD_MESSAGES,
  documentsFromDataTransfer,
  filesFromClipboard,
  pastedFileForUpload,
  validateDocumentSelection,
  type DocumentSelectionContext,
  type DocumentSelectionVerdict,
} from '@/shared/lib/documentUpload';
import { formatBytes } from '@/features/skill/skillPackage';
import { useCreateScheduledTask, useUploadScheduledTaskDocuments } from './hooks';
import { normalizeRunPolicy, RunPolicyEditor } from './components/RunPolicyEditor';
import { ScheduleEditor } from './components/ScheduleEditor';
import { transitionScheduledTask } from './api';
import type { CreateScheduledTaskBody } from './types';
import './ScheduledTaskForm.css';

const { TextArea } = Input;
const POLICY_FIELDS = ['sessionMode', 'overlapPolicy', 'misfirePolicy', 'startDeadlineSeconds', 'affinityTimeoutSeconds'];
interface CreateFormValues { name: string; instructionMd: string; squadId: number; initialAgentId: number; scheduleType: 'ONCE' | 'CRON'; runAtDate?: Dayjs; runAtTime?: Dayjs; cronExpression?: string; sessionMode: 'ISOLATED' | 'CONTINUOUS'; overlapPolicy: 'SKIP' | 'QUEUE' | 'ALLOW'; misfirePolicy: 'SKIP_ALL' | 'FIRE_LATEST' | 'FIRE_ALL'; startDeadlineSeconds?: number; affinityTimeoutSeconds?: number; initialStatus?: 'ACTIVE' | 'PAUSED'; }
export function initialStatusForCreate(requestedStatus: 'ACTIVE' | 'PAUSED', documentCount: number) {
  return documentCount > 0 && requestedStatus === 'ACTIVE' ? 'PAUSED' : requestedStatus;
}

// ApiError extends Error, so this also covers a plain Error; trimming keeps a blank reason
// from rendering a truncated hint such as "上传失败：".
export function backendErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.trim() : '';
}

export function documentSelectionContext(current: readonly UploadFile[]): DocumentSelectionContext {
  return {
    existingCount: current.length,
    existingNames: current.map((item) => item.name),
    existingTotalBytes: current.reduce((total, item) => total + (item.originFileObj?.size ?? item.size ?? 0), 0),
  };
}

let uploadFileSequence = 0;

/** Clipboard files never pass through the picker, so build the UploadFile shape antd creates for picked files. */
export function asUploadFile(file: File): UploadFile {
  const uid = `document-${Date.now()}-${(uploadFileSequence += 1)}`;
  return { uid, name: file.name, size: file.size, type: file.type, originFileObj: Object.assign(file, { uid, lastModifiedDate: new Date(file.lastModified) }) };
}

export function ScheduledTaskCreatePage() {
  const { t } = useTranslation('scheduledTask');
  const navigate = useNavigate(); const accessCommand = useAccessCommand();
  const [form] = Form.useForm<CreateFormValues & { schedulePreset: string }>();
  useLocalizedValidation(form);
  const [files, setFiles] = useState<UploadFile[]>([]); const [selectedAgentId, setSelectedAgentId] = useState<number>();
  // rc-upload hands the whole selection to every beforeUpload call, so caching by batch identity
  // validates a multi-file drop once (all-or-nothing, like the workitem card) and reports one message.
  const documentBatchRef = useRef<{ batch: readonly File[]; verdict: DocumentSelectionVerdict; reported: boolean } | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const sessionMode = Form.useWatch('sessionMode', form); const overlapPolicy = Form.useWatch('overlapPolicy', form); const misfirePolicy = Form.useWatch('misfirePolicy', form); const startDeadlineSeconds = Form.useWatch('startDeadlineSeconds', form);
  const squadId = Form.useWatch('squadId', form); const createTask = useCreateScheduledTask(); const uploadDocuments = useUploadScheduledTaskDocuments();
  const { data: squadsPage } = useQuery({ queryKey: ['squads', 'scheduled-task-selector'], queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }) });
  const { data: members = [], isLoading: membersLoading } = useQuery({ queryKey: ['squads', squadId, 'members'], queryFn: () => getSquadMembers(squadId!), enabled: Boolean(squadId) });
  const beforeUpload = (_file: File, batch: readonly File[]) => {
    let verification = documentBatchRef.current;
    if (!verification || verification.batch !== batch) {
      verification = { batch, verdict: validateDocumentSelection(batch, documentSelectionContext(files)), reported: false };
      documentBatchRef.current = verification;
    }
    const { verdict } = verification;
    if (verdict.ok) return false;
    if (!verification.reported) {
      verification.reported = true;
      message.error(verdict.message);
    }
    return Upload.LIST_IGNORE;
  };
  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const pasted = filesFromClipboard(event.clipboardData);
    // A text-only paste carries no files: leave it alone so ordinary text areas keep working.
    if (pasted.length === 0) return;
    event.preventDefault();
    const renamed = pasted.map((file) => pastedFileForUpload(file));
    const verdict = validateDocumentSelection(renamed, documentSelectionContext(files));
    if (!verdict.ok) { message.error(verdict.message); return; }
    setFiles((current) => [...current, ...renamed.map(asUploadFile)]);
  };
  // Runs in the capture phase so an invalid drop is reported with the shared copy and never reaches
  // rc-upload, whose own accept filter would otherwise silently discard unsupported files.
  const handleDropGuard = (event: ReactDragEvent<HTMLDivElement>) => {
    const { files: dropped, containsDirectory } = documentsFromDataTransfer(event.dataTransfer);
    let failure: string | null = null;
    if (containsDirectory) {
      failure = DOCUMENT_UPLOAD_MESSAGES.directory;
    } else if (dropped.length === 0) {
      failure = DOCUMENT_UPLOAD_MESSAGES.noLocalFile;
    } else {
      const verdict = validateDocumentSelection(dropped, documentSelectionContext(files));
      if (!verdict.ok) failure = verdict.message;
    }
    if (!failure) return;
    event.preventDefault(); event.stopPropagation();
    message.error(failure);
  };
  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);
  const submit = (values: CreateFormValues) => accessCommand('READ_WRITE', t('commands.createTask'), async () => {
    const runAt = values.runAtDate && values.runAtTime ? dayjs(values.runAtDate).hour(values.runAtTime.hour()).minute(values.runAtTime.minute()).second(0).millisecond(0).toISOString() : undefined;
    const requestedStatus = values.initialStatus ?? 'ACTIVE';
    // A task must not become scanner-eligible before its selected requirement documents are attached.
    const initialStatus = initialStatusForCreate(requestedStatus, files.length);
    const policy = normalizeRunPolicy({ sessionMode: values.sessionMode ?? 'ISOLATED', overlapPolicy: values.overlapPolicy ?? 'SKIP', affinityTimeoutSeconds: values.affinityTimeoutSeconds, startDeadlineSeconds: values.startDeadlineSeconds ?? 300 });
    const body: CreateScheduledTaskBody = { name: values.name, instructionMd: values.instructionMd, squadId: values.squadId, initialAgentId: values.initialAgentId, scheduleType: values.scheduleType, timezone: 'Asia/Shanghai', ...policy, misfirePolicy: values.misfirePolicy ?? 'SKIP_ALL', initialStatus, ...(values.scheduleType === 'ONCE' ? { runAt: runAt! } : { cronExpression: values.cronExpression }) };
    try {
      const task = await createTask.mutateAsync(body);
      const rawFiles: File[] = files.flatMap((file) => file.originFileObj ? [file.originFileObj] : []);
      try {
        if (rawFiles.length) await uploadDocuments.mutateAsync({ id: task.id, files: rawFiles });
      } catch (error) {
        const reason = backendErrorMessage(error);
        message.error(reason ? i18n.t('scheduledTask:create.uploadFailedReason', { reason }) : i18n.t('scheduledTask:create.uploadFailed'));
        navigate(`/scheduled-tasks/${task.id}`);
        return;
      }
      if (requestedStatus === 'ACTIVE' && initialStatus === 'PAUSED') {
        try { await transitionScheduledTask(task.id, 'enable', task.version); }
        catch (error) {
          const reason = backendErrorMessage(error);
          message.error(reason ? i18n.t('scheduledTask:create.enableFailedReason', { reason }) : i18n.t('scheduledTask:create.enableFailed'));
          navigate(`/scheduled-tasks/${task.id}`);
          return;
        }
      }
      message.success(requestedStatus === 'ACTIVE' ? i18n.t('scheduledTask:create.enabled') : i18n.t('scheduledTask:create.paused'));
      navigate(`/scheduled-tasks/${task.id}`);
    } catch { /* shared interceptor preserves the form for retry */ }
  });
  const selectedMember = members.find((member) => member.agentId === Number(selectedAgentId));
  const submitAs = (status: 'ACTIVE' | 'PAUSED') => { form.setFieldValue('initialStatus', status); form.submit(); };
  const sessionLabels: Record<string, string> = { ISOLATED: t('session.isolated'), CONTINUOUS: t('session.continuous') };
  const overlapLabels: Record<string, string> = { SKIP: t('overlap.skip'), QUEUE: t('overlap.queue'), ALLOW: t('overlap.allow') };
  const misfireLabels: Record<string, string> = { SKIP_ALL: t('misfire.skipAll'), FIRE_LATEST: t('misfire.fireLatest'), FIRE_ALL: t('misfire.fireAll') };
  const policySummary = t('create.policySummary', { session: sessionLabels[sessionMode] ?? '', overlap: overlapLabels[overlapPolicy] ?? '', misfire: misfireLabels[misfirePolicy] ?? '', seconds: startDeadlineSeconds ?? '' });
  const openPolicyOnError = ({ errorFields }: { errorFields: { name: (string | number)[] }[] }) => {
    if (errorFields.some((field) => POLICY_FIELDS.includes(String(field.name[0])))) setPolicyOpen(true);
  };
  return <>
    <div className="aw-form-head">
      <PageBackButton to="/scheduled-tasks" label={t('actions.backToList')} />
      <span className="aw-form-title">{t('create.title')}</span>
    </div>
    <Form form={form} className="aw-sched-form" layout="vertical" onFinish={submit} onFinishFailed={openPolicyOnError} initialValues={{ scheduleType: 'CRON', schedulePreset: 'daily', cronExpression: '0 0 2 * * *', sessionMode: 'ISOLATED', overlapPolicy: 'SKIP', misfirePolicy: 'SKIP_ALL', startDeadlineSeconds: 300, affinityTimeoutSeconds: 0, initialStatus: 'ACTIVE' }}>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.content')}</div>
        <Form.Item name="name" label={t('form.name')} rules={[{ required: true, message: t('validation.nameRequired') }]}><Input maxLength={200} showCount placeholder={t('form.namePlaceholder')} /></Form.Item>
        <Form.Item name="instructionMd" label={t('form.instruction')} extra={t('form.instructionHelp')} rules={[{ required: true, message: t('validation.instructionRequired') }]}><TextArea rows={6} /></Form.Item>
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.executor')}</div>
        <div className="aw-sched-grid">
          <Form.Item name="squadId" label={t('form.squad')} rules={[{ required: true, message: t('validation.squadRequired') }]}><Select showSearch optionFilterProp="label" options={(squadsPage?.list ?? []).map((squad) => ({ value: squad.id, label: squad.name }))} onChange={() => form.setFieldValue('initialAgentId', undefined)} placeholder={t('form.squadPlaceholder')} /></Form.Item>
          <Form.Item name="initialAgentId" label={t('form.initialAgent')} rules={[{ required: true, message: t('validation.agentRequired') }]}><Select loading={membersLoading} disabled={!squadId} onChange={setSelectedAgentId} options={members.map((member) => ({ value: member.agentId, label: <AiIdentity name={member.agentName} avatar icon size="sm" /> }))} placeholder={t('form.agentPlaceholder')} /></Form.Item>
        </div>
        {selectedMember ? <div className="aw-sched-flow" data-flow>
          {selectedMember.sdlcName
            ? <Trans t={t} i18nKey="create.flowLine" values={{ workflow: selectedMember.sdlcName }} components={{ k: <span className="fl-k" />, b: <b /> }} />
            : <span className="fl-k">{t('create.noWorkflow')}</span>}
          {selectedMember.sdlcSteps?.length ? <span className="fl-steps">{selectedMember.sdlcSteps.map((step) => <span key={step.stepOrder} className="cs">{t('create.stepChip', { order: step.stepOrder, name: step.name })}</span>)}</span> : null}
        </div> : null}
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.schedule')}</div>
        <ScheduleEditor timezone="Asia/Shanghai" />
      </div>
      <div className="aw-sched-sec">
        <button type="button" className="aw-sched-sec-title" aria-expanded={policyOpen} aria-controls="scheduled-task-policy" onClick={() => setPolicyOpen((open) => !open)}>
          <span>{t('create.sections.policy')}</span><AwStrokeIcon name="chev-d" size={12} />
          {policyOpen ? null : <span className="aw-sched-sec-sum">{policySummary}</span>}
        </button>
        <div id="scheduled-task-policy" className="aw-sched-grid" hidden={!policyOpen}><RunPolicyEditor /></div>
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('form.documents')}<span className="aw-sched-opt">{t('create.optional')}</span></div>
        <Form.Item extra={t('form.documentsHelp')}><div data-testid="scheduled-task-document-dropzone" aria-label={t('form.documentsAria')} tabIndex={0} onPaste={handlePaste} onDropCapture={handleDropGuard} style={{ outline: 'none' }}><Upload.Dragger className="aw-sched-dragger" multiple accept={DOCUMENT_ACCEPT_ATTRIBUTE} beforeUpload={beforeUpload} fileList={files} onChange={({ fileList }) => setFiles(fileList)} itemRender={(_node, file, _list, { remove }) => <div className="aw-sched-file"><AwStrokeIcon name="doc" size={13} /><span className="nm" title={file.name}>{file.name}</span><span className="fs">{formatBytes(file.originFileObj?.size ?? file.size ?? 0)}</span><button type="button" className="fx" aria-label={t('form.removeDocument', { name: file.name })} onClick={remove}><AwStrokeIcon name="x" size={13} /></button></div>}><AwStrokeIcon name="upload" size={20} /><span className="aw-sched-drop-text">{t('form.documentsPrompt')}</span></Upload.Dragger></div></Form.Item>
        {files.length ? <Alert className="aw-sched-doc-note" type="warning" showIcon message={t('create.docPauseNote')} /> : null}
      </div>
    </Form>
    <div className="aw-form-foot">
      <Button type="primary" loading={createTask.isPending} onClick={() => submitAs('ACTIVE')}>{t('actions.createEnable')}</Button>
      <Button loading={createTask.isPending} onClick={() => submitAs('PAUSED')}>{t('actions.savePaused')}</Button>
      <Button onClick={() => navigate('/scheduled-tasks')}>{t('actions.cancel')}</Button>
    </div>
  </>;
}
