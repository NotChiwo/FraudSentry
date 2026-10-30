// Transactions module — "Did the money arrive?" buttons for one receipt. The
// answer is the transaction's status and also its training label for the forest.
import { useAppStore } from '../shared/store';
import { OutcomeControl } from './TransactionsPage';
import type { ImageScanResult } from '../shared/types';

// After checking their own account, the user marks whether the money arrived.
// That real outcome is also the receipt's training label for the Random
// Forest (received = genuine, not received = fake); only the 10 numeric
// evidence features and the label are kept for training.
export default function TrainingLabel({ scan }: { scan: ImageScanResult; compact?: boolean }) {
  const live = useAppStore(s => s.imageScans.find(x => x.id === scan.id));
  const label = useAppStore(s => s.trainingRows.find(r => r.id === scan.id)?.label ?? null);
  const setTxStatus = useAppStore(s => s.setTxStatus);
  // older receipts may have a training label but no outcome yet
  const status = live?.txStatus && live.txStatus !== 'pending' ? live.txStatus : label === 0 ? 'received' : label === 1 ? 'not-received' : 'pending';
  return <OutcomeControl status={status} statusAt={live?.txStatusAt} isReceipt onChange={st => setTxStatus('receipt', scan.id, st)} />;
}
