'use client';
import { useEffect, useRef, useState } from 'react';

type Sound = 'upload' | 'click' | 'success' | 'error' | 'boot' | 'boot-end' | 'clearance' | 'key' | 'remove' | 'reassign' | 'destroy' | 'seal' | 'navigate' | 'edit';
export function terminalSound(sound: Sound) {
    window.dispatchEvent(new CustomEvent('terminal-sound', { detail: sound }));
}
export function commandSound(action: string, authenticated = false): Sound {
    if (['phrase','regenerate_phrase'].includes(action)) return 'key';
    if (['destroy_orbat','deregister','delete_operation_audit','delete_template'].includes(action)) return 'destroy';
    if (['withdraw','release','reset_phrase','logout'].includes(action)) return 'remove';
    if (['edit_assignment','slot_role','save_layout','apply_template'].includes(action)) return 'reassign';
    if (action === 'clear_all') return 'seal';
    return action === 'login' || authenticated ? 'clearance' : 'success';
}
export function TerminalAudio({loading,error}:{loading:boolean;error:string}) {
    const [muted, setMuted] = useState(false);
    const [ready,setReady] = useState(false);
    const [unavailable,setUnavailable] = useState(false);
    const audio = useRef<{context: AudioContext; master: GainNode; ambient: GainNode} | null>(null);
    const mutedRef = useRef(false);
    const startAudio = useRef<((event:Event)=>Promise<void>) | null>(null);
    useEffect(() => {
        try { mutedRef.current = localStorage.getItem('xxii-audio-muted') === 'true'; setMuted(mutedRef.current); } catch {}
        let lastClick = 0;

        const bootVoices = new Set<AudioScheduledSourceNode>();
        function tone(kind: Sound) {
            if(kind === 'boot-end') { for(const voice of bootVoices) {try{voice.stop()}catch{}}bootVoices.clear();return;}
            const engine = audio.current;
            if (!engine || mutedRef.current || document.hidden || engine.context.state !== 'running') return;
            const {context, master} = engine;
            if(kind === 'boot') return;
            const profiles: Partial<Record<Sound,number[][]>> = {
                upload:[[196,294,392,523,784,1047]],
                key:[[392,587,784,1175],[440,660,880,1320]],
                remove:[[330,220,165],[294,196,147]],
                destroy:[[220,165,110,55],[196,147,98,49]],
                reassign:[[440,330,247,294],[392,294,220,262]],
                seal:[[262,392,523,262],[294,440,587,294]],
                navigate:[[640,960],[600,900]],edit:[[520,650],[480,600]],
                clearance:[[330,495,660,990],[349,523,698,1047]],
                success:[[330,440,660],[349,466,698]],error:[[220,165,110],[196,147,98]],click:[[850],[900],[790]]
            };
            const variants=profiles[kind] || profiles.click!;
            const notes=variants[0];
            const negative=['error','remove','destroy','reassign'].includes(kind);
            const short=['click','navigate','edit'].includes(kind);
            const pitch=1+(Math.random()-.5)*.006;
            const spacing=(negative ? .14 : .095)*(.96+Math.random()*.08);
            const strength=.9+Math.random()*.2;
            notes.forEach((frequency,index) => {
                const oscillator = context.createOscillator(), gain = context.createGain();
                const start = context.currentTime + index * spacing, duration = short ? .045 : .21*(.92+Math.random()*.16);
                oscillator.type = kind === 'click' ? 'square' : negative ? 'sawtooth' : 'triangle'; oscillator.frequency.value = frequency*pitch;
                gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime((short ? .04 : .10)*strength,start+.004); gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
                oscillator.connect(gain); gain.connect(master); oscillator.start(start); oscillator.stop(start+duration+.01);
                oscillator.onended = () => {oscillator.disconnect();gain.disconnect();};
                if(!short) {
                    const harmonic=context.createOscillator(),echo=context.createGain();harmonic.type='sine';harmonic.frequency.value=frequency*pitch*(negative?1.04:2);
                    echo.gain.setValueAtTime(0,start+.025);echo.gain.linearRampToValueAtTime(.025,start+.035);echo.gain.exponentialRampToValueAtTime(.0001,start+duration+.12);
                    harmonic.connect(echo);echo.connect(master);harmonic.start(start+.025);harmonic.stop(start+duration+.15);harmonic.onended=()=>{harmonic.disconnect();echo.disconnect()};
                }
            });
        }
        async function activate(event?: Event) {
            if ((event && !event.isTrusted) || mutedRef.current || document.hidden) return;
            try {
                const starting = !audio.current;
                if (!audio.current) {
                    const AudioEngine=window.AudioContext || (window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
                    if(!AudioEngine)throw new Error('Web Audio unavailable');
                    const context = new AudioEngine(), master = context.createGain(), ambient = context.createGain();
                    master.gain.value = .62; const compressor=context.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=3;master.connect(compressor);compressor.connect(context.destination); ambient.gain.value = .19; ambient.connect(master);
                    audio.current = {context,master,ambient};
                    context.onstatechange=()=>{setReady(context.state==='running')};
                    // A restrained transformer hum and filtered ventilation noise.
                    for (const frequency of [50,100,180]) {
                        const oscillator = context.createOscillator(), gain = context.createGain();
                        oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.value = frequency === 50 ? .45 : frequency===180 ? .22 : .12;
                        oscillator.connect(gain);gain.connect(ambient);oscillator.start();
                    }
                    const buffer = context.createBuffer(1,context.sampleRate*2,context.sampleRate), samples = buffer.getChannelData(0);
                    for(let i=0;i<samples.length;i++) samples[i]=(Math.random()*2-1)*.25;
                    const noise = context.createBufferSource(), filter = context.createBiquadFilter();
                    noise.buffer=buffer;noise.loop=true;filter.type='lowpass';filter.frequency.value=330;
                    noise.connect(filter);filter.connect(ambient);noise.start();
                    const modulation=context.createOscillator(), depth=context.createGain();
                    modulation.frequency.value=.17;depth.gain.value=.008;modulation.connect(depth);depth.connect(ambient.gain);modulation.start();
                }
                if(audio.current.context.state==='suspended') await audio.current.context.resume();


                setReady(audio.current.context.state==='running');
                setUnavailable(false);
            } catch { setUnavailable(true); }
        }
        function click(event: MouseEvent) {
            const target = event.target as Element;
            if (!event.isTrusted || target.closest('[data-terminal-audio]') || !target.closest('button,a,[role=option],[role=tab]')) return;
            if(performance.now()-lastClick<70)return;lastClick=performance.now();
            const control=target.closest('button,a,[role=option],[role=tab]')!;
            const identity=(control.textContent+' '+control.getAttribute('aria-label')+' '+control.getAttribute('title')).toLowerCase();
            tone(/cancel|close|back/.test(identity)?'click':/destroy|delete|expunge/.test(identity)?'destroy':/withdraw/.test(identity)?'click':/remove|clear |log out/.test(identity)?'remove':/passphrase|passkey|generate/.test(identity)?'edit':/edit|manage|role/.test(identity)?'edit':control.matches('a,[role=tab]')||/archive|history|inspect|back/.test(identity)?'navigate':'click');
        }
        function signal(event: Event) { const kind=(event as CustomEvent<Sound>).detail;const context=audio.current?.context;if(kind==='boot'&&!context&&!mutedRef.current){void activate().then(()=>{if(document.querySelector('.boot-running'))tone('boot')}).catch(()=>{});return;}if(kind==='boot'&&context?.state==='suspended'&&!mutedRef.current)void context.resume().then(()=>{if(document.querySelector('.boot-running'))tone(kind)}).catch(()=>{});else tone(kind); }
        function visibility() {
            const context = audio.current?.context;
            if (!context) return;
            if (document.hidden || mutedRef.current) void context.suspend().catch(()=>{});
            else void context.resume().catch(()=>{});
        }
        function gesture(event:Event) { if((event.target as Element)?.closest?.('[data-terminal-audio]'))return;void activate(event); }
        startAudio.current = activate;
        void activate();
        document.addEventListener('pointerup',gesture);
        document.addEventListener('keydown',gesture);
        document.addEventListener('click',click);
        document.addEventListener('visibilitychange',visibility);
        window.addEventListener('terminal-sound',signal);
        return () => {
            document.removeEventListener('pointerup',gesture);document.removeEventListener('keydown',gesture);document.removeEventListener('click',click);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('terminal-sound',signal);
            startAudio.current=null;
            const context=audio.current?.context;audio.current=null;if(context)context.onstatechange=null;if(context)void context.close().catch(()=>{});
        };
    },[]);
    async function toggle(event: {nativeEvent:Event}) {
        if(!mutedRef.current && audio.current?.context.state !== 'running') { await startAudio.current?.(event.nativeEvent);return; }
        const next = !mutedRef.current;mutedRef.current=next;setMuted(next);
        try {localStorage.setItem('xxii-audio-muted',String(next));}catch{}
        const context=audio.current?.context;
        if(context) {try {if(next) await context.suspend();else await context.resume();}catch{}}
        if(!next && !context) await startAudio.current?.(event.nativeEvent);
    }
    return <button type="button" data-terminal-audio className={'online uplink-audio '+(error?'vox-fault':'')+(muted?' disconnected':'')} title={unavailable?'Terminal audio unavailable':muted||!ready?'Connect terminal audio':'Disconnect terminal audio'} aria-label={muted||!ready?'Connect terminal audio':'Disconnect terminal audio'} aria-pressed={!muted && ready} onClick={toggle}><i/>{unavailable?'VOX AUDIO UNAVAILABLE':muted?'VOX UPLINK DISCONNECTED':!ready?'VOX UPLINK / CLICK TO CONNECT':error?'VOX INTERRUPTED':loading?'ESTABLISHING UPLINK':'VOX UPLINK ESTABLISHED'}</button>;
}

