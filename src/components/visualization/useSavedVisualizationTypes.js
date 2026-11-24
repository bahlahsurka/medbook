// components/visualization/useSavedVisualizationTypes.js
//
// Which visualization types are saved for an entry, if known yet —
// re-renders the caller when VisualizationService learns more (a batched
// prefetch or a listSaved). Never triggers a request itself.
import { useSyncExternalStore } from 'react';
import VisualizationService from '../../services/visualization';

export default function useSavedVisualizationTypes(entryId) {
  const snapshot = useSyncExternalStore(
    VisualizationService.subscribeSaved,
    () => VisualizationService.getSavedTypes(entryId) || null,
  );
  return snapshot || undefined;
}
