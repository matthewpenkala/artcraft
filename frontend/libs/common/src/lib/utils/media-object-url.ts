/**
 * Process-lifetime registry for object URLs created for prompt references and
 * temporary media probes. A URL is owned only when it was created here; its
 * `blob:` spelling is never used as an ownership signal.
 */

export type MediaObjectUrlOwner = string | symbol;

export interface MediaObjectUrlOwnershipTransition {
  owner: MediaObjectUrlOwner;
  previousUrls: Iterable<string | null | undefined>;
  nextUrls: Iterable<string | null | undefined>;
}

interface OwnedObjectUrlRecord {
  owners: Set<MediaObjectUrlOwner>;
}

const ownedObjectUrls = new Map<string, OwnedObjectUrlRecord>();

export function createOwnedMediaObjectUrl(blob: Blob | MediaSource): string {
  const url = URL.createObjectURL(blob);
  ownedObjectUrls.set(url, { owners: new Set() });
  return url;
}

export function isOwnedMediaObjectUrl(url: string): boolean {
  return ownedObjectUrls.has(url);
}

/**
 * Release an uncommitted/temporary URL. Committed URLs are protected by their
 * state owners and can only be released through reconciliation.
 */
export function discardOwnedMediaObjectUrl(url: string): boolean {
  const record = ownedObjectUrls.get(url);
  if (!record || record.owners.size > 0) return false;
  revokeOwnedMediaObjectUrl(url);
  return true;
}

/**
 * Reconcile one store field from its previous URL collection to its next one.
 * Shared URLs remain live while any registered state owner still retains
 * them. Borrowed CDN/data/blob URLs are ignored.
 */
export function reconcileOwnedMediaObjectUrls(
  owner: MediaObjectUrlOwner,
  previousUrls: Iterable<string | null | undefined>,
  nextUrls: Iterable<string | null | undefined>,
): void {
  reconcileOwnedMediaObjectUrlOwners([{ owner, previousUrls, nextUrls }]);
}

/**
 * Reconcile several state fields atomically. Every next owner is registered
 * before any previous owner is released, so moving one URL between fields in
 * a single store update cannot revoke it in the middle of the transfer.
 */
export function reconcileOwnedMediaObjectUrlOwners(
  transitions: Iterable<MediaObjectUrlOwnershipTransition>,
): void {
  const normalized = [...transitions].map((transition) => ({
    owner: transition.owner,
    previous: new Set(withoutEmpty(transition.previousUrls)),
    next: new Set(withoutEmpty(transition.nextUrls)),
  }));

  for (const { owner, next } of normalized) {
    for (const url of next) {
      ownedObjectUrls.get(url)?.owners.add(owner);
    }
  }

  for (const { owner, previous, next } of normalized) {
    for (const url of previous) {
      if (next.has(url)) continue;
      const record = ownedObjectUrls.get(url);
      if (!record) continue;
      record.owners.delete(owner);
      if (record.owners.size === 0) revokeOwnedMediaObjectUrl(url);
    }
  }
}

/** Create a probe-only URL and guarantee release on resolve or rejection. */
export async function withTemporaryMediaObjectUrl<T>(
  blob: Blob | MediaSource,
  operation: (url: string) => Promise<T> | T,
): Promise<T> {
  const url = createOwnedMediaObjectUrl(blob);
  try {
    return await operation(url);
  } finally {
    discardOwnedMediaObjectUrl(url);
  }
}

function revokeOwnedMediaObjectUrl(url: string): void {
  if (!ownedObjectUrls.delete(url)) return;
  URL.revokeObjectURL(url);
}

function withoutEmpty(urls: Iterable<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const url of urls) {
    if (url) result.push(url);
  }
  return result;
}

/** Test-only reset; production state must release through reconciliation. */
export function resetOwnedMediaObjectUrlsForTests(): void {
  for (const url of [...ownedObjectUrls.keys()]) {
    ownedObjectUrls.get(url)?.owners.clear();
    discardOwnedMediaObjectUrl(url);
  }
}
