interface PendingRecreateModelPayload {
  modelId?: string;
}

interface RecreateModelLike {
  model: string;
}

export function resolvePendingRecreateTargetModel<
  TPayload extends PendingRecreateModelPayload,
  TModel extends RecreateModelLike,
>({
  payload,
  currentPending,
  models,
  defaultModelId,
  onUnavailable,
}: {
  payload: TPayload;
  currentPending: TPayload | null;
  models: readonly TModel[];
  defaultModelId: string;
  onUnavailable: (modelId: string) => void;
}): TModel | null {
  if (payload.modelId) {
    const exactModel = models.find((model) => model.model === payload.modelId);
    if (exactModel) return exactModel;
    if (currentPending === payload) onUnavailable(payload.modelId);
    return null;
  }

  return (
    models.find((model) => model.model === defaultModelId) ?? models[0] ?? null
  );
}
