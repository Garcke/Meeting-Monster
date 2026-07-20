const FALLBACK_PROFILES = [
    {
        id: 'generic_openai', label: 'OpenAI', protocol: 'openai', model: '后端默认模型',
        api_key_required: false, has_api_key: false, max_tokens: 4096, temperature: 0.3, active: false,
    },
    {
        id: 'generic_anthropic', label: 'Anthropic', protocol: 'anthropic', model: '后端默认模型',
        api_key_required: false, has_api_key: false, max_tokens: 4096, temperature: 0.3, active: false,
    },
];

export class ModelSettingsController {
    constructor({api, elements, onActiveModelChanged}) {
        this.api = api;
        this.elements = elements;
        this.onActiveModelChanged = onActiveModelChanged;
        this.profiles = [];
        this.selectedProfile = null;
        this.savedConnection = null;
    }

    bind() {
        const {modelForm, modelProtocol, modelTestButton, modelSaveButton} = this.elements;
        modelForm?.addEventListener('submit', (event) => event.preventDefault());
        modelProtocol?.addEventListener('change', () => this.selectProtocol(modelProtocol.value));
        modelTestButton?.addEventListener('click', () => this.testProfile());
        modelSaveButton?.addEventListener('click', () => this.saveConnection());
    }

    async refreshModels() {
        const {modelList, modelStatus} = this.elements;
        const saved = this.api.models.getSaved
            ? await this.api.models.getSaved().catch(() => null)
            : null;
        this.savedConnection = saved;
        try {
            const result = await this.api.models.list();
            const configuredProfiles = Array.isArray(result?.profiles) ? result.profiles : [];
            this.profiles = configuredProfiles.length
                ? configuredProfiles
                : FALLBACK_PROFILES.map((profile) => ({...profile}));
            const selected = this.#findSavedProfile(saved)
                || this.profiles.find((profile) => profile.id === result.active_profile)
                || this.profiles[0]
                || null;
            this.selectProfile(selected, {render: false});
            this.renderModels();
            if (modelStatus) modelStatus.textContent = saved?.has_api_key
                ? '已加载保存的连接'
                : (configuredProfiles.length ? '' : '后端尚未配置可用模型，当前显示本地厂商选项');
            return this.profiles;
        } catch (error) {
            this.profiles = FALLBACK_PROFILES.map((profile) => ({...profile}));
            const selected = this.#findSavedProfile(saved)
                || this.profiles.find((profile) => profile.protocol === saved?.protocol)
                || this.profiles[0];
            this.selectProfile(selected, {render: false});
            this.renderModels();
            if (modelStatus) modelStatus.textContent = `Python 服务未连接，已显示本地厂商选项：${error.message || '请先启动 127.0.0.1:9000'}`;
            return this.profiles;
        }
    }

    selectProtocol(protocol) {
        const profile = this.profiles.find((candidate) => candidate.protocol === protocol);
        if (!profile) {
            const {modelStatus} = this.elements;
            if (modelStatus) modelStatus.textContent = `后端尚未配置 ${protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'} 模型`;
            return null;
        }
        return this.selectProfile(profile);
    }

    selectProfile(profile, {render = true} = {}) {
        if (!profile) return null;
        this.selectedProfile = profile;
        const {modelProtocol, modelApiKey, modelMaxTokens, modelTemperature, modelStatus} = this.elements;
        if (modelProtocol) modelProtocol.value = profile.protocol || 'openai';
        if (modelMaxTokens) modelMaxTokens.value = String(profile.max_tokens || 4096);
        if (modelTemperature) modelTemperature.value = profile.temperature == null ? '' : String(profile.temperature);
        if (modelApiKey) modelApiKey.value = '';
        if (modelStatus) modelStatus.textContent = `已选择：${profile.label || profile.model}`;
        if (render) this.renderModels();
        this.onActiveModelChanged?.(profile, this.getSelection());
        return profile;
    }

    getSelection() {
        return this.#selectionFromForm();
    }

    async saveConnection() {
        const {modelStatus, modelProtocol} = this.elements;
        try {
            const selection = this.#selectionFromForm();
            const saved = await this.api.models.save({
                ...selection,
                protocol: modelProtocol?.value || this.selectedProfile.protocol,
            });
            this.savedConnection = saved;
            if (modelStatus) modelStatus.textContent = '连接已保存到本机安全存储';
            return saved;
        } catch (error) {
            if (modelStatus) modelStatus.textContent = `连接保存失败：${error.message || '请重试'}`;
            throw error;
        }
    }

    async testProfile() {
        const {modelStatus} = this.elements;
        try {
            const result = await this.api.models.test(this.#selectionFromForm());
            if (modelStatus) modelStatus.textContent = result.ok
                ? `模型连接成功：${result.model}（${result.latency_ms}ms）`
                : '模型连接失败，请检查后端配置';
            return result;
        } catch (error) {
            if (modelStatus) modelStatus.textContent = `模型连接失败：${error.message || '请检查后端配置'}`;
            throw error;
        }
    }

    renderModels() {
        const {modelList} = this.elements;
        if (!modelList || typeof document === 'undefined') return;
        modelList.replaceChildren(...this.profiles.map((profile) => this.#createProfileRow(profile)));
    }

    #findSavedProfile(saved) {
        if (!saved) return null;
        return this.profiles.find((profile) => profile.id === saved.profile_id)
            || this.profiles.find((profile) => profile.protocol === saved.protocol)
            || null;
    }

    #selectionFromForm() {
        if (!this.selectedProfile?.id) throw new Error('请先选择模型');
        const {modelApiKey, modelMaxTokens, modelTemperature} = this.elements;
        const selection = {
            profile_id: this.selectedProfile.id,
            max_tokens: Number(modelMaxTokens?.value || this.selectedProfile.max_tokens),
            temperature: modelTemperature?.value?.trim() === ''
                ? undefined
                : Number(modelTemperature?.value ?? this.selectedProfile.temperature),
        };
        const apiKey = modelApiKey?.value?.trim();
        if (apiKey) selection.api_key = apiKey;
        return selection;
    }

    #createProfileRow(profile) {
        const row = document.createElement('article');
        row.className = `model-row${profile.id === this.selectedProfile?.id ? ' is-selected' : ''}`;
        const summary = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = labelForProfile(profile);
        const detail = document.createElement('span');
        detail.textContent = `${profile.protocol} · ${profile.model}${profile.active ? ' · 默认' : ''}`;
        summary.append(label, detail);
        const actions = document.createElement('div');
        actions.className = 'model-row-actions';
        actions.append(this.#button(profile.id === this.selectedProfile?.id ? '已选择' : '选择', () => this.selectProfile(profile)));
        row.append(summary, actions);
        return row;
    }

    #button(label, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', handler);
        return button;
    }
}

function labelForProfile(profile) {
    if (profile.label && !profile.label.toLowerCase().includes('generic')) return profile.label;
    return profile.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI';
}
