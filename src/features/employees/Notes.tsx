import { dateTime12 } from '@/core/clock';
import { Archive, Pencil, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { addNote, fetchNotes, updateNote, type Note } from '@/data/notes';
import type { UserProfile } from '@/data/types';
import { t } from '@/i18n';
import { Button, ErrorBox, cx } from '@/ui/components';

const when = (iso: string) => dateTime12(iso, true);

/** Notes on a person, newest first: author and time on each; edit own (Coordinator) or any (Section Head). */
export function Notes({ employeeId, profile, limit }: { employeeId: string; profile: UserProfile; limit?: number }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { fetchNotes(employeeId).then(setNotes).catch(setErr); }, [employeeId]);
  useEffect(load, [load]);
  const isHead = profile.role_code === 'section_head';
  const mayEdit = (n: Note) => isHead || n.author === profile.auth_user_id;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); load(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const shown = (notes ?? []).filter((n) => !n.archived).slice(0, all || !limit ? undefined : limit);
  const hidden = (notes ?? []).filter((n) => !n.archived).length - shown.length;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={t('Add a note (no medical details)')} className="input min-h-11 flex-1 py-2" />
        <Button aria-label={t('Add note')} className="shrink-0 self-end" disabled={busy || !text.trim()} onClick={() => run(async () => { await addNote(employeeId, text); setText(''); })}><Send className="h-4 w-4 rtl:rotate-180" /></Button>
      </div>
      {err != null && <ErrorBox error={err} />}
      {notes && shown.length === 0 && <p className="text-sm text-slate-500">{t('No notes yet.')}</p>}
      <ul className="space-y-1.5">
        {shown.map((n) => (
          <li key={n.id} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            {editing?.id === n.id ? (
              <div className="space-y-1.5">
                <textarea value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} rows={3} className="input py-2" />
                <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>{t('Cancel')}</Button><Button className="flex-1" disabled={busy || !editing.body.trim()} onClick={() => run(async () => { await updateNote(n.id, { body: editing.body.trim() }); setEditing(null); })}>{t('Save')}</Button></div>
              </div>
            ) : <>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{n.body}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>{n.authorName} · {when(n.createdAt)}{n.editedAt ? ` · ${t('edited')} ${when(n.editedAt)}${n.editedByName && n.editedByName !== n.authorName ? ` ${t('by')} ${n.editedByName}` : ''}` : ''}</span>
                {mayEdit(n) && <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={t('Edit note')} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white" onClick={() => setEditing({ id: n.id, body: n.body })}><Pencil className="h-3.5 w-3.5" /></button>
                  {isHead && <button type="button" aria-label={t('Archive note')} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white" onClick={() => run(() => updateNote(n.id, { archived: true }))}><Archive className="h-3.5 w-3.5" /></button>}
                </span>}
              </div>
            </>}
          </li>
        ))}
      </ul>
      {hidden > 0 && <button type="button" onClick={() => setAll(true)} className={cx('min-h-9 text-xs font-medium text-brand-700')}>{t('Show all notes')} ({hidden})</button>}
    </div>
  );
}
