import { TerminalAudio } from '@/components/terminal-audio';
export function TerminalHeader({ loading, error, admin }: {
    loading: boolean;
    error: string;
    admin: boolean;
}) {
    return (<header className="masthead">
    <div className="masthead-authority">
    <span>DEPARTMENTO MUNITORUM <span className="authority-divider"> //</span> REGIMENTAL COGITATOR</span>
    <TerminalAudio loading={loading} error={error}/>
    </div>
    <div className="masthead-body">
    <a href="/" className="brand">
    <img className="brand-logo" src="/regiment-logo-transparent.png" alt="Elysian Drop Troops insignia"/>
    <div>
    <span className="brand-docket">ASTRA MILITARUM / REGIMENTAL COMMAND</span>
    <strong>22ND DROP REGIMENT</strong>
    <span>CADIAN / ELYSIAN · ARMA 3</span>
    </div>
    </a>
    <div className="masthead-imperium">
    <img src="/imperial-aquila.png" alt="Imperial Aquila"/>
    <span>IMPERATOR VULT</span>
    </div>
    <div className="masthead-docket">
    <span>REGIMENTAL DESIGNATION</span>
    <strong>XXII / SPEAR</strong>
    <span>{admin ? 'COMMAND WARRANT VERIFIED' : 'DUTY-STATION MANIFEST'}</span>
    </div>
    </div>
    </header>);
}
