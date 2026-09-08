// Derived footer indicator for orphaned background processes (plan step 4).
// The orphan watchdog mirrors its count into AppState.orphanAlertCount, so
// this reads AppState directly — deterministic, unlike the React notification
// queue, which has a processing gap for non-React events.

import * as React from 'react';
import { Box, Text } from '../ink.js';
import { useAppState } from '../state/AppState.js';

export function OrphanProcessesIndicator(): React.ReactNode {
  const orphanAlertCount = useAppState((s) => s.orphanAlertCount);
  if (!orphanAlertCount) {
    return null;
  }
  return (
    <Box>
      <Text color="warning" wrap="truncate">
        {`⚠ ${orphanAlertCount} orphaned process(es) — /tasks to kill`}
      </Text>
    </Box>
  );
}
