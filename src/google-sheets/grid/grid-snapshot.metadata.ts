import type { GridIssue, GridLayout } from './grid-layout';

export type GridSnapshotMetadata = {
  visibilityPolicyVersion: 1;
  gridLayout: GridLayout;
  issues: GridIssue[];
};

export function readGridSnapshotMetadata(
  value: unknown,
): GridSnapshotMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Partial<GridSnapshotMetadata>;
  const layout = metadata.gridLayout;
  if (
    metadata.visibilityPolicyVersion !== 1 ||
    layout?.version !== 1 ||
    !Array.isArray(layout.rowMap) ||
    !Array.isArray(layout.columnMap) ||
    layout.rowCount !== layout.rowMap.length ||
    layout.columnCount !== layout.columnMap.length ||
    !Array.isArray(metadata.issues)
  )
    return null;
  return metadata as GridSnapshotMetadata;
}
