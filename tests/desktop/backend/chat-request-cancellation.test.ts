import {describe, expect, it, vi} from 'vitest';
import {cancelChatRequestsForSender} from '../../../desktop/src/main/chat-request-cancellation';

describe('sender-scoped chat request cancellation', () => {
    it('aborts and removes only requests owned by the lost sender', () => {
        const lostSender = {id: 1};
        const liveSender = {id: 2};
        const lostCancel = vi.fn();
        const liveCancel = vi.fn();
        const lostController = new AbortController();
        const liveController = new AbortController();
        const requests = new Map([
            ['lost-request', {
                controller: lostController,
                sender: lostSender,
                backendRequestId: 'lost-request:1',
                backend: {cancel: lostCancel},
            }],
            ['live-request', {
                controller: liveController,
                sender: liveSender,
                backendRequestId: 'live-request:2',
                backend: {cancel: liveCancel},
            }],
        ]);

        cancelChatRequestsForSender(requests, lostSender);

        expect(lostController.signal.aborted).toBe(true);
        expect(lostCancel).toHaveBeenCalledOnce();
        expect(lostCancel).toHaveBeenCalledWith('lost-request:1');
        expect(requests.has('lost-request')).toBe(false);
        expect(liveController.signal.aborted).toBe(false);
        expect(liveCancel).not.toHaveBeenCalled();
        expect([...requests.keys()]).toEqual(['live-request']);
    });
});
