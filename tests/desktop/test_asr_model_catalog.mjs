import test from 'node:test';
import assert from 'node:assert/strict';

const catalog = await import('../../desktop/dist/main/asr-model-catalog.js');

function assertManifestCoversRequiredFiles(model, source) {
    assert.deepEqual(source.files.map((file) => file.name).sort(), [...model.requiredFiles].sort());
    for (const file of source.files) {
        assert.equal(typeof file.bytes, 'number');
        assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
}

test('catalog contains exactly the two fixed models and Paraformer is the default', () => {
    assert.deepEqual(catalog.getAsrModelCatalog().map((model) => model.id), [
        'streaming-paraformer-bilingual-zh-en',
        'streaming-zipformer-zh-int8-2025-06-30',
    ]);
    assert.equal(catalog.DEFAULT_ASR_MODEL_ID, 'streaming-paraformer-bilingual-zh-en');
    assert.equal(catalog.getAsrModel('streaming-paraformer-bilingual-zh-en').kind, 'online-paraformer');
    assert.equal(catalog.getAsrModel('streaming-zipformer-zh-int8-2025-06-30').kind, 'online-transducer');
});

test('each fixed source has its own revision, byte manifest, and hash manifest', () => {
    const [paraformer, zipformer] = catalog.getAsrModelCatalog();
    assert.deepEqual(paraformer.requiredFiles, ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']);
    assert.equal(paraformer.sources[0].repository, 'ZhaoChaoqun/sherpa-onnx-asr-models');
    assert.equal(paraformer.sources[0].revision, '0cca9ce976d2f626d1a9ba582d6e75ead7e8a84b');
    assert.equal(paraformer.sources[0].files[0].bytes, 226071017);
    assert.equal(paraformer.sources[0].files[0].sha256,
        '61990efe6692a0ae4e80d57f699152318f4c72ffac7dab1634bda6f863c72235');
    assert.equal(zipformer.sources[0].repository, 'manyeyes/k2transducer-zipformer-large-zh-onnx-online-yuekai-20250630');
    assert.equal(zipformer.sources[0].revision, '05639a783e06b22a4d90650cdb8df95b7c8ee6ad');
    assert.deepEqual(zipformer.sources[0].files, [
        {name: 'encoder.int8.onnx', bytes: 161141793, sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f'},
        {name: 'decoder.onnx', bytes: 5165083, sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e'},
        {name: 'joiner.int8.onnx', bytes: 1033416, sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b'},
        {name: 'tokens.txt', bytes: 18626, sha256: '6722bd1585f46f84456b29c3550a343a3cc375b971645773c02ed8e0b4e2405c'},
    ]);
    assert.deepEqual(zipformer.sources[1].files, [
        {name: 'encoder.int8.onnx', bytes: 161141793, sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f'},
        {name: 'decoder.onnx', bytes: 5165083, sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e'},
        {name: 'joiner.int8.onnx', bytes: 1033416, sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b'},
        {name: 'tokens.txt', bytes: 20628, sha256: '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652'},
    ]);
    assert.deepEqual(paraformer.sources[1].files, [
        {name: 'encoder.int8.onnx', bytes: 165462184, sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a'},
        {name: 'decoder.int8.onnx', bytes: 71664561, sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f'},
        {name: 'tokens.txt', bytes: 75756, sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6'},
    ]);
    assertManifestCoversRequiredFiles(paraformer, paraformer.sources[1]);
    assertManifestCoversRequiredFiles(zipformer, zipformer.sources[1]);
    assert.ok(paraformer.sources.every((source) => !/\/(?:main|master)(?:\/|$)/.test(source.urlRoot)));
    assert.ok(zipformer.sources.every((source) => !/\/(?:main|master)(?:\/|$)/.test(source.urlRoot)));
});

test('public catalog projection does not expose URLs, paths, hashes, or download rules', () => {
    const publicModel = catalog.toPublicAsrModelDescriptor(
        catalog.getAsrModel('streaming-paraformer-bilingual-zh-en'),
    );
    assert.deepEqual(Object.keys(publicModel).sort(), [
        'description', 'estimatedBytes', 'id', 'installedState', 'isCurrent',
        'label', 'languages', 'supportsHotwords',
    ]);
    assert.doesNotMatch(JSON.stringify(publicModel), /https?:\/\/|sha256|userData|staging|onnx|tokens\.txt/i);
});

test('unknown model IDs are rejected before path or source resolution', () => {
    assert.throws(() => catalog.getAsrModel('file:///escape'), /Unknown ASR model/);
});
