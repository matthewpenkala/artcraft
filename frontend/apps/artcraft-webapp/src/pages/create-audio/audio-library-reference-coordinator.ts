import {
  appendProbedMediaReferenceBatch,
  type MediaReferenceCandidateLike,
  type TimedMediaReferenceLike,
} from "@storyteller/common";

export interface AudioLibraryPolicy {
  modelId?: string;
  supported: boolean;
  maxCount: number;
  maxTotalSeconds: number;
}

export interface AudioLibraryReferenceCoordinator<
  TCandidate extends MediaReferenceCandidateLike,
  TReference extends TimedMediaReferenceLike,
> {
  operationEpoch: number;
  operationModelId?: string;
  isMounted: () => boolean;
  getEpoch: () => number;
  getPolicy: () => AudioLibraryPolicy;
  getCurrent: () => readonly TReference[];
  publish: (next: TReference[]) => void;
  probeDuration: (url: string) => Promise<number | null>;
  toReference: (candidate: TCandidate, duration: number) => TReference;
  onUnreadable?: (candidate: TCandidate) => void;
  onRejected?: Parameters<
    typeof appendProbedMediaReferenceBatch<TCandidate, TReference>
  >[1]["onRejected"];
}

export const applyAudioLibraryReferenceBatch = async <
  TCandidate extends MediaReferenceCandidateLike,
  TReference extends TimedMediaReferenceLike,
>(
  candidates: readonly TCandidate[],
  coordinator: AudioLibraryReferenceCoordinator<TCandidate, TReference>,
) =>
  appendProbedMediaReferenceBatch(candidates, {
    isCurrent: () => {
      const policy = coordinator.getPolicy();
      return (
        coordinator.isMounted() &&
        coordinator.operationEpoch === coordinator.getEpoch() &&
        policy.supported &&
        policy.modelId === coordinator.operationModelId
      );
    },
    getCurrent: coordinator.getCurrent,
    publish: coordinator.publish,
    probeDuration: coordinator.probeDuration,
    getLimits: () => {
      const policy = coordinator.getPolicy();
      return {
        maxCount: policy.maxCount,
        maxTotalSeconds: policy.maxTotalSeconds,
      };
    },
    toReference: coordinator.toReference,
    onUnreadable: coordinator.onUnreadable,
    onRejected: coordinator.onRejected,
  });
