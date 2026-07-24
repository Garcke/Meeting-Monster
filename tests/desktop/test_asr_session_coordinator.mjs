import test from 'node:test';
import assert from 'node:assert/strict';

const COORDINATOR_MODULE = '../../desktop/dist/main/asr-session-coordinator.js';

async function loadCoordinatorModule() {
    return import(COORDINATOR_MODULE);
}

class FakePort {
    constructor(actions) {
        this.actions = actions;
        this.closed = false;
        this.listener = null;
    }

    on(event, listener) {
        assert.equal(event, 'message');
        this.listener = listener;
    }

    start() {
        this.actions.push('port:start');
    }

    close() {
        this.closed = true;
        this.actions.push('port:close');
    }

    receive(data) {
        this.listener({data});
    }
}

function createHarness({startEngine, stopEngine, writePcm, postMessage} = {}) {
    const actions = [];
    const ports = [];
    const portErrors = [];
    const engineStarts = [];
    const engineStops = [];
    const pcmWrites = [];
    const senders = [];
    return {
        actions,
        ports,
        portErrors,
        engineStarts,
        engineStops,
        pcmWrites,
        senders,
        startEngine: startEngine ?? (async (sampleRate) => {
            actions.push('engine:start');
            engineStarts.push(sampleRate);
            return {state: 'recording'};
        }),
        stopEngine: stopEngine ?? (async () => {
            actions.push('engine:stop');
            engineStops.push(1);
            return {state: 'idle'};
        }),
        writePcm: writePcm ?? ((buffer) => pcmWrites.push(buffer)),
        createSender(name) {
            const sender = {
                name,
                live: true,
                postMessage(channel, _message, transferred) {
                    postMessage?.(channel);
                    actions.push(`post:${channel}`);
                    assert.equal(transferred.length, 1);
                },
            };
            senders.push(sender);
            return sender;
        },
        async build() {
            const {AsrSessionCoordinator} = await loadCoordinatorModule();
            return new AsrSessionCoordinator({
                isAuthorizedSender: (sender) => sender.live,
                createPort: () => {
                    actions.push('port:create');
                    const input = new FakePort(actions);
                    ports.push(input);
                    return {input, output: {id: ports.length}};
                },
                startEngine: this.startEngine,
                writePcm: this.writePcm,
                stopEngine: this.stopEngine,
                onPortError: (sender) => {
                    actions.push(`port:error:${sender.name}`);
                    portErrors.push(sender);
                },
                portChannel: 'asr:port',
            });
        },
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return {promise, resolve, reject};
}

function waitForAsyncCleanup() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('rejects an unauthorized sender before creating a PCM port', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    const sender = harness.createSender('untrusted');
    sender.live = false;

    await assert.rejects(coordinator.start(sender, 16000), /Unauthorized ASR request/);
    assert.deepEqual(harness.actions, []);
    assert.equal(coordinator.isActive(), false);
});

test('locks a session to its owner until it ends', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    const first = harness.createSender('first');

    await coordinator.start(first, 16000);
    await assert.rejects(coordinator.start(harness.createSender('second'), 16000), /ASR is already active/);
    assert.equal(coordinator.getOwner(), first);
    coordinator.endSession();
    assert.equal(coordinator.isActive(), false);
});

test('delivers the PCM port before starting the local engine', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    await coordinator.start(harness.createSender('main'), 16000);
    assert.deepEqual(harness.actions.slice(0, 3), ['port:create', 'port:start', 'post:asr:port']);
    assert.deepEqual(harness.engineStarts, [16000]);
});

test('rolls back the port and sanitizes a local engine startup failure', async () => {
    const harness = createHarness({startEngine: async () => { throw new Error('private native detail'); }});
    const coordinator = await harness.build();

    await assert.rejects(coordinator.start(harness.createSender('main'), 16000), (error) => {
        assert.match(error.message, /Local ASR failed/);
        assert.doesNotMatch(error.message, /private native detail/);
        return true;
    });
    assert.equal(harness.ports[0].closed, true);
    assert.equal(coordinator.isActive(), false);
});

test('cleans up a transferred port when its delivery fails', async () => {
    const harness = createHarness({postMessage: () => { throw new Error('private delivery detail'); }});
    const coordinator = await harness.build();

    await assert.rejects(coordinator.start(harness.createSender('main'), 16000), (error) => {
        assert.match(error.message, /Local ASR failed/);
        assert.doesNotMatch(error.message, /private delivery detail/);
        return true;
    });
    assert.equal(harness.ports[0].closed, true);
    assert.equal(coordinator.isActive(), false);
    assert.deepEqual(harness.engineStarts, []);
});

