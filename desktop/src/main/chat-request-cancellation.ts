export interface SenderScopedChatRequest<Sender> {
    controller: AbortController;
    sender: Sender;
    backendRequestId: string;
    backend?: {cancel(requestId: string): unknown};
}

export function cancelChatRequestsForSender<
    Sender,
    Request extends SenderScopedChatRequest<Sender>,
>(requests: Map<string, Request>, sender: Sender): void {
    for (const [id, request] of requests) {
        if (request.sender !== sender) continue;
        if (requests.get(id) === request) requests.delete(id);
        request.controller.abort();
        try {
            request.backend?.cancel(request.backendRequestId);
        } catch {
            // Renderer/window teardown must continue even if a backend cancellation fails.
        }
    }
}
