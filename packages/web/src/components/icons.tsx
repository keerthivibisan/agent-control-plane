import {
  MessagesSquare,
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Bug,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  GitMerge,
  Inbox,
  Info,
  LayoutDashboard,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Network,
  Plus,
  ScrollText,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkle,
  Sparkles,
  SquareKanban,
  Star,
  Sun,
  Ticket,
  TriangleAlert,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { SVGProps } from 'react';

/**
 * The app's icons: lucide (bundled, tree-shaken), under the names the app already uses. 24×24
 * strokes in `currentColor` at 1.75px, decorative by default (`aria-hidden`): every icon sits next
 * to a visible word or an `aria-label`, so icons never add text.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function icon(Lucide: LucideIcon, name: string) {
  function AppIcon({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
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
  AppIcon.displayName = name;
  return AppIcon;
}

export const OverviewIcon = icon(LayoutDashboard, 'OverviewIcon');
export const SessionsIcon = icon(List, 'SessionsIcon');
export const TokensIcon = icon(ChartColumn, 'TokensIcon');
export const ProjectsIcon = icon(Folder, 'ProjectsIcon');
export const SetupIcon = icon(Plus, 'SetupIcon');
export const HealthIcon = icon(Activity, 'HealthIcon');
export const InfoIcon = icon(Info, 'InfoIcon');
export const CopyIcon = icon(Copy, 'CopyIcon');
export const CheckIcon = icon(Check, 'CheckIcon');
export const SunIcon = icon(Sun, 'SunIcon');
export const MoonIcon = icon(Moon, 'MoonIcon');
export const MonitorIcon = icon(Monitor, 'MonitorIcon');
export const ChevronRightIcon = icon(ChevronRight, 'ChevronRightIcon');
export const InboxIcon = icon(Inbox, 'InboxIcon');
export const SparkIcon = icon(Sparkle, 'SparkIcon');

// --- Shell: one icon per sidebar entry, plus the top bar's controls. -----------------------------

export const BoardNavIcon = icon(SquareKanban, 'BoardNavIcon');
export const WorkflowIcon = icon(Workflow, 'WorkflowIcon');
export const SkillsIcon = icon(Sparkles, 'SkillsIcon');
export const HarnessIcon = icon(ShieldCheck, 'HarnessIcon');
// The Code map page (ADR-0034, CM-4).
export const CodeMapIcon = icon(Network, 'CodeMapIcon');
export const SettingsIcon = icon(Settings, 'SettingsIcon');
export const GridIcon = icon(LayoutGrid, 'GridIcon');
export const SearchIcon = icon(Search, 'SearchIcon');
export const ChevronDownIcon = icon(ChevronDown, 'ChevronDownIcon');
export const PlusSmallIcon = icon(Plus, 'PlusSmallIcon');
export const TicketIcon = icon(Ticket, 'TicketIcon');
export const ArrowRightIcon = icon(ArrowRight, 'ArrowRightIcon');

// The board's icons (features/board/icons.tsx re-exports them); the alert and ticket types are used
// across the app too.
export const MoveIcon = icon(ArrowLeftRight, 'MoveIcon');
export const AlertIcon = icon(TriangleAlert, 'AlertIcon');
export const FeatureIcon = icon(Star, 'FeatureIcon');
export const BugIcon = icon(Bug, 'BugIcon');
export const ChoreIcon = icon(Wrench, 'ChoreIcon');

// Shared primitives (Dialog).
export const CloseIcon = icon(X, 'CloseIcon');

// Ticket comments the app writes itself (v0.3.0, ADR-0024): the run summary and the merge line.
export const RunSummaryIcon = icon(ScrollText, 'RunSummaryIcon');
export const MergeIcon = icon(GitMerge, 'MergeIcon');

// The project assistant (ADR-0035, AS-2): its floating button and the send button.
export const AssistantIcon = icon(MessagesSquare, 'AssistantIcon');
export const SendIcon = icon(SendHorizontal, 'SendIcon');
