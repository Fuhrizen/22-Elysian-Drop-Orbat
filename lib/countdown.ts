export type CountdownConfig = {
    localStart: string;
    timeZone: string;
    autoRenew: boolean;
};
const pad = (n: number) => String(n).padStart(2, '0');
export function zonedLocal(epoch: number, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(epoch);
    const get = (key: string) => parts.find(p => p.type === key)!.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function localEpoch(local: string, timeZone: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
        throw new Error('Enter a valid date and time.');
    const naive = Date.parse(local + ':00Z');
    if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== local)
        throw new Error('Enter a valid date and time.');
    let candidate = naive;
    for (let i = 0; i < 4; i++) {
        const shown = Date.parse(zonedLocal(candidate, timeZone) + ':00Z');
        candidate += naive - shown;
    }
    // For a repeated clock hour use its first occurrence; reject nonexistent DST times.
    const matches = [candidate - 3600000, candidate, candidate + 3600000].filter(t => zonedLocal(t, timeZone) === local);
    if (!matches.length)
        throw new Error('This time falls in a daylight-saving clock change. Choose another time.');
    return Math.min(...matches);
}
function shiftDays(local: string, days: number): string {
    return new Date(Date.parse(local + ':00Z') + days * 86400000).toISOString().slice(0, 16);
}
export function defaultCountdown(now = Date.now()): CountdownConfig {
    const local = zonedLocal(now, 'Europe/London');
    const weekday = new Date(local.slice(0, 10) + 'T12:00:00Z').getUTCDay();
    let start = shiftDays(local.slice(0, 10) + 'T19:30', (5 - weekday + 7) % 7);
    if (localEpoch(start, 'Europe/London') <= now)
        start = shiftDays(start, 7);
    return { localStart: start, timeZone: 'Europe/London', autoRenew: true };
}
export function nextCountdown(config: CountdownConfig, now = Date.now()): number {
    let local = config.localStart;
    let target = localEpoch(local, config.timeZone);
    if (!config.autoRenew || target > now)
        return target;
    const currentDay = Date.parse(zonedLocal(now, config.timeZone).slice(0, 10) + 'T00:00:00Z');
    const firstDay = Date.parse(local.slice(0, 10) + 'T00:00:00Z');
    local = shiftDays(local, Math.max(0, Math.floor((currentDay - firstDay) / (7 * 86400000))) * 7);
    for (let i = 0; i < 3; i++) {
        try {
            target = localEpoch(local, config.timeZone);
            if (target > now)
                return target;
        }
        catch { /* skip a weekly occurrence in a DST gap */ }
        local = shiftDays(local, 7);
    }
    throw new Error('Could not determine the next deployment time.');
}
export const statusLabel = (status: string) => status === 'absent' ? 'On Leave' : status === 'active' ? 'Active' : status === 'retired' ? 'Retired' : 'Inactive';
