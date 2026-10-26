import {
  ArrowLeft,
  Bot,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Compass,
  FileText,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  List,
  Link2,
  Lock,
  Maximize,
  MousePointerClick,
  Redo2,
  ScanSearch,
  Trash,
  Undo2,
  UserCheck,
  WandSparkles,
  Users,
  X,
  ZoomIn,
  ZoomOut,
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
/** v0.3.0 D-C: the editor's problem marker, canvas tools and legend. */
export const ErrorIcon = icon(CircleAlert, 'ErrorIcon');
export const HelpIcon = icon(CircleHelp, 'HelpIcon');
export const LegendIcon = icon(List, 'LegendIcon');
export const FitIcon = icon(Maximize, 'FitIcon');
export const ZoomInIcon = icon(ZoomIn, 'ZoomInIcon');
export const ZoomOutIcon = icon(ZoomOut, 'ZoomOutIcon');
/** The editor's history and layout tools (v0.3.1 P-C). */
export const UndoIcon = icon(Undo2, 'UndoIcon');
export const RedoIcon = icon(Redo2, 'RedoIcon');
export const TidyIcon = icon(WandSparkles, 'TidyIcon');
export const LinkIcon = icon(Link2, 'LinkIcon');

/** One icon per agent role, so a node reads at a glance (the role's word is always next to it). */
export const ROLE_ICON: Record<WorkflowRole, ReturnType<typeof icon>> = {
  planner: icon(ClipboardList, 'PlannerIcon'),
  lead: icon(Compass, 'LeadIcon'),
  helper: icon(Users, 'HelperIcon'),
  reviewer: icon(ScanSearch, 'ReviewerIcon'),
  tester: icon(FlaskConical, 'TesterIcon'),
};
