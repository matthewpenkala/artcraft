import { CommonBitrate } from "@storyteller/api-enums";

export interface VideoBitrateCapabilities {
  readonly bitrateOptions?: readonly CommonBitrate[];
  readonly defaultBitrate?: CommonBitrate;
}

const COMMON_BITRATE_VALUES: ReadonlySet<string> = new Set(
  Object.values(CommonBitrate),
);

const COMMON_BITRATE_LABELS: Record<CommonBitrate, string> = {
  [CommonBitrate.Normal]: "Normal",
  [CommonBitrate.High]: "High",
};

export function commonBitrateFromString(
  value: string | null | undefined,
): CommonBitrate | undefined {
  return value != null && COMMON_BITRATE_VALUES.has(value)
    ? (value as CommonBitrate)
    : undefined;
}

export function normalizeVideoBitrateOptions(
  values: readonly string[] | null | undefined,
): CommonBitrate[] | undefined {
  if (values === undefined) return undefined;
  if (values === null) return [];

  return Array.from(
    new Set(
      values
        .map(commonBitrateFromString)
        .filter((value): value is CommonBitrate => value !== undefined),
    ),
  );
}

/**
 * Resolve one legal bitrate for the current model.
 *
 * A still-valid user or Recreate selection wins. Otherwise the catalog default
 * wins when it is advertised, followed by the first option for older catalogs
 * that omitted a usable default. Models without options do not send bitrate.
 */
export function resolveVideoBitrate(
  model: VideoBitrateCapabilities | null | undefined,
  currentBitrate: CommonBitrate | null | undefined,
): CommonBitrate | null {
  const options = model?.bitrateOptions ?? [];
  if (options.length === 0) return null;
  if (currentBitrate && options.includes(currentBitrate)) {
    return currentBitrate;
  }
  if (model?.defaultBitrate && options.includes(model.defaultBitrate)) {
    return model.defaultBitrate;
  }
  return options[0] ?? null;
}

export function videoBitrateLabel(bitrate: CommonBitrate): string {
  return COMMON_BITRATE_LABELS[bitrate];
}
