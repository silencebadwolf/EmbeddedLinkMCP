import type * as React from 'react';
import { Button } from '../../components/ui/button.js';
import { useT, type TranslationKey } from '../../i18n/index.js';
import {
  selectDefaultActivityGroups,
  type ActivityCenterState,
  type ActivityDefaultGroup,
} from './activity-reducer.js';

interface AiStatusCapsuleProps {
  readonly state: ActivityCenterState;
  readonly onOpen: () => void;
}

type CapsuleStatus = 'attention' | 'running' | 'idle';

const STATUS_COPY: Record<
  CapsuleStatus,
  { readonly label: TranslationKey; readonly ariaLabel: TranslationKey }
> = {
  attention: {
    label: 'activity.capsule.status.attention',
    ariaLabel: 'activity.capsule.aria.attention',
  },
  running: {
    label: 'activity.capsule.status.running',
    ariaLabel: 'activity.capsule.aria.running',
  },
  idle: {
    label: 'activity.capsule.status.idle',
    ariaLabel: 'activity.capsule.aria.idle',
  },
};

export function AiStatusCapsule({
  state,
  onOpen,
}: AiStatusCapsuleProps): React.ReactElement {
  const t = useT();
  const activityStatus = getActivityCapsuleStatus(state);
  const copy = STATUS_COPY[activityStatus];

  return (
    <Button
      type="button"
      variant={activityStatus === 'attention' ? 'destructive' : activityStatus === 'idle' ? 'ghost' : 'secondary'}
      size="sm"
      aria-label={t(copy.ariaLabel)}
      onClick={onOpen}
    >
      <span aria-hidden="true">AI</span>
      <span>{t(copy.label)}</span>
    </Button>
  );
}

function getActivityCapsuleStatus(state: ActivityCenterState): Exclude<CapsuleStatus, 'paused'> {
  const groups: readonly ActivityDefaultGroup[] = selectDefaultActivityGroups(state);
  if (groups.some((group) => group.kind === 'attention')) {
    return 'attention';
  }

  if (groups.some((group) => group.kind === 'active')) {
    return 'running';
  }

  return 'idle';
}
