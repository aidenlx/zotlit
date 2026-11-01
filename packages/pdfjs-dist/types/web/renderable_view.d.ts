export class RenderableView {
    /**
     * Unique ID for rendering queue.
     * @type {string}
     */
    renderingId: string;
    /**
     * @type {import("../src/display/api").RenderTask | null}
     */
    renderTask: import("../src/display/api").RenderTask | null;
    /**
     * @type {function | null}
     */
    resume: Function | null;
    /**
     * @param {number} state
     */
    set renderingState(state: number);
    /**
     * @type {number}
     */
    get renderingState(): number;
    /**
     * @returns {Promise} Resolved on draw completion.
     */
    draw(): Promise<any>;
}
export namespace RenderingStates {
    let INITIAL: number;
    let RUNNING: number;
    let PAUSED: number;
    let FINISHED: number;
}
