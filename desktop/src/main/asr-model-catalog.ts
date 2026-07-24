import type {AsrModelId, AsrModelState} from '../shared/contracts';
export type {AsrModelId} from '../shared/contracts';

export type AsrModelKind = 'online-paraformer' | 'online-transducer';
export type AsrSourceKind = 'archive' | 'files';

export interface AsrModelFile {name: string; bytes: number; sha256: string}
export interface AsrModelSource {
    provider: 'modelscope' | 'huggingface';
    kind: AsrSourceKind;
    repository: string;
    revision: string;
    urlRoot: string;
    files: readonly AsrModelFile[];
}

export interface AsrModelDescriptor {
    id: AsrModelId;
    label: string;
    languages: readonly string[];
    description: string;
    estimatedBytes: number;
    kind: AsrModelKind;
    requiredFiles: readonly string[];
    supportsHotwords: boolean;
    modelingUnit: 'cjkchar' | '';
    sources: readonly AsrModelSource[];
    sherpa: {
        provider: 'cpu';
        numThreads: 2;
        decodingMethod: 'greedy_search';
        enableEndpointDetection: true;
        hotwordFile: '';
    };
    endpoint: {rule1MinTrailingSilence: number; rule2MinTrailingSilence: number; rule3MinUtteranceLength: number};
}

export interface AsrModelPublicDescriptor {
    id: AsrModelId;
    label: string;
    languages: string[];
    description: string;
    estimatedBytes: number;
    supportsHotwords: boolean;
    installedState: AsrModelState;
    isCurrent: boolean;
}

export const DEFAULT_ASR_MODEL_ID: AsrModelId = 'streaming-paraformer-bilingual-zh-en';

function modelScopeRoot(repository: string, revision: string): string {
    return `https://modelscope.cn/models/${repository}/resolve/${revision}`;
}

function huggingFaceRoot(repository: string, revision: string): string {
    return `https://huggingface.co/${repository}/resolve/${revision}`;
}

const PARA_TOKEN_BYTES = 75_756;
const ZIP_MODELSCOPE_TOKEN_BYTES = 18_626;
const ZIP_HUGGINGFACE_TOKEN_BYTES = 20_628;

const paraformer: AsrModelDescriptor = {
    id: 'streaming-paraformer-bilingual-zh-en',
    label: 'Streaming Paraformer (Chinese + English)',
    languages: ['zh', 'en'],
    description: 'Streaming bilingual Chinese and English speech recognition.',
    estimatedBytes: 226071017,
    kind: 'online-paraformer',
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
    supportsHotwords: false,
    modelingUnit: 'cjkchar',
    sources: [
        {
            provider: 'modelscope',
            kind: 'archive',
            repository: 'ZhaoChaoqun/sherpa-onnx-asr-models',
            revision: '0cca9ce976d2f626d1a9ba582d6e75ead7e8a84b',
            urlRoot: modelScopeRoot('ZhaoChaoqun/sherpa-onnx-asr-models', '0cca9ce976d2f626d1a9ba582d6e75ead7e8a84b'),
            files: [{
                name: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2',
                bytes: 226071017,
                sha256: '61990efe6692a0ae4e80d57f699152318f4c72ffac7dab1634bda6f863c72235',
            }],
        },
        {
            provider: 'huggingface',
            kind: 'files',
            repository: 'csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en',
            revision: '8e40c43232a1c5c66c82111efc5820d3accca11b',
            urlRoot: huggingFaceRoot('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', '8e40c43232a1c5c66c82111efc5820d3accca11b'),
            files: [
                {name: 'encoder.int8.onnx', bytes: 165462184, sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a'},
                {name: 'decoder.int8.onnx', bytes: 71664561, sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f'},
                {name: 'tokens.txt', bytes: PARA_TOKEN_BYTES, sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6'},
            ],
        },
    ],
    sherpa: {provider: 'cpu', numThreads: 2, decodingMethod: 'greedy_search', enableEndpointDetection: true, hotwordFile: ''},
    endpoint: {rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20},
};

const zipformer: AsrModelDescriptor = {
    id: 'streaming-zipformer-zh-int8-2025-06-30',
    label: 'Streaming Zipformer (Chinese)',
    languages: ['zh'],
    description: 'Streaming Chinese speech recognition with an INT8 Zipformer.',
    estimatedBytes: 176200000,
    kind: 'online-transducer',
    requiredFiles: ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt'],
    supportsHotwords: false,
    modelingUnit: 'cjkchar',
    sources: [
        {
            provider: 'modelscope',
            kind: 'files',
            repository: 'manyeyes/k2transducer-zipformer-large-zh-onnx-online-yuekai-20250630',
            revision: '05639a783e06b22a4d90650cdb8df95b7c8ee6ad',
            urlRoot: modelScopeRoot('manyeyes/k2transducer-zipformer-large-zh-onnx-online-yuekai-20250630', '05639a783e06b22a4d90650cdb8df95b7c8ee6ad'),
            files: [
                {name: 'encoder.int8.onnx', bytes: 161141793, sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f'},
                {name: 'decoder.onnx', bytes: 5165083, sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e'},
                {name: 'joiner.int8.onnx', bytes: 1033416, sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b'},
                {name: 'tokens.txt', bytes: ZIP_MODELSCOPE_TOKEN_BYTES, sha256: '6722bd1585f46f84456b29c3550a343a3cc375b971645773c02ed8e0b4e2405c'},
            ],
        },
        {
            provider: 'huggingface',
            kind: 'files',
            repository: 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
            revision: 'ad658fa0201659a09ea3c176129a191c77ecae8f',
            urlRoot: huggingFaceRoot('csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30', 'ad658fa0201659a09ea3c176129a191c77ecae8f'),
            files: [
                {name: 'encoder.int8.onnx', bytes: 161141793, sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f'},
                {name: 'decoder.onnx', bytes: 5165083, sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e'},
                {name: 'joiner.int8.onnx', bytes: 1033416, sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b'},
                {name: 'tokens.txt', bytes: ZIP_HUGGINGFACE_TOKEN_BYTES, sha256: '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652'},
            ],
        },
    ],
    sherpa: {provider: 'cpu', numThreads: 2, decodingMethod: 'greedy_search', enableEndpointDetection: true, hotwordFile: ''},
    endpoint: {rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20},
};

const CATALOG: readonly AsrModelDescriptor[] = [paraformer, zipformer];

export function getAsrModelCatalog(): readonly AsrModelDescriptor[] {
    return CATALOG;
}

export function getAsrModel(id: AsrModelId): AsrModelDescriptor {
    const model = CATALOG.find((candidate) => candidate.id === id);
    if (!model) throw new Error(`Unknown ASR model: ${String(id)}`);
    return model;
}

export function toPublicAsrModelDescriptor(
    descriptor: AsrModelDescriptor,
    installedState: AsrModelState = 'not-downloaded',
    isCurrent = false,
): AsrModelPublicDescriptor {
    return {
        id: descriptor.id,
        label: descriptor.label,
        languages: [...descriptor.languages],
        description: descriptor.description,
        estimatedBytes: descriptor.estimatedBytes,
        supportsHotwords: descriptor.supportsHotwords,
        installedState,
        isCurrent,
    };
}
