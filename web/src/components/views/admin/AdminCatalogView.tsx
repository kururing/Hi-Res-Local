import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Shield, Upload, X } from 'lucide-react';
import { hashFileSha256 } from '../../../admin/checksum';
import { ObjectUploadTransport } from '../../../admin/ObjectUploadTransport';
import { AdminUploadSession } from '../../../admin/uploadSession';
import { Button } from '../../common/Button';
import { ProgressBar } from '../../common/ProgressBar';
import { useAdminCapabilities } from '../../../context/AdminCapabilitiesContext';
import { useAuth } from '../../../context/AuthContext';
import { useSettings } from '../../../context/SettingsContext';
import { t, type TranslationKey } from '../../../i18n';
import { usePlatform } from '../../../platform';
import type { AdminImport, AdminImportStatus } from '../../../platform/admin/types';
import { AdminArtworkSection } from './AdminArtworkSection';

const CONCURRENCY = 3;
const POLL_MS = 400;
const AUDIO_ACCEPT = 'audio/*,.flac,.wav,.mp3,.m4a,.ogg,.webm,.dsf,.dff';
const PROCESSING: AdminImportStatus[] = ['waiting_upload', 'uploading', 'verifying', 'probing', 'publishing'];

type QueuePhase =
  | 'queued'
  | 'hashing'
  | 'uploading'
  | 'verifying'
  | 'probing'
  | 'publishing'
  | 'published'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

interface QueueItem {
  key: string;
  file: File | null;
  filename: string;
  importId: string | null;
  phase: QueuePhase;
  percent: number;
  record: AdminImport | null;
  error: string | null;
  generation: number;
}

