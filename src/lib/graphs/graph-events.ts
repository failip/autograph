export type GraphSelectionChangedEvent = {
  type: "selection-changed";
  speciesId: string;
  selected: boolean;
  selectedSpecies: readonly string[];
};

export type GraphLayerAddedEvent = {
  type: "layer-added";
  selectedSpecies: readonly string[];
  addedNodeIds: readonly string[];
  addedEdges: readonly (readonly [string, string])[];
};

export type GraphResetEvent = {
  type: "reset";
};

export type GraphEvent =
  | GraphSelectionChangedEvent
  | GraphLayerAddedEvent
  | GraphResetEvent;

export type GraphEventHandler = (event: GraphEvent) => void;
