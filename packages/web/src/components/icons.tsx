import {
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
  Inbox,
  Info,
  LayoutDashboard,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Plus,
  Search,
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
export const SettingsIcon = icon(Settings, 'SettingsIcon');
export const GridIcon = icon(LayoutGrid, 'GridIcon');
export const SearchIcon = icon(Search, 'SearchIcon');
export const ChevronDownIcon = icon(ChevronDown, 'ChevronDownIcon');
export const PlusSmallIcon = icon(Plus, 'PlusSmallIcon');
export const TicketIcon = icon(Ticket, 'TicketIcon');
export const ArrowRightIcon = icon(ArrowRight, 'ArrowRightIcon');

/*
 * Lucide equivalents of the board's own icons (features/board/icons.tsx), for U-C to adopt. The
 * board keeps its hand-drawn set until then.
 */
export const MoveIcon = icon(ArrowLeftRight, 'MoveIcon');
export const AlertIcon = icon(TriangleAlert, 'AlertIcon');
export const FeatureIcon = icon(Star, 'FeatureIcon');
export const BugIcon = icon(Bug, 'BugIcon');
export const ChoreIcon = icon(Wrench, 'ChoreIcon');

// Shared primitives (Dialog).
export const CloseIcon = icon(X, 'CloseIcon');
