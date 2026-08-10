import {
    MAX_MODEL_TEST_ATTEMPTS,
    type ModelSelectionInput,
    type ModelTestProgress,
    type ModelTestResult,
} from '../shared/contracts';

export {MAX_MODEL_TEST_ATTEMPTS};
export type {ModelTestProgress};

type ModelTestClient = {
    testSelectedModel(selection: ModelSelectionInput): Promise<ModelTestResult>;
};

export async function runModelTestWithVisionRetries(
    client: ModelTestClient,
    selection: ModelSelectionInput,
    onProgress: (progress: ModelTestProgress) => void,
): Promise<ModelTestResult> {
    onProgress({phase: 'connecting', attempt: 0, maxAttempts: MAX_MODEL_TEST_ATTEMPTS});

    for (let attempt = 1; attempt <= MAX_MODEL_TEST_ATTEMPTS; attempt += 1) {
        onProgress({phase: 'vision', attempt, maxAttempts: MAX_MODEL_TEST_ATTEMPTS});
        try {
            return await client.testSelectedModel(selection);
        } catch (error) {
            const retryable = isVisionVerificationFailure(error);
            if (!retryable || attempt === MAX_MODEL_TEST_ATTEMPTS) throw error;
        }
    }

    throw new Error('Model test retry loop ended unexpectedly');
}

function isVisionVerificationFailure(error: unknown): boolean {
    return Boolean(error && typeof error === 'object'
        && 'code' in error
        && error.code === 'vision_verification_failed');
}
