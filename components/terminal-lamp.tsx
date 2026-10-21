import type { CSSProperties } from 'react';
export function TerminalLamp({ lit, seed, shape = 'bar' }: {
    lit: boolean;
    seed: string;
    shape?: 'bar' | 'dot';
}) {
    let hash = 0;
    for (const char of seed)
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const style = { '--lamp-cycle': `${7.2 + (hash % 90) / 10}s`, '--lamp-delay': `${-(hash % 170) / 10}s`, '--lamp-breath': `${3.5 + (hash % 45) / 10}s` } as CSSProperties;
    return <i aria-hidden="true" data-lit={lit ? 'true' : 'false'} className={`terminal-lamp terminal-lamp-${shape} ${lit ? 'on' : ''}`} style={style}/>;
}
