import {useSyncExternalStore} from 'react';
import type {AsrStatus} from '../../../src/shared/contracts';

let currentStatus: AsrStatus = {state: 'idle'};
const listeners = new Set<() => void>();

export function publishTranscriptionStatus(status: AsrStatus): void {
    currentStatus = {...status};
    for (const listener of listeners) listener();
}

export function subscribeTranscriptionStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getTranscriptionStatus(): AsrStatus {
    return currentStatus;
}

export function useTranscriptionStatus(): AsrStatus {
    return useSyncExternalStore(
        subscribeTranscriptionStatus,
        getTranscriptionStatus,
        getTranscriptionStatus,
    );
}
