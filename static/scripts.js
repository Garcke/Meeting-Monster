import PCMAudioRecorder from './audio_recorder.js';

// ================== FastAPI参数配置 ==================
const API_BASE_URL = "http://localhost:2333"; // FastAPI 地址（llm_api.py 服务）
const MODEL_CONFIG_STORAGE_KEY = "aiChatModelConfig"; // 本地存储键名
let SYSTEM_PROMPT = ""; // 提示词初始化为空，后续从文件中读取
const RECOGNITION_MESSAGE_CLASS = 'recognition-message';

// ================== 快捷键配置 ==================
const SHORTCUT_KEYS = {
    'KeyC': 'clearButton',   // C键清除文本
    'KeyF': 'outputButton'   // F键输出文本
};
const activate_audio = 'KeyA'

// ================== DOM元素 ==================
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const chat = document.getElementById('chat');
const outputDiv = document.getElementById('outputText');
const textInput = document.getElementById('inputBox');
document.getElementById('saveTXTButton').addEventListener('click', saveHistoryAsTXT);
const modelConfigButton = document.getElementById('modelConfigButton');
const modelConfigModal = document.getElementById('modelConfigModal');
const modelApiKeyInput = document.getElementById('modelApiKey');
const modelBaseUrlInput = document.getElementById('modelBaseUrl');
const modelNameInput = document.getElementById('modelNameInput');
const modelDropdown = document.getElementById('modelDropdown');
const modelConfigSaveButton = document.getElementById('modelConfigSaveButton');
const modelConfigCancelButton = document.getElementById('modelConfigCancelButton');
const modelTestConnectionButton = document.getElementById('modelTestConnectionButton');
const modelTestResult = document.getElementById('modelTestResult');

// ================== 全局变量 ==================
let activeResponseMessage = addMessage('>', 'response-message');
let recorder = new PCMAudioRecorder();
let ws = null;
let completeTexts = []; // 存储所有完整识别结果
let aiConversationHistory = []; // 存储AI对话历史
let isUserScrolling = false; // 用户是否正在手动滚动
let isSending = false; // 防止重复提交

// 当前使用的模型配置（从 localStorage 初始化）
let currentModelConfig = loadModelConfigFromStorage();

// ================== 模型配置相关函数 ==================
function loadModelConfigFromStorage() {
    try {
        const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        console.warn('读取模型配置失败，将使用默认配置:', e);
        return {};
    }
}

function saveModelConfigToStorage(config) {
    try {
        localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config || {}));
        currentModelConfig = config || {};
    } catch (e) {
        console.error('保存模型配置到本地失败:', e);
    }
}

function getModelPayloadForRequest() {
    // 每次请求都从 localStorage 读取，确保使用最新保存的配置（避免“保存新模型后仍用旧模型”）
    const cfg = loadModelConfigFromStorage() || {};
    const payload = {};

    if (cfg.modelName) payload.model = cfg.modelName;
    if (cfg.apiKey) payload.api_key = cfg.apiKey;
    if (cfg.baseUrl) payload.base_url = cfg.baseUrl;

    return payload;
}

// 显示/隐藏测试结果
function showModelTestResult(success, message) {
    if (!modelTestResult) return;
    modelTestResult.textContent = message || (success ? '连接成功' : '连接失败');
    modelTestResult.classList.remove('hidden', 'success', 'error');
    modelTestResult.classList.add(success ? 'success' : 'error');
}

function hideModelTestResult() {
    if (modelTestResult) {
        modelTestResult.classList.add('hidden');
        modelTestResult.textContent = '';
    }
}

// 当前模型名：直接使用输入框
function getCurrentModelName() {
    return modelNameInput?.value?.trim() || '';
}

// 缓存最近一次从后端获取的模型列表
let availableModels = [];

