import {describe, expect, it} from 'vitest';
import {
    validateBackendImage,
    validateBackendSelection,
} from '../../../desktop/src/backend/validation';
import type {BackendModelSelection} from '../../../desktop/src/backend/types';

const validOpenAiSelection: BackendModelSelection = {
    profile_id: 'generic_openai',
    protocol: 'openai',
    base_url: 'https://provider.example/v1/',
    model: 'vision-model',
    api_key: 'test-key',
    max_tokens: 512,
    temperature: 0.2,
};

const validAnthropicSelection: BackendModelSelection = {
    profile_id: 'generic_anthropic',
    protocol: 'anthropic',
    base_url: 'https://provider.example',
    model: 'claude-test',
    max_tokens: 1024,
    temperature: null,
};

describe('backend validation', () => {
    it('rejects a selection with an unsupported field', () => {
        expect(() => validateBackendSelection({...validOpenAiSelection, unexpected: true}))
            .toThrow(/unsupported field/i);
    });

    it('rejects profile and protocol pairs that do not match', () => {
        expect(() => validateBackendSelection({...validOpenAiSelection, protocol: 'anthropic'}))
            .toThrow(/protocol/i);
    });

    it('rejects an empty model ID', () => {
        expect(() => validateBackendSelection({...validOpenAiSelection, model: '   '}))
            .toThrow(/model/i);
    });

    it.each(['https://provider.example/v1?key=secret', 'https://provider.example/v1#fragment'])(
        'rejects a base URL with a query or fragment: %s',
        (base_url) => {
            expect(() => validateBackendSelection({...validOpenAiSelection, base_url}))
                .toThrow(/base_url/i);
        },
    );

    it('rejects an image with an unsupported media type', () => {
        expect(() => validateBackendImage({media_type: 'image/jpeg', data: 'image-data'}))
            .toThrow(/image/i);
    });

    it('rejects an image with empty data', () => {
        expect(() => validateBackendImage({media_type: 'image/png', data: ''}))
            .toThrow(/image/i);
    });

    it('accepts a complete fixed OpenAI protocol selection', () => {
        expect(validateBackendSelection(validOpenAiSelection)).toEqual({
            ...validOpenAiSelection,
            base_url: 'https://provider.example/v1',
        });
    });

    it('accepts a complete fixed Anthropic protocol selection', () => {
        expect(validateBackendSelection(validAnthropicSelection)).toEqual(validAnthropicSelection);
    });
});
