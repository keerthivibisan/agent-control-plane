import {
  Binary,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileDiff,
  FileMinus,
  FilePlus,
  FileSymlink,
  UnfoldVertical,
  type LucideIcon,
} from 'lucide-react';
import type { IconProps } from '../icons';
import type { DiffFileStatus } from './parse';

/*
 * The diff viewer's icons, in the style of components/icons.tsx (lucide, 1.75px strokes,
 * decorative): each sits next to a word or inside a labelled control.
 */
function icon(Lucide: LucideIcon, name: string) {
  function DiffIcon({ size = 15, strokeWidth = 1.75, ...rest }: IconProps) {
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
  DiffIcon.displayName = name;
  return DiffIcon;
}

export const ChevronIcon = icon(ChevronRight, 'ChevronIcon');
export const CollapseAllIcon = icon(ChevronsDownUp, 'CollapseAllIcon');
export const ExpandAllIcon = icon(ChevronsUpDown, 'ExpandAllIcon');
export const UnfoldIcon = icon(UnfoldVertical, 'UnfoldIcon');
export const BinaryIcon = icon(Binary, 'BinaryIcon');

export const STATUS_ICON: Readonly<Record<DiffFileStatus, ReturnType<typeof icon>>> = {
  added: icon(FilePlus, 'FileAddedIcon'),
  deleted: icon(FileMinus, 'FileDeletedIcon'),
  modified: icon(FileDiff, 'FileChangedIcon'),
  renamed: icon(FileSymlink, 'FileRenamedIcon'),
  copied: icon(Copy, 'FileCopiedIcon'),
};

/** The status color: meaning only (DESIGN.md), next to the status word. */
export const STATUS_TONE: Readonly<Record<DiffFileStatus, string>> = {
  added: 'text-success',
  deleted: 'text-danger',
  modified: 'text-dim',
  renamed: 'text-accent',
  copied: 'text-accent',
};