// 测试连接：
// - 若已输入模型名：调用 /test_connection/ 测试该模型
// - 若未输入模型名：调用 /models/list/ 获取模型列表并填充 datalist
modelTestConnectionButton?.addEventListener('click', async () => {
    const baseUrl = modelBaseUrlInput?.value?.trim() || '';
    const apiKey = modelApiKeyInput?.value?.trim() || '';
    const model = getCurrentModelName().trim();

    if (!baseUrl || !apiKey) {
        showModelTestResult(false, '请先填写 Base URL 和 API Key。');
        return;
    }

    hideModelTestResult();
    modelTestConnectionButton.disabled = true;
    try {
        if (model) {
            // 已指定模型名：直接测试该模型
            const response = await fetch(`${API_BASE_URL}/test_connection/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model }),
            });
            const data = await response.json().catch(() => ({}));
            const success = data.success === true;
            showModelTestResult(success, data.message || (success ? '连接成功' : '请求失败'));
        } else {
            // 未指定模型名：尝试获取可用模型列表并填充下拉菜单
            const response = await fetch(`${API_BASE_URL}/models/list/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
            });
            const data = await response.json().catch(() => ({}));
            const models = Array.isArray(data.models) ? data.models : [];

            if (models.length > 0 && modelDropdown) {
                availableModels = models;
                renderModelDropdown(models);
                showModelTestResult(true, `已获取 ${models.length} 个可用模型，可在上方输入框中点击选择。`);
            } else {
                showModelTestResult(
                    false,
                    '未获取到可用模型，请检查 Base URL 和 API Key，或该接口可能不支持模型列表。'
                );
            }
        }
    } catch (e) {
        showModelTestResult(false, '网络错误: ' + (e.message || String(e)));
    } finally {
        modelTestConnectionButton.disabled = false;
    }
});

function renderModelDropdown(models) {
    if (!modelDropdown) return;
    modelDropdown.innerHTML = '';

    if (!models.length) {
        modelDropdown.classList.add('hidden');
        return;
    }

    models.forEach((id) => {
        const item = document.createElement('div');
        item.className = 'model-dropdown-item';
        item.textContent = id;
        // 用 mousedown 而不是 click，可以避免 input 先失焦导致列表消失
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (modelNameInput) modelNameInput.value = id;
            modelDropdown.classList.add('hidden');
        });
        modelDropdown.appendChild(item);
    });

    modelDropdown.classList.remove('hidden');
}

// 点击输入框时，如果已有列表，则展开下拉菜单
modelNameInput?.addEventListener('focus', () => {
    if (availableModels.length && modelDropdown) {
        renderModelDropdown(availableModels);
    }
});

// 点击弹窗区域其他地方时，关闭下拉菜单
document.addEventListener('click', (e) => {
    if (!modelDropdown || !modelConfigModal || modelConfigModal.classList.contains('hidden')) return;
    if (modelDropdown.contains(e.target) || e.target === modelNameInput) return;
    modelDropdown.classList.add('hidden');
});

// 打开模型配置弹窗
modelConfigButton?.addEventListener('click', async () => {
    hideModelTestResult();
    modelConfigModal.classList.remove('hidden');
    // 从 localStorage 同步最新配置并填入表单，与发请求时读取来源一致
    currentModelConfig = loadModelConfigFromStorage() || {};
    modelApiKeyInput.value = currentModelConfig.apiKey || '';
    modelBaseUrlInput.value = currentModelConfig.baseUrl || '';
    if (modelNameInput) modelNameInput.value = currentModelConfig.modelName || '';
});

// 关闭弹窗（取消）
modelConfigCancelButton?.addEventListener('click', () => {
    modelConfigModal.classList.add('hidden');
});

// 保存配置
modelConfigSaveButton?.addEventListener('click', () => {
    const newConfig = {
        modelName: getCurrentModelName(),
        apiKey: modelApiKeyInput.value.trim(),
        baseUrl: modelBaseUrlInput.value.trim(),
    };

    saveModelConfigToStorage(newConfig);
    addAIMessage('模型配置已保存，本次及后续会话将使用新的配置。', 'info-message');
    modelConfigModal.classList.add('hidden');
});

// ================== 滚动行为优化 ==================
outputDiv.addEventListener('scroll', () => {
    const threshold = 100; // 距离底部 100px 视为"接近底部"
    const isNearBottom =
        outputDiv.scrollHeight - outputDiv.scrollTop - outputDiv.clientHeight <= threshold;
    isUserScrolling = !isNearBottom;
});

// 全局快捷键监听
document.addEventListener('keydown', (e) => {
    // 模型配置弹窗打开时，主界面快捷键不生效，避免冲突
    if (modelConfigModal && !modelConfigModal.classList.contains('hidden')) return;
    // 排除输入框操作
    if (document.activeElement === textInput) return;

    // A键切换录音状态
    if (e.code === activate_audio) {
        e.preventDefault();

        // 根据按钮状态判断操作
        if (!startButton.disabled) {
            startButton.click(); // 触发开始录音
        } else if (!stopButton.disabled) {
            stopButton.click(); // 触发停止录音
        }
    }

    // 其他快捷键保持原样
    const targetId = SHORTCUT_KEYS[e.code];
    if (targetId) {
        const button = document.getElementById(targetId);
        if (button && !button.disabled) button.click();
    }
});

