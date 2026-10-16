import type { ComponentType } from 'react';
import {
  BoardNavIcon,
  HarnessIcon,
  SessionsIcon,
  SettingsIcon,
  SkillsIcon,
  TokensIcon,
  WorkflowIcon,
  type IconProps,
} from '../components/icons';
import { SHELL_COPY } from '../lib/copy';
import type { ProjectPageId } from '../lib/router';

export interface ProjectPageDef {
  id: ProjectPageId;
  label: string;
  icon: ComponentType<IconProps>;
  /**
   * False until the page's WP ships it (AGENTS.md rule 10: no placeholder pages). An unavailable
   * page has no sidebar entry and no palette entry, and its address reads "Page not found". The
   * page WP flips this flag in the same change that adds its screen to `ProjectScreen` (App.tsx).
   */
  available: boolean;
}

const L = SHELL_COPY.nav.pages;

/** The project sidebar, in order (docs/redesign/README.md §3). One list for nav and palette. */
export const PROJECT_PAGES: readonly ProjectPageDef[] = [
  { id: 'board', label: L.board, icon: BoardNavIcon, available: true },
  // R-B.
  { id: 'workflow', label: L.workflow, icon: WorkflowIcon, available: false },
  // R-D.
  { id: 'skills', label: L.skills, icon: SkillsIcon, available: false },
  // R-E.
  { id: 'harness', label: L.harness, icon: HarnessIcon, available: true },
  // R-F.
  { id: 'tokens', label: L.tokens, icon: TokensIcon, available: true },
  { id: 'sessions', label: L.sessions, icon: SessionsIcon, available: true },
  { id: 'settings', label: L.settings, icon: SettingsIcon, available: true },
];

export function availableProjectPages(
  pages: readonly ProjectPageDef[] = PROJECT_PAGES,
): ProjectPageDef[] {
  return pages.filter((p) => p.available);
}

export function isProjectPageAvailable(
  id: ProjectPageId,
  pages: readonly ProjectPageDef[] = PROJECT_PAGES,
): boolean {
  return pages.some((p) => p.id === id && p.available);
}
