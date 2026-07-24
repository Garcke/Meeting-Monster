import type {AsrModelId, AsrModelSnapshot, MeetingMonsterApi} from '../../../src/shared/contracts';

export function isAsrModelReady(snapshot: AsrModelSnapshot | null, selectedId: AsrModelId | null): boolean {
    const selected = snapshot?.models.find((model) => model.id === (selectedId ?? snapshot.currentModelId));
    return Boolean(selected && selected.id === snapshot?.currentModelId && (selected.installedState === 'installed' || selected.installedState === 'ready'));
}

export function formatAsrModelStatus(snapshot: AsrModelSnapshot | null, selectedId: AsrModelId | null, operation: string | null): string {
    const model = snapshot?.models.find((item) => item.id === (selectedId ?? snapshot.currentModelId));
    if (!model) return '请选择语音识别模型';
    if (operation === 'selecting') return '正在切换模型';
    if (operation === 'downloading' || model.installedState === 'downloading') {
        const percent = model.totalBytes > 0 ? Math.round((model.downloadedBytes / model.totalBytes) * 100) : 0;
        return `下载中 ${Math.min(100, Math.max(0, percent))}%`;
    }
    if (model.installedState === 'verifying') return '正在校验模型';
    if (model.installedState === 'failed') return model.errorMessage || '下载未完成，请重试';
    if (model.installedState === 'installed' || model.installedState === 'ready') return '已安装';
    return '尚未下载';
}

export function describeAsrModel(model: AsrModelSnapshot['models'][number]): string {
    const size = `${Math.max(1, Math.round(model.estimatedBytes / 1_000_000))} MB`;
    return `${model.languages.join(' · ')} · ${size} · ${model.supportsHotwords ? '支持热词' : '不支持热词'}`;
}

export function createAsrModelActions(api: MeetingMonsterApi) {
    return {
        refresh: () => api.asrModels.list(),
        select: (id: AsrModelId) => api.asrModels.select(id),
        download: (id: AsrModelId) => api.asrModels.download(id),
        cancel: (id: AsrModelId) => api.asrModels.cancel(id),
        delete: (id: AsrModelId) => api.asrModels.delete(id),
    };
}