// ================== 文本输入处理 ==================
textInput.addEventListener('keydown', async (e) => {
    // Shift + Enter 换行
    if (e.shiftKey && e.key === 'Enter') {
        return; // 允许默认换行行为
    }

    // 单独按下Enter发送
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isSending && textInput.value.trim()) {
            isSending = true;
            try {
                await processTextInput(textInput.value.trim());
                textInput.value = ''; // 清空输入框
                console.log('textInput.value:', textInput.value); // 应该输出<textarea>元素
            } catch (error) {
                console.error('发送失败:', error);
                addAIMessage('消息发送失败，请重试', 'error-message');
            } finally {
                isSending = false;
            }
        }
    }
});

// ================== 输出按钮功能 ==================
document.getElementById('outputButton').addEventListener('click', async () => {
    try {
        // 1. 显示用户消息
        const userMessage = completeTexts.join('\n');
        addAIMessage(userMessage, 'user-message');

        // 2. 调用AI接口
        const bodyPayload = {
            content: userMessage,
            ...getModelPayloadForRequest(),
        };

        const response = await fetch(`${API_BASE_URL}/chat/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        // 3. 处理流式响应（SSE：按行解析 event/data，支持事件区分与简单断线重连）
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let activeAIMessage = createAIMessageElement();
        let buffer = '';

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                try {
                    const jsonResponse = JSON.parse(trimmed.slice(6));
                    if (jsonResponse.response !== undefined) {
                        assistantMessage += jsonResponse.response;
                        updateMessageWithMarkdown(activeAIMessage, assistantMessage);
                        if (!isUserScrolling) outputDiv.scrollTop = outputDiv.scrollHeight;
                    }
                } catch (e) {
                    if (trimmed !== 'data: {}') console.error('SSE parse:', e, '行:', trimmed);
                }
            }
        }

        // 4. 保存完整消息
        aiConversationHistory.push({
            user: userMessage,
            assistant: assistantMessage,
        });
    } catch (error) {
        console.error('API请求失败:', error);
        addAIMessage('AI服务连接失败，请检查网络', 'error-message');
    }
});

// ================== 清除功能 ==================
document.getElementById('clearButton').addEventListener('click', () => {
    // 1. 清空存储的识别结果
    completeTexts = [];

    // 2. 移除所有识别消息DOM元素
    const recognitionMessages = document.querySelectorAll(`.${RECOGNITION_MESSAGE_CLASS}`);
    recognitionMessages.forEach((msg) => msg.remove());

    // 3. 重置当前活动消息
    activeResponseMessage = addMessage('>', 'response-message');

    console.log('所有识别文本已清除');
});

// 从文件中读取提示词
async function loadPromptFromFile() {
    try {
        const response = await fetch('../cache/prompt.txt'); // 读取 prompt.txt 文件
        if (!response.ok) {
            throw new Error('提示词文件加载失败');
        }
        SYSTEM_PROMPT = await response.text(); // 将文件内容赋值给 SYSTEM_PROMPT
        console.log('提示词已从文件加载:', SYSTEM_PROMPT);
    } catch (error) {
        console.error('加载提示词文件时出错:', error);
        SYSTEM_PROMPT = "默认提示词：请回答我的问题。"; // 如果文件加载失败，使用默认提示词
    }
}

// 初始化时设置提示词
(async function initPrompt() {
    await loadPromptFromFile(); // 从文件中加载提示词

    try {
        const response = await fetch(`${API_BASE_URL}/set_prompt/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: SYSTEM_PROMPT,
            }),
        });
        if (!response.ok) throw new Error("提示词设置失败");
        console.log("系统提示词设置成功");
    } catch (error) {
        console.error("提示词设置错误:", error);
    }
})();

