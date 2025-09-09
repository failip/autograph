import type { Node } from "ngraph.graph";
import { Molecule, SmilesParser } from "openchemlib";

export type Filter = (node: Node) => boolean;
type CountOperator = (a: number, b: number) => boolean;

export const COUNT_OPERATORS: Map<string, CountOperator> = new Map([
  ["==", (a, b) => a == b],
  ["!=", (a, b) => a != b],
  [">", (a, b) => a > b],
  ["<", (a, b) => a < b],
  [">=", (a, b) => a >= b],
  ["<=", (a, b) => a <= b],
]);

export const LOGICAL_OPERATORS: Map<string, (a: boolean, b: boolean) => boolean> = new Map([
  ["and", (a, b) => a && b],
  ["or", (a, b) => a || b],
]);

export const FILTERWORDS: Map<string, string> = new Map([
  ["==", "equal to"],
  ["!=", "not equal to"],
  [">", "greater than"],
  ["<", "less than"],
  [">=", "greater than or equal to"],
  ["<=", "less than or equal to"],
]);

const MOLECULE_CACHE = new Map<string, Molecule>();
const SMILES_PARSER = new SmilesParser();

export function filterByAtomCount(
  node: Node,
  atom: string,
  count: number,
  operator: CountOperator,
): boolean {
  const smiles = node.data.name.split("{")[0];
  const elements: string[] = [];
  const molecule =
    MOLECULE_CACHE.get(smiles) ||
    SMILES_PARSER.parseMolecule(smiles, { hydrogens: true });

  const number_of_atoms = molecule.getAllAtoms();
  for (let i = 0; i < number_of_atoms; i++) {
    const atom = molecule.getAtomLabel(i);
    elements.push(atom);
  }
  const atom_count = elements.filter((element) => element === atom).length;
  if (operator(atom_count, count)) {
    return true;
  }
  return false;
}

export function filterChargeCount(
  node: Node,
  count: number,
  operator: CountOperator,
): boolean {
  const chargeCheck = node.data.name.split("{");
  if (chargeCheck.length !== 2) {
    return false;
  }
  const chargeValue = chargeCheck[1].split(",")[0];

  if (operator(chargeValue, count)) {
    return true;
  }
  return false;
}

export function filterMultiplicityCount(
  node: Node,
  count: number,
  operator: CountOperator,
): boolean {
  const multiplicityCheck = node.data.name.split(",");
  if (multiplicityCheck.length !== 2) {
    return false;
  }
  const multipilicityValue = multiplicityCheck[1].split("}")[0];

  if (operator(multipilicityValue, count)) {
    return true;
  }
  return false;
}

export function filterByDoubleBond(
  node: Node,
  atom: string,
  count: number,
  operator: CountOperator,
): boolean {
  const smiles = node.data.name.split("{")[0];
  const molecule =
    MOLECULE_CACHE.get(smiles) ||
    SMILES_PARSER.parseMolecule(smiles, { hydrogens: true });
  const number_of_atoms = molecule.getAllAtoms();
  let number_of_double_bonds = 0;
  for (let i = 0; i < number_of_atoms; i++) {
    for (let j = i; j < number_of_atoms; j++) {
      const bond = molecule.getBond(i, j);
      const bond_order = molecule.getBondType(bond);
      if (bond_order == 2) number_of_double_bonds += 1;
    }
  }

  if (operator(number_of_double_bonds, count)) {
    return true;
  }
  return false;
}

export function filterByRing(
  node: Node,
  atom: string,
  count: number,
  operator: CountOperator,
): boolean {
  const smiles = node.data.name.split("{")[0];
  const molecule =
    MOLECULE_CACHE.get(smiles) ||
    SMILES_PARSER.parseMolecule(smiles, { hydrogens: true });
  const number_of_atoms = molecule.getAllAtoms();
  let number_of_rings = 0;
  for (let i = 0; i < number_of_atoms; i++) {
    const rings = molecule.getAtomRingCount(i, number_of_atoms);
    if (rings > number_of_rings) {
      number_of_rings = rings;
    }
  }

  if (operator(number_of_rings, count)) {
    return true;
  }
  return false;
}

export function filterByRingSize(
  node: Node,
  count: number,
  operator: CountOperator,
): boolean {
  const smiles = node.data.name.split("{")[0];

  const molecule =
    MOLECULE_CACHE.get(smiles) ||
    SMILES_PARSER.parseMolecule(smiles, { hydrogens: true });
  const number_of_atoms = molecule.getAllAtoms();
  let number_of_rings = 0;
  for (let i = 0; i < number_of_atoms; i++) {
    const rings = molecule.getAtomRingCount(i, number_of_atoms);
    if (operator(rings, count)) {
      number_of_rings += 1;
    }
  }

  if (number_of_rings > 0) {
    return true;
  }
  return false;
}

export function filterReactionEqualReactantProduct(
  node: Node,
): boolean {
  if (node.data.type !== "reaction") {
    return false;
  }
  const partners = node.data.name.split(" => ");
  if (partners.length !== 2) {
    return false;
  }
  if (partners[0] == partners[1]) {
    return true;
  }
  return false;
}

export function filterReactionMaxPartners(
  node: Node,
  count: number,
  operator: CountOperator,
): boolean {
  if (node.data.type !== "reaction") {
    return false;
  }
  const partners = node.data.name.split(" => ");
  if (partners.length !== 2) {
    return false;
  }
  const reactants = partners[0].split(" + ");
  const products = partners[1].split(" + ");

  if (operator(reactants.length, count)) {
    return true;
  }
  if (operator(products.length, count)) {
    return true;
  }
  return false;
}

export function filterException(
  node: Node,
  atom: string,
): boolean {
  const smiles1 = node.data.name.split("{")[0];
  const smiles2 = atom.split("{")[0];
  if (smiles1 === smiles2) {
    return false;
  }
  return true;
}

export function combineFilters(
  a: Filter,
  b: Filter,
  operator: (a: boolean, b: boolean) => boolean,
): Filter {
  return (node: Node) => {
    return operator(a(node), b(node));
  };
}