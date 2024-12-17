import fromJson from 'ngraph.fromjson';
import { Graph } from 'ngraph.graph';

type GraphologyNode = {
  key: string;
  attributes: {
    type: string;
    hash: string
  };
};

type GraphologyEdge = {
  source: string;
  target: string;
  attributes: {
    name: string;
  };
};

export function nodeLoadTransform(node: GraphologyNode) {
  return {
    id: node.key,
    data: {
      type: node.attributes.type,
      name: node.key,
      hash: node.attributes.hash,
      weight: node.attributes.weight,
    },
  };
}

export function edgeLoadTransform(edge: GraphologyEdge) {
  return {
    fromId: edge.source,
    toId: edge.target,
  };
}

export function createGraphFromString(graph: string): Graph {
  return fromJson(graph.replace('edges', 'links'), nodeLoadTransform, edgeLoadTransform);
}