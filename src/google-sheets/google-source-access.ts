import type { DataSource } from '../modules/data-sources/entities/data-source.entity';
import type { GoogleAccess } from '../modules/google-connections/google-connections.service';

export function sourceGoogleAccess(
  source: Pick<DataSource, 'ownerId' | 'connectionMetaJson'>,
): GoogleAccess | undefined {
  const id: unknown = source.connectionMetaJson?.googleConnectionId;
  return typeof id === 'string' && id
    ? { ownerId: source.ownerId, connectionId: id }
    : undefined;
}
