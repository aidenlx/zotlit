export function drawMeshWithGPU(posData: any, colData: any, vertexCount: any, context: any, backgroundColor: any, paddedWidth: any, paddedHeight: any, borderSize: any): ImageBitmap;
/**
 * Start GPU initialization as early as possible.
 * @returns {Promise<boolean>}  true if a GPU device was acquired.
 */
export function initGPU(): Promise<boolean>;
export function isGPUReady(): boolean;
/**
 * Pre-compile the Gouraud-mesh WGSL pipeline.
 */
export function loadMeshShader(): void;
