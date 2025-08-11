import { MeshPhongMaterial, SphereGeometry, Material, Group, Mesh, CylinderGeometry, MeshToonMaterial, InstancedMesh, Color, Matrix4, Vector3 } from "three";
import type { Run } from "./xyz";
import * as symbol_to_color from "./symbol_to_color.json"
import * as covalent_radii from "./covalent_radii.json"

export class MoleculeGenerator {

    colors: Map<string, number>;
    covalent_radii: Map<string, number>;
    materials: Map<string, Material>;
    scaling: Map<string, number>;
    geometries: Map<string, SphereGeometry>;
    bond_geometry: CylinderGeometry;
    bond_material: Material;
    meshes: Map<string, InstancedMesh>;


    constructor() {

        this.colors = new Map<string, number>(Object.entries(symbol_to_color));
        this.covalent_radii = new Map<string, number>(Object.entries(covalent_radii));

        this.materials = new Map<string, Material>();

        this.scaling = new Map<string, number>(
            [
                ["H", 0.3],
                ["default", 0.4]
            ]
        );

        this.geometries = new Map<string, SphereGeometry>(
            [
                ["H", new SphereGeometry(this.scaling.get("H"))],
                ["default", new SphereGeometry(this.scaling.get("default"))]
            ]
        );

        this.meshes = new Map<string, InstancedMesh>()
        this.bond_geometry = new CylinderGeometry(0.085, 0.085, 1.0);
        this.bond_material = new MeshToonMaterial({ color: 0x111111, transparent: false, opacity: 1.0 });
    };

    private get_mesh(symbol: string): InstancedMesh {
        const cached_mesh = this.meshes.get(symbol);
        if (cached_mesh) {
            return cached_mesh;
        }
        const geometry = this.geometries.get(symbol) || this.geometries.get("default");
        const material = this.get_material(symbol);
        const mesh = new InstancedMesh(geometry, material, 1000);
        this.meshes.set(symbol, mesh);
        return mesh;
    }


    private get_geometry(symbol: string): SphereGeometry {
        const cached_geometry = this.geometries.get(symbol);
        if (cached_geometry) {
            return cached_geometry;
        }
        const scaling = this.scaling.get(symbol) || this.scaling.get("default");
        const geometry = new SphereGeometry(scaling);
        this.geometries.set(symbol, geometry);
        return geometry;
    }

    private get_material(symbol: string): Material {
        const cached_material = this.materials.get(symbol);
        if (cached_material) {
            return cached_material;
        }
        const color = this.colors.get(symbol);
        const material = new MeshPhongMaterial({ color: color, transparent: false, opacity: 1.0 });

        this.materials.set(symbol, material);
        return material;
    }

    private findCentralPointFromArray(points: number[]): [number, number, number] {
        if (points.length === 0 || points.length % 3 !== 0) throw new Error("Invalid points array");

        const numPoints = points.length / 3;
        let centroid: [number, number, number] = [0, 0, 0];

        for (let i = 0; i < points.length; i += 3) {
            centroid[0] += points[i];
            centroid[1] += points[i + 1];
            centroid[2] += points[i + 2];
        }

        centroid = centroid.map(coord => coord / numPoints) as [number, number, number];

        let closestPoint: [number, number, number] = [points[0], points[1], points[2]];
        let minDistance = Number.MAX_VALUE;

        for (let i = 0; i < points.length; i += 3) {
            const distance = Math.sqrt(
                (points[i] - centroid[0]) ** 2 +
                (points[i + 1] - centroid[1]) ** 2 +
                (points[i + 2] - centroid[2]) ** 2
            );
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = [points[i], points[i + 1], points[i + 2]];
            }
        }

