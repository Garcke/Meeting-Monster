export type WebShortcutSurface = 'overlay' | 'settings';
export type WebShortcutAction =
    | 'allow'
    | 'prevent'
    | 'toggle-transcription'
    | 'clear-chat';

export interface WebShortcutInput {
    type: string;
    key: string;
    control: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
}

export function classifyWebShortcut(
    input: WebShortcutInput,
    surface: WebShortcutSurface,
    chatExpanded: boolean,
): WebShortcutAction {
    if (input.type !== 'keyDown') return 'allow';
    const key = input.key.toLowerCase();
    const command = input.control || input.meta;
    if (key === 'f5' || key === 'f11' || key === 'f12') return 'prevent';
    if (!command || input.alt) return 'allow';
    if (surface === 'overlay' && !input.shift && key === 's') {
        return 'toggle-transcription';
    }
    if (surface === 'overlay' && !input.shift && key === 'r') {
        return chatExpanded ? 'clear-chat' : 'prevent';
    }
    if (key === 's' || key === 'r' || key === 'u' || key === 'p'
        || key === 'f' || key === '+' || key === '-' || key === '0') {
        return 'prevent';
    }
    if (input.shift && key === 'i') return 'prevent';
    return 'allow';
}
