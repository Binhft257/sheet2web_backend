import { createHash } from 'node:crypto';
import type { GridSnapshot } from './grid-layout';

export function hashGridSnapshot(snapshot: GridSnapshot): string {
  // Only normalized, public-safe values/structure participate; no raw formulas or timestamps.
  return createHash('sha256')
    .update(
      JSON.stringify({
        headers: snapshot.headers,
        rows: snapshot.rows,
        layout: snapshot.gridLayout,
        issues: snapshot.issues.map((issue) => issue.code).sort(),
        visibilityPolicyVersion: 1,
      }),
    )
    .digest('hex');
}
