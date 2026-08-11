export type GenerationEnqueueAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Pending-job metadata and callbacks may only be published after the native
 * generation command accepts the request. A rejected command must leave no
 * state that can be attached to a later, unrelated task.
 */
export async function generateBeforeNotifying<T>(
  generate: () => Promise<T>,
  notifyEnqueued: (value: T) => void | Promise<void>,
): Promise<GenerationEnqueueAttempt<T>> {
  let value: T;
  try {
    value = await generate();
  } catch (error) {
    return { ok: false, error };
  }

  await notifyEnqueued(value);
  return { ok: true, value };
}
