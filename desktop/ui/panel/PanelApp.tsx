import {useEffect, useRef, useState} from 'react';
import type {OverlaySnapshot} from '../../src/shared/contracts';
import {SettingsView} from './SettingsView';
import {WorkspaceView} from './WorkspaceView';
import './panel.css';

const initialSnapshot: OverlaySnapshot = {target: 'closed', phase: 'hidden', revision: 0};

export function PanelApp() {
    const api = window.meetingMonster;
    const [snapshot, setSnapshot] = useState<OverlaySnapshot>(initialSnapshot);
    const [lastTarget, setLastTarget] = useState<'workspace' | 'settings'>('workspace');
    const [error, setError] = useState('');

    useEffect(() => {
        const unsubscribe = api.overlay.onSnapshot((next) => {
            setSnapshot(next);
            if (next.target !== 'closed') setLastTarget(next.target);
        });
        const unsubscribeError = api.overlay.onWindowError(setError);
        void api.overlay.getSnapshot().then((next) => {
            setSnapshot(next);
            if (next.target !== 'closed') setLastTarget(next.target);
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
    const visibleTarget = snapshot.target === 'closed' ? lastTarget : snapshot.target;
    const className = [
        'panel-shell',
        snapshot.phase === 'opening' ? 'panel-enter' : '',
        snapshot.phase === 'visible' ? 'panel-visible' : '',
        isClosing ? 'panel-exit' : '',
    ].filter(Boolean).join(' ');

    return (
        <main className={`${className} ${snapshot.target === 'closed' && snapshot.phase === 'hidden' ? 'is-hidden' : ''}`} data-target={visibleTarget} aria-label="Meeting-Monster 面板">
            <header className="panel-drag-handle" data-drag-handle>
                {visibleTarget === 'workspace'
                    ? <div className="panel-prompt" aria-label="What should I say?"><span aria-hidden="true">✦</span> What should I say?</div>
                    : <span className="panel-title">连接与模型</span>}
                <span className="panel-drag-hint">拖动面板</span>
            </header>
            {error && <div className="panel-error no-drag" role="alert">{error}</div>}
            <section className={`panel-view ${visibleTarget === 'workspace' ? 'is-active' : ''}`} aria-hidden={visibleTarget !== 'workspace'}>
                <WorkspaceView active={visibleTarget === 'workspace'} />
            </section>
            <section className={`panel-view ${visibleTarget === 'settings' ? 'is-active' : ''}`} aria-hidden={visibleTarget !== 'settings'}>
                <SettingsView active={visibleTarget === 'settings'} />
            </section>
        </main>
    );
}
