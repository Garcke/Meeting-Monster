const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const OPEN_THINK_TO_END = /<think>[\s\S]*$/i;
const CLOSE_THINK = /<\/think>/gi;

export function stripAssistantThinking(markdown: string): string {
    return markdown
        .replace(THINK_BLOCK, '')
        .replace(OPEN_THINK_TO_END, '')
        .replace(CLOSE_THINK, '')
        .trimStart();
}
