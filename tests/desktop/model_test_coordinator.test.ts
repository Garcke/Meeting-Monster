import {describe, expect, test} from 'vitest';
import {
    MAX_MODEL_TEST_ATTEMPTS,
    runModelTestWithVisionRetries,
    type ModelTestProgress,
} from '../../desktop/src/main/model-test-coordinator';
import {RemoteApiError} from '../../desktop/src/main/remote-api-client';
import type {ModelSelectionInput, ModelTestResult} from '../../desktop/src/shared/contracts';

const selection: ModelSelectionInput = {
    profile_id: 'generic_openai',
    protocol: 'openai',
    base_url: 'https://example.test/v1',
    model: 'vision-model',
    api_key: 'test-secret',
};

const success: ModelTestResult = {
    ok: true,
    vision: true,
    latency_ms: 12,
    model: 'vision-model',
};

describe('runModelTestWithVisionRetries', () => {
    test('returns a successful first vision attempt without retry', async () => {
        const progress: ModelTestProgress[] = [];
        let calls = 0;
        const client = {
            testSelectedModel: async (): Promise<ModelTestResult> => {
                calls += 1;
                return success;
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, (item) => progress.push(item)),
        ).resolves.toBe(success);

        expect(calls).toBe(1);
        expect(progress.map((item) => item.attempt)).toEqual([0, 1]);
    });

    test('reports connecting plus three vision attempts when all vision checks fail', async () => {
        const failure = new RemoteApiError(
            'Image verification failed',
            400,
            'vision_verification_failed',
        );
        const progress: ModelTestProgress[] = [];
        let calls = 0;
        const client = {
            testSelectedModel: async () => {
                calls += 1;
                throw failure;
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, (item) => progress.push(item)),
        ).rejects.toBe(failure);

        expect(calls).toBe(3);
        expect(progress).toEqual([
            {phase: 'connecting', attempt: 0, maxAttempts: 3},
            {phase: 'vision', attempt: 1, maxAttempts: 3},
            {phase: 'vision', attempt: 2, maxAttempts: 3},
            {phase: 'vision', attempt: 3, maxAttempts: 3},
        ]);
    });

    test('returns a successful second vision attempt', async () => {
        const progress: ModelTestProgress[] = [];
        let calls = 0;
        const client = {
            testSelectedModel: async (): Promise<ModelTestResult> => {
                calls += 1;
                if (calls === 1) {
                    throw new RemoteApiError(
                        'Image verification failed',
                        400,
                        'vision_verification_failed',
                    );
                }
                return success;
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, (item) => progress.push(item)),
        ).resolves.toBe(success);

        expect(calls).toBe(2);
        expect(progress.map((item) => item.attempt)).toEqual([0, 1, 2]);
    });

    test('returns a successful third vision attempt and stops at the limit', async () => {
        const progress: ModelTestProgress[] = [];
        let calls = 0;
        const client = {
            testSelectedModel: async (): Promise<ModelTestResult> => {
                calls += 1;
                if (calls < 3) {
                    throw new RemoteApiError(
                        'Image verification failed',
                        400,
                        'vision_verification_failed',
                    );
                }
                return success;
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, (item) => progress.push(item)),
        ).resolves.toBe(success);

        expect(calls).toBe(3);
        expect(progress.map((item) => item.attempt)).toEqual([0, 1, 2, 3]);
    });

    test('does not retry an authentication failure', async () => {
        const failure = new RemoteApiError('Authentication failed', 401, 'authentication_failed');
        const progress: ModelTestProgress[] = [];
        let calls = 0;
        const client = {
            testSelectedModel: async () => {
                calls += 1;
                throw failure;
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, (item) => progress.push(item)),
        ).rejects.toBe(failure);

        expect(calls).toBe(1);
        expect(progress.map((item) => item.attempt)).toEqual([0, 1]);
    });

    test('never makes more than the configured maximum number of model-test calls', async () => {
        let calls = 0;
        const client = {
            testSelectedModel: async () => {
                calls += 1;
                throw new RemoteApiError(
                    'Image verification failed',
                    400,
                    'vision_verification_failed',
                );
            },
        };

        await expect(
            runModelTestWithVisionRetries(client, selection, () => undefined),
        ).rejects.toMatchObject({code: 'vision_verification_failed'});

        expect(calls).toBe(MAX_MODEL_TEST_ATTEMPTS);
    });
});
