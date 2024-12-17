import { Graph, Link, Node, NodeId } from 'ngraph.graph';

type Reaction = string;
type Dependency = string[];
type Edge = [Reaction, number, Dependency];
type AdjacencyList = Map<Reaction, Edge[]>;
type Barrier = [number, number];

// Simple Priority Queue implementation
class PriorityQueue<T> {
  private items: { element: T; priority: number }[] = [];

  public enqueue(element: T, priority: number): void {
    const queueElement = { element, priority };
    let added = false;

    // Find the correct position to insert the new element
    for (let i = 0; i < this.items.length; i++) {
      if (queueElement.priority < this.items[i].priority) {
        this.items.splice(i, 0, queueElement); // Insert without removing
        added = true;
        break;
      }
    }

    // If it has the highest priority, add it to the end
    if (!added) {
      this.items.push(queueElement);
    }
  }

  public dequeue(): T | undefined {
    return this.items.shift()?.element;
  }

  public isEmpty(): boolean {
    return this.items.length === 0;
  }
}


export class PathSearchGraph {
  private adj: AdjacencyList;
  private graph: Graph;

  constructor(graph: Graph) {
    this.adj = this.createAdjacencyList(graph);
    this.graph = graph;
  }

  private createAdjacencyList(graph: Graph): AdjacencyList {
    const adjacencyList: AdjacencyList = new Map<Reaction, Edge[]>();

    const reactions = new Set<NodeId>();
    graph.forEachNode((node) => {
      try {
        if (node.data.type === "reaction") {
          reactions.add(node.id);
        }
      }
      catch (e) {
        console.log(node);
      }
    });

    reactions.forEach((reactionId) => {
      const reaction = graph.getNode(reactionId);
      if (!reaction) {
        return;
      }
      const products = new Array<NodeId>();

      graph.forEachLinkedNode(
        reaction.id,
        (node, link) => {
          if (link.fromId === reaction.id) {
            products.includes(node.id) ? null : products.push(node.id);
          }
        },
        true,
      );

      const connectedReactions = new Array<NodeId>();
      for (const productId of products) {
        const product = graph.getNode(productId);
        if (!product) {
          continue;
        }

        product.links?.forEach((link) => {
          if (link.fromId === product.id) {
            connectedReactions.includes(link.toId)
              ? null
              : connectedReactions.push(link.toId);
          }
        });
      }

      for (const reactionId of connectedReactions) {
        const connectedReaction = graph.getNode(reactionId);
        if (!connectedReaction) {
          continue;
        }
        const reactant = new Array<NodeId>();

        connectedReaction.links?.forEach((link) => {
          if (link.toId === connectedReaction.id) {
            reactant.includes(link.fromId) ? null : reactant.push(link.fromId);
          }
        });

        const dependencies = reactant.filter((r) => !products.includes(r));

        const edge = [connectedReaction.id, connectedReaction.data.weight ? connectedReaction.data.weight : 1, dependencies];
        adjacencyList.has(reaction.id)
          ? adjacencyList.get(reaction.id).push(edge)
          : adjacencyList.set(reaction.id, [edge]);
      }
    });

    // console.log(adjacencyList);

    return adjacencyList;
  }

  private getStartingNodes(graph: Graph, startingNodeKeys: string[]): NodeId[] {
    const reactions = new Set<Node>();
    for (const startingNodeKey of startingNodeKeys) {
      const node = graph.getNode(startingNodeKey);
      if (!node) {
        continue;
      }

      graph.forEachLinkedNode(
        node.id,
        (node, link) => {
          const isReaction = link.fromId === startingNodeKey;
          if (isReaction) {
            reactions.add(node);
          }
        },
        true,
      );
    }

    const startingNodeOnlyReactions = new Set<NodeId>();
    reactions.forEach((reaction) => {
      let fromLinks = new Array<Link>();
      graph.forEachLink((link) => {
        if (link.toId === reaction.id) {
          fromLinks.push(link);
        }
      });

      let isStartingNodeOnly = true;
      fromLinks.forEach((link) => {
        isStartingNodeOnly =
          isStartingNodeOnly && startingNodeKeys.includes(link.fromId);
      });

      if (isStartingNodeOnly) {
        startingNodeOnlyReactions.add(reaction.id);
      }
    });

    return Array.from(startingNodeOnlyReactions);
  }

