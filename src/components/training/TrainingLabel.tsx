import { useAppStore } from '../../store/useAppStore';
import { OutcomeControl } from '../../pages/TransactionsPage';
import type { ImageScanResult } from '../../types';

// After checking their own account, the user marks whether the money arrived.
// That real outcome is also the receipt's training label for the Random
// Forest (received = genuine, not received = fake); only the 10 numeric
// evidence features and the label are kept for training.
export default function TrainingLabel({ scan }: { scan: ImageScanResult; compact?: boolean }) {
  const live = useAppStore(s => s.imageScans.find(x => x.id === scan.id));
  const label = useAppStore(s => s.trainingRows.find(r => r.id === scan.id)?.label ?? null);
  const setTxStatus = useAppStore(s => s.setTxStatus);
  // receipts labelled before V9.1 have a label but no outcome yet
  const status = live?.txStatus && live.txStatus !== 'pending' ? live.txStatus : label === 0 ? 'received' : label === 1 ? 'not-received' : 'pending';
  return <OutcomeControl status={status} statusAt={live?.txStatusAt} isReceipt onChange={st => setTxStatus('receipt', scan.id, st)} />;
}