interface AdminCatalogViewProps {
  onLeave?: () => void;
  onBusyChange?: (busy: boolean) => void;
  transport?: ObjectUploadTransport;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function phaseFromImport(status: AdminImportStatus): QueuePhase {
  if (status === 'waiting_upload' || status === 'uploading') return 'uploading';
  if (status === 'verifying') return 'verifying';
  if (status === 'probing') return 'probing';
  if (status === 'publishing' || status === 'needs_review' || status === 'ready') return 'publishing';
  if (status === 'published' || status === 'duplicate' || status === 'failed' || status === 'cancelled') {
    return status;
  }
  return 'queued';
}

function statusKey(phase: QueuePhase): TranslationKey {
  if (phase === 'queued' || phase === 'hashing') return 'admin_status_preparing';
  if (phase === 'uploading') return 'admin_import_status_uploading';
  if (phase === 'verifying') return 'admin_import_status_verifying';
  if (phase === 'probing') return 'admin_import_status_probing';
  if (phase === 'publishing') return 'admin_import_status_publishing';
  if (phase === 'published') return 'admin_import_status_published';
  if (phase === 'duplicate') return 'admin_import_status_duplicate';
  if (phase === 'failed') return 'admin_import_status_failed';
  return 'admin_import_status_cancelled';
}

export const AdminCatalogView: React.FC<AdminCatalogViewProps> = ({
  onLeave,
  onBusyChange,
  transport = new ObjectUploadTransport(),
}) => {
  const { catalogAdmin } = useAdminCapabilities();
  const { status } = useAuth();
  const { admin } = usePlatform();
  const { settings } = useSettings();
  const lang = settings.language;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const sessions = useRef(new Map<string, AdminUploadSession>());
  const pollers = useRef(new Map<string, number>());
  const inflight = useRef(0);
  const pending = useRef<Array<{ key: string; file: File }>>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const dragDepth = useRef(0);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [liveMessage, setLiveMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);

  const fileId = useId();
  const summaryId = useId();
  itemsRef.current = items;

  const busy = items.some(item => item.phase === 'hashing' || item.phase === 'uploading');

  const updateItem = useCallback((key: string, patch: Partial<QueueItem> | ((current: QueueItem) => Partial<QueueItem>)) => {
    setItems(previous => previous.map(item => {
      if (item.key !== key) return item;
      const next = typeof patch === 'function' ? patch(item) : patch;
      return { ...item, ...next };
    }));
  }, []);

  const sessionFor = (key: string) => {
    const existing = sessions.current.get(key);
    if (existing) return existing;
    const created = new AdminUploadSession();
    sessions.current.set(key, created);
    return created;
  };

  const stopPoll = (key: string) => {
    const timer = pollers.current.get(key);
    if (timer) window.clearInterval(timer);
    pollers.current.delete(key);
  };

  useEffect(() => {
    if (!catalogAdmin && onLeave) onLeave();
  }, [catalogAdmin, onLeave]);

  useEffect(() => {
    if (status !== 'authenticated') {
      for (const session of sessions.current.values()) session.abort();
      for (const key of pollers.current.keys()) stopPoll(key);
    }
  }, [status]);

  useEffect(() => () => {
    for (const session of sessions.current.values()) session.abort();
    for (const key of pollers.current.keys()) stopPoll(key);
  }, []);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  useEffect(() => {
    if (!admin || !catalogAdmin) return;
    void admin.listImports().then(rows => {
      setItems(previous => {
        const known = new Set(previous.map(item => item.importId).filter(Boolean));
        const restored: QueueItem[] = rows
          .filter(row => !known.has(row.id))
          .map(row => ({
            key: `import:${row.id}`,
            file: null,
            filename: row.original_filename,
            importId: row.id,
            phase: phaseFromImport(row.status),
            percent: row.status === 'published' || row.status === 'duplicate' ? 100 : 0,
            record: row,
            error: row.error_message,
            generation: 0,
          }));
        return [...restored, ...previous];
      });
    });
  }, [admin, catalogAdmin]);

  const pollImport = useCallback((key: string, importId: string, generation: number) => {
    if (!admin) return;
    stopPoll(key);
    const tick = () => {
      void admin.getImport(importId).then(row => {
        if (sessionFor(key).currentGeneration() !== generation) return;
        updateItem(key, {
          record: row,
          phase: phaseFromImport(row.status),
          percent: 100,
          error: row.error_message,
        });
        if (!PROCESSING.includes(row.status) && row.status !== 'waiting_upload') {
          stopPoll(key);
          setLiveMessage(t(statusKey(phaseFromImport(row.status)), lang));
        }
      }).catch(() => undefined);
    };
    tick();
    pollers.current.set(key, window.setInterval(tick, POLL_MS));
  }, [admin, lang, updateItem]);

  const pumpRef = useRef<() => void>(() => undefined);

  const runFile = useCallback(async (key: string, file: File) => {
    if (!admin) {
      inflight.current = Math.max(0, inflight.current - 1);
      pumpRef.current();
      return;
    }
    const session = sessionFor(key);
    const { signal, generation } = session.start();
    updateItem(key, { phase: 'hashing', percent: 0, error: null, generation, file });
    setLiveMessage(t('admin_status_preparing', lang));
    try {
      const checksum = await hashFileSha256(file, {
        signal,
        onProgress: progress => {
          if (session.currentGeneration() !== generation) return;
          updateItem(key, { percent: progress.percent });
        },
      });
      if (session.currentGeneration() !== generation) return;
      const created = await admin.createImport({
        filename: file.name,
        content_type: file.type || 'audio/flac',
        size_bytes: file.size,
        checksum_sha256: checksum,
      }, crypto.randomUUID());
      session.rememberUrl(created.upload.url);
      if (session.hasPersistedUrl()) return;
      updateItem(key, { importId: created.import.id, record: created.import, phase: 'uploading', percent: 0 });
      if (created.import.status === 'published' || created.import.status === 'duplicate') {
        updateItem(key, { phase: phaseFromImport(created.import.status), percent: 100 });
        setLiveMessage(t(statusKey(phaseFromImport(created.import.status)), lang));
        return;
      }
      setLiveMessage(t('admin_import_status_uploading', lang));
      await transport.put({
        upload: created.upload,
        body: file,
        signal,
        onProgress: progress => {
          if (session.currentGeneration() !== generation) return;
          updateItem(key, { percent: progress.percent });
        },
      });
      if (session.currentGeneration() !== generation) return;
      updateItem(key, { phase: 'verifying', percent: 100 });
      setLiveMessage(t('admin_import_status_verifying', lang));
      const completed = await admin.completeImport(created.import.id);
      updateItem(key, { record: completed, phase: phaseFromImport(completed.status), percent: 100 });
      pollImport(key, created.import.id, generation);
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      updateItem(key, {
        phase: 'failed',
        error: error instanceof Error ? error.message : t('admin_error_file', lang),
      });
      setLiveMessage(t('admin_import_status_failed', lang));
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      inflight.current = Math.max(0, inflight.current - 1);
      pumpRef.current();
    }
  }, [admin, lang, pollImport, transport, updateItem]);

  const pump = useCallback(() => {
    while (inflight.current < CONCURRENCY && pending.current.length) {
      const job = pending.current.shift();
      if (!job) break;
      inflight.current += 1;
      void runFile(job.key, job.file);
    }
  }, [runFile]);
  pumpRef.current = pump;

  const enqueueFiles = (files: File[]) => {
    if (!files.length) return;
    const next: QueueItem[] = [];
    for (const file of files) {
      const key = fileKey(file);
      if (itemsRef.current.some(item => item.key === key) || pending.current.some(job => job.key === key)) continue;
      next.push({
        key,
        file,
        filename: file.name,
        importId: null,
        phase: 'queued',
        percent: 0,
        record: null,
        error: null,
        generation: 0,
      });
      pending.current.push({ key, file });
    }
    if (!next.length) return;
    setItems(previous => {
      const updated = [...next, ...previous];
      itemsRef.current = updated;
      return updated;
    });
    pump();
  };

  const assignFromInput = (list: FileList | null) => {
    if (!list?.length) return;
    enqueueFiles(Array.from(list));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelItem = (key: string) => {
    sessionFor(key).abort();
    stopPoll(key);
    pending.current = pending.current.filter(item => item.key !== key);
    const item = itemsRef.current.find(row => row.key === key);
    if (item?.importId) void admin?.cancelImport(item.importId);
    updateItem(key, { phase: 'cancelled', error: null });
    setLiveMessage(t('admin_import_status_cancelled', lang));
  };

  const retryItem = (key: string) => {
    const item = itemsRef.current.find(row => row.key === key);
    if (!item || !admin) return;
    if (item.importId && (item.file === null || item.record?.status === 'failed')) {
      void admin.retryImport(item.importId).then(row => {
        updateItem(key, { record: row, phase: phaseFromImport(row.status), error: null });
        pollImport(key, row.id, sessionFor(key).currentGeneration());
      }).catch(() => {
        if (!item.file) return;
        pending.current = pending.current.filter(job => job.key !== key);
        pending.current.unshift({ key, file: item.file });
        updateItem(key, { phase: 'queued', error: null, percent: 0 });
        pumpRef.current();
      });
      return;
    }
    if (!item.file) return;
    pending.current = pending.current.filter(job => job.key !== key);
    pending.current.unshift({ key, file: item.file });
    updateItem(key, { phase: 'queued', error: null, percent: 0 });
    pumpRef.current();
  };

  const removeItem = (key: string) => {
    sessionFor(key).abort();
    stopPoll(key);
    pending.current = pending.current.filter(item => item.key !== key);
    const item = itemsRef.current.find(row => row.key === key);
    if (item?.importId && item.phase !== 'published' && item.phase !== 'duplicate') {
      void admin?.cancelImport(item.importId);
    }
    setItems(previous => previous.filter(row => row.key !== key));
  };

  const scanExisting = async () => {
    if (!admin || scanning) return;
    setScanning(true);
    try {
      const result = await admin.reconcileImports();
      setLiveMessage(t('admin_scan_done', lang, { count: result.enqueued }));
      const restored = result.imports.map(row => ({
        key: `import:${row.id}`,
        file: null,
        filename: row.original_filename,
        importId: row.id,
        phase: phaseFromImport(row.status),
        percent: 0,
        record: row,
        error: row.error_message,
        generation: 0,
      } satisfies QueueItem));
      setItems(previous => {
        const known = new Set(previous.map(item => item.importId).filter(Boolean));
        return [...restored.filter(item => !known.has(item.importId)), ...previous];
      });
      for (const item of restored) {
        if (item.importId) pollImport(item.key, item.importId, 0);
      }
    } catch (error) {
      setLiveMessage(error instanceof Error ? error.message : t('admin_error_file', lang));
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setScanning(false);
    }
  };

  if (!catalogAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Shield className="mx-auto mb-4 h-10 w-10 text-brand-muted" aria-hidden />
        <h1 className="text-2xl font-semibold text-brand-foreground">{t('admin_title', lang)}</h1>
        <p className="mt-2 text-brand-muted">{t('admin_forbidden', lang)}</p>
      </div>
    );
  }

  const recent = items.filter(item => item.phase === 'published' || item.phase === 'duplicate');
  const active = items.filter(item => item.phase !== 'published' && item.phase !== 'duplicate');

  return (
    <div className="view-page mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6" data-admin-catalog="true">
      <header>
        <h1 className="text-2xl font-semibold text-brand-foreground">{t('admin_title', lang)}</h1>
        <p className="mt-1 text-sm text-brand-muted">{t('admin_zero_input_subtitle', lang)}</p>
      </header>

      <div
        ref={summaryRef}
        id={summaryId}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {liveMessage}
      </div>

      <div
        onDragEnter={event => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={event => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          enqueueFiles(Array.from(event.dataTransfer?.files ?? []));
        }}
        className={`rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-oled-card'
        }`}
      >
        <Upload className="mx-auto mb-3 h-8 w-8 text-brand-accent" aria-hidden />
        <p className="text-brand-foreground">{t('admin_drop_files', lang)}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <input
            ref={fileInputRef}
            id={fileId}
            type="file"
            accept={AUDIO_ACCEPT}
            multiple
            className="sr-only"
            onChange={event => assignFromInput(event.target.files)}
          />
          <Button
            variant="accent"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('admin_upload_music', lang)}
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={scanning}
            onClick={() => void scanExisting()}
          >
            {t('admin_scan_existing', lang)}
          </Button>
        </div>
      </div>

      {active.length > 0 && (
        <section aria-labelledby="admin-queue-heading">
          <h2 id="admin-queue-heading" className="mb-3 text-lg font-medium text-brand-foreground">
            {t('admin_queue_heading', lang)}
          </h2>
          <ul className="flex flex-col gap-3">
            {active.map(item => (
              <li key={item.key} className="rounded-2xl border border-brand-border bg-oled-card p-4">
                <ProgressBar
                  value={item.percent}
                  label={item.filename}
                  statusText={t(statusKey(item.phase), lang)}
                />
                {item.error && (
                  <p className="mt-2 text-sm text-rose-300">{item.error}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(item.phase === 'hashing' || item.phase === 'uploading' || item.phase === 'queued') && (
                    <Button size="sm" variant="ghost" type="button" onClick={() => cancelItem(item.key)}>
                      {t('admin_cancel_upload', lang)}
                    </Button>
                  )}
                  {item.phase === 'failed' && (
                    <>
                      <Button size="sm" type="button" onClick={() => retryItem(item.key)}>
                        {t('admin_retry', lang)}
                      </Button>
                      <Button size="sm" variant="danger" type="button" onClick={() => removeItem(item.key)}>
                        {t('admin_remove_file', lang)}
                      </Button>
                    </>
                  )}
                  {item.phase === 'cancelled' && (
                    <Button size="sm" variant="ghost" type="button" onClick={() => removeItem(item.key)}>
                      <X className="h-4 w-4" aria-hidden />
                      {t('admin_remove_file', lang)}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="admin-recent-heading">
          <h2 id="admin-recent-heading" className="mb-3 text-lg font-medium text-brand-foreground">
            {t('admin_recent_imports', lang)}
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map(item => (
              <li
                key={item.key}
                className="flex items-center justify-between rounded-2xl border border-brand-border bg-oled-card px-4 py-3"
              >
                <span className="truncate text-brand-foreground">{item.filename}</span>
                <span className="text-sm text-brand-muted">{t(statusKey(item.phase), lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AdminArtworkSection transport={transport} />
    </div>
  );
};
