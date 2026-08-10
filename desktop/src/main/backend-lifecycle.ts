export interface DisposableBackend {
    dispose(): Promise<void>;
}

export interface BackendLifecycle<T extends DisposableBackend> {
    getBackend(): T;
    disposeForQuit(): Promise<void>;
}

/** Guards access to an application-owned backend while coordinating shutdown. */
export function createBackendLifecycle<T extends DisposableBackend>(backend: T): BackendLifecycle<T> {
    let shuttingDown = false;
    let disposal: Promise<void> | undefined;

    return {
        getBackend(): T {
            if (shuttingDown) throw new Error('Native backend is shutting down');
            return backend;
        },
        disposeForQuit(): Promise<void> {
            if (disposal) return disposal;
            shuttingDown = true;
            try {
                disposal = backend.dispose();
            } catch (error) {
                disposal = Promise.reject(error);
            }
            return disposal;
        },
    };
}

export function sanitizeBackendLifecycleError(_error: unknown): Error {
    return new Error('Native backend shutdown failed');
}
