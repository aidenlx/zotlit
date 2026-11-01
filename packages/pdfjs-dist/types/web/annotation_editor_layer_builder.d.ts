export type PDFPageProxy = import("../src/display/api").PDFPageProxy;
export type PageViewport = import("../src/display/display_utils").PageViewport;
export type AnnotationEditorUIManager = import("../src/display/editor/tools.js").AnnotationEditorUIManager;
export type TextAccessibilityManager = import("./text_accessibility.js").TextAccessibilityManager;
export type AnnotationLayer = import("../src/display/annotation_layer.js").AnnotationLayer;
export type StructTreeLayerBuilder = any;
export type AnnotationEditorLayerBuilderOptions = {
    uiManager?: import("../src/pdf").AnnotationEditorUIManager | undefined;
    pageIndex: number;
    l10n?: L10n;
    structTreeLayer?: StructTreeLayerBuilder;
    accessibilityManager?: import("./text_accessibility.js").TextAccessibilityManager | undefined;
    annotationLayer?: import("../src/pdf").AnnotationLayer | undefined;
    textLayer?: TextLayer;
    drawLayer?: DrawLayer;
    onAppend?: Function | undefined;
};
export type AnnotationEditorLayerBuilderRenderOptions = {
    viewport: PageViewport;
    /**
     * - The default value is "display".
     */
    intent?: string | undefined;
};
/**
 * @typedef {Object} AnnotationEditorLayerBuilderOptions
 * @property {AnnotationEditorUIManager} [uiManager]
 * @property {number} pageIndex
 * @property {L10n} [l10n]
 * @property {StructTreeLayerBuilder} [structTreeLayer]
 * @property {TextAccessibilityManager} [accessibilityManager]
 * @property {AnnotationLayer} [annotationLayer]
 * @property {TextLayer} [textLayer]
 * @property {DrawLayer} [drawLayer]
 * @property {function} [onAppend]
 */
/**
 * @typedef {Object} AnnotationEditorLayerBuilderRenderOptions
 * @property {PageViewport} viewport
 * @property {string} [intent] - The default value is "display".
 */
export class AnnotationEditorLayerBuilder {
    /**
     * @param {AnnotationEditorLayerBuilderOptions} options
     */
    constructor(options: AnnotationEditorLayerBuilderOptions);
    pageIndex: number;
    accessibilityManager: import("./text_accessibility.js").TextAccessibilityManager | undefined;
    l10n: any;
    annotationEditorLayer: AnnotationEditorLayer | null;
    div: HTMLDivElement | null;
    _cancelled: boolean;
    updatePageIndex(newPageIndex: any): void;
    /**
     * @param {AnnotationEditorLayerBuilderRenderOptions} options
     * @returns {Promise<void>}
     */
    render({ viewport, intent }: AnnotationEditorLayerBuilderRenderOptions): Promise<void>;
    cancel(): void;
    hide(): void;
    show(): void;
    #private;
}
import { AnnotationEditorLayer } from "../src/pdf";
