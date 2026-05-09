import { Plugin } from "obsidian";
import "./zt-main.css";

export default class ZotLitPlugin extends Plugin {
  override async onload(): Promise<void> {
    await super.onload();
    console.log("ZotLit loaded");
  }
}
