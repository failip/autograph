import fromJson from 'ngraph.fromjson';
import createGraph, { type Graph } from 'ngraph.graph';

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

export function mergeGraphs(graphs: readonly Graph[]): Graph {
  const mergedGraph = createGraph();

  for (const graph of graphs) {
    graph.forEachNode((node) => {
      if (!mergedGraph.hasNode(node.id)) {
        mergedGraph.addNode(node.id, node.data);
      }
    });

    graph.forEachLink((link) => {
      if (!mergedGraph.hasLink(link.fromId, link.toId)) {
        mergedGraph.addLink(link.fromId, link.toId, link.data);
      }
    });
  }

  return mergedGraph;
}
