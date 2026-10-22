import {
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Keyboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import type { IconProps } from '../../components/icons';

/*
 * The review page's icons, in the style of components/icons.tsx (lucide, 1.75px strokes,
 * decorative): each sits next to a word or inside a labelled control.
 */
function icon(Lucide: LucideIcon, name: string) {
  function ReviewIcon({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
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
  ReviewIcon.displayName = name;
  return ReviewIcon;
}

export const FolderIcon = icon(Folder, 'FolderIcon');
export const FolderOpenIcon = icon(FolderOpen, 'FolderOpenIcon');
export const ChevronIcon = icon(ChevronRight, 'ChevronIcon');
export const ViewedIcon = icon(Check, 'ViewedIcon');
export const CommentIcon = icon(MessageSquare, 'CommentIcon');
export const AddCommentIcon = icon(Plus, 'AddCommentIcon');
export const KeyboardIcon = icon(Keyboard, 'KeyboardIcon');
export const HideTreeIcon = icon(PanelLeftClose, 'HideTreeIcon');
export const ShowTreeIcon = icon(PanelLeftOpen, 'ShowTreeIcon');
