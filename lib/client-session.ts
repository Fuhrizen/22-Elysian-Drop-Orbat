// Credentials only: personnel, assignments and session authority remain server-owned.
let memoryToken = '';
const storageKey = 'xxii-admin-session';
export function adminToken() {
    if (typeof window === 'undefined')
        return '';
    try {
        return sessionStorage.getItem(storageKey) || memoryToken;
    }
    catch {
        return memoryToken;
    }
}
export function saveAdminToken(token: string) {
    memoryToken = token;
    try {
        if (token)
            sessionStorage.setItem(storageKey, token);
        else
            sessionStorage.removeItem(storageKey);
    }
    catch { }
}
export function adminHeaders(): Record<string, string> {
    const token = adminToken();
    let machine='';
    if(typeof window!=='undefined')try{machine=localStorage.getItem('xxii-machine-id') || crypto.randomUUID();localStorage.setItem('xxii-machine-id',machine)}catch{}
    return {...(token?{Authorization:`Bearer ${token}`} : {}),...(machine?{'X-Regiment-Machine':machine}:{})};
}
