import { ExternalLink, GitPullRequest, RefreshCw, type LucideIcon } from 'lucide-react';
import type { IconProps } from '../../components/icons';

/*
 * Icons of the GitHub screens (ADR-0025), in the style of components/icons.tsx (lucide, 1.75px
 * strokes, decorative): each sits next to a word or inside a labelled control.
 */
function icon(Lucide: LucideIcon, name: string) {
  function CodeHostIcon({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <Lucide
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
        {...rest}
      />
    );
  }
  CodeHostIcon.displayName = name;
  return CodeHostIcon;
}

export const PullRequestIcon = icon(GitPullRequest, 'PullRequestIcon');
export const ExternalLinkIcon = icon(ExternalLink, 'ExternalLinkIcon');
export const RefreshIcon = icon(RefreshCw, 'RefreshIcon');
