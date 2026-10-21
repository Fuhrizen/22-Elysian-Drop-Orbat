/** Short buffered bursts interrupted by bounded simulated terminal latency. */
export function terminalBeat(remaining: number, boundary = false, random = Math.random) {
    const lag = random() < (boundary ? .22 : .1);
    return { characters: Math.min(remaining, 1 + Math.floor(random() * 3)), delay: lag ? 160 + Math.floor(random() * 220) : 22 + Math.floor(random() * 55) };
}
