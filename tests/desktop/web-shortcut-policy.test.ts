import {describe, expect, it} from 'vitest';
import {classifyWebShortcut, type WebShortcutInput} from '../../desktop/src/main/web-shortcut-policy';

function ctrl(key: string, overrides: Partial<WebShortcutInput> = {}): WebShortcutInput {
    return {type: 'keyDown', key, control: true, meta: false, shift: false, alt: false, ...overrides};
}

describe('web shortcut policy', () => {
    it('routes overlay Ctrl+S and Ctrl+R through local workspace actions', () => {
        expect(classifyWebShortcut(ctrl('s'), 'overlay', false)).toBe('toggle-transcription');
        expect(classifyWebShortcut(ctrl('r'), 'overlay', true)).toBe('clear-chat');
        expect(classifyWebShortcut(ctrl('r'), 'overlay', false)).toBe('prevent');
    });

    it('prevents Ctrl+S and Ctrl+R in settings', () => {
        expect(classifyWebShortcut(ctrl('s'), 'settings', false)).toBe('prevent');
        expect(classifyWebShortcut(ctrl('r'), 'settings', false)).toBe('prevent');
    });

    it.each([
        ctrl('F5', {control: false}),
        ctrl('F11', {control: false}),
        ctrl('F12', {control: false}),
        ctrl('r', {shift: true}),
        ctrl('i', {shift: true}),
        ctrl('u'),
        ctrl('p'),
        ctrl('f'),
        ctrl('+'),
        ctrl('='),
        ctrl('-'),
        ctrl('0'),
    ])('prevents browser or debug shortcut %#', (input) => {
        expect(classifyWebShortcut(input, 'overlay', false)).toBe('prevent');
    });

    it.each([
        ctrl('c'), ctrl('v'), ctrl('x'), ctrl('a'), ctrl('z'), ctrl('y'),
        ctrl('F4', {control: false, alt: true}),
        ctrl('ArrowLeft', {control: false}), ctrl('Backspace', {control: false}),
        ctrl('Delete', {control: false}), ctrl('Tab', {control: false}),
    ])('allows editing and system shortcut %#', (input) => {
        expect(classifyWebShortcut(input, 'overlay', false)).toBe('allow');
    });

    it('allows key-up events', () => {
        expect(classifyWebShortcut(ctrl('s', {type: 'keyUp'}), 'overlay', false)).toBe('allow');
    });
});
