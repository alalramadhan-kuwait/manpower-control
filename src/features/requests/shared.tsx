import type { RequestStatus } from '@/data/requests';
import { Chip, type Tone } from '@/ui/components';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: 'Waiting for review', reviewed: 'Waiting for decision', approved: 'Approved', not_approved: 'Not approved', withdrawn: 'Withdrawn'
};
const STATUS_TONE: Record<RequestStatus, Tone> = { submitted: 'neutral', reviewed: 'blue', approved: 'green', not_approved: 'red', withdrawn: 'neutral' };

export function StatusChip({ status }: { status: RequestStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

export const dayCount = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