test('stops the engine when the sender is no longer authorized after startup', async () => {
    let sender;
    const harness = createHarness({startEngine: async () => {
        sender.live = false;
        return {state: 'recording'};
    }});
    const coordinator = await harness.build();
    sender = harness.createSender('closing');

    await assert.rejects(coordinator.start(sender, 16000), /Unauthorized ASR request/);
    assert.deepEqual(harness.engineStops, [1]);
    assert.equal(harness.ports[0].closed, true);
    assert.equal(coordinator.isActive(), false);
});

test('a stale start completion cannot stop or release a newer session', async () => {
    const firstStart = createDeferred();
    let starts = 0;
    const harness = createHarness({startEngine: async (sampleRate) => {
        starts += 1;
        harness.engineStarts.push(sampleRate);
        return starts === 1 ? firstStart.promise : {state: 'recording'};
    }});
    const coordinator = await harness.build();
    const first = harness.createSender('first');
    const second = harness.createSender('second');

    const startingFirst = coordinator.start(first, 16000);
    coordinator.endSession();
    await coordinator.start(second, 16000);
    first.live = false;
    firstStart.resolve({state: 'recording'});

    await assert.rejects(startingFirst, /Unauthorized ASR request/);
    assert.equal(coordinator.getOwner(), second);
    assert.equal(coordinator.isActive(), true);
    assert.equal(harness.ports[1].closed, false);
    assert.deepEqual(harness.engineStops, []);
});

test('stop drains the local engine and releases the owner and port', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    await coordinator.start(harness.createSender('main'), 16000);
    assert.deepEqual(await coordinator.stop(), {state: 'idle'});
    assert.equal(coordinator.isActive(), false);
    assert.deepEqual(harness.engineStops, [1]);
    assert.equal(harness.ports[0].closed, true);
});

test('stop releases the session and sanitizes a local engine failure', async () => {
    const harness = createHarness({stopEngine: async () => { throw new Error('private native detail'); }});
    const coordinator = await harness.build();
    await coordinator.start(harness.createSender('main'), 16000);

    await assert.rejects(coordinator.stop(), (error) => {
        assert.match(error.message, /Local ASR failed/);
        assert.doesNotMatch(error.message, /private native detail/);
        return true;
    });
    assert.equal(coordinator.isActive(), false);
    assert.equal(harness.ports[0].closed, true);
});

test('stop returns idle without calling the engine when there is no session', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();

    assert.deepEqual(await coordinator.stop(), {state: 'idle'});
    assert.deepEqual(harness.engineStops, []);
});

test('malformed or failed PCM stops the engine before releasing the port and publishing a generic local-ASR error', async () => {
    const harness = createHarness({writePcm: () => { throw new Error('private native detail'); }});
    const coordinator = await harness.build();
    const sender = harness.createSender('main');
    await coordinator.start(sender, 16000);
    harness.ports[0].receive(new ArrayBuffer(2));
    await waitForAsyncCleanup();
    assert.equal(coordinator.isActive(), false);
    assert.deepEqual(harness.portErrors, [sender]);
    assert.equal(harness.ports[0].closed, true);
    assert.deepEqual(harness.engineStops, [1]);
    assert.deepEqual(harness.actions.slice(-3), ['engine:stop', 'port:close', 'port:error:main']);
    await coordinator.start(harness.createSender('next'), 16000);
});

test('accepts PCM ArrayBuffer views from the Electron message port', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    await coordinator.start(harness.createSender('main'), 16000);

    harness.ports[0].receive(new Uint8Array([0, 0]));
    await waitForAsyncCleanup();

    assert.equal(coordinator.isActive(), true);
    assert.equal(harness.pcmWrites.length, 1);
    assert.equal(harness.pcmWrites[0] instanceof ArrayBuffer, true);
    assert.deepEqual(Array.from(new Uint8Array(harness.pcmWrites[0])), [0, 0]);
});

test('rejects malformed PCM before it reaches the local engine', async () => {
    const harness = createHarness();
    const coordinator = await harness.build();
    const sender = harness.createSender('main');
    await coordinator.start(sender, 16000);

    harness.ports[0].receive(new ArrayBuffer(1));
    await waitForAsyncCleanup();

    assert.deepEqual(harness.pcmWrites, []);
    assert.equal(coordinator.isActive(), false);
    assert.deepEqual(harness.portErrors, [sender]);
    assert.deepEqual(harness.engineStops, [1]);
});
