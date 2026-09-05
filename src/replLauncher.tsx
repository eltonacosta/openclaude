import React from 'react';
import type { StatsStore } from './context/stats.js';
import type { Root } from './ink.js';
import type { Props as REPLProps } from './screens/REPL.js';
import type { AppState } from './state/AppStateStore.js';
import type { FpsMetrics } from './utils/fpsTracker.js';
type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
};
export async function launchRepl(root: Root, appProps: AppWrapperProps, replProps: REPLProps, renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>): Promise<void> {
  const {
    App
  } = await import('./components/App.js');
  const {
    REPL
  } = await import('./screens/REPL.js');
  const {
    StartupHeader
  } = await import('./components/StartupHeader.js');
  // Pinned brand header above the REPL. It is part of the Ink tree (unlike
  // the pre-Ink splash) so ctrl+l's forceRedraw repaints it instead of
  // erasing it.
  await renderAndRun(root, <App {...appProps}>
      <StartupHeader />
      <REPL {...replProps} />
    </App>);
}
