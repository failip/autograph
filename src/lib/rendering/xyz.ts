import npyjs from "npyjs";
import { run } from "svelte/internal";

let numpyjs = new npyjs();

export interface Run {
    number_of_atoms: number;
    number_of_frames: number;
    symbols: string[];
    frames: Frame[];
}

export interface Frame {
    positions: Float32Array;
}

export function appendRuns(run: Run, appendable_data: Run): void {
    run.number_of_frames += appendable_data.number_of_frames;
    run.frames.push(...appendable_data.frames);
}

export async function parseRunNPY(run_file_content: string): Promise<Run> {
    const array = await numpyjs.load(run_file_content)
    console.log(array);
    console.log(array.shape);

    const number_of_frames = array.shape[0];
    const number_of_atoms = array.shape[1];
    const frames = []

    for (let i = 0; i < number_of_frames; i++) {
        const frame = {
            positions: array.data.subarray(i * number_of_atoms * 3, (i + 1) * number_of_atoms * 3)
        };
        frames.push(frame);
    }

    return {
        number_of_atoms: number_of_atoms,
        number_of_frames: number_of_frames,
        frames: frames,
        symbols: []
    }
}

export function parseRun(run_file_content: string): Run {
    const lines = run_file_content.split("\n");
    const number_of_atoms = parseInt(lines[0]);
    const number_of_lines = lines.length;
    const number_of_frames = ~~(number_of_lines / (number_of_atoms + 2));
    const symbols = [];
    const frames = [];

    for (let i = 0; i < number_of_frames; i++) {
        const frame = {
            positions: new Float32Array(number_of_atoms * 3)
        };
        frames.push(frame);
    }

    for (let i = 0; i < number_of_atoms; i++) {
        const line = lines[2 + i];
        const symbol = line.trim().split(/\s+/)[0];
        symbols.push(symbol);
    }

    for (let i = 0; i < number_of_frames; i++) {
        const frame = frames[i];
        for (let j = 0; j < number_of_atoms; j++) {
            const line_number = (number_of_atoms + 2) * i + 2 + j;
            const line = lines[line_number].trim();
            const parts = line.split(/\s+/);
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            frame.positions[3 * j] = x;
            frame.positions[3 * j + 1] = y;
            frame.positions[3 * j + 2] = z;
        }
    }

    return {
        number_of_atoms: number_of_atoms,
        number_of_frames: number_of_frames,
        symbols: symbols,
        frames: frames
    };
}

function compareBonds(bond1: Array<number>, bond2: Array<number>) {
    return (
        (bond1[0] == bond2[0] && bond1[1] == bond2[1]) ||
        (bond1[0] == bond2[1] && bond1[1] == bond2[0])
    );
}