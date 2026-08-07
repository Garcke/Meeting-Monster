import {useEffect, useRef, useState} from 'react';
import type {OverlaySnapshot} from '../../src/shared/contracts';
import {WorkspaceMenu} from './WorkspaceMenu';
import {WorkspaceView} from './WorkspaceView';
import './panel.css';

const initialSnapshot: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

export function PanelApp() {
    const api = window.meetingMonster;
    const [snapshot, setSnapshot] = useState<OverlaySnapshot>(initialSnapshot);
    const [error, setError] = useState('');

    useEffect(() => {
        const unsubscribe = api.overlay.onSnapshot((next) => {
            setSnapshot(next);
        });
        const unsubscribeError = api.overlay.onWindowError(setError);
        void api.overlay.getSnapshot().then((next) => {
            setSnapshot(next);
        }).catch(() => setError('面板状态不可用'));
        return () => { unsubscribe(); unsubscribeError(); };
    }, [api]);

    useEffect(() => {
        if (snapshot.target === 'closed' || snapshot.phase !== 'opening') return undefined;
        let cancelled = false;
        const frame = window.requestAnimationFrame(() => {
            if (cancelled) return;
            void api.overlay.rendererReady(snapshot.revision)
                .then((next) => { if (!cancelled) setSnapshot(next); })
                .catch(() => { if (!cancelled) setError('面板无法打开'); });
        });
        return () => { cancelled = true; window.cancelAnimationFrame(frame); };
    }, [api, snapshot.revision, snapshot.target, snapshot.phase]);

    const closeRevisionRef = useRef<number | null>(null);
    useEffect(() => {
        if (snapshot.target !== 'closed' || snapshot.phase !== 'closing') return undefined;
        closeRevisionRef.current = snapshot.revision;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (cancelled || closeRevisionRef.current !== snapshot.revision) return;
            void api.overlay.animationFinished(snapshot.revision).catch(() => undefined);
        }, 180);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [api, snapshot.phase, snapshot.revision, snapshot.target]);

    const isClosing = snapshot.target === 'closed' && snapshot.phase === 'closing';
    const className = [
        'panel-shell',
        snapshot.phase === 'opening' ? 'panel-enter' : '',
        snapshot.phase === 'visible' ? 'panel-visible' : '',
        isClosing ? 'panel-exit' : '',
    ].filter(Boolean).join(' ');

    return (
        <main className={`${className} ${snapshot.target === 'closed' && snapshot.phase === 'hidden' ? 'is-hidden' : ''}`} data-target={snapshot.target} aria-label="Meeting-Monster 面板">
            <header className="panel-drag-handle" data-drag-handle>
                <span className="panel-kicker">TRANSCRIPT</span>
                <span className="panel-drag-hint">拖动面板</span>
                <WorkspaceMenu />
            </header>
            {error && <div className="panel-error no-drag" role="alert">{error}</div>}
            <section className={`panel-view ${snapshot.target === 'workspace' ? 'is-active' : ''}`} aria-hidden={snapshot.target !== 'workspace'}>
                <WorkspaceView active={snapshot.target === 'workspace'} />
            </section>
        </main>
    );
}
