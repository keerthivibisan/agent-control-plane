import {
  ArrowLeft,
  Bot,
  CircleCheck,
  ClipboardList,
  Compass,
  FileText,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Lock,
  MousePointerClick,
  ScanSearch,
  Trash,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { IconProps } from '../../components/icons';
import type { WorkflowRole } from './graph';

/*
 * Icons of the Workflow and Skills & Agents pages, in the style of components/icons.tsx (lucide,
 * 1.75px strokes, decorative): every icon sits next to a word or inside a labelled control, so an
 * icon never adds text.
 */
function icon(Lucide: LucideIcon, name: string) {
  function FeatureIcon({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
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
  FeatureIcon.displayName = name;
  return FeatureIcon;
}

/** An agent definition file (`.claude/agents/<name>.md`): on nodes, the legend and the lists. */
export const AgentFileIcon = icon(Bot, 'AgentFileIcon');
export const ReadOnlyIcon = icon(Lock, 'ReadOnlyIcon');
export const OwnCopyIcon = icon(GitBranch, 'OwnCopyIcon');
export const YouIcon = icon(UserCheck, 'YouIcon');
export const MergeIcon = icon(GitMerge, 'MergeIcon');
export const DoneIcon = icon(CircleCheck, 'DoneIcon');
export const PickStageIcon = icon(MousePointerClick, 'PickStageIcon');
export const BackIcon = icon(ArrowLeft, 'BackIcon');
export const RemoveIcon = icon(X, 'RemoveIcon');
export const FileIcon = icon(FileText, 'FileIcon');
export const CommitIcon = icon(GitCommitHorizontal, 'CommitIcon');
export const DeleteIcon = icon(Trash, 'DeleteIcon');

/** One icon per agent role, so a node reads at a glance (the role's word is always next to it). */
export const ROLE_ICON: Record<WorkflowRole, ReturnType<typeof icon>> = {
  planner: icon(ClipboardList, 'PlannerIcon'),
  lead: icon(Compass, 'LeadIcon'),
  helper: icon(Users, 'HelperIcon'),
  reviewer: icon(ScanSearch, 'ReviewerIcon'),
  tester: icon(FlaskConical, 'TesterIcon'),
};
