import createGraph, { type Graph } from "ngraph.graph";

interface ChemkinFile {
  elements: string[];
  species: string[];
  reactions: ChemkinReaction[];
}

interface ChemkinReaction {
  equation: string;
  rate: number;
  rate2: number;
  rate3: number;
}

export function parseChemkinFile(chemkinFileContent: string): ChemkinFile {
  const chemkinFile = {
    elements: new Array<string>(),
    species: new Array<string>(),
    reactions: new Array<ChemkinReaction>(),
  };

  let lines = chemkinFileContent.split('\n');

  // Remove all comments
  lines = lines.filter((line) => !line.startsWith('!') || line.trim() === '');

  // Parse elements block
  const elementsStartsIndex = lines.findIndex((line) => line.startsWith('ELEMENTS'));
  const elementsEndIndex = lines.findIndex((line) => line.startsWith('END'));
  const elementsLines = lines.slice(elementsStartsIndex + 1, elementsEndIndex);
  for (const line of elementsLines) {
    const elements = line.split(/\s+/).filter(Boolean);
    chemkinFile.elements.push(...elements);
  }
  chemkinFile.elements.sort();

  lines = lines.slice(elementsEndIndex + 1);

  // Parse species block
  const speciesStartsIndex = lines.findIndex((line) => line.startsWith('SPECIES'));
  const speciesEndIndex = lines.findIndex((line) => line.startsWith('END'));
  const speciesLines = lines.slice(speciesStartsIndex + 1, speciesEndIndex);
  for (const line of speciesLines) {
    const species = line.split(/\s+/).filter(Boolean);
    chemkinFile.species.push(...species);
  }
  chemkinFile.species.sort();
  lines = lines.slice(speciesEndIndex + 1);

  // Parse reactions block
  const reactionsStartsIndex = lines.findIndex((line) => line.startsWith('REACTIONS'));
  const reactionsEndIndex = lines.findIndex((line) => line.startsWith('END'));
  const reactionsLines = lines.slice(reactionsStartsIndex + 1, reactionsEndIndex);
  for (let i = 0; i < reactionsLines.length; i++) {
    const reactionData = reactionsLines[i].split(/\s+/).filter(Boolean);

    if (reactionData.length <= 3) {
      continue;
    }

    const equation = reactionData[0];

    if (equation.startsWith('PLOG') || equation.startsWith('CHEB')) {
      continue;
    }

    const rate = parseFloat(reactionData[1]);
    const rate2 = parseFloat(reactionData[2]);
    const rate3 = parseFloat(reactionData[3]);

    // If the equation has M, then a following line may be a list of species
    const equationHasM = equation.includes('M');
    if (equationHasM) {

      let nextLine = "";
      let nextLineIsNotSpeciesDefenition = false;
      do {
        nextLine = reactionsLines[++i].trim();
        nextLineIsNotSpeciesDefenition = nextLine.includes('=>') || nextLine.includes('<=>') || nextLine.includes('PLOG') || nextLine.includes('CHEB');
        if (nextLineIsNotSpeciesDefenition) {
          // Sometimes no species are defined
          break;
        }
      } while (nextLine.startsWith('LOW') || nextLine.startsWith('TROE'));

      if (nextLineIsNotSpeciesDefenition) {
        --i;
        chemkinFile.reactions.push({ equation, rate, rate2, rate3 });
        continue;
      }

      const species = nextLine.split(/[\/\s]+/).filter(Boolean).filter((_, index) => index % 2 !== 1)
      for (const speciesName of species) {
        if (speciesName.startsWith('!')) {
          break;
        }
        const newEquation = equation.replaceAll('M', speciesName);
        chemkinFile.reactions.push({ equation: newEquation, rate, rate2, rate3 });
      }
    } else {
      chemkinFile.reactions.push({
        equation, rate, rate2, rate3
      });
    }
  }

  return chemkinFile;
}

export function chemkinFileToGraph(chemkinFile: ChemkinFile): Graph {
  const graph = createGraph();

  graph.addNode('M', { type: 'species' });

  // Graph is a bipartite graph connecting species to reactions
  for (const species of chemkinFile.species) {
    graph.addNode(species, { type: 'species', name: species });
  }

  for (const reaction of chemkinFile.reactions) {
    graph.addNode(reaction.equation, { type: 'reaction', name: reaction.equation });
  }

  for (const reaction of chemkinFile.reactions) {
    // replace (+X) with +X
    const equation = reaction.equation.replace(/\(\+([^\)]+)\)/g, "+$1");
    const [reactants, products] = equation.split(/<=>|=>|=/).map((side) => side.split("+").map((species) => species.trim()));

    for (const reactant of reactants) {
      graph.addLink(reactant.replace(/^\d+/, ''), reaction.equation);
    }

    for (const product of products) {
      graph.addLink(reaction.equation, product.replace(/^\d+/, ''));
    }
  }
  return graph;
}