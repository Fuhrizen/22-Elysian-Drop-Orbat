/** Neighbour-constrained binary collapse, used to grow connected pixel islands. */
export type PixelWave = {
    columns: number;
    rows: number;
    lit: Map<number, number>;
    frontier: Set<number>;
    blocked: Set<number>;
    target: number;
    bias: number;
};
export function neighbours(cell: number, columns: number, rows: number): number[] {
    const x = cell % columns, y = Math.floor(cell / columns), out: number[] = [];
    if (x > 0)
        out.push(cell - 1);
    if (x < columns - 1)
        out.push(cell + 1);
    if (y > 0)
        out.push(cell - columns);
    if (y < rows - 1)
        out.push(cell + columns);
    return out;
}
export function seedWave(columns: number, rows: number, seed: number, target: number, now: number, bias = .58): PixelWave {
    const wave: PixelWave = { columns, rows, lit: new Map([[seed, now]]), frontier: new Set(neighbours(seed, columns, rows)), blocked: new Set(), target, bias };
    return wave;
}
export function collapseWave(wave: PixelWave, now: number, random: () => number = Math.random): boolean {
    if (wave.lit.size >= wave.target || !wave.frontier.size)
        return false;
    let selected = -1, best = Infinity, probability = 0;
    // Every frontier cell may collapse dark or lit. Multiple lit neighbours reduce
    // uncertainty; a small random tie-break keeps the resulting boundaries irregular.
    for (const cell of wave.frontier) {
        const count = neighbours(cell, wave.columns, wave.rows).filter(n => wave.lit.has(n)).length;
        const p = Math.min(.96, wave.bias + count * .085), entropy = -p * Math.log(p) - (1 - p) * Math.log(1 - p) + random() * .12;
        if (entropy < best) {
            best = entropy;
            selected = cell;
            probability = p;
        }
    }
    wave.frontier.delete(selected);
    if (random() < probability) {
        wave.lit.set(selected, now);
        for (const n of neighbours(selected, wave.columns, wave.rows))
            if (!wave.lit.has(n) && !wave.blocked.has(n))
                wave.frontier.add(n);
    }
    else
        wave.blocked.add(selected);
    return true;
}
