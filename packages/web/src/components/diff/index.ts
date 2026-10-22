export { DiffSection } from './DiffSection';
export { DiffViewer } from './DiffViewer';
export { parseDiff, type DiffFile, type DiffLine, type ParsedDiff } from './parse';
// v0.3.0 D-A: the parts the review page builds its own "Files changed" layout from.
export { DIFF_COPY } from './copy';
export { DiffFileView, FilePath, type DiffLineSlots, type DiffSide } from './DiffFileView';
export { STATUS_ICON, STATUS_TONE } from './icons';
export { initiallyShown, missingPaths } from './layout';
export { fileLineCount } from './parse';
export {
  VIEW_MODE_KEY,
  readViewMode,
  useSplitFits,
  useViewMode,
  type DiffViewMode,
} from './view-mode';
