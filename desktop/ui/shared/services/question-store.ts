export type AnswerStatus = 'idle' | 'loading' | 'complete' | 'error';
export interface Question {
    id: string;
    text: string;
    source: 'asr' | 'manual';
    answer: string;
    answerStatus: AnswerStatus;
    errorMessage: string;
}

export class QuestionStore {
    private questions: Question[] = [];
    private selectedIds = new Set<string>();
    private selectedId: string | null = null;
    private nextId = 1;

    public addQuestion(text: string, source: Question['source'] = 'asr'): Question | null {
        const normalized = String(text || '').trim();
        if (!normalized) return null;
        const question: Question = {id: `question-${this.nextId++}`, text: normalized, source, answer: '', answerStatus: 'idle', errorMessage: ''};
        this.questions = [...this.questions, question];
        if (source === 'manual') this.selectedIds.clear();
        this.selectedIds.add(question.id);
        this.selectedId = question.id;
        return question;
    }
    public getQuestion(id: string | null): Question | null {
        const question = this.questions.find((item) => item.id === id);
        return question ? {...question} : null;
    }
    public getQuestions(): readonly Question[] { return this.questions.map((question) => ({...question})); }
    public getSelectedIds(): string[] {
        return this.questions.filter((question) => this.selectedIds.has(question.id)).map((question) => question.id);
    }
    public getSelectedQuestions(): Question[] {
        return this.questions.filter((question) => this.selectedIds.has(question.id)).map((question) => ({...question}));
    }
    public getSelected(): Question | null {
        const selected = this.selectedId && this.selectedIds.has(this.selectedId)
            ? this.selectedId
            : [...this.selectedIds].at(-1) ?? null;
        this.selectedId = selected;
        return this.getQuestion(selected);
    }
    public selectQuestion(id: string): Question | null {
        if (!this.getQuestion(id)) return null;
        this.selectedIds = new Set([id]);
        this.selectedId = id;
        return this.getSelected();
    }
    public toggleQuestion(id: string): boolean {
        if (!this.getQuestion(id)) return false;
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
            if (this.selectedId === id) this.selectedId = [...this.selectedIds].at(-1) ?? null;
            return false;
        }
        this.selectedIds.add(id);
        this.selectedId = id;
        return true;
    }
    public resetAnswer(id: string): Question | null { return this.update(id, {answer: '', errorMessage: '', answerStatus: 'idle'}); }
    public appendAnswer(id: string, chunk: string): Question | null { const current = this.getQuestion(id); return current ? this.update(id, {answer: current.answer + String(chunk || '')}) : null; }
    public setAnswerStatus(id: string, answerStatus: AnswerStatus, errorMessage = ''): Question | null { return this.update(id, {answerStatus, errorMessage}); }
    public clear(): void { this.questions = []; this.selectedIds.clear(); this.selectedId = null; this.nextId = 1; }
    private update(id: string, patch: Partial<Question>): Question | null {
        if (!this.getQuestion(id)) return null;
        this.questions = this.questions.map((item) => item.id === id ? {...item, ...patch} : item);
        return this.getQuestion(id);
    }
}