  private getEndNodes(graph: Graph, product: string): NodeId[] {
    const endNode = graph.getNode(product);
    if (!endNode) {
      return [];
    }

    const endNodes = new Set<NodeId>();
    endNode.links?.forEach((link) => {
      if (link.toId === endNode.id) {
        endNodes.add(link.fromId);
      }
    });

    return Array.from(endNodes);
  }


  public getAdjacencyList(): AdjacencyList {
    return this.adj;
  }

  public shortestPath(
    from: string | string[],
    to: string,
  ): { shortestPath: string[] | null, cost: number } {
    const fromKeys = Array.isArray(from) ? from : [from];
    const startNodes = this.getStartingNodes(this.graph, fromKeys);
    const endNodes = this.getEndNodes(this.graph, to);
    const startingBarriers: number[] = startNodes.map((node) => {
      return this.graph.getNode(node)?.data.weight || 1;
    });
    return this.adaptedDijkstra(startNodes, endNodes, startingBarriers);
  }

  public adaptedDijkstra(
    startNodes: string[],
    endNodes: string[],
    startingBarriers: number[],
    testMode: boolean = false
  ): { shortestPath: string[] | null, cost: number } {
    const minHeap = new PriorityQueue<[number, string, string[], Set<string>]>();
    const visited = new Set<string>();

    // Initialize the heap with start nodes
    for (let index = 0; index < startNodes.length; index++) {
      const startNode = startNodes[index];
      const startingReactants = createReactantSet(startNode, testMode);
      const startingProducts = createProductSet(startNode, testMode);
      const combined = new Set([...startingReactants, ...startingProducts]);
      const barrier = startingBarriers[index];

      // Enqueue (current_cost, current_node, path, visited_molecules)
      minHeap.enqueue([barrier, startNode, [], combined], barrier);
      // print the enqueued elements
      // console.log(`Enqueued: ${startNode} with cost ${barrier}`);
    }

    while (!minHeap.isEmpty()) {
      const [cost, node, path, visitedMolecules] = minHeap.dequeue()!;
      // Print the dequeue elemeents
      if (visited.has(node)) {
        continue;
      }

      // Extend path
      const newPath = [...path, node];
      visited.add(node);
      const newVisitedMolecules = new Set([
        ...visitedMolecules,
        ...createProductSet(node, testMode)
      ]);

      // Check if the current node is one of the end nodes
      if (endNodes.includes(node)) {
        return { shortestPath: newPath, cost };
      }

      // Explore neighbors

      if (this.adj.has(node)) {

        // console.log(`HERE: Exploring neighbors of node ${node}`);
        for (const [neighbor, weight, dependency] of this.adj.get(node)!) {
          if (isSubset(new Set(dependency), Array.from(newVisitedMolecules))) {
            const newCost = cost + weight;
            // console.log(`Dependencies met. Enqueuing neighbor ${neighbor} with cost ${newCost}`);
            minHeap.enqueue([newCost, neighbor, newPath, newVisitedMolecules], newCost);
          }
        }
      }
    }

    return { shortestPath: null, cost: Infinity };
  }
}

function createReactantSet(reactionLabel: string, testMode: boolean = false): Set<string> {
  if (testMode) {
    return new Set(reactionLabel.split("=>")[0].trim().split(" + "));
  }
  const reactantsStr = reactionLabel.split("=>")[0].trim();
  const reactants = reactantsStr.match(/\[.*?\]\{.*?\}|\[.*?\]/g) || [];
  return new Set(reactants);
}

function createProductSet(reactionLabel: string, testMode: boolean = false): Set<string> {
  if (testMode) {
    return new Set(reactionLabel.split("=>")[1].trim().split(" + "));
  }
  const productsStr = reactionLabel.split("=>")[1].trim();
  const products = productsStr.match(/\[.*?\]\{.*?\}|\[.*?\]/g) || [];
  return new Set(products);
}

function isSubset(set: Set<string>, array: string[]): boolean {
  return [...set].every(element => array.includes(element));
}