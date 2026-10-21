'use client';
import { useEffect, useRef } from 'react';
import { collapseWave, seedWave, type PixelWave } from '@/lib/pixel-growth';
// Every bright cell has a hard expiry; dead cells remain only as growth constraints.
export const pixelTTL = (cell: number, epoch: number) => 450 + Math.floor(signalNoise(cell, epoch) * 850);
type Island = {
    wave: PixelWave;
    born: number;
    expires: number;
    nextStep: number;
    stepTime: number;
    tone: number;
};
const signalNoise = (cell: number, frame: number) => { let n = Math.imul(cell + 1, 374761393) ^ Math.imul(frame + 1, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
export function PixelField() {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx)
            return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const base = document.createElement('canvas'), baseCtx = base.getContext('2d');
        if (!baseCtx)
            return;
        let width = 0, height = 0, columns = 0, rows = 0, cellSize = 8, islands: Island[] = [], frame = 0, lastPaint = 0, nextSeed = 0, resizeTimer: ReturnType<typeof setTimeout> | undefined;
        function addSeed(now: number, initial = false) {
            const seeds = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < seeds && islands.length < 28; i++) {
                const seed = Math.floor(Math.random() * columns * rows), target = 10 + Math.floor(Math.random() * 65);
                islands.push({ wave: seedWave(columns, rows, seed, target, now, .48 + Math.random() * .2), born: now, expires: now + 2200 + Math.random() * 1100, nextStep: now, stepTime: 24 + Math.random() * 45, tone: Math.random() });
            }
            nextSeed = now + (initial ? 120 : 180 + Math.random() * 260);
        }
        function paint(now: number) {
            ctx!.imageSmoothingEnabled = false;
            ctx!.clearRect(0, 0, columns, rows);
            ctx!.drawImage(base, 0, 0);
            const signalFrame = Math.floor(now / 140);
            // Individual phosphor cells switch abruptly; no opacity interpolation or sine pulse.
            for (const island of islands) {
                for (const [cell, birth] of island.wave.lit) {
                    if (!media.matches && now - birth >= pixelTTL(cell, Math.floor(island.born)))
                        continue;
                    const noise = signalNoise(cell, signalFrame);
                    if (noise < .08)
                        continue;
                    const alpha = noise < .2 ? .14 : noise < .8 ? .29 + island.tone * .14 : .5;
                    ctx!.fillStyle = `rgba(126,161,72,${alpha})`;
                    ctx!.fillRect(cell % columns, Math.floor(cell / columns), 1, 1);
                }
            }
            // Low-level raster snow stays local; it never flashes the complete screen.
            for (let i = 0; i < 110; i++) {
                const cell = Math.floor(signalNoise(i, signalFrame + 29) * columns * rows);
                ctx!.fillStyle = i % 9 === 0 ? 'rgba(157,178,103,.18)' : 'rgba(91,120,57,.07)';
                ctx!.fillRect(cell % columns, Math.floor(cell / columns), 1, 1);
            }
        }
        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            cellSize = width < 600 ? 7 : 8;
            columns = Math.ceil(width / cellSize);
            rows = Math.ceil(height / cellSize);
            canvas!.width = columns;
            canvas!.height = rows;
            canvas!.style.width = width + 'px';
            canvas!.style.height = height + 'px';
            ctx!.imageSmoothingEnabled = false;
            base.width = canvas!.width;
            base.height = canvas!.height;
            baseCtx!.imageSmoothingEnabled = false;
            baseCtx!.clearRect(0, 0, columns, rows);
            for (let y = 0; y < rows; y++)
                for (let x = 0; x < columns; x++) {
                    baseCtx!.fillStyle = `rgba(111,147,75,${.025 + Math.random() * .055})`;
                    baseCtx!.fillRect(x, y, 1, 1);
                }
            islands = [];
            const now = performance.now();
            for (let i = 0; i < 5; i++)
                addSeed(now, true);
            // Reduced motion gets a static connected field; normal motion starts from seeds.
            if (media.matches) {
                for (const island of islands)
                    for (let i = 0; i < 300; i++)
                        if (!collapseWave(island.wave, now - 600))
                            break;
                paint(now);
            }
        }
        function loop(now: number) {
            if (!media.matches && !document.hidden && now - lastPaint >= 80) {
                lastPaint = now;
                islands = islands.filter(x => x.expires > now);
                if (now >= nextSeed)
                    addSeed(now);
                for (const island of islands) {
                    let budget = 8;
                    while (now >= island.nextStep && budget-- > 0) {
                        collapseWave(island.wave, now);
                        island.nextStep += island.stepTime;
                    }
                }
                paint(now);
            }
            if (!media.matches)
                frame = requestAnimationFrame(loop);
        }
        function start() { cancelAnimationFrame(frame); resize(); lastPaint = 0; if (!media.matches)
            frame = requestAnimationFrame(loop); }
        function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); }
        function onVisible() { if (!document.hidden) {
            const now = performance.now();
            for (const island of islands)
                island.nextStep = now;
            nextSeed = now;
        } }
        start();
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVisible);
        media.addEventListener('change', start);
        return () => { cancelAnimationFrame(frame); clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVisible); media.removeEventListener('change', start); };
    }, []);
    return <canvas ref={ref} className="pixel-field" aria-hidden="true"/>;
}
