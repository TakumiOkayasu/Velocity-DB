import { useMemo } from 'react';
import type { TriggerInfo } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface TriggersTabProps {
  triggers: TriggerInfo[];
}

export function TriggersTab({ triggers }: TriggersTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'name', headerName: 'Trigger Name', width: '25%' },
      { field: 'type', headerName: 'Type', width: 120 },
      { field: 'events', headerName: 'Events', width: '30%' },
      {
        field: 'isEnabled',
        headerName: 'Enabled',
        width: 80,
        formatter: (value: unknown) => (value ? 'Yes' : 'No'),
      },
    ],
    []
  );

  const data = useMemo(
    () =>
      triggers.map((trigger) => ({
        name: trigger.name,
        type: trigger.type,
        events: trigger.events.join(', '),
        isEnabled: trigger.isEnabled,
      })),
    [triggers]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
