'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
export function ChangeSignal({ value, className, children }: {
    value: string;
    className: string;
    children: ReactNode;
}) {
    const previous = useRef(value), [revision, setRevision] = useState(0), [changing, setChanging] = useState(false);
    useEffect(() => { if (previous.current === value)
        return; previous.current = value; setRevision(n => n + 1); setChanging(true); const timer = setTimeout(() => setChanging(false), 2400); return () => clearTimeout(timer); }, [value]);
    return <div className={className + ' signal-region'} data-changing={changing}>{children}{changing && <span key={revision} className="record-signal" aria-hidden="true"/>}</div>;
}
