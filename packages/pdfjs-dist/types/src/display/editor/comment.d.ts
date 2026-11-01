export class Comment {
    constructor(editor: any);
    renderForToolbar(): any;
    renderForStandalone(): any;
    focusButton(): void;
    onUpdatedColor(): void;
    get commentButtonWidth(): number;
    set commentPopupPositionInLayer(pos: number[] | null);
    get commentPopupPositionInLayer(): number[] | null;
    hasDefaultPopupPosition(): boolean;
    removeStandaloneCommentButton(): void;
    removeToolbarCommentButton(): void;
    setCommentButtonStates({ selected, hasPopup }: {
        selected: any;
        hasPopup: any;
    }): void;
    edit(options: any): void;
    finish(): void;
    isDeleted(): boolean;
    isEmpty(): boolean;
    hasBeenEdited(): boolean;
    serialize(): {
        text: null;
        richText: null;
        date: null;
        deleted: boolean;
    };
    /**
     * Set the comment data.
     */
    set data(text: {
        text: null;
        richText: null;
        date: null;
        deleted: boolean;
    });
    get data(): {
        text: null;
        richText: null;
        date: null;
        deleted: boolean;
    };
    /**
     * Restore the comment data (used for undo).
     * @param {Object} data - The comment data to restore.
     * @param {string} data.text - The comment text.
     * @param {string|null} data.richText - The rich text content.
     * @param {Date|null} data.date - The original date.
     */
    restoreData({ text, richText, date }: {
        text: string;
        richText: string | null;
        date: Date | null;
    }): void;
    setInitialText(text: any, richText?: null): void;
    shown(): void;
    destroy(): void;
    #private;
}
