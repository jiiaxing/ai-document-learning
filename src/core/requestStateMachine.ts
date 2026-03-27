export enum RequestState {
    Idle = 'idle',
    Running = 'running',
    Cancelling = 'cancelling',
    Cancelled = 'cancelled'
}

export type RequestEvent =
    | 'start'
    | 'cancel'
    | 'finish'
    | 'manualInteraction'
    | 'autoSuppressExpired';

export function nextRequestState(current: RequestState, event: RequestEvent): RequestState {
    switch (event) {
        case 'start':
            return RequestState.Running;
        case 'cancel':
            return current === RequestState.Running ? RequestState.Cancelling : current;
        case 'finish':
            if (current === RequestState.Cancelling) {
                return RequestState.Cancelled;
            }
            return RequestState.Idle;
        case 'manualInteraction':
            return current === RequestState.Cancelled ? RequestState.Idle : current;
        case 'autoSuppressExpired':
            return current === RequestState.Cancelled ? RequestState.Idle : current;
        default:
            return current;
    }
}
