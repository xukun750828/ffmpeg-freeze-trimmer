export {};

declare global {
  interface Window {
    desktopApi?: {
      getAppVersion(): Promise<string>;
    };
  }
}
