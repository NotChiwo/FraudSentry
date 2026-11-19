// "Seen before in your records": shown with a result. Looks the check up
// against every earlier record in the on-device database (fraudMemory.ts).
import { History as HistoryIcon, Repeat2 } from 'lucide-react';
import { useAppStore } from '../shared/store';
import { formatDateTime } from '../shared/helpers';
import { findPriorCases, type AnyRecord, type PriorRef, type RecordKind } from './fraudMemory';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function PriorCasesCard({ kind, record }: { kind: RecordKind; record: AnyRecord }) {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const crossChecks = useAppStore(s => s.crossChecks);
  const manualTransactions = useAppStore(s => s.manualTransactions);
  const setFocusResultId = useAppStore(s => s.setFocusResultId);
  const p = findPriorCases(kind, record, { imageScans, messageScans, crossChecks, manualTransactions });

  const open = (r: PriorRef) => {
    setFocusResultId(r.id);
    location.hash = r.kind === 'transaction' ? '#transactions' : '#history';
  };
  const list = (rs: PriorRef[]) => (
    <ul className="prior-list">
      {rs.slice(0, 3).map(r => (
        <li key={r.id}>
          <button type="button" className="link-btn" onClick={() => open(r)}>{r.title}</button>
          <span className="muted"> · {formatDateTime(r.at)} · {r.riskLevel}</span>
        </li>
      ))}
    </ul>
  );

  const seenTypes = p.byType.filter(t => t.count > 0);
  const newTypes = p.byType.filter(t => t.count === 0);
  const anything = seenTypes.length || p.sameReference.length || p.sameRecipient.length || p.sameContact.length;

  return (
    <section className="card pad prior-card" aria-labelledby={`prior-${record.id}`}>
      <h3 id={`prior-${record.id}`} className="section-title"><HistoryIcon size={18} /> Seen before in your records</h3>
      {!anything ? (
        <p className="small muted" style={{ margin: 0 }}>
          {p.searched ? `Checked against ${plural(p.searched, 'earlier record')} in the on-device database: ` : 'This is the first record in the on-device database: '}
          {p.byType.length ? `this is the first time ${newTypes.map(t => `“${t.type}”`).join(', ')} has been seen, and ` : ''}
          {kind === 'message' ? 'no earlier message has the same suspicious link or phone number.' : kind === 'cross' ? 'nothing earlier matches it.' : 'no earlier check has the same reference number or recipient.'}
        </p>
      ) : (
        <>
          {seenTypes.map(t => (
            <div key={t.type} className="prior-block">
              <p className="small"><Repeat2 size={14} style={{ verticalAlign: '-2px' }} /> <strong>{t.type}</strong> has been seen <strong>{plural(t.count, 'time')}</strong> before, most recently on {formatDateTime(t.lastAt!)}.</p>
              {list(t.examples)}
            </div>
          ))}
          {p.sameReference.length > 0 && (
            <div className="prior-block">
              <p className="small"><strong>The same reference number</strong> is in {plural(p.sameReference.length, 'earlier check')}. One payment has one reference: a repeat usually means a reused or edited receipt.</p>
              {list(p.sameReference)}
            </div>
          )}
          {p.sameRecipient.length > 0 && (
            <div className="prior-block">
              <p className="small"><strong>The same recipient</strong> is in {plural(p.sameRecipient.length, 'earlier check')}.</p>
              {list(p.sameRecipient)}
            </div>
          )}
          {p.sameContact.length > 0 && (
            <div className="prior-block">
              <p className="small"><strong>The same suspicious link or phone number</strong> was in {plural(p.sameContact.length, 'earlier message')}.</p>
              {list(p.sameContact)}
            </div>
          )}
          {newTypes.length > 0 && <p className="small muted" style={{ margin: '8px 0 0' }}>First time seen: {newTypes.map(t => t.type).join(', ')}.</p>}
          <p className="small muted" style={{ margin: '8px 0 0' }}>Searched {plural(p.searched, 'earlier record')} in the on-device database.</p>
        </>
      )}
    </section>
  );
}