        return closestPoint;
    }

    public generateMolecule(run: Run, hiddenSymbols: Set<string> = new Set(), move_to_center: boolean = true, smiles: string | undefined = undefined): Group {
        const positions = run.frames[0].positions;
        // move to origin

        if (move_to_center) {
            const center = this.findCentralPointFromArray(positions);
            run.frames.forEach((frame) => {
                const positions = frame.positions;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i] -= center[0];
                    positions[i + 1] -= center[1];
                    positions[i + 2] -= center[2];
                }
            });
        }

        const symbols = run.symbols;
        const number_of_atoms = run.number_of_atoms;

        const group = new Group();

        const atomGeometry = new SphereGeometry(1.0, 32, 32);
        const atomMaterial = new MeshPhongMaterial({ color: 0xffffff, transparent: false, opacity: 1.0 });
        const atomInstances = new InstancedMesh(atomGeometry, atomMaterial, number_of_atoms);
        
        for (let i = 0; i < number_of_atoms; i++) {
            atomInstances.setColorAt(i, new Color(this.colors.get(symbols[i])));
            const isHidden = hiddenSymbols.has(symbols[i]);
            const scale = isHidden ? 0 : (symbols[i] === "H" ? 0.3 : 0.4);
            const matrix = new Matrix4().makeTranslation(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
            matrix.scale(new Vector3(scale, scale, scale));
            atomInstances.setMatrixAt(i, matrix);
        }

        group.add(atomInstances);

        const bondMaterial = new MeshToonMaterial({ color: 0x000000, transparent: false, opacity: 1.0 });
        const bondGeometry = new CylinderGeometry(0.085, 0.085, 1.0);

        const bondMatrices = new Array<Matrix4>();
        const _matrix = new Matrix4();

        for (let i = 0; i < number_of_atoms; i++) {
            for (let j = i + 1; j < number_of_atoms; j++) {
                const posA = new Vector3(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
                const posB = new Vector3(positions[3 * j], positions[3 * j + 1], positions[3 * j + 2]);

                const distance = posA.distanceTo(posB);
                let max_distance = 1.5;
                let radius_a = this.covalent_radii.get(symbols[i]);
                let radius_b = this.covalent_radii.get(symbols[j]);
                if (radius_a && radius_b) {
                    max_distance = ((radius_a + radius_b)) * 0.8;
                }

                if (distance < max_distance) {
                    const matrix = new Matrix4();
                    matrix.makeTranslation(
                        (posA.x + posB.x) / 2.0,
                        (posA.y + posB.y) / 2.0,
                        (posA.z + posB.z) / 2.0,
                    );

                    matrix.lookAt(posB, posA, new Vector3(0, 1, 0));
                    matrix.multiply(_matrix.makeRotationX(Math.PI / 2.0));

                    let number_of_hydrogen = symbols[i] === "H" ? 1 : 0;
                    number_of_hydrogen += symbols[j] === "H" ? 1 : 0;

                    const bond_length = distance - 0.72 + number_of_hydrogen * 0.2;

                    matrix.scale(new Vector3(1.0, bond_length, 1.0));

                    bondMatrices.push(matrix);
                }
            }
        }

        const bonds = new Group();
        const bondInstances = new InstancedMesh(bondGeometry, bondMaterial, bondMatrices.length);
        bondMatrices.forEach((matrix, index) => {
            bondInstances.setMatrixAt(index, matrix);
        });
        bonds.add(bondInstances);

        group.add(bonds);

        // group.scale.set(3.0, 3.0, 3.0);
        return group;

    }

    public updateMolecule(group: Group, run: Run, frame_index: number): void {
        const positions = run.frames[frame_index].positions;

        const number_of_atoms = run.number_of_atoms;
        for (let i = 0; i < number_of_atoms; i++) {
            const child = group.children[i];
            child.position.x = positions[3 * i];
            child.position.y = positions[3 * i + 1];
            child.position.z = positions[3 * i + 2];
        }

        // Remove bonds

        const bonds = group.children[group.children.length - 1];
        group.remove(bonds);

        // Add bonds

        const new_bonds = new Group();

        group.children.forEach((child) => {
            group.children.forEach((other_child) => {
                if (child !== other_child) {
                    const distance = child.position.distanceTo(other_child.position);
                    if (distance < 1.5) {
                        const bond = new Mesh(this.bond_geometry, this.bond_material.clone());
                        bond.position.set(
                            (child.position.x + other_child.position.x) / 2.0,
                            (child.position.y + other_child.position.y) / 2.0,
                            (child.position.z + other_child.position.z) / 2.0,
                        );
                        bond.lookAt(other_child.position);
                        bond.rotateX(Math.PI / 2.0);
                        bond.scale.set(1.0, distance, 1.0);
                        new_bonds.add(bond);
                    }
                }
            });
        });
        group.add(new_bonds);
    }



}

export function bondDifferences(
    reac_bonds: Array<Array<number>>,
    prod_bonds: Array<Array<number>>,
) {
    const in_reac_only = reac_bonds.filter(
        (bond) =>
            !prod_bonds.some((prod_bond) => compareBonds(bond, prod_bond)),
    );

    const in_prod_only = prod_bonds.filter(
        (bond) =>
            !reac_bonds.some((reac_bond) => compareBonds(bond, reac_bond)),
    );

    const bond_diff = in_reac_only.concat(in_prod_only);

    return bond_diff;
}

function compareBonds(bond1: Array<number>, bond2: Array<number>) {
    return (
        (bond1[0] == bond2[0] && bond1[1] == bond2[1]) ||
        (bond1[0] == bond2[1] && bond1[1] == bond2[0])
    );
}