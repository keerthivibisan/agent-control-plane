import {
  Bot,
  CircleCheck,
  FileDiff,
  FileText,
  History,
  MessageSquare,
  Pencil,
  Play,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { IconProps } from '../../components/icons';

/*
 * Icons of the ticket page's tabs and timeline (v0.3.0 D-B), in the style of components/icons.tsx
 * (lucide, 1.75px strokes, decorative): each sits next to a word or inside a labelled control.
 */
function icon(Lucide: LucideIcon, name: string) {
  function TicketPageIcon({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
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
  TicketPageIcon.displayName = name;
  return TicketPageIcon;
}

export const CommentsIcon = icon(MessageSquare, 'CommentsIcon');
/** Conversation (v0.3.0 C-B): the timeline of what happened on the ticket. */
export const ConversationIcon = icon(History, 'ConversationIcon');
export const AgentsIcon = icon(Bot, 'AgentsIcon');
export const FilesChangedIcon = icon(FileDiff, 'FilesChangedIcon');
export const ChecksIcon = icon(CircleCheck, 'ChecksIcon');
export const EditIcon = icon(Pencil, 'EditIcon');
export const RunStartedIcon = icon(Play, 'RunStartedIcon');
export const PlanIcon = icon(FileText, 'PlanIcon');
export const OwnerIcon = icon(UserRound, 'OwnerIcon');
