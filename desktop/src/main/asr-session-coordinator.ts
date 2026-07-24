import type {AsrStatus} from '../shared/contracts';

function toArrayBuffer(data: unknown): ArrayBuffer | null {
    if (data instanceof ArrayBuffer) return data;
    if (!ArrayBuffer.isView(data)) return null;
    const view = data as ArrayBufferView;
    if (!(view.buffer instanceof ArrayBuffer)) return null;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export interface AsrSessionSender {
    postMessage(channel: string, message: unknown, transfer: unknown[]): void;
}

export interface AsrSessionPort {
    on(event: 'message', listener: (event: {data: unknown}) => void): void;
    start(): void;
    close(): void;
}

export interface AsrSessionCoordinatorOptions {
    isAuthorizedSender(sender: AsrSessionSender): boolean;
    createPort(): {input: AsrSessionPort; output: unknown};
    startEngine(sampleRate: number): Promise<AsrStatus>;
    writePcm(buffer: ArrayBuffer): void;
    stopEngine(): Promise<AsrStatus>;
    onPortError(sender: AsrSessionSender): void;
    portChannel: string;
}

export class AsrSessionCoordinator {
    private owner: AsrSessionSender | null = null;
    private port: AsrSessionPort | null = null;
    private nextSessionToken = 0;
    private activeSessionToken: number | null = null;

    public constructor(private readonly options: AsrSessionCoordinatorOptions) {}

    public isActive(): boolean {
        return this.owner !== null;
    }

    public getOwner(): AsrSessionSender | null {
        return this.owner;
    }

    public async start(sender: AsrSessionSender, sampleRate: number): Promise<AsrStatus> {
        if (!this.options.isAuthorizedSender(sender)) throw new Error('Unauthorized ASR request');
        if (this.isActive()) throw new Error('ASR is already active');
        const token = ++this.nextSessionToken;

        try {
            const {input, output} = this.options.createPort();
            this.owner = sender;
            this.port = input;
            this.activeSessionToken = token;
            input.on('message', ({data}) => this.handlePortMessage(data));
            input.start();
            sender.postMessage(this.options.portChannel, null, [output]);
        } catch {
            this.endSessionIfCurrent(token);
            throw new Error('Local ASR failed');
        }

        let status: AsrStatus;
        try {
            status = await this.options.startEngine(sampleRate);
        } catch {
            this.endSessionIfCurrent(token);
            throw new Error('Local ASR failed');
        }
        if (!this.isCurrentSession(token)) {
            if (!this.options.isAuthorizedSender(sender)) throw new Error('Unauthorized ASR request');
            throw new Error('ASR session was ended');
        }
        if (!this.options.isAuthorizedSender(sender)) {
            await this.stopEngineIfCurrent(token);
            this.endSessionIfCurrent(token);
            throw new Error('Unauthorized ASR request');
        }
        return status;
    }

    public async stop(): Promise<AsrStatus> {
        const token = this.activeSessionToken;
        if (token === null) return {state: 'idle'};
        try {
            return await this.options.stopEngine();
        } catch {
            throw new Error('Local ASR failed');
        } finally {
            this.endSessionIfCurrent(token);
        }
    }

    public endSession(): void {
        const token = this.activeSessionToken;
        if (token !== null) this.endSessionIfCurrent(token);
    }

    private isCurrentSession(token: number): boolean {
        return this.activeSessionToken === token;
    }

    private endSessionIfCurrent(token: number): boolean {
        if (!this.isCurrentSession(token)) return false;
        const port = this.port;
        this.port = null;
        this.owner = null;
        this.activeSessionToken = null;
        port?.close();
        return true;
    }

    private handlePortMessage(data: unknown): void {
        const buffer = toArrayBuffer(data);
        if (!buffer || !buffer.byteLength || buffer.byteLength % 2 !== 0) {
            void this.failPort();
            return;
        }
        try { this.options.writePcm(buffer); } catch { void this.failPort(); }
    }

    private async failPort(): Promise<void> {
        const token = this.activeSessionToken;
        const owner = this.owner;
        if (token === null || !owner) return;
        await this.stopEngineIfCurrent(token);
        if (this.endSessionIfCurrent(token)) this.options.onPortError(owner);
    }

    private async stopEngineIfCurrent(token: number): Promise<void> {
        if (!this.isCurrentSession(token)) return;
        try {
            await this.options.stopEngine();
        } catch {}
    }
}
