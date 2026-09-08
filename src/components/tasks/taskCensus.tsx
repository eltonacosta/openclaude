// Dialog-scoped census plumbing for the BackgroundTasksDialog (plan step 5).
//
// The census is held in local dialog state (NOT AppState) so the cost of the
// platform snapshot (PowerShell CIM on Windows) only runs while the dialog is
// open and at least one shell task is running. Shell rows read descendant
// counts/RAM from the context; the orphan watchdog + spawn ledger stay the
// source of truth for orphans themselves.

import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from '../../ink.js';
import figures from 'figures';
import {
  getDescendants,
  snapshotProcessTable,
  type ProcessInfo,
} from '../../utils/processCensus.js';
import { formatFileSize, truncateToWidth } from '../../utils/format.js';

const CENSUS_INTERVAL_MS = 5000;

export const TaskCensusContext = React.createContext<ProcessInfo[] | null>(null);

/**
 * Poll the process table at a 5s interval while `enabled`. The hook stays
 * dialog-local: closing the dialog (or no running shells) stops the polling.
 */
export function useTaskCensus(enabled: boolean): {
  table: ProcessInfo[];
  refresh: () => void;
} {
  const [table, setTable] = useState<ProcessInfo[]>([]);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const run = () => {
      void snapshotProcessTable().then((t) => {
        if (!cancelled) {
          setTable(t);
        }
      });
    };
    run();
    const timer = setInterval(run, CENSUS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return { table, refresh: () => void snapshotProcessTable().then(setTable) };
}

export function useCensusDescendants(shellPid: number | undefined): ProcessInfo[] {
  const table = React.useContext(TaskCensusContext);
  if (!table || shellPid === undefined) {
    return [];
  }
  return getDescendants(table, shellPid);
}

/** `· N procs · X MB` suffix shown on running shell rows in the list. */
export function ShellProcSummary({ shellPid }: { shellPid: number | undefined }): React.ReactNode {
  const descendants = useCensusDescendants(shellPid);
  if (descendants.length === 0) {
    return null;
  }
  const totalMem = descendants.reduce((sum, d) => sum + (d.memoryBytes ?? 0), 0);
  return (
    <Text dimColor>
      {` · ${descendants.length} procs${totalMem > 0 ? ` · ${formatFileSize(totalMem)}` : ''}`}
    </Text>
  );
}

/** Expandable descendant list for the shell detail dialog. */
export function ShellDescendants({ shellPid }: { shellPid: number }): React.ReactNode {
  const descendants = useCensusDescendants(shellPid);
  if (descendants.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      <Text bold>{'Processes:'}</Text>
      {descendants.map((d) => (
        <Text key={d.pid} dimColor wrap="truncate-end">
          {`  ${d.pid}  ${d.name}${d.memoryBytes ? `  ${formatFileSize(d.memoryBytes)}` : ''}${d.commandLine ? `  ${truncateToWidth(d.commandLine, 60)}` : ''}`}
        </Text>
      ))}
    </Box>
  );
}

type OrphanItemProps = {
  orphan: ProcessInfo;
  sourceCommand: string;
  isSelected: boolean;
};

/** One "Orphaned processes" row in the /tasks list. */
export function OrphanItem({ orphan, sourceCommand, isSelected }: OrphanItemProps): React.ReactNode {
  const marker = isSelected ? `${figures.pointer} ` : '  ';
  const mem = orphan.memoryBytes ? ` · ${formatFileSize(orphan.memoryBytes)}` : '';
  const cmd = orphan.commandLine ? ` · ${truncateToWidth(orphan.commandLine, 50)}` : '';
  return (
    <Box flexDirection="row">
      <Text dimColor={isSelected}>{marker}</Text>
      <Text color={isSelected ? 'suggestion' : 'warning'} wrap="truncate">
        {`⚠ ${orphan.name} (pid ${orphan.pid})${mem}${cmd} — survived kill of "${truncateToWidth(sourceCommand, 40)}" · x to kill`}
      </Text>
    </Box>
  );
}
