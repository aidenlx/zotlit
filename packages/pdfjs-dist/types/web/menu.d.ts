export class Menu {
    /**
     * Create a menu for the given button.
     * @param {HTMLElement} menuContainer
     * @param {HTMLElement} triggeringButton
     * @param {Array<HTMLElement>|null} menuItems
     */
    constructor(menuContainer: HTMLElement, triggeringButton: HTMLElement, menuItems: Array<HTMLElement> | null);
    destroy(): void;
    #private;
}
