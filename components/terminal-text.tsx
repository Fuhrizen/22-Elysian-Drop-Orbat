'use client';
import { useEffect, useRef, useState } from 'react';
import { terminalBeat } from '@/lib/terminal-timing';
/** Type on first appearance or changed values; revisited text stays intact. */
export function TerminalText({ text }: {
    text: string;
}) {
    const ref = useRef<HTMLElement>(null), written = useRef<string | null>(null), [output, setOutput] = useState(text), [writing, setWriting] = useState(false);
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        let timer: ReturnType<typeof setTimeout> | undefined, visible = false, started = false, observer: IntersectionObserver | undefined;
        function clear() { clearTimeout(timer); }
        function settle(mark = false) { clear(); setOutput(text); setWriting(false); if (mark)
            written.current = text; }
        function begin() {
            clear();
            if (media.matches) {
                settle(true);
                return;
            }
            if (written.current === text) {
                setOutput(text);
                setWriting(false);
                return;
            }
            started = true;
            let count = 0;
            const began = performance.now();
            setOutput('');
            setWriting(true);
            function tick() { if (performance.now() - began > 4200) {
                settle(true);
                return;
            } const beat = terminalBeat(text.length - count, /\s|[.,:;]/.test(text[count - 1] || '')); timer = setTimeout(() => { count += beat.characters; setOutput(text.slice(0, count) + (count < text.length ? '▌' : '')); if (count >= text.length)
                settle(true);
            else
                tick(); }, beat.delay); }
            tick();
        }
        function preference() { if (media.matches)
            settle(true);
        else if (visible)
            begin(); }
        if (typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(entries => { for (const entry of entries) {
                if (!entry.isIntersecting) {
                    visible = false;
                    settle(started);
                }
                else if (entry.intersectionRatio >= .15 && !visible) {
                    visible = true;
                    begin();
                }
            } }, { threshold: [0, .15] });
            if (ref.current)
                observer.observe(ref.current);
        }
        else {
            visible = true;
            begin();
        }
        media.addEventListener('change', preference);
        return () => { clear(); observer?.disconnect(); media.removeEventListener('change', preference); };
    }, [text]);
    return <i ref={ref} className="terminal-text" data-writing={writing}>
    <b className="terminal-text-size" aria-hidden="true">{text}</b>
    <b className="terminal-text-output" aria-hidden="true">{output}</b>
    <span className="sr-only">{text}</span>
    </i>;
}
