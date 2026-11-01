/**
 * Taken from https://github.com/shivaprsd/doq MIT License
 *
 * Interface for storing and processing sRGB colors in CIELAB
 * Adapted from => https://github.com/LeaVerou/color.js
 */
declare class Color {
    static parseHex(str: any): any[];
    static parseRGB(str: any): any;
    static parseRGBA(str: any): any[];
    static compToHex(c: any): any;
    constructor(...args: any[]);
    _lab: any[] | undefined;
    _rgb: any;
    _hex: string | undefined;
    get hex(): string;
    get rgb(): any;
    get lab(): any[];
    get lightness(): any;
    get chroma(): number;
    get alpha(): any;
    deltaE(color: any): number;
    range(color: any): (p: any) => Color;
    toHex(alpha?: number): string;
}
declare namespace Color {
    let white: Color;
}
export default Color;
