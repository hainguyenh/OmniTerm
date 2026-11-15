/** The IDE's frame bridge (`window.omniterm`), injected before the page's scripts. */
interface OmnitermDocumentState {
  version: number;
  text: string;
}

interface OmnitermTextEdit {
  from: number;
  to: number;
  insert: string;
}

interface OmnitermFileFilter {
  name: string;
  extensions: string[];
}

interface OmnitermBridge {
  postMessage(text: string): void;
  onMessage(fn: (text: string) => void): void;
  readonly theme: { dark: boolean; vars: Readonly<Record<string, string>> } | null;
  onThemeChange(fn: (theme: { dark: boolean; vars: Readonly<Record<string, string>> }) => void): void;
  document: {
    /** `name`: the file's name, without its directory. */
    get(): Promise<OmnitermDocumentState & { readOnly: boolean; name: string }>;
    onChange(fn: (state: OmnitermDocumentState) => void): void;
    edit(version: number, edits: OmnitermTextEdit[]): Promise<{ version: number }>;
    replace(version: number, text: string): Promise<{ version: number }>;
  };
  saveFile(options: {
    name: string;
    data: string | Uint8Array | ArrayBuffer | Blob;
    filters?: OmnitermFileFilter[];
  }): Promise<string | null>;
  openFile(options?: { filters?: OmnitermFileFilter[] }): Promise<{ name: string; data: Uint8Array } | null>;
}

interface Window {
  omniterm?: OmnitermBridge;
}
