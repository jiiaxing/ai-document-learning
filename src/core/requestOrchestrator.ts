import { nextRequestState, RequestState } from './requestStateMachine';

export class RequestOrchestrator {
    private requestSeq = 0;
    private activeRequestSeq = 0;
    private state: RequestState = RequestState.Idle;
    private suppressAutoUntil = 0;

    public beginManualInteraction(): void {
        this.suppressAutoUntil = 0;
        this.state = nextRequestState(this.state, 'manualInteraction');
    }

    public canAutoTrigger(now = Date.now()): boolean {
        if (this.state === RequestState.Cancelled && now >= this.suppressAutoUntil) {
            this.state = nextRequestState(this.state, 'autoSuppressExpired');
        }

        return now >= this.suppressAutoUntil && this.state !== RequestState.Cancelling;
    }

    public startRequest(): { started: true; requestId: number } | { started: false } {
        if (this.state === RequestState.Running || this.state === RequestState.Cancelling) {
            return { started: false };
        }

        const requestId = ++this.requestSeq;
        this.activeRequestSeq = requestId;
        this.state = nextRequestState(this.state, 'start');
        return { started: true, requestId };
    }

    public cancelCurrentRequest(): boolean {
        if (this.state !== RequestState.Running) {
            return false;
        }

        this.state = nextRequestState(this.state, 'cancel');
        this.suppressAutoUntil = Date.now();
        this.activeRequestSeq = ++this.requestSeq;
        this.state = nextRequestState(this.state, 'finish');
        return true;
    }

    public isCurrentRequest(requestId: number): boolean {
        return requestId === this.activeRequestSeq;
    }

    public finishRequest(requestId: number, wasCancelled: boolean): void {
        if (!this.isCurrentRequest(requestId)) {
            return;
        }

        if (wasCancelled) {
            this.suppressAutoUntil = Date.now();
            this.state = RequestState.Cancelled;
            return;
        }

        this.state = nextRequestState(this.state, 'finish');
    }

    public getSnapshot(now = Date.now()): {
        requestSeq: number;
        activeRequestSeq: number;
        state: RequestState;
        suppressAutoUntil: number;
        canAutoTrigger: boolean;
    } {
        return {
            requestSeq: this.requestSeq,
            activeRequestSeq: this.activeRequestSeq,
            state: this.state,
            suppressAutoUntil: this.suppressAutoUntil,
            canAutoTrigger: now >= this.suppressAutoUntil && this.state !== RequestState.Cancelling
        };
    }
}