// 保存为TXT文件的功能
async function saveHistoryAsTXT() {
    try {
        const response = await fetch(`${API_BASE_URL}/history/`);
        if (!response.ok) throw new Error('获取历史失败: ' + response.status);

        const data = await response.json();
        const history = data.history;

        // 转换为易读的TXT格式
        let txtContent = `<center>=== AI 聊天记录 ===</center>\n\n`;
        let messageCount = 0;

        history.forEach((entry, index) => {
            if (entry.role === 'system') return; // 跳过系统提示词

            const prefix = entry.role === 'user' ? '[用户] ' : '[AI] ';
            txtContent += `${prefix}${entry.content}\n\n`;
            messageCount++;
        });

        if (messageCount === 0) {
            addAIMessage('当前没有可保存的聊天记录', 'info-message');
            return;
        }

        // 创建Blob并下载
        const blob = new Blob([txtContent], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `聊天历史{${new Date().toISOString().slice(0, 10)}}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        addAIMessage(`已保存 ${messageCount} 条记录到本地文件`, 'info-message');
    } catch (error) {
        console.error('保存失败:', error);
        addAIMessage(`保存失败: ${error.message}`, 'error-message');
    }
}

// 输入文本处理函数
async function processTextInput(text) {
    // 显示用户消息
    addAIMessage(text, 'user-message');

    try {
        // 调用API
        const bodyPayload = {
            content: text,
            ...getModelPayloadForRequest(),
        };

        const response = await fetch(`${API_BASE_URL}/chat/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) throw new Error(`HTTP错误: ${response.status}`);

        // 处理流式响应（SSE：只解析 data: 行，event: done 等可做断线/结束判断）
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let activeAIMessage = createAIMessageElement();
        let buffer = '';

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                try {
                    const jsonResponse = JSON.parse(trimmed.slice(6));
                    if (jsonResponse.response !== undefined) {
                        assistantMessage += jsonResponse.response;
                        updateMessageWithMarkdown(activeAIMessage, assistantMessage);
                        if (!isUserScrolling) outputDiv.scrollTop = outputDiv.scrollHeight;
                    }
                } catch (e) {
                    if (trimmed !== 'data: {}') console.error('SSE 解析:', e, '行:', trimmed);
                }
            }
        }

        // 保存对话历史
        aiConversationHistory.push({
            user: text,
            assistant: assistantMessage,
        });
    } catch (error) {
        console.error('API请求失败:', error);
        addAIMessage('服务连接失败，请检查网络', 'error-message');
        throw error;
    }
}




// 聊天消息处理函数
function createAIMessageElement() {
    const message = document.createElement('div');
    message.className = 'message ai-response-message';
    outputDiv.appendChild(message);
    return message;
}

function addAIMessage(text, className) {
    const message = document.createElement('div');
    message.className = `message ${className}`;
    message.textContent = text;
    outputDiv.appendChild(message);
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function addResponseMessage(msg) {
    const jsonObject = JSON.parse(msg);
    let text = jsonObject.text;
    let is_end = jsonObject.is_end;

    // 更新当前活动消息
    activeResponseMessage.textContent = text;

    if (is_end) {
        completeTexts.push(text); // 将完成的文本添加到数组
        activeResponseMessage = addMessage('>', 'response-message');
    }

    chat.scrollTop = chat.scrollHeight;
}

// 添加消息到聊天框
function addMessage(text, className) {
    const message = document.createElement('div');
    message.classList.add('message', className);

    // 安全添加识别类名
    if (className === 'response-message') {
        message.classList.add('recognition-message');
    }

    message.textContent = text;

    // 使用 requestAnimationFrame 避免阻塞
    requestAnimationFrame(() => {
        chat.appendChild(message);
        chat.scrollTop = chat.scrollHeight;
    });

    return message;
}

// 更新消息内容（支持 Markdown）
function updateMessageWithMarkdown(element, text) {
    requestAnimationFrame(() => {
        // 使用文档片段
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = marked.parse(text);

        // 高亮代码块
        tempDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });

        fragment.appendChild(tempDiv);
        element.innerHTML = '';
        element.appendChild(fragment);
    });
}

// ================== 录音功能 ==================
startButton.onclick = async () => {
    try {
        // 连接WebSocket
        ws = new WebSocket('ws://localhost:6220');
        console.log('[Debug] WebSocket 已创建');

        ws.onmessage = (event) => {
            const data = event.data;
            if (typeof data === 'string') {
                if (data === 'asr stopped') {
                    // ws.close();
                } else {
                    console.log('recv msg: ', data);
                    addResponseMessage(data);
                }
            }
        };

        console.log('[Debug] 正在初始化录音...');

        await recorder.connect(async (pcmData) => {
            console.log('[Debug] 收到音频数据，长度:', pcmData.length);
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('send audio');
                ws.send(pcmData);
            }
        });

        startButton.disabled = true;
        stopButton.disabled = false;
        console.log('[Debug] 录音已启动');
    } catch (error) {
        console.error('Error:', error);
    }
};

stopButton.onclick = () => {
    recorder.stop();
    if (ws) {
        ws.send('stop');
    }
    startButton.disabled = false;
    stopButton.disabled = true;
};